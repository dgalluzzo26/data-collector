"""Publish and CRUD for collection record tables stored in Lakebase Postgres."""

from __future__ import annotations

import json
import os
import uuid
from datetime import datetime, timezone
from typing import Any, Optional

from backend import pg_util
from backend.models import FieldDefinition


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


def publish_table(
    project: dict[str, Any],
    draft_fields: list[FieldDefinition],
    previous_keys: set[str],
) -> None:
    ensure_schema(project)
    ref = table_ref(project)

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
            col = f"{_quote_ident(field.field_key)} {_pg_type(field.field_type)}"
            try:
                pg_util.execute(f"ALTER TABLE {ref} ADD COLUMN {col}")
            except Exception as exc:
                msg = str(exc).lower()
                if "already exists" not in msg and "duplicate" not in msg:
                    raise

    ensure_collection_grants(project)


def list_records(
    project: dict[str, Any], fields: list[FieldDefinition]
) -> list[dict[str, Any]]:
    field_cols = ", ".join(_quote_ident(f.field_key) for f in fields) if fields else ""
    extra = f", {field_cols}" if field_cols else ""
    sql = (
        f"SELECT _record_id, _created_at, _created_by, _updated_at, _updated_by{extra} "
        f"FROM {table_ref(project)} "
        f"ORDER BY _updated_at DESC NULLS LAST, _created_at DESC"
    )
    rows = pg_util.fetchall(sql)
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
    field_cols = ", ".join(_quote_ident(f.field_key) for f in fields) if fields else ""
    extra = f", {field_cols}" if field_cols else ""
    row = pg_util.fetchone(
        f"SELECT _record_id, _created_at, _created_by, _updated_at, _updated_by{extra} "
        f"FROM {table_ref(project)} WHERE _record_id = %s",
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
    record_id = str(uuid.uuid4())
    now = _now()
    cols = ["_record_id", "_created_at", "_created_by", "_updated_at", "_updated_by"]
    vals: list[Any] = [record_id, now, user_email, now, user_email]
    for field in fields:
        cols.append(_quote_ident(field.field_key))
        val = values.get(field.field_key)
        vals.append(json.dumps(val) if isinstance(val, (list, dict)) else val)

    placeholders = ", ".join("%s" for _ in cols)
    col_sql = ", ".join(cols)
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
    now = _now()
    sets = ["_updated_at = %s", "_updated_by = %s"]
    params: list[Any] = [now, user_email]
    for field in fields:
        if field.field_key in values:
            sets.append(f"{_quote_ident(field.field_key)} = %s")
            val = values[field.field_key]
            params.append(json.dumps(val) if isinstance(val, (list, dict)) else val)
    params.append(record_id)
    pg_util.execute(
        f"UPDATE {table_ref(project)} SET {', '.join(sets)} WHERE _record_id = %s",
        params,
    )


def delete_record(project: dict[str, Any], record_id: str) -> bool:
    existing = pg_util.fetchone(
        f"SELECT _record_id FROM {table_ref(project)} WHERE _record_id = %s",
        (record_id,),
    )
    if not existing:
        return False
    pg_util.execute(
        f"DELETE FROM {table_ref(project)} WHERE _record_id = %s",
        (record_id,),
    )
    return True
