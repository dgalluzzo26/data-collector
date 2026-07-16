"""Shared Databricks workspace SDK client."""

from __future__ import annotations

import os

from databricks.sdk import WorkspaceClient


def workspace_client() -> WorkspaceClient:
    host = (os.environ.get("DATABRICKS_HOST") or "").strip()
    token = (os.environ.get("DATABRICKS_TOKEN") or "").strip()
    if host and token and "REPLACE_WITH" not in token:
        return WorkspaceClient(host=host.removeprefix("https://").removeprefix("http://"), token=token)
    return WorkspaceClient()
