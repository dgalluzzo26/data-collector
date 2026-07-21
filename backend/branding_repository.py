"""Persist app-wide branding in Unity Catalog metadata."""

from __future__ import annotations

import json
from datetime import datetime, timezone
from typing import Any

from backend import config
from backend.branding_defaults import DEFAULT_BRANDING
from backend.sql_util import execute, fetchone

_SETTING_KEY = "branding"


def _now() -> datetime:
    return datetime.now(timezone.utc)


def _table() -> str:
    return config.t("app_settings")


def _deep_merge(base: dict[str, Any], patch: dict[str, Any]) -> dict[str, Any]:
    merged = json.loads(json.dumps(base))
    for key, value in patch.items():
        if isinstance(value, dict) and isinstance(merged.get(key), dict):
            merged[key] = _deep_merge(merged[key], value)
        else:
            merged[key] = value
    return merged


def get_branding() -> dict[str, Any]:
    try:
        row = fetchone(
            f"SELECT value_json FROM {_table()} WHERE setting_key = ?",
            (_SETTING_KEY,),
        )
    except Exception as exc:
        from backend.sql_errors import SqlPermissionError, is_table_not_found

        if isinstance(exc, SqlPermissionError) or is_table_not_found(exc):
            return json.loads(json.dumps(DEFAULT_BRANDING))
        raise
    if not row or not row.get("value_json"):
        return json.loads(json.dumps(DEFAULT_BRANDING))
    try:
        stored = json.loads(row["value_json"])
    except json.JSONDecodeError:
        return json.loads(json.dumps(DEFAULT_BRANDING))
    return _deep_merge(DEFAULT_BRANDING, stored)


def save_branding(updates: dict[str, Any], user_email: str) -> dict[str, Any]:
    current = get_branding()
    merged = _deep_merge(current, updates)
    now = _now()
    execute(
        f"DELETE FROM {_table()} WHERE setting_key = ?",
        (_SETTING_KEY,),
    )
    execute(
        f"""
        INSERT INTO {_table()} (setting_key, value_json, updated_at, updated_by)
        VALUES (?, ?, ?, ?)
        """,
        (_SETTING_KEY, json.dumps(merged), now, user_email),
    )
    return merged
