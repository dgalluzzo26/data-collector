"""Project, member, field, and record data access."""

from __future__ import annotations

import json
import re
import uuid
from datetime import datetime, timezone
from typing import Any, Optional

from backend import config
from backend.models import FieldDefinition, ProjectMember, ProjectRole
from backend.sql_util import execute, fetchall, fetchone

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
            target_catalog, target_schema, target_table,
            schema_version, status, created_at, created_by, updated_at, updated_by
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0, 'draft', ?, ?, ?, ?)
        """,
        (
            project_id,
            name,
            slug,
            description,
            storage_type,
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


def add_member(project_id: str, user_email: str, role: ProjectRole, added_by: str) -> None:
    execute(
        f"""
        INSERT INTO {_table("project_members")} (project_id, user_email, role, added_at, added_by)
        VALUES (?, ?, ?, ?, ?)
        """,
        (project_id, user_email.lower(), role, _now(), added_by),
    )


def remove_member(project_id: str, user_email: str) -> None:
    execute(
        f"DELETE FROM {_table('project_members')} WHERE project_id = ? AND user_email = ?",
        (project_id, user_email.lower()),
    )


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
    for field in fields:
        execute(
            f"""
            INSERT INTO {_table("field_definitions")} (
                project_id, field_key, label, field_type, config_json,
                sort_order, is_required, schema_version, is_published
            ) VALUES (?, ?, ?, ?, ?, ?, ?, 0, false)
            """,
            (
                project_id,
                field.field_key,
                field.label,
                field.field_type,
                json.dumps(field.config_json) if field.config_json else None,
                field.sort_order,
                field.is_required,
            ),
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


def publish_project(project_id: str, user_email: str) -> dict[str, Any]:
    project = get_project(project_id)
    if not project:
        raise ValueError("Project not found")

    fields = list_fields(project_id, published_only=False)
    draft_fields = [f for f in fields if not f.is_published]
    if not draft_fields:
        draft_fields = fields

    version = int(project["schema_version"]) + 1

    previous_published = list_fields(project_id, published_only=True)
    previous_keys = {f.field_key for f in previous_published}

    if _is_lakebase(project):
        from backend import lakebase_storage

        lakebase_storage.publish_table(project, draft_fields, previous_keys)
    else:
        catalog = project["target_catalog"]
        schema = project["target_schema"]
        table = project["target_table"]
        from backend.config import quote_identifier

        data_table = (
            f"{quote_identifier(catalog)}.{quote_identifier(schema)}."
            f"{quote_identifier(table)}"
        )

        columns = [
            "_record_id STRING NOT NULL",
            "_created_at TIMESTAMP NOT NULL",
            "_created_by STRING NOT NULL",
            "_updated_at TIMESTAMP",
            "_updated_by STRING",
        ]
        for field in draft_fields:
            columns.append(f"{quote_identifier(field.field_key)} {_sql_type(field.field_type)}")

        execute(f"CREATE TABLE IF NOT EXISTS {data_table} ({', '.join(columns)}) USING DELTA")

        for field in draft_fields:
            if field.field_key not in previous_keys:
                col = f"{quote_identifier(field.field_key)} {_sql_type(field.field_type)}"
                try:
                    execute(f"ALTER TABLE {data_table} ADD COLUMN {col}")
                except Exception as exc:
                    msg = str(exc).lower()
                    if "already exists" not in msg and "duplicate" not in msg:
                        raise

    # Drop superseded published definitions before inserting the new version.
    execute(
        f"DELETE FROM {_table('field_definitions')} WHERE project_id = ? AND is_published = true AND schema_version < ?",
        (project_id, version),
    )

    for field in draft_fields:
        execute(
            f"""
            INSERT INTO {_table('field_definitions')} (
                project_id, field_key, label, field_type, config_json,
                sort_order, is_required, schema_version, is_published
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, true)
            """,
            (
                project_id,
                field.field_key,
                field.label,
                field.field_type,
                json.dumps(field.config_json) if field.config_json else None,
                field.sort_order,
                field.is_required,
                version,
            ),
        )

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
    from backend import genie_service

    refreshed = get_project(project_id)
    if refreshed and genie_service.genie_available_for_project(refreshed):
        genie_service.provision_genie_space(project_id, user_email)
    elif refreshed and _is_lakebase(refreshed):
        update_project(
            project_id,
            {"genie_status": "disabled", "genie_error": None},
            user_email,
        )
    return get_project(project_id)  # type: ignore[return-value]


def _data_table_fqn(project: dict[str, Any]) -> str:
    from backend.config import quote_identifier

    return (
        f"{quote_identifier(project['target_catalog'])}."
        f"{quote_identifier(project['target_schema'])}."
        f"{quote_identifier(project['target_table'])}"
    )


def list_records(project: dict[str, Any], fields: list[FieldDefinition]) -> list[dict[str, Any]]:
    if _is_lakebase(project):
        from backend import lakebase_storage

        return lakebase_storage.list_records(project, fields)
    field_cols = ", ".join(f"`{f.field_key}`" for f in fields) if fields else ""
    extra = f", {field_cols}" if field_cols else ""
    sql = f"SELECT _record_id, _created_at, _created_by, _updated_at, _updated_by{extra} FROM {_data_table_fqn(project)} ORDER BY _updated_at DESC NULLS LAST, _created_at DESC"
    rows = fetchall(sql)
    result = []
    for row in rows:
        values = {k: row[k] for k in row if not k.startswith("_")}
        result.append(
            {
                "record_id": row["_record_id"],
                "values": values,
                "created_at": row.get("_created_at"),
                "created_by": row.get("_created_by"),
                "updated_at": row.get("_updated_at"),
                "updated_by": row.get("_updated_by"),
            }
        )
    return result


def get_record(
    project: dict[str, Any],
    fields: list[FieldDefinition],
    record_id: str,
) -> Optional[dict[str, Any]]:
    if _is_lakebase(project):
        from backend import lakebase_storage

        return lakebase_storage.get_record(project, fields, record_id)
    field_cols = ", ".join(f"`{f.field_key}`" for f in fields) if fields else ""
    extra = f", {field_cols}" if field_cols else ""
    row = fetchone(
        f"SELECT _record_id, _created_at, _created_by, _updated_at, _updated_by{extra} FROM {_data_table_fqn(project)} WHERE _record_id = ?",
        (record_id,),
    )
    if not row:
        return None
    values = {k: row[k] for k in row if not k.startswith("_")}
    return {
        "record_id": row["_record_id"],
        "values": values,
        "created_at": row.get("_created_at"),
        "created_by": row.get("_created_by"),
        "updated_at": row.get("_updated_at"),
        "updated_by": row.get("_updated_by"),
    }


def create_record(
    project: dict[str, Any],
    fields: list[FieldDefinition],
    values: dict[str, Any],
    user_email: str,
) -> dict[str, Any]:
    if _is_lakebase(project):
        from backend import lakebase_storage

        return lakebase_storage.create_record(project, fields, values, user_email)
    record_id = str(uuid.uuid4())
    now = _now()
    cols = ["_record_id", "_created_at", "_created_by", "_updated_at", "_updated_by"]
    vals = [record_id, now, user_email, now, user_email]
    for field in fields:
        cols.append(f"`{field.field_key}`")
        val = values.get(field.field_key)
        if isinstance(val, (list, dict)):
            vals.append(json.dumps(val))
        else:
            vals.append(val)

    placeholders = ", ".join("?" for _ in cols)
    col_sql = ", ".join(cols)
    execute(f"INSERT INTO {_data_table_fqn(project)} ({col_sql}) VALUES ({placeholders})", vals)
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
    now = _now()
    sets = ["_updated_at = ?", "_updated_by = ?"]
    params: list[Any] = [now, user_email]
    for field in fields:
        if field.field_key in values:
            sets.append(f"`{field.field_key}` = ?")
            val = values[field.field_key]
            params.append(json.dumps(val) if isinstance(val, (list, dict)) else val)
    params.append(record_id)
    execute(
        f"UPDATE {_data_table_fqn(project)} SET {', '.join(sets)} WHERE _record_id = ?",
        params,
    )


def delete_record(project: dict[str, Any], record_id: str) -> bool:
    """Delete a record by id. Returns False if not found."""
    if _is_lakebase(project):
        from backend import lakebase_storage

        return lakebase_storage.delete_record(project, record_id)
    existing = fetchone(
        f"SELECT _record_id FROM {_data_table_fqn(project)} WHERE _record_id = ?",
        (record_id,),
    )
    if not existing:
        return False
    execute(f"DELETE FROM {_data_table_fqn(project)} WHERE _record_id = ?", (record_id,))
    return True
