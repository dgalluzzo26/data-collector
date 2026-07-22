"""Genie space provisioning and record Q&A for published collections."""

from __future__ import annotations

import json
import logging
import os
import uuid
from datetime import datetime, timezone
from typing import Any, Optional

from backend import repository
from backend.genie_client import workspace_client
from backend.models import FieldDefinition

logger = logging.getLogger(__name__)


def _now() -> datetime:
    return datetime.now(timezone.utc)


def _genie_id() -> str:
    return uuid.uuid4().hex


def genie_enabled() -> bool:
    return os.environ.get("GENIE_ENABLED", "true").strip().lower() not in ("0", "false", "no")


def _warehouse_id() -> str:
    wid = os.environ.get("GENIE_WAREHOUSE_ID") or os.environ.get("DATABRICKS_WAREHOUSE_ID")
    if not wid:
        raise RuntimeError("DATABRICKS_WAREHOUSE_ID is required for Genie")
    return wid


def _genie_parent_path() -> Optional[str]:
    """Optional workspace folder for new Genie spaces (not Unity Catalog)."""
    return (
        (os.environ.get("GENIE_PARENT_PATH") or "").strip()
        or "/Shared/brick-constructor/genie"
    )


def _is_genie_access_denied(exc: Exception) -> bool:
    msg = str(exc).lower()
    return "does not have read permission" in msg or "permission_denied" in msg


def _service_principal_id() -> str | None:
    sp = (os.environ.get("DATABRICKS_CLIENT_ID") or "").strip()
    return sp or None


def _client():
    """Genie always runs as the app service principal (shared per collection)."""
    return workspace_client()


def _ensure_sp_genie_space_access(client: Any, space_id: str) -> None:
    """Ensure the app service principal can run Genie against this space."""
    sp_id = _service_principal_id()
    if not sp_id:
        return
    try:
        client.api_client.do(
            "PUT",
            f"/api/2.0/permissions/genie/{space_id}",
            body={
                "access_control_list": [
                    {
                        "service_principal_name": sp_id,
                        "permission_level": "CAN_MANAGE",
                    }
                ]
            },
        )
    except Exception as exc:
        logger.warning("Could not grant Genie space access to SP %s: %s", sp_id, exc)


def _ensure_workspace_folder(client: Any, path: str) -> None:
    """Create a Databricks workspace folder if it does not exist."""
    try:
        client.workspace.mkdirs(path)
    except Exception as exc:
        msg = str(exc).lower()
        if "already exists" in msg or "resource_already_exists" in msg:
            return
        raise


def has_sync_location(project: dict[str, Any]) -> bool:
    return bool(
        (project.get("sync_catalog") or "").strip()
        and (project.get("sync_schema") or "").strip()
        and (project.get("sync_table") or "").strip()
    )


def genie_available_for_project(project: dict[str, Any]) -> bool:
    if project.get("storage_type") == "lakebase":
        return has_sync_location(project)
    return project.get("storage_type") == "uc_delta"


def _table_identifier(project: dict[str, Any]) -> str:
    if project.get("storage_type") == "lakebase" and has_sync_location(project):
        return f"{project['sync_catalog']}.{project['sync_schema']}.{project['sync_table']}"
    return f"{project['target_catalog']}.{project['target_schema']}.{project['target_table']}"


def build_serialized_space(project: dict[str, Any], fields: list[FieldDefinition]) -> str:
    """Build Genie serialized_space JSON for a collection data table."""
    table = _table_identifier(project)
    col_lines = [
        f"- `{f.field_key}` ({f.field_type}): {f.label}" + (" [required]" if f.is_required else "")
        for f in fields
    ]
    sample_questions = [
        "How many records are in this collection?",
        "Show all records",
        "Summarize this data",
    ]
    for field in fields[:2]:
        if field.field_type in ("number", "date", "datetime"):
            sample_questions.append(f"What is the average or range of {field.label}?")
            break

    payload = {
        "version": 2,
        "config": {
            "sample_questions": [
                {"id": _genie_id(), "question": [question]} for question in sample_questions[:5]
            ],
        },
        "data_sources": {
            "tables": [
                {
                    "identifier": table,
                    "description": [
                        f"Data Collector collection: {project['name']}",
                        "Contains submitted form records for this collection.",
                    ],
                }
            ],
        },
        "instructions": {
            "text_instructions": [
                {
                    "id": _genie_id(),
                    "content": [
                        f"Answer questions about the '{project['name']}' data collection.",
                        f"Query the table `{table}` unless the user specifies otherwise.",
                        "System audit columns: `_record_id`, `_created_at`, `_created_by`, `_updated_at`, `_updated_by`.",
                        "Prefer human-readable field labels when explaining results.",
                        "Field reference:",
                        *col_lines,
                    ],
                }
            ],
        },
    }
    if project.get("description"):
        payload["instructions"]["text_instructions"][0]["content"].insert(
            1, f"Collection description: {project['description']}"
        )
    return json.dumps(payload)


