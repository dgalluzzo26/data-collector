"""Databricks Genie API client."""

from __future__ import annotations

from backend.workspace_client import workspace_client as _workspace_client


def workspace_client(*, access_token: str | None = None):
    return _workspace_client(access_token=access_token)
