"""Single source of truth for Data Collector Unity Catalog metadata tables.

Consumed by scripts/setup.py and sql/schema.sql generation. Creates the app
metadata schema and tables only — the catalog must already exist.
"""

# table name -> column definition body (without CREATE TABLE wrapper)
TABLES = {
    "projects": """
        project_id STRING NOT NULL,
        name STRING NOT NULL,
        slug STRING NOT NULL,
        description STRING,
        storage_type STRING NOT NULL,
        target_catalog STRING,
        target_schema STRING,
        target_table STRING,
        sync_catalog STRING,
        sync_schema STRING,
        sync_table STRING,
        genie_space_id STRING,
        genie_status STRING,
        genie_last_synced_at TIMESTAMP,
        genie_error STRING,
        storage_mode STRING,
        record_key_column STRING,
        record_sync_mode STRING,
        schema_version INT NOT NULL,
        status STRING NOT NULL,
        created_at TIMESTAMP NOT NULL,
        created_by STRING NOT NULL,
        updated_at TIMESTAMP,
        updated_by STRING""",
    "project_members": """
        project_id STRING NOT NULL,
        user_email STRING NOT NULL,
        role STRING NOT NULL,
        added_at TIMESTAMP NOT NULL,
        added_by STRING NOT NULL""",
    "field_definitions": """
        project_id STRING NOT NULL,
        field_key STRING NOT NULL,
        label STRING NOT NULL,
        field_type STRING NOT NULL,
        config_json STRING,
        sort_order INT NOT NULL,
        is_required BOOLEAN NOT NULL,
        schema_version INT NOT NULL,
        is_published BOOLEAN NOT NULL""",
    "form_layouts": """
        project_id STRING NOT NULL,
        layout_json STRING,
        schema_version INT NOT NULL,
        updated_at TIMESTAMP NOT NULL,
        updated_by STRING NOT NULL""",
    "schema_versions": """
        project_id STRING NOT NULL,
        version INT NOT NULL,
        ddl_snapshot STRING,
        published_at TIMESTAMP NOT NULL,
        published_by STRING NOT NULL""",
    "record_audit_log": """
        project_id STRING NOT NULL,
        record_id STRING NOT NULL,
        field_key STRING,
        old_value STRING,
        new_value STRING,
        changed_by STRING NOT NULL,
        changed_at TIMESTAMP NOT NULL""",
    "lookup_tables": """
        lookup_id STRING NOT NULL,
        project_id STRING NOT NULL,
        name STRING NOT NULL,
        slug STRING NOT NULL,
        description STRING,
        columns_json STRING NOT NULL,
        row_count INT NOT NULL,
        source STRING NOT NULL,
        source_catalog STRING,
        source_schema STRING,
        source_table STRING,
        created_at TIMESTAMP NOT NULL,
        created_by STRING NOT NULL,
        updated_at TIMESTAMP,
        updated_by STRING""",
    "lookup_rows": """
        lookup_id STRING NOT NULL,
        row_id STRING NOT NULL,
        values_json STRING NOT NULL,
        sort_order INT NOT NULL""",
    "staged_record_changes": """
        project_id STRING NOT NULL,
        record_id STRING NOT NULL,
        operation STRING NOT NULL,
        values_json STRING,
        staged_at TIMESTAMP NOT NULL,
        staged_by STRING NOT NULL,
        updated_at TIMESTAMP,
        updated_by STRING""",
    "ai_generation_log": """
        log_id STRING NOT NULL,
        project_id STRING,
        user_email STRING NOT NULL,
        generation_type STRING NOT NULL,
        prompt STRING NOT NULL,
        response_json STRING,
        model_endpoint STRING,
        error STRING,
        created_at TIMESTAMP NOT NULL""",
}

MIGRATIONS: list[str] = []


def migration_statements(catalog: str, schema: str) -> list[str]:
    """ALTER statements for existing deployments (idempotent re-run may fail if columns exist)."""
    lt = _table_fqn(catalog, schema, "lookup_tables")
    proj = _table_fqn(catalog, schema, "projects")
    return [
        f"ALTER TABLE {lt} ADD COLUMN source_catalog STRING",
        f"ALTER TABLE {lt} ADD COLUMN source_schema STRING",
        f"ALTER TABLE {lt} ADD COLUMN source_table STRING",
        f"ALTER TABLE {proj} ADD COLUMN genie_space_id STRING",
        f"ALTER TABLE {proj} ADD COLUMN genie_status STRING",
        f"ALTER TABLE {proj} ADD COLUMN genie_last_synced_at TIMESTAMP",
        f"ALTER TABLE {proj} ADD COLUMN genie_error STRING",
        f"ALTER TABLE {proj} ADD COLUMN sync_catalog STRING",
        f"ALTER TABLE {proj} ADD COLUMN sync_schema STRING",
        f"ALTER TABLE {proj} ADD COLUMN sync_table STRING",
        f"ALTER TABLE {proj} ADD COLUMN storage_mode STRING",
        f"ALTER TABLE {proj} ADD COLUMN record_key_column STRING",
        f"ALTER TABLE {proj} ADD COLUMN record_sync_mode STRING",
    ]


def _schema_fqn(catalog: str, schema: str) -> str:
    from backend.config import quote_identifier

    return f"{quote_identifier(catalog)}.{quote_identifier(schema)}"


def _table_fqn(catalog: str, schema: str, table: str) -> str:
    from backend.config import quote_identifier

    return f"{_schema_fqn(catalog, schema)}.{quote_identifier(table)}"


def ddl_statements(catalog: str, schema: str) -> list[str]:
    """Fully-qualified DDL to provision catalog.schema metadata tables."""
    schema_fqn = _schema_fqn(catalog, schema)
    statements = [f"CREATE SCHEMA IF NOT EXISTS {schema_fqn}"]
    for table, columns in TABLES.items():
        statements.append(
            f"CREATE TABLE IF NOT EXISTS {_table_fqn(catalog, schema, table)} ({columns}\n    ) USING DELTA"
        )
    for migration in MIGRATIONS:
        statements.append(migration)
    for migration in migration_statements(catalog, schema):
        statements.append(migration)
    return statements


def is_migration(stmt: str) -> bool:
    return stmt.lstrip().upper().startswith("ALTER")


def schema_sql(catalog: str, schema: str) -> str:
    """Runnable schema.sql for the SQL editor or `databricks sql execute`."""
    from backend.config import quote_identifier

    lines = [
        "-- Data Collector metadata schema — generated from backend/schema_ddl.py.",
        "-- Regenerate: python scripts/setup.py --emit-sql",
        "-- Or provision directly: python scripts/setup.py --catalog <cat> --schema <schema>",
        "",
        f"USE CATALOG {quote_identifier(catalog)};",
        f"CREATE SCHEMA IF NOT EXISTS {quote_identifier(schema)};",
        f"USE SCHEMA {quote_identifier(schema)};",
        "",
    ]
    for table, columns in TABLES.items():
        lines.append(f"CREATE TABLE IF NOT EXISTS {table} ({columns}\n) USING DELTA;")
        lines.append("")
    for migration in MIGRATIONS:
        lines.append(migration + ";")
    for migration in migration_statements(catalog, schema):
        lines.append(migration + ";")
    lines.append("")
    return "\n".join(lines)
