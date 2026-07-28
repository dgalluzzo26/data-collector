"""Lakebase Postgres introspection for collection setup (schemas / tables / preview)."""

from __future__ import annotations

from typing import Any

from backend import config, lakebase_config, pg_util
from backend.models import LookupColumn

_SYSTEM_SCHEMAS = frozenset(
    {
        "information_schema",
        "pg_catalog",
        "pg_toast",
        "pgrst",
        "databricks_auth",
    }
)


def _pg_field_type(data_type: str) -> str:
    dt = (data_type or "").lower()
    if "bool" in dt:
        return "boolean"
    if "timestamp" in dt or "timestamptz" in dt:
        return "datetime"
    if dt == "date":
        return "date"
    if any(t in dt for t in ("int", "numeric", "decimal", "double", "real", "float", "money")):
        return "number"
    return "text"


def list_databases() -> list[str]:
    lakebase_config.require_configured()
    return [lakebase_config.database_name()]


def list_schemas() -> list[str]:
    lakebase_config.require_configured()
    rows = pg_util.fetchall(
        """
        SELECT schema_name
        FROM information_schema.schemata
        ORDER BY schema_name
        """
    )
    names: list[str] = []
    for row in rows:
        name = str(row.get("schema_name") or "").strip()
        if not name or name in _SYSTEM_SCHEMAS or name.startswith("pg_"):
            continue
        names.append(name)
    return names


def list_tables(schema: str) -> list[str]:
    lakebase_config.require_configured()
    schema = config.validate_identifier(schema.strip(), "schema")
    rows = pg_util.fetchall(
        """
        SELECT table_name
        FROM information_schema.tables
        WHERE table_schema = %s
          AND table_type IN ('BASE TABLE', 'VIEW')
        ORDER BY table_name
        """,
        (schema,),
    )
    return [str(row["table_name"]) for row in rows if row.get("table_name")]


def describe_table_columns(schema: str, table: str) -> list[LookupColumn]:
    lakebase_config.require_configured()
    schema = config.validate_identifier(schema.strip(), "schema")
    table = config.validate_identifier(table.strip(), "table")
    rows = pg_util.fetchall(
        """
        SELECT column_name, data_type, udt_name, is_nullable, column_default
        FROM information_schema.columns
        WHERE table_schema = %s AND table_name = %s
        ORDER BY ordinal_position
        """,
        (schema, table),
    )
    columns: list[LookupColumn] = []
    seen: set[str] = set()
    for row in rows:
        name = str(row.get("column_name") or "").strip()
        if not name:
            continue
        key = name
        if key in seen:
            key = f"{name}_{len(seen)}"
        seen.add(key)
        raw_type = str(row.get("udt_name") or row.get("data_type") or "text")
        # NOT NULL without a default must be supplied by the form or the insert fails.
        required = str(row.get("is_nullable") or "YES").upper() == "NO" and not row.get(
            "column_default"
        )
        columns.append(
            LookupColumn(
                key=key,
                label=name,
                type=_pg_field_type(raw_type),  # type: ignore[arg-type]
                required=required,
            )
        )
    if not columns:
        raise ValueError(f"Table {schema}.{table} has no readable columns")
    return columns


def approximate_row_count(schema: str, table: str, *, cap: int = 100_001) -> int:
    schema = config.validate_identifier(schema.strip(), "schema")
    table = config.validate_identifier(table.strip(), "table")
    ref = f'"{schema}"."{table}"'
    row = pg_util.fetchone(
        f"SELECT COUNT(*) AS cnt FROM (SELECT 1 FROM {ref} LIMIT %s) t",
        (cap,),
    )
    return int(row["cnt"]) if row else 0


def fetch_sample_rows(
    schema: str,
    table: str,
    column_keys: list[str],
    *,
    limit: int = 5,
) -> list[dict[str, Any]]:
    if not column_keys:
        return []
    schema = config.validate_identifier(schema.strip(), "schema")
    table = config.validate_identifier(table.strip(), "table")
    ref = f'"{schema}"."{table}"'
    col_sql = ", ".join(f'"{k.replace(chr(34), chr(34) * 2)}"' for k in column_keys)
    return pg_util.fetchall(f"SELECT {col_sql} FROM {ref} LIMIT %s", (limit,))


def preview_table(schema: str, table: str, *, sample_limit: int = 5) -> dict[str, Any]:
    lakebase_config.require_configured()
    database = lakebase_config.database_name()
    columns = describe_table_columns(schema, table)
    keys = [c.key for c in columns]
    row_count = approximate_row_count(schema, table)
    sample = fetch_sample_rows(schema, table, keys, limit=sample_limit)
    return {
        "catalog": database,
        "schema": schema.strip(),
        "table": table.strip(),
        "columns": columns,
        "row_count": row_count,
        "sample_rows": sample,
    }
