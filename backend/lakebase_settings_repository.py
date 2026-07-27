"""Persist app-wide Lakebase Data API settings in Unity Catalog metadata."""

from __future__ import annotations

import json
from datetime import datetime, timezone
from typing import Any

from backend import config
from backend.sql_util import execute, fetchone

_SETTING_KEY = "lakebase"
_DEFAULT: dict[str, Any] = {"data_api_url": None}


def _now() -> datetime:
    return datetime.now(timezone.utc)


def _table() -> str:
    return config.t("app_settings")


def get_lakebase_settings() -> dict[str, Any]:
    row = fetchone(
        f"SELECT value_json FROM {_table()} WHERE setting_key = ?",
        (_SETTING_KEY,),
    )
    if not row or not row.get("value_json"):
        return dict(_DEFAULT)
    try:
        stored = json.loads(row["value_json"])
    except json.JSONDecodeError:
        return dict(_DEFAULT)
    url = (stored.get("data_api_url") or "").strip() or None
    return {"data_api_url": url}


def save_lakebase_settings(updates: dict[str, Any], user_email: str) -> dict[str, Any]:
    current = get_lakebase_settings()
    url = updates.get("data_api_url")
    if url is not None:
        url = url.strip() or None
    merged = {**current, "data_api_url": url}
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


def is_data_api_linked() -> bool:
    return bool(get_lakebase_settings().get("data_api_url"))
