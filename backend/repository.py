"""Project, member, field, and record data access."""

from __future__ import annotations

import json
import re
import uuid
from datetime import datetime, timezone
from typing import Any, Optional

from backend import config
from backend.models import FieldDefinition, ProjectMember, ProjectRole
from backend.sql_errors import (
    SqlPermissionError,
    UserAuthorizationRequiredError,
    is_table_not_found,
)
from backend.sql_util import (
    data_execute,
    data_fetchall,
    data_fetchone,
    execute,
    fetchall,
    fetchone,
    project_data_scope,
)

_SLUG_RE = re.compile(r"[^a-z0-9]+")


def _now() -> datetime:
    return datetime.now(timezone.utc)


def _table(name: str) -> str:
    return config.t(name)


def slugify(name: str) -> str:
    slug = _SLUG_RE.sub("_", name.strip().lower()).strip("_")
    return slug[:80] or "collection"


def _is_lakebase(project: dict[str, Any]) -> bool:
    return project.get("storage_type") == "lakebase"


def _is_existing_uc(project: dict[str, Any]) -> bool:
    return (project.get("storage_mode") or "managed") == "existing_uc"


def _uses_staged_sync(project: dict[str, Any]) -> bool:
    return (
        project.get("storage_type") == "uc_delta"
        and project.get("record_sync_mode") == "staged"
    )


def _record_key_column(project: dict[str, Any]) -> Optional[str]:
    if not _is_existing_uc(project):
        return None
    col = project.get("record_key_column")
    return str(col).strip() if col else None


def _quote_col(name: str) -> str:
    from backend.config import quote_identifier

    return quote_identifier(name)


def _table_has_column(existing: set[str], col: str) -> bool:
    return col.lower() in existing


def _parse_field(row: dict[str, Any]) -> FieldDefinition:
    config_json = row.get("config_json")
    parsed = json.loads(config_json) if config_json else None
    return FieldDefinition(
        field_key=row["field_key"],
        label=row["label"],
        field_type=row["field_type"],
        config_json=parsed,
        sort_order=int(row["sort_order"]),
        is_required=bool(row["is_required"]),
        schema_version=int(row["schema_version"]),
        is_published=bool(row["is_published"]),
    )


def list_projects_for_user(user_email: str) -> list[dict[str, Any]]:
    sql = f"""
        SELECT p.*, m.role
        FROM {_table("projects")} p
        INNER JOIN {_table("project_members")} m
          ON p.project_id = m.project_id
        WHERE m.user_email = ?
        ORDER BY p.updated_at DESC NULLS LAST, p.created_at DESC
    """
    return fetchall(sql, (user_email.lower(),))


def get_project(project_id: str) -> Optional[dict[str, Any]]:
    return fetchone(f"SELECT * FROM {_table('projects')} WHERE project_id = ?", (project_id,))


def get_project_with_member(
    project_id: str,
    user_email: str,
) -> tuple[Optional[dict[str, Any]], Optional[ProjectRole]]:
    row = fetchone(
        f"""
        SELECT p.*, m.role AS member_role
        FROM {_table("projects")} p
        INNER JOIN {_table("project_members")} m
          ON p.project_id = m.project_id
        WHERE p.project_id = ? AND m.user_email = ?
        """,
        (project_id, user_email.lower()),
    )
    if not row:
        return None, None
    role = row.pop("member_role")
    return row, role


def get_member_role(project_id: str, user_email: str) -> Optional[ProjectRole]:
    row = fetchone(
        f"SELECT role FROM {_table('project_members')} WHERE project_id = ? AND user_email = ?",
        (project_id, user_email.lower()),
    )
    return row["role"] if row else None


def list_members(project_id: str) -> list[ProjectMember]:
    rows = fetchall(
        f"SELECT * FROM {_table('project_members')} WHERE project_id = ? ORDER BY added_at",
        (project_id,),
    )
    return [ProjectMember(**row) for row in rows]