def _extract_answer(message: Any) -> dict[str, Any]:
    """Parse a completed Genie message into a client-friendly response."""
    answer_text = ""
    sql: Optional[str] = None
    columns: list[str] = []
    rows: list[list[Any]] = []
    suggested: list[str] = []
    attachment_id: Optional[str] = None

    for attachment in message.attachments or []:
        if attachment.text and attachment.text.content:
            answer_text = attachment.text.content.strip()
        if attachment.query and attachment.query.query:
            sql = attachment.query.query
            attachment_id = attachment.attachment_id
        if attachment.suggested_questions and attachment.suggested_questions.questions:
            suggested = list(attachment.suggested_questions.questions)

    return {
        "answer_text": answer_text,
        "sql": sql,
        "columns": columns,
        "rows": rows,
        "suggested_questions": suggested,
        "attachment_id": attachment_id,
        "status": str(message.status) if message.status else None,
        "error": str(message.error) if message.error else None,
    }


def _attach_query_results(
    parsed: dict[str, Any],
    *,
    space_id: str,
    conversation_id: str,
    message_id: str,
) -> dict[str, Any]:
    attachment_id = parsed.get("attachment_id")
    if not attachment_id:
        return parsed

    client = _client()
    try:
        result = client.genie.get_message_attachment_query_result(
            space_id, conversation_id, message_id, attachment_id
        )
    except Exception:
        return parsed

    statement = result.statement_response
    if not statement:
        return parsed

    manifest = statement.manifest
    data = statement.result
    if manifest and manifest.schema and manifest.schema.columns:
        parsed["columns"] = [col.name for col in manifest.schema.columns if col.name]
    if data and data.data_array:
        parsed["rows"] = data.data_array
    return parsed


def provision_genie_space(project_id: str, user_email: str) -> None:
    """Create or update a Genie space for a published collection. Never raises."""
    if not genie_enabled():
        return

    project = repository.get_project(project_id)
    if not project or project.get("status") != "published":
        return
    if not genie_available_for_project(project):
        return

    fields = repository.list_fields(project_id, published_only=True)
    serialized = build_serialized_space(project, fields)
    title = f"Data Collector — {project['name']}"
    parent_path = _genie_parent_path()

    repository.update_project(
        project_id,
        {"genie_status": "pending", "genie_error": None},
        user_email,
    )

    try:
        client = _client()
        warehouse_id = _warehouse_id()
        space_id = project.get("genie_space_id")

        if space_id:
            try:
                existing = client.genie.get_space(space_id, include_serialized_space=True)
                client.genie.update_space(
                    space_id,
                    serialized_space=serialized,
                    title=title,
                    warehouse_id=warehouse_id,
                    etag=existing.etag,
                )
            except Exception as exc:
                if not _is_genie_access_denied(exc):
                    raise
                space_id = None

        if not space_id:
            if parent_path:
                _ensure_workspace_folder(client, parent_path)
            create_kwargs: dict[str, Any] = {
                "warehouse_id": warehouse_id,
                "serialized_space": serialized,
                "title": title,
                "description": project.get("description"),
            }
            if parent_path:
                create_kwargs["parent_path"] = parent_path
            created = client.genie.create_space(**create_kwargs)
            space_id = created.space_id

        _ensure_sp_genie_space_access(client, space_id)

        repository.update_project(
            project_id,
            {
                "genie_space_id": space_id,
                "genie_status": "ready",
                "genie_last_synced_at": _now(),
                "genie_error": None,
            },
            user_email,
        )
    except Exception as exc:
        repository.update_project(
            project_id,
            {"genie_status": "error", "genie_error": str(exc)[:2000]},
            user_email,
        )


def get_genie_status(project: dict[str, Any]) -> dict[str, Any]:
    return {
        "enabled": genie_enabled(),
        "status": project.get("genie_status") or "disabled",
        "space_id": project.get("genie_space_id"),
        "last_synced_at": project.get("genie_last_synced_at"),
        "error": project.get("genie_error"),
        "ready": bool(project.get("genie_space_id")) and project.get("genie_status") == "ready",
    }


def ask_question(
    project: dict[str, Any],
    *,
    content: str,
    conversation_id: Optional[str] = None,
) -> dict[str, Any]:
    space_id = project.get("genie_space_id")
    if not space_id or project.get("genie_status") != "ready":
        raise ValueError("Genie is not ready for this collection. Try publishing again or re-sync from Settings.")

    question = content.strip()
    if not question:
        raise ValueError("Question cannot be empty")

    client = _client()
    if conversation_id:
        message = client.genie.create_message_and_wait(space_id, conversation_id, question)
    else:
        message = client.genie.start_conversation_and_wait(space_id, question)

    if message.error:
        raise ValueError(str(message.error))

    parsed = _extract_answer(message)
    parsed = _attach_query_results(
        parsed,
        space_id=space_id,
        conversation_id=message.conversation_id,
        message_id=message.message_id,
    )
    parsed["conversation_id"] = message.conversation_id
    parsed["message_id"] = message.message_id
    return parsed
