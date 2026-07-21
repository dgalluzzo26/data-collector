-- Data Collector metadata schema — generated from backend/schema_ddl.py.
-- Regenerate: python scripts/setup.py --emit-sql
-- Or provision directly: python scripts/setup.py --catalog <cat> --schema <schema>

USE CATALOG serverless_stable_ipan_catalog;
CREATE SCHEMA IF NOT EXISTS data_collector;
USE SCHEMA data_collector;

CREATE TABLE IF NOT EXISTS projects (
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
        duplicate_key_mode STRING,
        schema_version INT NOT NULL,
        status STRING NOT NULL,
        created_at TIMESTAMP NOT NULL,
        created_by STRING NOT NULL,
        updated_at TIMESTAMP,
        updated_by STRING
) USING DELTA;

CREATE TABLE IF NOT EXISTS project_members (
        project_id STRING NOT NULL,
        user_email STRING NOT NULL,
        role STRING NOT NULL,
        added_at TIMESTAMP NOT NULL,
        added_by STRING NOT NULL
) USING DELTA;

CREATE TABLE IF NOT EXISTS field_definitions (
        project_id STRING NOT NULL,
        field_key STRING NOT NULL,
        label STRING NOT NULL,
        field_type STRING NOT NULL,
        config_json STRING,
        sort_order INT NOT NULL,
        is_required BOOLEAN NOT NULL,
        schema_version INT NOT NULL,
        is_published BOOLEAN NOT NULL
) USING DELTA;

CREATE TABLE IF NOT EXISTS form_layouts (
        request_id STRING NOT NULL,
        project_id STRING NOT NULL,
        status STRING NOT NULL,
        layout_json STRING NOT NULL,
        message STRING,
        requested_by STRING NOT NULL,
        requested_at TIMESTAMP NOT NULL,
        reviewed_by STRING,
        reviewed_at TIMESTAMP,
        review_note STRING,
        schema_version INT NOT NULL,
        updated_at TIMESTAMP NOT NULL,
        updated_by STRING NOT NULL
) USING DELTA;

CREATE TABLE IF NOT EXISTS schema_versions (
        project_id STRING NOT NULL,
        version INT NOT NULL,
        ddl_snapshot STRING,
        published_at TIMESTAMP NOT NULL,
        published_by STRING NOT NULL
) USING DELTA;

CREATE TABLE IF NOT EXISTS record_audit_log (
        project_id STRING NOT NULL,
        record_id STRING NOT NULL,
        field_key STRING,
        old_value STRING,
        new_value STRING,
        changed_by STRING NOT NULL,
        changed_at TIMESTAMP NOT NULL
) USING DELTA;

CREATE TABLE IF NOT EXISTS lookup_tables (
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
        updated_by STRING
) USING DELTA;

CREATE TABLE IF NOT EXISTS lookup_rows (
        lookup_id STRING NOT NULL,
        row_id STRING NOT NULL,
        values_json STRING NOT NULL,
        sort_order INT NOT NULL
) USING DELTA;

CREATE TABLE IF NOT EXISTS staged_record_changes (
        project_id STRING NOT NULL,
        record_id STRING NOT NULL,
        operation STRING NOT NULL,
        values_json STRING,
        staged_at TIMESTAMP NOT NULL,
        staged_by STRING NOT NULL,
        updated_at TIMESTAMP,
        updated_by STRING
) USING DELTA;

CREATE TABLE IF NOT EXISTS ai_generation_log (
        log_id STRING NOT NULL,
        project_id STRING,
        user_email STRING NOT NULL,
        generation_type STRING NOT NULL,
        prompt STRING NOT NULL,
        response_json STRING,
        model_endpoint STRING,
        error STRING,
        created_at TIMESTAMP NOT NULL
) USING DELTA;

CREATE TABLE IF NOT EXISTS app_settings (
        setting_key STRING NOT NULL,
        value_json STRING NOT NULL,
        updated_at TIMESTAMP NOT NULL,
        updated_by STRING NOT NULL
) USING DELTA;

ALTER TABLE serverless_stable_ipan_catalog.data_collector.lookup_tables ADD COLUMN source_catalog STRING;
ALTER TABLE serverless_stable_ipan_catalog.data_collector.lookup_tables ADD COLUMN source_schema STRING;
ALTER TABLE serverless_stable_ipan_catalog.data_collector.lookup_tables ADD COLUMN source_table STRING;
ALTER TABLE serverless_stable_ipan_catalog.data_collector.projects ADD COLUMN genie_space_id STRING;
ALTER TABLE serverless_stable_ipan_catalog.data_collector.projects ADD COLUMN genie_status STRING;
ALTER TABLE serverless_stable_ipan_catalog.data_collector.projects ADD COLUMN genie_last_synced_at TIMESTAMP;
ALTER TABLE serverless_stable_ipan_catalog.data_collector.projects ADD COLUMN genie_error STRING;
ALTER TABLE serverless_stable_ipan_catalog.data_collector.projects ADD COLUMN sync_catalog STRING;
ALTER TABLE serverless_stable_ipan_catalog.data_collector.projects ADD COLUMN sync_schema STRING;
ALTER TABLE serverless_stable_ipan_catalog.data_collector.projects ADD COLUMN sync_table STRING;
ALTER TABLE serverless_stable_ipan_catalog.data_collector.projects ADD COLUMN storage_mode STRING;
ALTER TABLE serverless_stable_ipan_catalog.data_collector.projects ADD COLUMN record_key_column STRING;
ALTER TABLE serverless_stable_ipan_catalog.data_collector.projects ADD COLUMN record_sync_mode STRING;
ALTER TABLE serverless_stable_ipan_catalog.data_collector.projects ADD COLUMN duplicate_key_mode STRING;
ALTER TABLE serverless_stable_ipan_catalog.data_collector.form_layouts ADD COLUMN request_id STRING;
ALTER TABLE serverless_stable_ipan_catalog.data_collector.form_layouts ADD COLUMN status STRING;
ALTER TABLE serverless_stable_ipan_catalog.data_collector.form_layouts ADD COLUMN message STRING;
ALTER TABLE serverless_stable_ipan_catalog.data_collector.form_layouts ADD COLUMN requested_by STRING;
ALTER TABLE serverless_stable_ipan_catalog.data_collector.form_layouts ADD COLUMN requested_at TIMESTAMP;
ALTER TABLE serverless_stable_ipan_catalog.data_collector.form_layouts ADD COLUMN reviewed_by STRING;
ALTER TABLE serverless_stable_ipan_catalog.data_collector.form_layouts ADD COLUMN reviewed_at TIMESTAMP;
ALTER TABLE serverless_stable_ipan_catalog.data_collector.form_layouts ADD COLUMN review_note STRING;