def list_admin_emails(project_id: str) -> list[str]:
    rows = fetchall(
        f"""
        SELECT user_email FROM {_table('project_members')}
        WHERE project_id = ? AND role = 'admin'
        ORDER BY added_at
        """,
        (project_id,),
    )
    return [row["user_email"] for row in rows]


def list_fields(
    project_id: str,
    *,
    published_only: bool = False,
    project: Optional[dict[str, Any]] = None,
) -> list[FieldDefinition]:
    if project is None:
        project = get_project(project_id)
    if not project:
        return []

    version = int(project["schema_version"])

    if published_only:
        if version < 1:
            return []
        sql = f"""
            SELECT * FROM {_table('field_definitions')}
            WHERE project_id = ? AND is_published = true AND schema_version = ?
            ORDER BY sort_order, field_key
        """
        return [_parse_field(row) for row in fetchall(sql, (project_id, version))]

    # Drafts plus the current published version only (exclude historical publishes).
    sql = f"""
        SELECT * FROM {_table('field_definitions')}
        WHERE project_id = ?
          AND (is_published = false OR (is_published = true AND schema_version = ?))
        ORDER BY sort_order, field_key
    """
    return [_parse_field(row) for row in fetchall(sql, (project_id, version))]


def create_project(
    *,
    name: str,
    description: Optional[str],
    storage_type: str,
    storage_mode: str = "managed",
    record_key_column: Optional[str] = None,
    target_catalog: str,
    target_schema: str,
    target_table: str,
    created_by: str,
) -> dict[str, Any]:
    project_id = str(uuid.uuid4())
    slug = slugify(name)
    now = _now()

    execute(
        f"""
        INSERT INTO {_table("projects")} (
            project_id, name, slug, description, storage_type,
            storage_mode, record_key_column,
            target_catalog, target_schema, target_table,
            schema_version, status, created_at, created_by, updated_at, updated_by
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, 'draft', ?, ?, ?, ?)
        """,
        (
            project_id,
            name,
            slug,
            description,
            storage_type,
            storage_mode,
            record_key_column,
            target_catalog,
            target_schema,
            target_table,
            now,
            created_by,
            now,
            created_by,
        ),
    )
    add_member(project_id, created_by, "admin", created_by)
    return get_project(project_id)  # type: ignore[return-value]


def add_member(project_id: str, user_email: str, role: ProjectRole, added_by: str) -> tuple[bool, Optional[str]]:
    execute(
        f"""
        INSERT INTO {_table("project_members")} (project_id, user_email, role, added_at, added_by)
        VALUES (?, ?, ?, ?, ?)
        """,
        (project_id, user_email.lower(), role, _now(), added_by),
    )
    project = get_project(project_id)
    if project and project.get("status") == "published":
        from backend import uc_grants

        return uc_grants.grant_member(project, user_email.lower(), role)
    return False, None


def remove_member(project_id: str, user_email: str) -> None:
    project = get_project(project_id)
    if project:
        from backend import uc_grants

        uc_grants.revoke_member(project, user_email.lower())
    execute(
        f"DELETE FROM {_table('project_members')} WHERE project_id = ? AND user_email = ?",
        (project_id, user_email.lower()),
    )


def delete_project(project_id: str) -> None:
    """Remove collection metadata. Does not drop the backing UC/Lakebase data table."""
    if not get_project(project_id):
        raise ValueError("Project not found")

    from backend import lookup_repository

    for lookup in lookup_repository.list_lookups(project_id):
        lookup_repository.delete_lookup(project_id, lookup.lookup_id)

    for table in (
        "staged_record_changes",
        "record_audit_log",
        "schema_versions",
        "form_layouts",
        "field_definitions",
        "project_members",
        "ai_generation_log",
        "projects",
    ):
        execute(f"DELETE FROM {_table(table)} WHERE project_id = ?", (project_id,))


def update_project(project_id: str, updates: dict[str, Any], updated_by: str) -> None:
    if not updates:
        return
    sets = ", ".join(f"{key} = ?" for key in updates)
    params = list(updates.values()) + [_now(), updated_by, project_id]
    execute(
        f"UPDATE {_table('projects')} SET {sets}, updated_at = ?, updated_by = ? WHERE project_id = ?",
        params,
    )


