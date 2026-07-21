"""Form layout change requests stored in form_layouts (status state machine)."""

from __future__ import annotations

import json
import uuid
from datetime import datetime, timezone
from typing import Any, Optional

from backend import config
from backend.models import FieldDefinition
from backend.sql_util import execute, fetchall, fetchone

ChangeRequestStatus = str  # draft | pending | published | rejected

STATUS_PENDING = "pending"
STATUS_DRAFT = "draft"
STATUS_PUBLISHED = "published"
STATUS_REJECTED = "rejected"


def _now() -> datetime:
    return datetime.now(timezone.utc)


def _table() -> str:
    return config.t("form_layouts")


def _parse_fields(layout_json: str) -> list[FieldDefinition]:
    data = json.loads(layout_json)
    return [FieldDefinition.model_validate(item) for item in data]


def _row_to_dict(row: dict[str, Any]) -> dict[str, Any]:
    return {
        "request_id": row["request_id"],
        "project_id": row["project_id"],
        "status": row["status"],
        "message": row.get("message"),
        "proposed_fields": _parse_fields(row["layout_json"]),
        "requested_by": row["requested_by"],
        "requested_at": row["requested_at"],
        "reviewed_by": row.get("reviewed_by"),
        "reviewed_at": row.get("reviewed_at"),
        "review_note": row.get("review_note"),
        "schema_version": int(row["schema_version"]),
        "updated_at": row["updated_at"],
        "updated_by": row["updated_by"],
    }


def get_request(project_id: str, request_id: str) -> Optional[dict[str, Any]]:
    row = fetchone(
        f"SELECT * FROM {_table()} WHERE project_id = ? AND request_id = ?",
        (project_id, request_id),
    )
    return _row_to_dict(row) if row else None


def list_requests(
    project_id: str,
    *,
    status: Optional[ChangeRequestStatus] = None,
    requested_by: Optional[str] = None,
) -> list[dict[str, Any]]:
    clauses = ["project_id = ?"]
    params: list[Any] = [project_id]
    if status:
        clauses.append("status = ?")
        params.append(status)
    if requested_by:
        clauses.append("requested_by = ?")
        params.append(requested_by.lower())
    where = " AND ".join(clauses)
    rows = fetchall(
        f"SELECT * FROM {_table()} WHERE {where} ORDER BY requested_at DESC",
        tuple(params),
    )
    return [_row_to_dict(row) for row in rows]


def count_pending(project_id: str) -> int:
    row = fetchone(
        f"SELECT COUNT(*) AS cnt FROM {_table()} WHERE project_id = ? AND status = ?",
        (project_id, STATUS_PENDING),
    )
    return int(row["cnt"]) if row else 0


def get_pending_for_user(project_id: str, user_email: str) -> Optional[dict[str, Any]]:
    row = fetchone(
        f"""
        SELECT * FROM {_table()}
        WHERE project_id = ? AND requested_by = ? AND status = ?
        ORDER BY requested_at DESC
        LIMIT 1
        """,
        (project_id, user_email.lower(), STATUS_PENDING),
    )
    return _row_to_dict(row) if row else None


def create_or_update_pending(
    project_id: str,
    fields: list[FieldDefinition],
    user_email: str,
    message: Optional[str] = None,
    *,
    schema_version: int = 0,
) -> dict[str, Any]:
    existing = get_pending_for_user(project_id, user_email)
    now = _now()
    layout_json = json.dumps([f.model_dump() for f in fields])
    trimmed_message = (message or "").strip() or None

    if existing:
        execute(
            f"""
            UPDATE {_table()}
            SET layout_json = ?, message = ?, status = ?, requested_at = ?,
                updated_at = ?, updated_by = ?, schema_version = ?
            WHERE request_id = ?
            """,
            (
                layout_json,
                trimmed_message,
                STATUS_PENDING,
                now,
                now,
                user_email.lower(),
                schema_version,
                existing["request_id"],
            ),
        )
        updated = get_request(project_id, existing["request_id"])
        if not updated:
            raise RuntimeError("Failed to load updated change request")
        return updated

    request_id = str(uuid.uuid4())
    execute(
        f"""
        INSERT INTO {_table()} (
            request_id, project_id, status, layout_json, message,
            requested_by, requested_at, schema_version, updated_at, updated_by
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        """,
        (
            request_id,
            project_id,
            STATUS_PENDING,
            layout_json,
            trimmed_message,
            user_email.lower(),
            now,
            schema_version,
            now,
            user_email.lower(),
        ),
    )
    created = get_request(project_id, request_id)
    if not created:
        raise RuntimeError("Failed to load created change request")
    return created


def set_status(
    project_id: str,
    request_id: str,
    status: ChangeRequestStatus,
    reviewed_by: str,
    review_note: Optional[str] = None,
) -> dict[str, Any]:
    now = _now()
    trimmed_note = (review_note or "").strip() or None
    execute(
        f"""
        UPDATE {_table()}
        SET status = ?, reviewed_by = ?, reviewed_at = ?, review_note = ?,
            updated_at = ?, updated_by = ?
        WHERE project_id = ? AND request_id = ?
        """,
        (
            status,
            reviewed_by.lower(),
            now,
            trimmed_note,
            now,
            reviewed_by.lower(),
            project_id,
            request_id,
        ),
    )
    updated = get_request(project_id, request_id)
    if not updated:
        raise RuntimeError("Failed to load updated change request")
    return updated


def clear_for_project(project_id: str) -> None:
    execute(f"DELETE FROM {_table()} WHERE project_id = ?", (project_id,))
