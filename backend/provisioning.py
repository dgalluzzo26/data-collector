"""Run Data Collector metadata DDL against a Databricks SQL warehouse."""

from backend.schema_ddl import TABLES, _schema_fqn, _table_fqn, ddl_statements, is_migration, migration_statements


def ensure_metadata_schema(cursor, catalog: str, schema: str) -> None:
    """Create the metadata schema if it does not exist."""
    try:
        cursor.execute(f"CREATE SCHEMA IF NOT EXISTS {_schema_fqn(catalog, schema)}")
    except Exception as exc:
        print(f"  schema ensure skipped: {exc}")


def ensure_metadata_tables(cursor, catalog: str, schema: str) -> None:
    """Create any metadata tables added since the deployment was first provisioned."""
    ensure_metadata_schema(cursor, catalog, schema)
    for table, columns in TABLES.items():
        try:
            cursor.execute(
                f"CREATE TABLE IF NOT EXISTS {_table_fqn(catalog, schema, table)} ({columns}\n    ) USING DELTA"
            )
        except Exception as exc:
            print(f"  table ensure skipped for {table}: {exc}")


def run_migrations(cursor, catalog: str, schema: str) -> None:
    """Apply ALTER TABLE migrations for existing deployments."""
    ensure_metadata_tables(cursor, catalog, schema)
    for stmt in migration_statements(catalog, schema):
        try:
            cursor.execute(stmt)
        except Exception as exc:
            print(f"  migration skipped (may already be applied): {exc}")


def provision(cursor, catalog: str, schema: str) -> None:
    """Create schema and metadata tables if they do not exist."""
    for stmt in ddl_statements(catalog, schema):
        try:
            cursor.execute(stmt)
        except Exception as exc:
            if is_migration(stmt):
                print(f"  migration skipped (may already be applied): {exc}")
                continue
            raise