def replace_draft_fields(project_id: str, fields: list[FieldDefinition], user_email: str) -> None:
    execute(
        f"DELETE FROM {_table('field_definitions')} WHERE project_id = ? AND is_published = false",
        (project_id,),
    )
    if fields:
        row_placeholder = "(?, ?, ?, ?, ?, ?, ?, 0, false)"
        values_sql = ", ".join(row_placeholder for _ in fields)
        params: list[Any] = []
        for field in fields:
            params.extend(
                [
                    project_id,
                    field.field_key,
                    field.label,
                    field.field_type,
                    json.dumps(field.config_json) if field.config_json else None,
                    field.sort_order,
                    field.is_required,
                ]
            )
        execute(
            f"""
            INSERT INTO {_table("field_definitions")} (
                project_id, field_key, label, field_type, config_json,
                sort_order, is_required, schema_version, is_published
            ) VALUES {values_sql}
            """,
            params,
        )
    update_project(project_id, {}, user_email)


def _sql_type(field_type: str) -> str:
    mapping = {
        "text": "STRING",
        "textarea": "STRING",
        "email": "STRING",
        "url": "STRING",
        "number": "DOUBLE",
        "date": "DATE",
        "datetime": "TIMESTAMP",
        "boolean": "BOOLEAN",
        "single_select": "STRING",
        "multi_select": "STRING",
        "lookup": "STRING",
    }
    return mapping.get(field_type, "STRING")


def _describe_column_names(data_table: str) -> set[str]:
    rows = data_fetchall(f"DESCRIBE TABLE {data_table}")
    names: set[str] = set()
    for row in rows:
        name = str(row.get("col_name") or row.get("column_name") or "").strip()
        if name and not name.startswith("#"):
            names.add(name.lower())
    return names


def _ensure_audit_columns(
    data_table: str,
    *,
    include_record_id: bool = True,
    existing: Optional[set[str]] = None,
) -> None:
    """Add app audit columns to a UC table when missing."""
    if existing is None:
        existing = _describe_column_names(data_table)
    audit_cols: list[tuple[str, str]] = [
        ("_created_at", "TIMESTAMP"),
        ("_created_by", "STRING"),
        ("_updated_at", "TIMESTAMP"),
        ("_updated_by", "STRING"),
    ]
    if include_record_id:
        audit_cols.insert(0, ("_record_id", "STRING"))
    missing = [
        (col_name, col_type)
        for col_name, col_type in audit_cols
        if col_name.lower() not in existing
    ]
    if missing:
        cols_sql = ", ".join(f"{_quote_col(name)} {col_type}" for name, col_type in missing)
        data_execute(f"ALTER TABLE {data_table} ADD COLUMNS ({cols_sql})")
        for col_name, _ in missing:
            existing.add(col_name.lower())
    if include_record_id:
        data_execute(
            f"UPDATE {data_table} SET {_quote_col('_record_id')} = uuid() "
            f"WHERE {_quote_col('_record_id')} IS NULL OR {_quote_col('_record_id')} = ''"
        )


def _ensure_app_metadata_columns(
    data_table: str,
    *,
    existing: Optional[set[str]] = None,
) -> None:
    """Add app record-tracking columns to an existing UC table when missing."""
    _ensure_audit_columns(data_table, include_record_id=True, existing=existing)


def _try_describe_column_names(data_table: str) -> Optional[set[str]]:
    try:
        return _describe_column_names(data_table)
    except (SqlPermissionError, UserAuthorizationRequiredError):
        raise
    except Exception as exc:
        if is_table_not_found(exc):
            return None
        raise


