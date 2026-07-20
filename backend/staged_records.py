"""Staged record changes when record_sync_mode=staged (local edits before UC bulk sync)."""

from __future__ import annotations

import json
from datetime import datetime, timezone
from typing import Any, Optional

from backend import config
from backend.sql_util import execute, fetchall, fetchone

StagedOperation = str  # insert | update | delete


def _now() -> datetime:
    return datetime.now(timezone.utc)


def _table(name: str) -> str:
    return config.t(name)


def list_staged(project_id: str) -> list[dict[str, Any]]:
    return fetchall(
        f"""
        SELECT project_id, record_id, operation, values_json,
               staged_at, staged_by, updated_at, updated_by
        FROM {_table("staged_record_changes")}
        WHERE project_id = ?
        ORDER BY staged_at
        """,
        (project_id,),
    )


def get_staged(project_id: str, record_id: str) -> Optional[dict[str, Any]]:
    return fetchone(
        f"""
        SELECT project_id, record_id, operation, values_json,
               staged_at, staged_by, updated_at, updated_by
        FROM {_table("staged_record_changes")}
        WHERE project_id = ? AND record_id = ?
        """,
        (project_id, record_id),
    )


def count_staged(project_id: str) -> int:
    row = fetchone(
        f"SELECT COUNT(*) AS cnt FROM {_table('staged_record_changes')} WHERE project_id = ?",
        (project_id,),
    )
    return int(row["cnt"]) if row else 0


def clear_staged(project_id: str) -> None:
    execute(
        f"DELETE FROM {_table('staged_record_changes')} WHERE project_id = ?",
        (project_id,),
    )


def delete_staged(project_id: str, record_id: str) -> None:
    execute(
        f"DELETE FROM {_table('staged_record_changes')} WHERE project_id = ? AND record_id = ?",
        (project_id, record_id),
    )


def _parse_values(values_json: Optional[str]) -> dict[str, Any]:
    if not values_json:
        return {}
    return json.loads(values_json)


def _staged_to_record(row: dict[str, Any]) -> dict[str, Any]:
    values = _parse_values(row.get("values_json"))
    return {
        "record_id": row["record_id"],
        "values": values,
        "created_at": row.get("staged_at"),
        "created_by": row.get("staged_by"),
        "updated_at": row.get("updated_at") or row.get("staged_at"),
        "updated_by": row.get("updated_by") or row.get("staged_by"),
    }


def merge_uc_with_staged(
    uc_records: list[dict[str, Any]],
    staged_rows: list[dict[str, Any]],
) -> list[dict[str, Any]]:
    by_id = {r["record_id"]: dict(r) for r in uc_records}
    staged_by_id = {s["record_id"]: s for s in staged_rows}

    for record_id, staged in staged_by_id.items():
        if staged["operation"] == "delete":
            by_id.pop(record_id, None)

    for record_id, staged in staged_by_id.items():
        if staged["operation"] == "update":
            values = _parse_values(staged.get("values_json"))
            if record_id in by_id:
                rec = by_id[record_id]
                rec["values"] = {**rec["values"], **values}
                rec["updated_at"] = staged.get("updated_at") or staged.get("staged_at")
                rec["updated_by"] = staged.get("updated_by") or staged.get("staged_by")
            else:
                by_id[record_id] = _staged_to_record(staged)

    for record_id, staged in staged_by_id.items():
        if staged["operation"] == "insert":
            by_id[record_id] = _staged_to_record(staged)

    return list(by_id.values())


def upsert_staged(
    project_id: str,
    record_id: str,
    operation: StagedOperation,
    values: Optional[dict[str, Any]],
    user_email: str,
) -> None:
    now = _now()
    existing = get_staged(project_id, record_id)
    values_json = json.dumps(values) if values is not None else None

    if existing:
        execute(
            f"""
            UPDATE {_table("staged_record_changes")}
            SET operation = ?, values_json = ?, updated_at = ?, updated_by = ?
            WHERE project_id = ? AND record_id = ?
            """,
            (operation, values_json, now, user_email, project_id, record_id),
        )
        return

    execute(
        f"""
        INSERT INTO {_table("staged_record_changes")} (
            project_id, record_id, operation, values_json,
            staged_at, staged_by, updated_at, updated_by
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        """,
        (
            project_id,
            record_id,
            operation,
            values_json,
            now,
            user_email,
            now,
            user_email,
        ),
    )


def insert_staged_batch(
    project_id: str,
    entries: list[tuple[str, dict[str, Any]]],
    user_email: str,
) -> None:
    """Insert new staged rows without per-row existence checks (bulk CSV import)."""
    if not entries:
        return
    now = _now()
    value_groups: list[str] = []
    params: list[Any] = []
    for record_id, values in entries:
        value_groups.append("(?, ?, ?, ?, ?, ?, ?, ?)")
        params.extend(
            (
                project_id,
                record_id,
                "insert",
                json.dumps(values),
                now,
                user_email,
                now,
                user_email,
            )
        )
    execute(
        f"""
        INSERT INTO {_table("staged_record_changes")} (
            project_id, record_id, operation, values_json,
            staged_at, staged_by, updated_at, updated_by
        ) VALUES {", ".join(value_groups)}
        """,
        params,
    )


def record_id_exists_in_staging(project_id: str, record_id: str) -> bool:
    row = get_staged(project_id, record_id)
    return row is not None and row.get("operation") != "delete"
