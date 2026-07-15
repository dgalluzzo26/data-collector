"""Unity Catalog table introspection for lookup binding."""

from __future__ import annotations

from typing import Any

from backend import config
from backend.models import FieldDefinition, LookupColumn
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
        key = name
        if key in seen:
            key = f"{name}_{len(seen)}"
        seen.add(key)
        data_type = str(row.get("data_type") or row.get("data_type_name") or "string").lower()
        if "bool" in data_type:
            col_type = "boolean"
        elif "timestamp" in data_type or "datetime" in data_type:
            col_type = "datetime"
        elif "date" in data_type:
            col_type = "date"
        elif any(t in data_type for t in ("int", "double", "float", "decimal", "long")):
            col_type = "number"
        else:
            col_type = "text"
        columns.append(LookupColumn(key=key, label=name, type=col_type))  # type: ignore[arg-type]
    if not columns:
        raise ValueError(f"Table {catalog}.{schema}.{table} has no readable columns")
    return columns


def count_table_rows(catalog: str, schema: str, table: str) -> int:
    fqn = _table_fqn(catalog, schema, table)
    row = fetchone(f"SELECT COUNT(*) AS cnt FROM {fqn}")
    return int(row["cnt"]) if row else 0


def approximate_row_count(catalog: str, schema: str, table: str, *, cap: int = 100_001) -> int:
    """Fast row estimate for UI preview — capped to avoid full-table scans."""
    fqn = _table_fqn(catalog, schema, table)
    row = fetchone(f"SELECT COUNT(*) AS cnt FROM (SELECT 1 FROM {fqn} LIMIT {int(cap)}) t")
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
    row_count = approximate_row_count(catalog, schema, table)
    sample = fetch_table_rows(catalog, schema, table, keys, limit=sample_limit)
    return {
        "catalog": catalog,
        "schema": schema,
        "table": table,
        "columns": columns,
        "row_count": row_count,
        "sample_rows": sample,
    }


def table_exists(catalog: str, schema: str, table: str) -> bool:
    try:
        describe_table_columns(catalog, schema, table)
        return True
    except ValueError:
        return False


def columns_to_field_definitions(
    columns: list[LookupColumn],
    *,
    selected_keys: set[str] | None = None,
) -> list[FieldDefinition]:
    """Build draft form fields from UC table column metadata."""
    fields: list[FieldDefinition] = []
    sort_order = 0
    for col in columns:
        if col.key.startswith("_"):
            continue
        if selected_keys is not None and col.key not in selected_keys:
            continue
        fields.append(
            FieldDefinition(
                field_key=col.key,
                label=col.label,
                field_type=col.type,  # type: ignore[arg-type]
                config_json=None,
                sort_order=sort_order,
                is_required=False,
                schema_version=0,
                is_published=False,
            )
        )
        sort_order += 1
    if not fields:
        raise ValueError("Select at least one column for the form")
    return fields