def _add_missing_field_columns(
    data_table: str,
    fields: list[FieldDefinition],
    previous_keys: set[str],
    existing_cols: set[str],
) -> None:
    from backend.config import quote_identifier

    missing_fields = [
        field
        for field in fields
        if field.field_key not in previous_keys and field.field_key.lower() not in existing_cols
    ]
    if not missing_fields:
        return
    cols_sql = ", ".join(
        f"{quote_identifier(field.field_key)} {_sql_type(field.field_type)}"
        for field in missing_fields
    )
    try:
        data_execute(f"ALTER TABLE {data_table} ADD COLUMNS ({cols_sql})")
    except Exception as exc:
        msg = str(exc).lower()
        if "already exists" not in msg and "duplicate" not in msg:
            raise
    for field in missing_fields:
        existing_cols.add(field.field_key.lower())


def _insert_published_fields(
    project_id: str,
    fields: list[FieldDefinition],
    version: int,
) -> None:
    if not fields:
        return
    row_placeholder = "(?, ?, ?, ?, ?, ?, ?, ?, true)"
    values_sql = ", ".join(row_placeholder for _ in fields)
    params: list[Any] = []
    for field in fields:
        params.extend(
            [
                project_id,
                field.field_key,
                field.label,
                field.field_type,
                json.dumps(field.config_json) if field.config_json else None,
                field.sort_order,
                field.is_required,
                version,
            ]
        )
    execute(
        f"""
        INSERT INTO {_table('field_definitions')} (
            project_id, field_key, label, field_type, config_json,
            sort_order, is_required, schema_version, is_published
        ) VALUES {values_sql}
        """,
        params,
    )


def _build_record_select_parts(
    data_table: str,
    fields: list[FieldDefinition],
    record_key_col: Optional[str],
) -> list[str]:
    existing = _describe_column_names(data_table)
    select_parts: list[str] = []
    if record_key_col:
        select_parts.append(_quote_col(record_key_col))
    elif _table_has_column(existing, "_record_id"):
        select_parts.append(_quote_col("_record_id"))
    for col in ["_created_at", "_created_by", "_updated_at", "_updated_by"]:
        if _table_has_column(existing, col):
            select_parts.append(_quote_col(col))
    for field in fields:
        if _table_has_column(existing, field.field_key):
            select_parts.append(_quote_col(field.field_key))
    return select_parts


def _records_order_clause(data_table: str, record_key_col: Optional[str]) -> str:
    existing = _describe_column_names(data_table)
    if _table_has_column(existing, "_updated_at"):
        return f"{_quote_col('_updated_at')} DESC NULLS LAST"
    if record_key_col:
        return f"{_quote_col(record_key_col)} DESC"
    return f"{_quote_col('_record_id')} DESC"


def _row_to_record(
    row: dict[str, Any],
    fields: list[FieldDefinition],
    record_key_col: Optional[str],
) -> dict[str, Any]:
    if record_key_col:
        record_id = str(row[record_key_col]) if row.get(record_key_col) is not None else ""
    else:
        record_id = str(row["_record_id"])
    field_keys = {f.field_key for f in fields}
    values = {k: row[k] for k in field_keys if k in row}
    return {
        "record_id": record_id,
        "values": values,
        "created_at": row.get("_created_at"),
        "created_by": row.get("_created_by"),
        "updated_at": row.get("_updated_at"),
        "updated_by": row.get("_updated_by"),
    }


def _record_where_clause(record_key_col: Optional[str], record_id: str) -> tuple[str, list[Any]]:
    if record_key_col:
        return f"{_quote_col(record_key_col)} = ?", [record_id]
    return f"{_quote_col('_record_id')} = ?", [record_id]


