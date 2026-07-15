"""Unity Catalog table introspection for lookup binding."""

from __future__ import annotations

from typing import Any

from backend import config
from backend.models import LookupColumn
from backend.repository import slugify
from backend.sql_util import fetchall, fetchone


def _table_fqn(catalog: str, schema: str, table: str) -> str:
    return config.table_fqn(catalog, schema, table)


def _schema_fqn(catalog: str, schema: str) -> str:
    return f"{config.quote_identifier(catalog)}.{config.quote_identifier(schema)}"


def _row_name(row: dict[str, Any], *keys: str) -> str:
    for key in keys:
        value = row.get(key)
        if value is not None and str(value).strip():
            return str(value).strip()
    for value in row.values():
        if value is not None and str(value).strip():
            return str(value).strip()
    return ""


def list_schemas(catalog: str) -> list[str]:
    """List schemas in a Unity Catalog catalog."""
    config.validate_identifier(catalog, "catalog")
    catalog_sql = config.quote_identifier(catalog)
    rows = fetchall(f"SHOW SCHEMAS IN {catalog_sql}")
    names = sorted(
        {
            name
            for row in rows
            if (name := _row_name(row, "databaseName", "namespace", "schemaName", "schema"))
        }
    )
    return names


def list_tables(catalog: str, schema: str) -> list[str]:
    """List tables in a Unity Catalog schema."""
    config.validate_identifier(catalog, "catalog")
    config.validate_identifier(schema, "schema")
    rows = fetchall(f"SHOW TABLES IN {_schema_fqn(catalog, schema)}")
    names = sorted(
        {
            name
            for row in rows
            if (name := _row_name(row, "tableName", "table", "name"))
        }
    )
    return names


def describe_table_columns(catalog: str, schema: str, table: str) -> list[LookupColumn]:
    """Return column metadata for a UC table."""
    config.validate_identifier(catalog, "catalog")
    config.validate_identifier(schema, "schema")
    config.validate_identifier(table, "table")

    fqn = _table_fqn(catalog, schema, table)
    rows = fetchall(f"DESCRIBE TABLE {fqn}")
    columns: list[LookupColumn] = []
    seen: set[str] = set()
    for row in rows:
        name = str(row.get("col_name") or row.get("column_name") or "").strip()
        if not name or name.startswith("#"):
            continue
        key = slugify(name) or name
        if key in seen:
            key = f"{key}_{len(seen)}"
        seen.add(key)
        data_type = str(row.get("data_type") or row.get("data_type_name") or "string").lower()
        col_type: str = "number" if any(t in data_type for t in ("int", "double", "float", "decimal", "long")) else "text"
        columns.append(LookupColumn(key=key, label=name, type=col_type))  # type: ignore[arg-type]
    if not columns:
        raise ValueError(f"Table {catalog}.{schema}.{table} has no readable columns")
    return columns


def count_table_rows(catalog: str, schema: str, table: str) -> int:
    fqn = _table_fqn(catalog, schema, table)
    row = fetchone(f"SELECT COUNT(*) AS cnt FROM {fqn}")
    return int(row["cnt"]) if row else 0


def fetch_table_rows(
    catalog: str,
    schema: str,
    table: str,
    column_keys: list[str],
    *,
    limit: int = 10_000,
) -> list[dict[str, Any]]:
    if not column_keys:
        return []
    fqn = _table_fqn(catalog, schema, table)
    col_sql = ", ".join(config.quote_identifier(k) for k in column_keys)
    return fetchall(f"SELECT {col_sql} FROM {fqn} LIMIT {int(limit)}")


def preview_uc_table(
    catalog: str,
    schema: str,
    table: str,
    *,
    sample_limit: int = 5,
) -> dict[str, Any]:
    columns = describe_table_columns(catalog, schema, table)
    keys = [c.key for c in columns]
    row_count = count_table_rows(catalog, schema, table)
    sample = fetch_table_rows(catalog, schema, table, keys, limit=sample_limit)
    return {
        "catalog": catalog,
        "schema": schema,
        "table": table,
        "columns": columns,
        "row_count": row_count,
        "sample_rows": sample,
    }
