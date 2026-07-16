"""Databricks Genie API client."""

from __future__ import annotations

from backend.workspace_client import workspace_client as _workspace_client


def workspace_client():
    return _workspace_client()