def publish_project(project_id: str, user_email: str) -> dict[str, Any]:
    project = get_project(project_id)
    if not project:
        raise ValueError("Project not found")

    if project.get("storage_type") == "uc_delta" and not project.get("record_sync_mode"):
        raise ValueError(
            "Choose how record changes sync to Unity Catalog in Settings before publishing."
        )

    fields = list_fields(project_id, published_only=False)
    draft_fields = [f for f in fields if not f.is_published]
    if not draft_fields:
        draft_fields = fields

    version = int(project["schema_version"]) + 1
    previous_keys = {f.field_key for f in fields if f.is_published}

    if _is_lakebase(project):
        from backend import lakebase_storage

        lakebase_storage.publish_table(project, draft_fields, previous_keys)
    else:
        with project_data_scope(project):
            catalog = project["target_catalog"]
            schema = project["target_schema"]
            table = project["target_table"]
            from backend.config import quote_identifier

            data_table = (
                f"{quote_identifier(catalog)}.{quote_identifier(schema)}."
                f"{quote_identifier(table)}"
            )
            existing_cols = _try_describe_column_names(data_table)

            if _is_existing_uc(project):
                if existing_cols is None:
                    raise ValueError(
                        f"Table {catalog}.{schema}.{table} does not exist or is not visible "
                        f"with your Unity Catalog permissions."
                    )
                _ensure_audit_columns(data_table, include_record_id=False, existing=existing_cols)
                _add_missing_field_columns(data_table, draft_fields, previous_keys, existing_cols)
            elif existing_cols is None:
                columns = [
                    "_record_id STRING NOT NULL",
                    "_created_at TIMESTAMP NOT NULL",
                    "_created_by STRING NOT NULL",
                    "_updated_at TIMESTAMP",
                    "_updated_by STRING",
                ]
                for field in draft_fields:
                    columns.append(f"{quote_identifier(field.field_key)} {_sql_type(field.field_type)}")

                data_execute(f"CREATE TABLE IF NOT EXISTS {data_table} ({', '.join(columns)}) USING DELTA")
            else:
                _ensure_app_metadata_columns(data_table, existing=existing_cols)
                _add_missing_field_columns(data_table, draft_fields, previous_keys, existing_cols)

    # Drop superseded published definitions before inserting the new version.
    execute(
        f"DELETE FROM {_table('field_definitions')} WHERE project_id = ? AND is_published = true AND schema_version < ?",
        (project_id, version),
    )

    _insert_published_fields(project_id, draft_fields, version)

    execute(
        f"""
        INSERT INTO {_table('schema_versions')} (
            project_id, version, ddl_snapshot, published_at, published_by
        ) VALUES (?, ?, ?, ?, ?)
        """,
        (project_id, version, json.dumps([f.model_dump() for f in draft_fields]), _now(), user_email),
    )

    update_project(
        project_id,
        {"schema_version": version, "status": "published"},
        user_email,
    )
    # Clear draft copies so the designer does not show stale duplicates.
    execute(
        f"DELETE FROM {_table('field_definitions')} WHERE project_id = ? AND is_published = false",
        (project_id,),
    )
    published = get_project(project_id)
    if published and published.get("storage_type") == "uc_delta":
        from backend import uc_grants

        uc_grants.sync_all_members(published, list_members(project_id))
    return published  # type: ignore[return-value]


def _data_table_fqn(project: dict[str, Any]) -> str:
    from backend.config import quote_identifier

    return (
        f"{quote_identifier(project['target_catalog'])}."
        f"{quote_identifier(project['target_schema'])}."
        f"{quote_identifier(project['target_table'])}"
    )


def list_records(
    project: dict[str, Any],
    fields: list[FieldDefinition],
    *,
    limit: int = 500,
    offset: int = 0,
) -> list[dict[str, Any]]:
    if _is_lakebase(project):
        from backend import lakebase_storage

        return lakebase_storage.list_records(project, fields)
    with project_data_scope(project):
        uc_rows = _list_records_from_uc(project, fields, limit=limit, offset=offset)
    if _uses_staged_sync(project):
        from backend import staged_records

        staged = staged_records.list_staged(project["project_id"])
        return staged_records.merge_uc_with_staged(uc_rows, staged)
    return uc_rows


