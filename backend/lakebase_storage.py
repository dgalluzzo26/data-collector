"""Publish and CRUD for collection record tables stored in Lakebase Postgres."""

from __future__ import annotations

import json
import os
import uuid
from datetime import datetime, timezone
from typing import Any, Optional

from backend import pg_util
from backend.models import FieldDefinition

_AUDIT_COLUMNS: list[tuple[str, str]] = [
    ("_created_at", "TIMESTAMPTZ"),
    ("_created_by", "TEXT"),
    ("_updated_at", "TIMESTAMPTZ"),
    ("_updated_by", "TEXT"),
]


def _now() -> datetime:
    return datetime.now(timezone.utc)


def _quote_ident(name: str) -> str:
    return '"' + name.replace('"', '""') + '"'


def _quote_grantee(role: str) -> str:
    if role.upper() == "PUBLIC":
        return "PUBLIC"
    return _quote_ident(role)


def _lakebase_grantees() -> list[str]:
    """Roles that should read/write collection tables (e.g. prod app service principal)."""
    grantees = ["PUBLIC"]
    extra = (os.environ.get("LAKEBASE_ADDITIONAL_GRANTEES") or "").strip()
    if extra:
        grantees.extend(part.strip() for part in extra.split(",") if part.strip())
    return grantees


def table_ref(project: dict[str, Any]) -> str:
    schema = project["target_schema"]
    table = project["target_table"]
    return f"{_quote_ident(schema)}.{_quote_ident(table)}"


def _is_existing_table(project: dict[str, Any]) -> bool:
    return (project.get("storage_mode") or "managed") == "existing_uc"


def _record_key_column(project: dict[str, Any]) -> Optional[str]:
    col = project.get("record_key_column")
    return str(col).strip() if col and str(col).strip() else None


def _duplicate_key_mode(project: dict[str, Any]) -> str:
    mode = project.get("duplicate_key_mode") or "retain"
    return mode if mode in ("retain", "overwrite") else "retain"


def _column_map(project: dict[str, Any]) -> dict[str, str]:
    """Lower-cased column name -> actual column name for the backing table."""
    rows = pg_util.fetchall(
        """
        SELECT column_name
        FROM information_schema.columns
        WHERE table_schema = %s AND table_name = %s
        ORDER BY ordinal_position
        """,
        (project["target_schema"], project["target_table"]),
    )
    return {str(r["column_name"]).lower(): str(r["column_name"]) for r in rows}


def _resolve(columns: dict[str, str], name: Optional[str]) -> Optional[str]:
    if not name:
        return None
    return columns.get(name.lower())


def _pg_type(field_type: str) -> str:
    mapping = {
        "text": "TEXT",
        "textarea": "TEXT",
        "email": "TEXT",
        "url": "TEXT",
        "number": "DOUBLE PRECISION",
        "date": "DATE",
        "datetime": "TIMESTAMPTZ",
        "boolean": "BOOLEAN",
        "single_select": "TEXT",
        "multi_select": "TEXT",
        "lookup": "TEXT",
    }
    return mapping.get(field_type, "TEXT")


def _encode(value: Any) -> Any:
    return json.dumps(value) if isinstance(value, (list, dict)) else value


def ensure_schema(project: dict[str, Any]) -> None:
    pg_util.execute(
        f"CREATE SCHEMA IF NOT EXISTS {_quote_ident(project['target_schema'])}"
    )


def ensure_collection_grants(project: dict[str, Any]) -> None:
    """Grant schema/table access so prod app PGUSER can read tables created locally."""
    schema = _quote_ident(project["target_schema"])
    ref = table_ref(project)
    for grantee in _lakebase_grantees():
        role = _quote_grantee(grantee)
        pg_util.execute(f"GRANT USAGE ON SCHEMA {schema} TO {role}")
        pg_util.execute(
            f"GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA {schema} TO {role}"
        )
        pg_util.execute(f"GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE {ref} TO {role}")
    pg_util.execute(
        f"ALTER DEFAULT PRIVILEGES IN SCHEMA {schema} "
        f"GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO PUBLIC"
    )


def _add_column(ref: str, name: str, col_type: str) -> None:
    try:
        pg_util.execute(f"ALTER TABLE {ref} ADD COLUMN IF NOT EXISTS {_quote_ident(name)} {col_type}")
    except Exception as exc:
        msg = str(exc).lower()
        if "already exists" not in msg and "duplicate" not in msg:
            raise


