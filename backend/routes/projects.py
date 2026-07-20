from __future__ import annotations

from fastapi import APIRouter, BackgroundTasks, HTTPException, Query, Request, Response

from backend import audit_repository, config, repository, uc_grants
from backend import auth, lookup_repository
from backend.csv_util import infer_fields_from_csv, parse_records_csv, preview_records_csv, records_to_csv
from backend.deps import assert_role, project_to_summary, require_role
from backend.sql_errors import SqlPermissionError, UserAuthorizationRequiredError
from backend.sql_util import request_connection, request_connections
from backend.validation import build_lookup_allowed, validate_record_values
from backend.timing import track_request
from backend.models import (
    AddMemberRequest,
    AddMemberResponse,
    CreateProjectRequest,
    CreateRecordRequest,
    CsvFormPreview,
    FieldDefinition,
    ImportRecordError,
    ImportRecordsCsvRequest,
    ImportRecordsResult,
    InferredColumn,
    PreviewCsvRequest,
    PreviewRecordsCsvRequest,
    ProjectDetail,
    ProjectMember,
    ProjectSummary,
    RecordAuditEntry,
    RecordCsvPreview,
    RecordRow,
    SaveFieldsRequest,
    SyncStagedRecordsResult,
    UpdateProjectRequest,
    UpdateRecordRequest,
    WorkspaceUser,
)

router = APIRouter(prefix="/projects", tags=["projects"])


def _resolve_storage_targets(
    *,
    storage_type: str,
    name: str,
    target_catalog: str | None = None,
    target_schema: str | None = None,
    target_table: str | None = None,
) -> dict[str, str]:
    if storage_type == "lakebase":
        from backend import lakebase_config

        try:
            lakebase_config.require_configured()
        except RuntimeError as exc:
            raise HTTPException(status_code=400, detail=str(exc)) from exc
        schema = (target_schema or lakebase_config.default_schema()).strip()
        table = (target_table or f"{repository.slugify(name)}_data").strip()
        return {
            "target_catalog": lakebase_config.database_name(),
            "target_schema": config.validate_identifier(schema, "schema"),
            "target_table": config.validate_identifier(table, "table"),
        }

    return _validate_storage_targets(
        target_catalog=target_catalog or config.DEFAULT_DATA_CATALOG,
        target_schema=target_schema or config.DEFAULT_DATA_SCHEMA,
        target_table=target_table or f"{repository.slugify(name)}_data",
    )


def _validate_storage_targets(
    *,
    target_catalog: str | None = None,
    target_schema: str | None = None,
    target_table: str | None = None,
) -> dict[str, str]:
    validated: dict[str, str] = {}
    if target_catalog is not None:
        validated["target_catalog"] = config.validate_identifier(target_catalog.strip(), "catalog")
    if target_schema is not None:
        validated["target_schema"] = config.validate_identifier(target_schema.strip(), "schema")
    if target_table is not None:
        validated["target_table"] = config.validate_identifier(target_table.strip(), "table")
    return validated


def _validate_sync_targets(
    *,
    sync_catalog: str | None = None,
    sync_schema: str | None = None,
    sync_table: str | None = None,
) -> dict[str, str | None]:
    """Validate UC sync location fields. Empty strings clear a field."""
    validated: dict[str, str | None] = {}
    for key, value in (
        ("sync_catalog", sync_catalog),
        ("sync_schema", sync_schema),
        ("sync_table", sync_table),
    ):
        if value is None:
            continue
        stripped = value.strip()
        if not stripped:
            validated[key] = None
        else:
            kind = "catalog" if key == "sync_catalog" else "schema" if key == "sync_schema" else "table"
            validated[key] = config.validate_identifier(stripped, kind)
    return validated


def _detail(project_id: str, role) -> ProjectDetail:
    project = repository.get_project(project_id)
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")
    summary = project_to_summary(project, role)
    return ProjectDetail(
        **summary,
        target_catalog=project.get("target_catalog"),
        target_schema=project.get("target_schema"),
        target_table=project.get("target_table"),
        storage_mode=project.get("storage_mode") or "managed",
        record_key_column=project.get("record_key_column"),
        record_sync_mode=project.get("record_sync_mode"),
        duplicate_key_mode=project.get("duplicate_key_mode") or "retain",
        staged_change_count=(
            repository.count_staged_changes(project_id)
            if project.get("record_sync_mode") == "staged"
            else 0
        ),
        sync_catalog=project.get("sync_catalog"),
        sync_schema=project.get("sync_schema"),
        sync_table=project.get("sync_table"),
        genie_space_id=project.get("genie_space_id"),
        genie_status=project.get("genie_status"),
        genie_last_synced_at=project.get("genie_last_synced_at"),
        genie_error=project.get("genie_error"),
        members=repository.list_members(project_id),
        fields=repository.list_fields(project_id),
        lookups=lookup_repository.list_lookups(project_id),
    )