def _list_records_from_uc(
    project: dict[str, Any],
    fields: list[FieldDefinition],
    *,
    limit: int = 500,
    offset: int = 0,
) -> list[dict[str, Any]]:
    data_table = _data_table_fqn(project)
    record_key_col = _record_key_column(project)
    select_parts = _build_record_select_parts(data_table, fields, record_key_col)
    if not select_parts:
        return []
    order = _records_order_clause(data_table, record_key_col)
    safe_limit = max(1, min(int(limit), 5000))
    safe_offset = max(0, int(offset))
    sql = (
        f"SELECT {', '.join(select_parts)} FROM {data_table} "
        f"ORDER BY {order} LIMIT {safe_limit} OFFSET {safe_offset}"
    )
    rows = data_fetchall(sql)
    return [_row_to_record(row, fields, record_key_col) for row in rows]


def get_record(
    project: dict[str, Any],
    fields: list[FieldDefinition],
    record_id: str,
) -> Optional[dict[str, Any]]:
    if _is_lakebase(project):
        from backend import lakebase_storage

        return lakebase_storage.get_record(project, fields, record_id)
    with project_data_scope(project):
        if _uses_staged_sync(project):
            from backend import staged_records

            staged_row = staged_records.get_staged(project["project_id"], record_id)
            if staged_row and staged_row["operation"] == "delete":
                return None
            uc_row = _get_record_from_uc(project, fields, record_id)
            if staged_row:
                if staged_row["operation"] == "insert":
                    return staged_records._staged_to_record(staged_row)
                if staged_row["operation"] == "update":
                    staged_rec = staged_records._staged_to_record(staged_row)
                    if uc_row:
                        return {
                            **uc_row,
                            "values": {**uc_row["values"], **staged_rec["values"]},
                            "updated_at": staged_rec.get("updated_at"),
                            "updated_by": staged_rec.get("updated_by"),
                        }
                    return staged_rec
            return uc_row
        return _get_record_from_uc(project, fields, record_id)


def _get_record_from_uc(
    project: dict[str, Any],
    fields: list[FieldDefinition],
    record_id: str,
) -> Optional[dict[str, Any]]:
    data_table = _data_table_fqn(project)
    record_key_col = _record_key_column(project)
    select_parts = _build_record_select_parts(data_table, fields, record_key_col)
    if not select_parts:
        return None
    where_sql, params = _record_where_clause(record_key_col, record_id)
    row = data_fetchone(
        f"SELECT {', '.join(select_parts)} FROM {data_table} WHERE {where_sql}",
        params,
    )
    if not row:
        return None
    return _row_to_record(row, fields, record_key_col)


def _resolve_new_record_id(
    project: dict[str, Any],
    values: dict[str, Any],
) -> str:
    record_key_col = _record_key_column(project)
    if record_key_col:
        key_val = values.get(record_key_col)
        if key_val is None or (isinstance(key_val, str) and not key_val.strip()):
            raise ValueError(f"{record_key_col} is required")
        return str(key_val)
    return str(uuid.uuid4())


def _assert_record_id_available(
    project: dict[str, Any],
    record_id: str,
    *,
    check_uc: bool = True,
    check_staging: bool = True,
) -> None:
    if check_uc:
        data_table = _data_table_fqn(project)
        record_key_col = _record_key_column(project)
        if record_key_col:
            key_sql = _quote_col(record_key_col)
            dup = data_fetchone(
                f"SELECT 1 AS found FROM {data_table} WHERE {key_sql} = ?",
                (record_id,),
            )
        else:
            dup = data_fetchone(
                f"SELECT 1 AS found FROM {data_table} WHERE {_quote_col('_record_id')} = ?",
                (record_id,),
            )
        if dup:
            raise ValueError("A record with this id already exists")
    if check_staging and _uses_staged_sync(project):
        from backend import staged_records

        if staged_records.record_id_exists_in_staging(project["project_id"], record_id):
            raise ValueError("A staged record with this id already exists")


def _record_exists_in_uc(project: dict[str, Any], record_id: str) -> bool:
    data_table = _data_table_fqn(project)
    record_key_col = _record_key_column(project)
    where_sql, params = _record_where_clause(record_key_col, record_id)
    row = data_fetchone(f"SELECT 1 AS found FROM {data_table} WHERE {where_sql}", params)
    return row is not None


