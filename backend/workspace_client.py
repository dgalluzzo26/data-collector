"""Shared Databricks workspace SDK client."""

from __future__ import annotations

import os

from databricks.sdk import WorkspaceClient


def workspace_client(*, access_token: str | None = None) -> WorkspaceClient:
    if access_token:
        host = (os.environ.get("DATABRICKS_HOST") or "").strip()
        if host:
            return WorkspaceClient(
                host=host.removeprefix("https://").removeprefix("http://"),
                token=access_token,
            )
        return WorkspaceClient(token=access_token)

    host = (os.environ.get("DATABRICKS_HOST") or "").strip()
    token = (os.environ.get("DATABRICKS_TOKEN") or "").strip()
    if host and token and "REPLACE_WITH" not in token:
        return WorkspaceClient(host=host.removeprefix("https://").removeprefix("http://"), token=token)
    return WorkspaceClient()