@router.get("", response_model=list[ProjectSummary])
def list_projects(request: Request):
    from backend import auth

    user = auth.get_user_email(request)
    rows = repository.list_projects_for_user(user)
    return [ProjectSummary(**project_to_summary(row, row.get("role"))) for row in rows]


@router.post("/preview-csv", response_model=CsvFormPreview)
def preview_csv(body: PreviewCsvRequest, request: Request):
    from backend import auth

    auth.get_user_email(request)
    try:
        fields, sample_rows, row_count, suggested_record_key = infer_fields_from_csv(
            body.csv,
            header_row=body.header_row,
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc

    columns = [
        InferredColumn(
            field_key=f.field_key,
            label=f.label,
            field_type=f.field_type,
            config_json=f.config_json,
            sort_order=f.sort_order,
            is_required=f.is_required,
            included=True,
        )
        for f in fields
    ]
    return CsvFormPreview(
        columns=columns,
        sample_rows=sample_rows,
        row_count=row_count,
        suggested_record_key=suggested_record_key,
        header_row=body.header_row,
    )


@router.post("", response_model=ProjectDetail, status_code=201)
def create_project(body: CreateProjectRequest, request: Request):
    from backend import auth

    user = auth.get_user_email(request)
    try:
        storage = _resolve_storage_targets(
            storage_type=body.storage_type,
            name=body.name.strip(),
            target_catalog=body.target_catalog,
            target_schema=body.target_schema,
            target_table=body.target_table,
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc

    if body.storage_mode == "existing_uc":
        if body.storage_type != "uc_delta":
            raise HTTPException(
                status_code=400,
                detail="Existing UC table mode requires Unity Catalog (Delta) storage",
            )
        if not body.record_key_column or not body.record_key_column.strip():
            raise HTTPException(
                status_code=400,
                detail="record_key_column is required when using an existing UC table",
            )

    with request_connections(request):
        project = repository.create_project(
            name=body.name.strip(),
            description=body.description,
            storage_type=body.storage_type,
            storage_mode=body.storage_mode,
            record_key_column=body.record_key_column.strip() if body.record_key_column else None,
            duplicate_key_mode=body.duplicate_key_mode,
            target_catalog=storage["target_catalog"],
            target_schema=storage["target_schema"],
            target_table=storage["target_table"],
            created_by=user,
        )
        if body.seed_fields:
            repository.replace_draft_fields(project["project_id"], body.seed_fields, user)
        return _detail(project["project_id"], "admin")


@router.get("/{project_id}", response_model=ProjectDetail)
def get_project(project_id: str, request: Request):
    _, role = require_role(project_id, request, "reader")
    return _detail(project_id, role)


@router.patch("/{project_id}", response_model=ProjectDetail)
def update_project(project_id: str, body: UpdateProjectRequest, request: Request):
    user, role = require_role(project_id, request, "admin")
    updates = body.model_dump(exclude_unset=True)
    sync_was_updated = False

    storage_keys = {"storage_type", "target_catalog", "target_schema", "target_table"}
    if storage_keys & updates.keys():
        project = repository.get_project(project_id)
        if not project:
            raise HTTPException(status_code=404, detail="Project not found")
        if project.get("status") == "published":
            raise HTTPException(
                status_code=400,
                detail="Cannot change storage location after the collection is published",
            )
        effective_storage_type = updates.get("storage_type", project.get("storage_type"))
        try:
            storage_updates = _resolve_storage_targets(
                storage_type=effective_storage_type,
                name=project["name"],
                target_catalog=updates.get("target_catalog", project.get("target_catalog")),
                target_schema=updates.get("target_schema", project.get("target_schema")),
                target_table=updates.get("target_table", project.get("target_table")),
            )
            if "storage_type" in updates:
                storage_updates["storage_type"] = effective_storage_type
        except ValueError as exc:
            raise HTTPException(status_code=400, detail=str(exc)) from exc
        for key in list(updates.keys()):
            if key in storage_keys:
                del updates[key]
        updates.update(storage_updates)

    sync_keys = {"sync_catalog", "sync_schema", "sync_table"}
    if sync_keys & updates.keys():
        sync_was_updated = True
        project = repository.get_project(project_id)
        if not project:
            raise HTTPException(status_code=404, detail="Project not found")
        if project.get("storage_type") != "lakebase":
            raise HTTPException(
                status_code=400,
                detail="UC sync location applies only to Lakebase collections",
            )
        try:
            sync_updates = _validate_sync_targets(
                sync_catalog=updates.get("sync_catalog"),
                sync_schema=updates.get("sync_schema"),
                sync_table=updates.get("sync_table"),
            )
        except ValueError as exc:
            raise HTTPException(status_code=400, detail=str(exc)) from exc
        for key in list(updates.keys()):
            if key in sync_keys:
                del updates[key]
        updates.update(sync_updates)

    if "record_sync_mode" in updates:
        project = repository.get_project(project_id)
        if not project:
            raise HTTPException(status_code=404, detail="Project not found")
        if project.get("status") == "published":
            raise HTTPException(
                status_code=400,
                detail="Cannot change record sync mode after the collection is published",
            )
        if project.get("storage_type") != "uc_delta":
            raise HTTPException(
                status_code=400,
                detail="Record sync mode applies only to Unity Catalog collections",
            )

    if "duplicate_key_mode" in updates:
        project = repository.get_project(project_id)
        if not project:
            raise HTTPException(status_code=404, detail="Project not found")
        if project.get("status") == "published":
            raise HTTPException(
                status_code=400,
                detail="Cannot change duplicate key handling after the collection is published",
            )
        if not project.get("record_key_column"):
            raise HTTPException(
                status_code=400,
                detail="Duplicate key handling applies only when a record key column is configured",
            )

    if updates:
        repository.update_project(project_id, updates, user)

    project = repository.get_project(project_id)
    if project and project.get("status") == "published" and sync_was_updated:
        from backend import genie_service

        if genie_service.genie_available_for_project(project):
            genie_service.provision_genie_space(project_id, user)
        elif project.get("storage_type") == "lakebase":
            repository.update_project(
                project_id,
                {"genie_status": "disabled", "genie_error": None},
                user,
            )
    return _detail(project_id, role)


@router.get("/{project_id}/workspace-users", response_model=list[WorkspaceUser])
def search_workspace_users(project_id: str, request: Request, q: str = ""):
    require_role(project_id, request, "admin")
    try:
        from backend import workspace_service

        return [WorkspaceUser(**row) for row in workspace_service.list_workspace_users(q)]
    except Exception as exc:
        raise HTTPException(
            status_code=502,
            detail=f"Could not load workspace users: {exc}",
        ) from exc


@router.delete("/{project_id}", status_code=204)
def delete_project(project_id: str, request: Request):
    require_role(project_id, request, "admin")
    try:
        with request_connection():
            repository.delete_project(project_id)
    except ValueError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    return Response(status_code=204)


@router.get("/{project_id}/members", response_model=list[ProjectMember])
def list_members(project_id: str, request: Request):
    require_role(project_id, request, "admin")
    return repository.list_members(project_id)


@router.post("/{project_id}/members", response_model=AddMemberResponse, status_code=201)
def add_member(project_id: str, body: AddMemberRequest, request: Request):
    user, _ = require_role(project_id, request, "admin")
    uc_granted, uc_note = repository.add_member(project_id, body.user_email, body.role, user)
    from backend import workspace_service

    granted, note = workspace_service.ensure_app_user_access(body.user_email)
    return AddMemberResponse(
        members=repository.list_members(project_id),
        app_access_granted=granted,
        app_access_note=note,
        uc_access_granted=uc_granted,
        uc_access_note=uc_note,
    )


@router.delete("/{project_id}/members/{user_email}", response_model=list[ProjectMember])
def remove_member(project_id: str, user_email: str, request: Request):
    current_user, _ = require_role(project_id, request, "admin")
    if user_email.lower() == current_user.lower():
        admins = [m for m in repository.list_members(project_id) if m.role == "admin"]
        if len(admins) <= 1:
            raise HTTPException(status_code=400, detail="Cannot remove the only admin")
    repository.remove_member(project_id, user_email)
    return repository.list_members(project_id)


@router.get("/{project_id}/fields", response_model=list[FieldDefinition])
def list_fields(project_id: str, request: Request, published_only: bool = False):
    require_role(project_id, request, "reader")
    return repository.list_fields(project_id, published_only=published_only)


@router.put("/{project_id}/fields", response_model=list[FieldDefinition])
def save_fields(project_id: str, body: SaveFieldsRequest, request: Request):
    user, _ = require_role(project_id, request, "admin")
    repository.replace_draft_fields(project_id, body.fields, user)
    return repository.list_fields(project_id)


def _publish_permission_detail(
    project_id: str,
    user: str,
    message: str,
    *,
    failure_kind: uc_grants.PublishFailureKind = "generic",
) -> dict[str, str]:
    project = repository.get_project(project_id)
    detail: dict[str, str] = {"message": message}
    if project and project.get("storage_type") == "uc_delta":
        grant_sql = uc_grants.grant_sql_for_publish_failure(
            project,
            user,
            failure_kind=failure_kind,
        )
        if grant_sql:
            detail["grant_sql"] = grant_sql
    return detail


def _is_publish_permission_failure(exc: ValueError) -> bool:
    msg = str(exc).lower()
    return (
        "does not exist or is not visible" in msg
        or "permission" in msg
        or "unity catalog" in msg
    )


@router.post("/{project_id}/publish", response_model=ProjectDetail)
def publish_project(project_id: str, request: Request, background_tasks: BackgroundTasks):
    user, role = require_role(project_id, request, "admin")
    with track_request("projects.publish") as timer:
        try:
            with request_connections(request):
                repository.publish_project(project_id, user)
                timer.mark("publish_ms")
        except SqlPermissionError as exc:
            raise HTTPException(
                status_code=403,
                detail=_publish_permission_detail(
                    project_id,
                    user,
                    str(exc),
                    failure_kind="permission_denied",
                ),
            ) from exc
        except UserAuthorizationRequiredError as exc:
            raise HTTPException(
                status_code=403,
                detail=_publish_permission_detail(
                    project_id,
                    user,
                    str(exc),
                    failure_kind="user_authorization",
                ),
            ) from exc
        except ValueError as exc:
            if _is_publish_permission_failure(exc):
                raise HTTPException(
                    status_code=400,
                    detail=_publish_permission_detail(
                        project_id,
                        user,
                        str(exc),
                        failure_kind="table_not_visible",
                    ),
                ) from exc
            raise HTTPException(status_code=400, detail=str(exc)) from exc
        from backend import genie_service

        project = repository.get_project(project_id)
        timer.mark("load_project_ms")
        if project and genie_service.genie_available_for_project(project):
            background_tasks.add_task(genie_service.provision_genie_space, project_id, user)
        elif project and project.get("storage_type") == "lakebase":
            repository.update_project(
                project_id,
                {"genie_status": "disabled", "genie_error": None},
                user,
            )
        timer.set_extra(project_id=project_id)
    return _detail(project_id, role)


def _validate_record_values(project_id: str, fields, values: dict) -> None:
    lookup_allowed = build_lookup_allowed(fields, project_id)
    errors = validate_record_values(fields, values, lookup_allowed=lookup_allowed)
    if errors:
        raise HTTPException(status_code=422, detail={"field_errors": errors})


@router.get("/{project_id}/records", response_model=list[RecordRow])
def list_records(
    project_id: str,
    request: Request,
    response: Response,
    limit: int = Query(500, ge=1, le=5000),
    offset: int = Query(0, ge=0),
):
    with track_request("records.list") as timer:
        with request_connections(request):
            email = auth.get_user_email(request)
            project, role = repository.get_project_with_member(project_id, email)
            timer.mark("auth_project_ms")
            assert_role(role, "reader", project_id)
            if not project or project["status"] != "published":
                timer.set_extra(project_id=project_id, row_count=0, storage_type=None)
                result: list[RecordRow] = []
            else:
                fields = repository.list_fields(
                    project_id,
                    published_only=True,
                    project=project,
                )
                timer.mark("load_fields_ms")
                rows = repository.list_records(project, fields, limit=limit, offset=offset)
                timer.mark("list_records_ms")
                result = [RecordRow(**row) for row in rows]
                timer.mark("serialize_ms")
                timer.set_extra(
                    project_id=project_id,
                    row_count=len(rows),
                    storage_type=project.get("storage_type"),
                    storage_mode=project.get("storage_mode"),
                    field_count=len(fields),
                    limit=limit,
                    offset=offset,
                )
    response.headers["Server-Timing"] = timer.server_timing_header()
    return result


@router.post("/{project_id}/records", response_model=RecordRow, status_code=201)
def create_record(project_id: str, body: CreateRecordRequest, request: Request, response: Response):
    with track_request("records.create") as timer:
        with request_connections(request):
            email = auth.get_user_email(request)
            project, role = repository.get_project_with_member(project_id, email)
            timer.mark("auth_project_ms")
            assert_role(role, "editor", project_id)
            if not project or project["status"] != "published":
                raise HTTPException(
                    status_code=400,
                    detail="Project must be published before adding records",
                )
            fields = repository.list_fields(
                project_id,
                published_only=True,
                project=project,
            )
            timer.mark("load_fields_ms")
            lookup_allowed = build_lookup_allowed(fields, project_id)
            errors = validate_record_values(
                fields,
                body.values,
                lookup_allowed=lookup_allowed,
            )
            timer.mark("validate_ms")
            if errors:
                raise HTTPException(status_code=422, detail={"field_errors": errors})
            try:
                existing = None
                record_key_col = repository._record_key_column(project)
                if record_key_col:
                    record_id = repository._resolve_new_record_id(project, body.values)
                    if repository._record_id_is_taken(project, record_id):
                        existing = repository.get_record(project, fields, record_id)
                row = repository.create_record(project, fields, body.values, email)
            except ValueError as exc:
                raise HTTPException(status_code=400, detail=str(exc)) from exc
            timer.mark("create_record_ms")
            if existing:
                audit_repository.log_record_updated(
                    project_id,
                    row["record_id"],
                    existing["values"],
                    body.values,
                    changed_by=email,
                )
            else:
                audit_repository.log_record_created(
                    project_id,
                    row["record_id"],
                    body.values,
                    changed_by=email,
                )
            timer.mark("audit_ms")
            timer.set_extra(
                project_id=project_id,
                storage_type=project.get("storage_type"),
                field_count=len(fields),
                value_count=len(body.values),
            )
            result = RecordRow(**row)
    response.headers["Server-Timing"] = timer.server_timing_header()
    return result


@router.patch("/{project_id}/records/{record_id}", response_model=RecordRow)
def update_record(project_id: str, record_id: str, body: UpdateRecordRequest, request: Request):
    with request_connections(request):
        user, _ = require_role(project_id, request, "editor")
        project = repository.get_project(project_id)
        if not project:
            raise HTTPException(status_code=404, detail="Project not found")
        fields = repository.list_fields(project_id, published_only=True)
        existing = repository.get_record(project, fields, record_id)
        if not existing:
            raise HTTPException(status_code=404, detail="Record not found")
        _validate_record_values(project_id, fields, body.values)
        try:
            repository.update_record(project, fields, record_id, body.values, user)
        except ValueError as exc:
            raise HTTPException(status_code=400, detail=str(exc)) from exc
        audit_repository.log_record_updated(
            project_id,
            record_id,
            existing["values"],
            body.values,
            changed_by=user,
        )
        updated = repository.get_record(project, fields, record_id)
    return RecordRow(**updated)  # type: ignore[arg-type]


@router.delete("/{project_id}/records/{record_id}", status_code=204)
def delete_record(project_id: str, record_id: str, request: Request):
    with request_connections(request):
        user, _ = require_role(project_id, request, "editor")
        project = repository.get_project(project_id)
        if not project:
            raise HTTPException(status_code=404, detail="Project not found")
        fields = repository.list_fields(project_id, published_only=True)
        existing = repository.get_record(project, fields, record_id)
        if not existing:
            raise HTTPException(status_code=404, detail="Record not found")
        repository.delete_record(project, record_id, user)
        audit_repository.log_record_deleted(
            project_id,
            record_id,
            existing["values"],
            changed_by=user,
        )


@router.post("/{project_id}/records/sync-to-uc", response_model=SyncStagedRecordsResult)
def sync_staged_records(project_id: str, request: Request):
    with request_connections(request):
        user, _ = require_role(project_id, request, "editor")
        project = repository.get_project(project_id)
        if not project:
            raise HTTPException(status_code=404, detail="Project not found")
        if project.get("status") != "published":
            raise HTTPException(
                status_code=400,
                detail="Collection must be published before syncing records to Unity Catalog",
            )
        fields = repository.list_fields(project_id, published_only=True, project=project)
        try:
            result = repository.sync_staged_records(project, fields, user)
        except ValueError as exc:
            raise HTTPException(status_code=400, detail=str(exc)) from exc
    return SyncStagedRecordsResult(**result)


def _field_label_map(fields: list[FieldDefinition]) -> dict[str, str]:
    return {f.field_key: f.label for f in fields}


@router.get("/{project_id}/records/{record_id}/audit", response_model=list[RecordAuditEntry])
def get_record_audit(project_id: str, record_id: str, request: Request):
    require_role(project_id, request, "reader")
    with request_connections(request):
        project = repository.get_project(project_id)
        if not project:
            raise HTTPException(status_code=404, detail="Project not found")
        fields = repository.list_fields(project_id, published_only=True)
        if not repository.get_record(project, fields, record_id):
            raise HTTPException(status_code=404, detail="Record not found")
        labels = _field_label_map(fields)
        rows = audit_repository.list_record_audit(project_id, record_id)
    return [
        RecordAuditEntry(
            field_key=row.get("field_key"),
            field_label=labels.get(row["field_key"]) if row.get("field_key") else None,
            old_value=row.get("old_value"),
            new_value=row.get("new_value"),
            changed_by=row["changed_by"],
            changed_at=row["changed_at"],
        )
        for row in rows
    ]


@router.get("/{project_id}/records/export")
def export_records(project_id: str, request: Request):
    require_role(project_id, request, "reader")
    with request_connections(request):
        project = repository.get_project(project_id)
        if not project or project["status"] != "published":
            raise HTTPException(status_code=400, detail="Project must be published to export records")
        fields = repository.list_fields(project_id, published_only=True)
        field_keys = [f.field_key for f in fields]
        rows = repository.list_records(project, fields, limit=5000)
        csv_text = records_to_csv(field_keys, rows)
    filename = f"{project['slug']}_records.csv"
    return Response(
        content=csv_text,
        media_type="text/csv",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )


@router.post("/{project_id}/records/preview-csv", response_model=RecordCsvPreview)
def preview_records_csv_route(project_id: str, body: PreviewRecordsCsvRequest, request: Request):
    require_role(project_id, request, "editor")
    project = repository.get_project(project_id)
    if not project or project["status"] != "published":
        raise HTTPException(status_code=400, detail="Project must be published before importing records")
    fields = repository.list_fields(project_id, published_only=True)
    if not fields:
        raise HTTPException(status_code=400, detail="Published form has no fields")
    try:
        columns, unmatched, sample_rows, row_count = preview_records_csv(
            body.csv,
            fields,
            header_row=body.header_row,
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    return RecordCsvPreview(
        columns=columns,
        unmatched_csv_headers=unmatched,
        sample_rows=sample_rows,
        row_count=row_count,
        header_row=body.header_row,
    )


@router.post("/{project_id}/records/import", response_model=ImportRecordsResult)
def import_records(project_id: str, body: ImportRecordsCsvRequest, request: Request):
    user, _ = require_role(project_id, request, "editor")
    with request_connections(request):
        project = repository.get_project(project_id)
        if not project or project["status"] != "published":
            raise HTTPException(status_code=400, detail="Project must be published before importing records")
        fields = repository.list_fields(project_id, published_only=True)
        field_keys = body.field_keys if body.field_keys is not None else [f.field_key for f in fields]
        try:
            parsed = parse_records_csv(
                body.csv,
                [f.field_key for f in fields],
                header_row=body.header_row,
                included_field_keys=field_keys,
            )
        except ValueError as exc:
            raise HTTPException(status_code=400, detail=str(exc)) from exc

        lookup_allowed = build_lookup_allowed(fields, project_id)
        created = 0
        updated = 0
        skipped = 0
        failed: list[ImportRecordError] = []
        record_key_col = project.get("record_key_column")
        for row_num, values in enumerate(parsed, start=body.header_row + 1):
            errors = validate_record_values(fields, values, lookup_allowed=lookup_allowed)
            if errors:
                failed.append(ImportRecordError(row=row_num, field_errors=errors))
                continue
            try:
                action, row, previous_values = repository.import_record_row(
                    project, fields, values, user
                )
            except ValueError as exc:
                field_key = record_key_col or "_import"
                failed.append(ImportRecordError(row=row_num, field_errors={field_key: str(exc)}))
                continue
            if action == "skipped":
                skipped += 1
                continue
            if action == "updated" and row:
                updated += 1
                audit_repository.log_record_updated(
                    project_id,
                    row["record_id"],
                    previous_values or {},
                    values,
                    changed_by=user,
                )
                continue
            if action == "created" and row:
                created += 1
                audit_repository.log_record_created(
                    project_id, row["record_id"], values, changed_by=user
                )
    return ImportRecordsResult(created=created, updated=updated, skipped=skipped, failed=failed)