def create_record(
    project: dict[str, Any],
    fields: list[FieldDefinition],
    values: dict[str, Any],
    user_email: str,
) -> dict[str, Any]:
    if _is_lakebase(project):
        from backend import lakebase_storage

        return lakebase_storage.create_record(project, fields, values, user_email)
    with project_data_scope(project):
        if _uses_staged_sync(project):
            from backend import staged_records

            record_id = _resolve_new_record_id(project, values)
            _assert_record_id_available(project, record_id)
            staged_records.upsert_staged(
                project["project_id"],
                record_id,
                "insert",
                values,
                user_email,
            )
            now = _now()
            return {
                "record_id": record_id,
                "values": values,
                "created_at": now,
                "created_by": user_email,
                "updated_at": now,
                "updated_by": user_email,
            }
        return _insert_record_to_uc(project, fields, values, user_email)


def _insert_record_to_uc(
    project: dict[str, Any],
    fields: list[FieldDefinition],
    values: dict[str, Any],
    user_email: str,
    *,
    record_id: Optional[str] = None,
    skip_duplicate_check: bool = False,
) -> dict[str, Any]:
    data_table = _data_table_fqn(project)
    record_key_col = _record_key_column(project)
    now = _now()
    existing_cols = _describe_column_names(data_table)

    if record_id is None:
        record_id = _resolve_new_record_id(project, values)
    if not skip_duplicate_check:
        _assert_record_id_available(project, record_id, check_staging=False)

    cols: list[str] = []
    vals: list[Any] = []
    if not record_key_col and _table_has_column(existing_cols, "_record_id"):
        cols.append(_quote_col("_record_id"))
        vals.append(record_id)
    if _table_has_column(existing_cols, "_created_at"):
        cols.append(_quote_col("_created_at"))
        vals.append(now)
    if _table_has_column(existing_cols, "_created_by"):
        cols.append(_quote_col("_created_by"))
        vals.append(user_email)
    if _table_has_column(existing_cols, "_updated_at"):
        cols.append(_quote_col("_updated_at"))
        vals.append(now)
    if _table_has_column(existing_cols, "_updated_by"):
        cols.append(_quote_col("_updated_by"))
        vals.append(user_email)

    for field in fields:
        if not _table_has_column(existing_cols, field.field_key):
            continue
        cols.append(_quote_col(field.field_key))
        val = values.get(field.field_key)
        if isinstance(val, (list, dict)):
            vals.append(json.dumps(val))
        else:
            vals.append(val)

    placeholders = ", ".join("?" for _ in cols)
    col_sql = ", ".join(cols)
    data_execute(f"INSERT INTO {data_table} ({col_sql}) VALUES ({placeholders})", vals)
    return {
        "record_id": record_id,
        "values": values,
        "created_at": now,
        "created_by": user_email,
        "updated_at": now,
        "updated_by": user_email,
    }


def update_record(
    project: dict[str, Any],
    fields: list[FieldDefinition],
    record_id: str,
    values: dict[str, Any],
    user_email: str,
) -> None:
    if _is_lakebase(project):
        from backend import lakebase_storage

        lakebase_storage.update_record(project, fields, record_id, values, user_email)
        return
    with project_data_scope(project):
        if _uses_staged_sync(project):
            from backend import staged_records

            existing = get_record(project, fields, record_id)
            if not existing:
                raise ValueError("Record not found")
            merged_values = {**existing["values"], **values}
            staged_row = staged_records.get_staged(project["project_id"], record_id)
            operation = "insert" if staged_row and staged_row["operation"] == "insert" else "update"
            staged_records.upsert_staged(
                project["project_id"],
                record_id,
                operation,
                merged_values,
                user_email,
            )
            return
        _update_record_in_uc(project, fields, record_id, values, user_email)