def publish_table(
    project: dict[str, Any],
    draft_fields: list[FieldDefinition],
    previous_keys: set[str],
) -> None:
    ref = table_ref(project)

    if _is_existing_table(project):
        columns = _column_map(project)
        if not columns:
            raise ValueError(
                f"Table {project['target_schema']}.{project['target_table']} does not exist "
                f"or is not visible with the app's Lakebase permissions."
            )
        # Audit columns are optional on tables the app does not own; reads adapt to what exists.
        for name, col_type in _AUDIT_COLUMNS:
            if name not in columns:
                try:
                    _add_column(ref, name, col_type)
                except Exception:
                    pass
        for field in draft_fields:
            if field.field_key.lower() not in columns:
                _add_column(ref, field.field_key, _pg_type(field.field_type))
        try:
            ensure_collection_grants(project)
        except Exception:
            pass
        return

    ensure_schema(project)

    columns = [
        "_record_id TEXT NOT NULL",
        "_created_at TIMESTAMPTZ NOT NULL",
        "_created_by TEXT NOT NULL",
        "_updated_at TIMESTAMPTZ",
        "_updated_by TEXT",
    ]
    for field in draft_fields:
        columns.append(f"{_quote_ident(field.field_key)} {_pg_type(field.field_type)}")

    pg_util.execute(f"CREATE TABLE IF NOT EXISTS {ref} ({', '.join(columns)})")

    for field in draft_fields:
        if field.field_key not in previous_keys:
            _add_column(ref, field.field_key, _pg_type(field.field_type))

    ensure_collection_grants(project)


def _id_column(project: dict[str, Any], columns: dict[str, str]) -> Optional[str]:
    """Column that identifies a record: the configured key, else the app record id."""
    return _resolve(columns, _record_key_column(project)) or _resolve(columns, "_record_id")


def _row_to_record(
    row: dict[str, Any],
    fields: list[FieldDefinition],
    columns: dict[str, str],
    id_col: Optional[str],
) -> dict[str, Any]:
    values: dict[str, Any] = {}
    for field in fields:
        actual = _resolve(columns, field.field_key)
        if actual and actual in row:
            values[field.field_key] = row[actual]
    raw_id = row.get(id_col) if id_col else None
    return {
        "record_id": "" if raw_id is None else str(raw_id),
        "values": values,
        "created_at": row.get(_resolve(columns, "_created_at") or ""),
        "created_by": row.get(_resolve(columns, "_created_by") or ""),
        "updated_at": row.get(_resolve(columns, "_updated_at") or ""),
        "updated_by": row.get(_resolve(columns, "_updated_by") or ""),
    }


def _select_columns(
    fields: list[FieldDefinition],
    columns: dict[str, str],
    id_col: Optional[str],
) -> list[str]:
    selected: list[str] = []
    if id_col:
        selected.append(id_col)
    for name, _ in _AUDIT_COLUMNS:
        actual = _resolve(columns, name)
        if actual and actual not in selected:
            selected.append(actual)
    for field in fields:
        actual = _resolve(columns, field.field_key)
        if actual and actual not in selected:
            selected.append(actual)
    return selected


def list_records(
    project: dict[str, Any], fields: list[FieldDefinition]
) -> list[dict[str, Any]]:
    columns = _column_map(project)
    if not columns:
        return []
    id_col = _id_column(project, columns)
    selected = _select_columns(fields, columns, id_col)
    if not selected:
        return []

    updated_at = _resolve(columns, "_updated_at")
    created_at = _resolve(columns, "_created_at")
    if updated_at and created_at:
        order = f"{_quote_ident(updated_at)} DESC NULLS LAST, {_quote_ident(created_at)} DESC"
    elif updated_at:
        order = f"{_quote_ident(updated_at)} DESC NULLS LAST"
    elif id_col:
        order = f"{_quote_ident(id_col)} DESC"
    else:
        order = "1"

    col_sql = ", ".join(_quote_ident(c) for c in selected)
    rows = pg_util.fetchall(
        f"SELECT {col_sql} FROM {table_ref(project)} ORDER BY {order}"
    )
    return [_row_to_record(row, fields, columns, id_col) for row in rows]


