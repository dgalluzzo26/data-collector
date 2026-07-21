"""State machine for editor form change requests (form_layouts table)."""

from __future__ import annotations

import json
from datetime import datetime, timezone
from typing import Any, Optional

from backend import repository
from backend.form_layout_repository import (
    STATUS_DRAFT,
    STATUS_PENDING,
    STATUS_REJECTED,
    create_or_update_pending,
    get_request,
    list_requests,
    set_status,
)
from backend.models import FieldDefinition
from backend.sql_util import execute


def _now() -> datetime:
    return datetime.now(timezone.utc)


def submit_change_request(
    project_id: str,
    fields: list[FieldDefinition],
    user_email: str,
    message: Optional[str] = None,
) -> dict[str, Any]:
    if not fields:
        raise ValueError("At least one field is required")
    project = repository.get_project(project_id)
    if not project:
        raise ValueError("Project not found")
    return create_or_update_pending(
        project_id,
        fields,
        user_email,
        message,
        schema_version=int(project["schema_version"]),
    )


def promote_pending_request(
    project_id: str,
    request_id: str,
    reviewed_by: str,
    review_note: Optional[str] = None,
) -> dict[str, Any]:
    """Approve a PENDING request: merge fields into draft and record schema_versions."""
    request = get_request(project_id, request_id)
    if not request:
        raise ValueError("Change request not found")
    if request["status"] != STATUS_PENDING:
        raise ValueError("Only pending change requests can be approved")

    project = repository.get_project(project_id)
    if not project:
        raise ValueError("Project not found")

    fields: list[FieldDefinition] = request["proposed_fields"]
    next_version = int(project["schema_version"]) + 1

    repository.replace_draft_fields(project_id, fields, reviewed_by)

    from backend import config

    execute(
        f"""
        INSERT INTO {config.t("schema_versions")} (
            project_id, version, ddl_snapshot, published_at, published_by
        ) VALUES (?, ?, ?, ?, ?)
        """,
        (
            project_id,
            next_version,
            json.dumps([f.model_dump() for f in fields]),
            _now(),
            reviewed_by.lower(),
        ),
    )

    updated_request = set_status(
        project_id,
        request_id,
        STATUS_DRAFT,
        reviewed_by,
        review_note,
    )

    return {
        "request": updated_request,
        "fields": repository.list_fields(project_id),
        "schema_version": next_version,
    }


def reject_change_request(
    project_id: str,
    request_id: str,
    reviewed_by: str,
    review_note: Optional[str] = None,
) -> dict[str, Any]:
    request = get_request(project_id, request_id)
    if not request:
        raise ValueError("Change request not found")
    if request["status"] != STATUS_PENDING:
        raise ValueError("Only pending change requests can be rejected")
    return set_status(project_id, request_id, STATUS_REJECTED, reviewed_by, review_note)


def withdraw_change_request(
    project_id: str,
    request_id: str,
    user_email: str,
) -> dict[str, Any]:
    request = get_request(project_id, request_id)
    if not request:
        raise ValueError("Change request not found")
    if request["status"] != STATUS_PENDING:
        raise ValueError("Only pending change requests can be withdrawn")
    if request["requested_by"].lower() != user_email.lower():
        raise ValueError("You can only withdraw your own change requests")
    return set_status(project_id, request_id, STATUS_DRAFT, user_email, "withdrawn")


def count_pending(project_id: str) -> int:
    from backend.form_layout_repository import count_pending as _count

    return _count(project_id)


def list_change_requests(
    project_id: str,
    *,
    status: Optional[str] = None,
    requested_by: Optional[str] = None,
) -> list[dict[str, Any]]:
    return list_requests(project_id, status=status, requested_by=requested_by)
