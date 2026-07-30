"""Lakebase (Postgres) connection settings for collection record storage."""

from __future__ import annotations

import os


def is_configured() -> bool:
    """True when PGHOST and ENDPOINT_NAME are set (Databricks App or local .env)."""
    return bool((os.environ.get("PGHOST") or "").strip() and (os.environ.get("ENDPOINT_NAME") or "").strip())


def require_configured() -> None:
    if not is_configured():
        raise RuntimeError(
            "Lakebase is not configured. Add a Lakebase database resource to the Databricks App "
            "(or set PGHOST, PGDATABASE, PGUSER, ENDPOINT_NAME in .env for local dev). "
            "See docs/LAKEBASE.md."
        )


def database_name() -> str:
    return (os.environ.get("PGDATABASE") or "databricks_postgres").strip()


def project_name() -> str | None:
    """Lakebase project id from resource paths like projects/<name>/branches/..."""
    for key in ("LAKEBASE_PROJECT", "ENDPOINT_NAME", "LAKEBASE_DATABASE", "LAKEBASE_BRANCH"):
        path = (os.environ.get(key) or "").strip().strip("/")
        if not path:
            continue
        # Allow a bare project name via LAKEBASE_PROJECT.
        if key == "LAKEBASE_PROJECT" and "/" not in path:
            return path
        parts = path.split("/")
        if len(parts) >= 2 and parts[0] == "projects" and parts[1]:
            return parts[1]
    return None


def default_schema() -> str:
    return (os.environ.get("LAKEBASE_DEFAULT_SCHEMA") or "data_collector").strip()


def endpoint_name() -> str:
    return (
        (os.environ.get("ENDPOINT_NAME") or os.environ.get("LAKEBASE_ENDPOINT") or "").strip()
    )