def get_record(
    project: dict[str, Any],
    fields: list[FieldDefinition],
    record_id: str,
) -> Optional[dict[str, Any]]:
    columns = _column_map(project)
    id_col = _id_column(project, columns)
    if not id_col:
        return None
    selected = _select_columns(fields, columns, id_col)
    col_sql = ", ".join(_quote_ident(c) for c in selected)
    row = pg_util.fetchone(
        f"SELECT {col_sql} FROM {table_ref(project)} "
        f"WHERE {_quote_ident(id_col)}::text = %s",
        (record_id,),
    )
    if not row:
        return None
    return _row_to_record(row, fields, columns, id_col)


def record_exists(project: dict[str, Any], record_id: str) -> bool:
    columns = _column_map(project)
    id_col = _id_column(project, columns)
    if not id_col:
        return False
    row = pg_util.fetchone(
        f"SELECT 1 AS found FROM {table_ref(project)} "
        f"WHERE {_quote_ident(id_col)}::text = %s",
        (record_id,),
    )
    return row is not None


def create_record(
    project: dict[str, Any],
    fields: list[FieldDefinition],
    values: dict[str, Any],
    user_email: str,
    *,
    record_id: Optional[str] = None,
) -> dict[str, Any]:
    columns = _column_map(project)
    key_col = _record_key_column(project)
    now = _now()

    if key_col:
        key_value = values.get(key_col)
        if key_value is None or (isinstance(key_value, str) and not key_value.strip()):
            raise ValueError(f"{key_col} is required")
        record_id = str(key_value)
        if get_record(project, fields, record_id):
            if _duplicate_key_mode(project) == "overwrite":
                update_record(project, fields, record_id, values, user_email)
                updated = get_record(project, fields, record_id)
                if updated:
                    return updated
            else:
                raise ValueError("A record with this id already exists")
    elif not record_id:
        record_id = str(uuid.uuid4())

    cols: list[str] = []
    vals: list[Any] = []

    record_id_col = _resolve(columns, "_record_id")
    if record_id_col and not key_col:
        cols.append(record_id_col)
        vals.append(record_id)

    for name, value in (
        ("_created_at", now),
        ("_created_by", user_email),
        ("_updated_at", now),
        ("_updated_by", user_email),
    ):
        actual = _resolve(columns, name)
        if actual:
            cols.append(actual)
            vals.append(value)

    for field in fields:
        actual = _resolve(columns, field.field_key)
        if actual and actual not in cols:
            cols.append(actual)
            vals.append(_encode(values.get(field.field_key)))

    if not cols:
        raise ValueError("No writable columns found on the Lakebase table")

    placeholders = ", ".join("%s" for _ in cols)
    col_sql = ", ".join(_quote_ident(c) for c in cols)
    pg_util.execute(
        f"INSERT INTO {table_ref(project)} ({col_sql}) VALUES ({placeholders})",
        vals,
    )
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
    columns = _column_map(project)
    id_col = _id_column(project, columns)
    if not id_col:
        raise ValueError("This Lakebase table has no record key column configured")

    key_col = _record_key_column(project)
    now = _now()
    sets: list[str] = []
    params: list[Any] = []

    for name, value in (("_updated_at", now), ("_updated_by", user_email)):
        actual = _resolve(columns, name)
        if actual:
            sets.append(f"{_quote_ident(actual)} = %s")
            params.append(value)

    for field in fields:
        if field.field_key not in values:
            continue
        if key_col and field.field_key == key_col:
            continue
        actual = _resolve(columns, field.field_key)
        if not actual:
            continue
        sets.append(f"{_quote_ident(actual)} = %s")
        params.append(_encode(values[field.field_key]))

    if not sets:
        return

    params.append(record_id)
    pg_util.execute(
        f"UPDATE {table_ref(project)} SET {', '.join(sets)} "
        f"WHERE {_quote_ident(id_col)}::text = %s",
        params,
    )


def delete_record(project: dict[str, Any], record_id: str) -> bool:
    columns = _column_map(project)
    id_col = _id_column(project, columns)
    if not id_col:
        return False
    existing = pg_util.fetchone(
        f"SELECT 1 AS found FROM {table_ref(project)} "
        f"WHERE {_quote_ident(id_col)}::text = %s",
        (record_id,),
    )
    if not existing:
        return False
    pg_util.execute(
        f"DELETE FROM {table_ref(project)} WHERE {_quote_ident(id_col)}::text = %s",
        (record_id,),
    )
    return True
