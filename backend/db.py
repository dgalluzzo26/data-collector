"""Databricks SQL warehouse connections for Data Collector."""

from __future__ import annotations

import os
from typing import Optional


def _normalize_host(host: str) -> str:
    return host.removeprefix("https://").removeprefix("http://").rstrip("/")


def resolve_warehouse_http_path(
    *,
    warehouse_http_path: Optional[str] = None,
    warehouse_id: Optional[str] = None,
) -> str:
    """Resolve SQL warehouse HTTP path from explicit args or environment."""
    path = warehouse_http_path or os.environ.get("DATABRICKS_SQL_WAREHOUSE_HTTP_PATH")
    if path and "REPLACE_WITH" not in path:
        return path

    wid = warehouse_id or os.environ.get("DATABRICKS_WAREHOUSE_ID")
    if wid and "REPLACE_WITH" not in wid:
        return f"/sql/1.0/warehouses/{wid}"

    if path:
        return path

    from backend import config

    return config.warehouse_http_path()


def _resolve_host(host: Optional[str] = None) -> str:
    pat_host = host or os.environ.get("DATABRICKS_HOST")
    if pat_host and "REPLACE_WITH" not in pat_host:
        return _normalize_host(pat_host)
    from databricks.sdk import WorkspaceClient

    return _normalize_host(WorkspaceClient().config.host)


def get_connection(
    *,
    host: Optional[str] = None,
    token: Optional[str] = None,
    warehouse_http_path: Optional[str] = None,
    warehouse_id: Optional[str] = None,
    access_token: Optional[str] = None,
    as_service_principal: bool = False,
):
    """Open a SQL warehouse connection.

    - ``access_token``: on-behalf-of user token (UC data-plane).
    - ``as_service_principal=True``: app service principal (metadata).
    - Local dev: ``DATABRICKS_TOKEN`` PAT when no OBO token is available.
    """
    from databricks import sql as dbsql

    http_path = resolve_warehouse_http_path(
        warehouse_http_path=warehouse_http_path,
        warehouse_id=warehouse_id,
    )

    if access_token:
        from databricks.sdk import WorkspaceClient

        # Always use the app workspace host for OBO tokens (not DATABRICKS_HOST from .env).
        workspace_host = _normalize_host(WorkspaceClient().config.host)
        return dbsql.connect(
            server_hostname=workspace_host,
            http_path=http_path,
            access_token=access_token,
        )

    pat_host = host or os.environ.get("DATABRICKS_HOST")
    pat_token = token or os.environ.get("DATABRICKS_TOKEN")
    use_pat = (
        not as_service_principal
        and pat_host
        and pat_token
        and "REPLACE_WITH" not in pat_token
    )

    if use_pat:
        return dbsql.connect(
            server_hostname=_normalize_host(pat_host),
            http_path=http_path,
            access_token=pat_token,
        )

    from databricks.sdk import WorkspaceClient

    w = WorkspaceClient()
    return dbsql.connect(
        server_hostname=w.config.host,
        http_path=http_path,
        credentials_provider=lambda: w.config.authenticate,
    )