def _update_record_in_uc(
    project: dict[str, Any],
    fields: list[FieldDefinition],
    record_id: str,
    values: dict[str, Any],
    user_email: str,
) -> None:
    data_table = _data_table_fqn(project)
    record_key_col = _record_key_column(project)
    existing_cols = _describe_column_names(data_table)
    now = _now()
    sets: list[str] = []
    params: list[Any] = []
    if _table_has_column(existing_cols, "_updated_at"):
        sets.append(f"{_quote_col('_updated_at')} = ?")
        params.append(now)
    if _table_has_column(existing_cols, "_updated_by"):
        sets.append(f"{_quote_col('_updated_by')} = ?")
        params.append(user_email)
    for field in fields:
        if field.field_key in values and field.field_key != record_key_col:
            if not _table_has_column(existing_cols, field.field_key):
                continue
            sets.append(f"{_quote_col(field.field_key)} = ?")
            val = values[field.field_key]
            params.append(json.dumps(val) if isinstance(val, (list, dict)) else val)
    if not sets:
        return
    where_sql, where_params = _record_where_clause(record_key_col, record_id)
    params.extend(where_params)
    data_execute(f"UPDATE {data_table} SET {', '.join(sets)} WHERE {where_sql}", params)


def delete_record(project: dict[str, Any], record_id: str, user_email: str) -> bool:
    """Delete a record by id. Returns False if not found."""
    if _is_lakebase(project):
        from backend import lakebase_storage

        return lakebase_storage.delete_record(project, record_id)
    with project_data_scope(project):
        if _uses_staged_sync(project):
            from backend import staged_records

            staged_row = staged_records.get_staged(project["project_id"], record_id)
            uc_exists = _record_exists_in_uc(project, record_id)
            if not uc_exists and not staged_row:
                return False
            if staged_row and staged_row["operation"] == "insert" and not uc_exists:
                staged_records.delete_staged(project["project_id"], record_id)
                return True
            staged_records.upsert_staged(
                project["project_id"],
                record_id,
                "delete",
                None,
                user_email,
            )
            return True
        return _delete_record_from_uc(project, record_id)


def _delete_record_from_uc(project: dict[str, Any], record_id: str) -> bool:
    data_table = _data_table_fqn(project)
    record_key_col = _record_key_column(project)
    where_sql, params = _record_where_clause(record_key_col, record_id)
    existing = data_fetchone(f"SELECT 1 AS found FROM {data_table} WHERE {where_sql}", params)
    if not existing:
        return False
    data_execute(f"DELETE FROM {data_table} WHERE {where_sql}", params)
    return True


def count_staged_changes(project_id: str) -> int:
    from backend import staged_records

    return staged_records.count_staged(project_id)


def sync_staged_records(
    project: dict[str, Any],
    fields: list[FieldDefinition],
    user_email: str,
) -> dict[str, int]:
    from backend import staged_records

    if not _uses_staged_sync(project):
        raise ValueError("This collection does not use staged record sync")

    rows = staged_records.list_staged(project["project_id"])
    if not rows:
        return {"synced": 0, "inserted": 0, "updated": 0, "deleted": 0}

    inserted = updated = deleted = 0
    with project_data_scope(project):
        for row in rows:
            record_id = row["record_id"]
            operation = row["operation"]
            if operation == "delete":
                if _delete_record_from_uc(project, record_id):
                    deleted += 1
                continue
            values = json.loads(row["values_json"] or "{}")
            if operation == "insert":
                if _get_record_from_uc(project, fields, record_id):
                    _update_record_in_uc(project, fields, record_id, values, user_email)
                    updated += 1
                else:
                    _insert_record_to_uc(
                        project,
                        fields,
                        values,
                        user_email,
                        record_id=record_id,
                        skip_duplicate_check=True,
                    )
                    inserted += 1
                continue
            if operation == "update":
                if _get_record_from_uc(project, fields, record_id):
                    _update_record_in_uc(project, fields, record_id, values, user_email)
                    updated += 1
                else:
                    _insert_record_to_uc(
                        project,
                        fields,
                        values,
                        user_email,
                        record_id=record_id,
                        skip_duplicate_check=True,
                    )
                    inserted += 1

    staged_records.clear_staged(project["project_id"])
    synced = inserted + updated + deleted
    return {"synced": synced, "inserted": inserted, "updated": updated, "deleted": deleted}
