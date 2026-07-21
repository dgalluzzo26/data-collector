"""API routes for form layout change requests."""

from __future__ import annotations

from fastapi import APIRouter, HTTPException, Request

from backend import change_request_service
from backend.deps import require_role
from backend.models import (
    ApproveChangeRequestResponse,
    CreateChangeRequestBody,
    FormChangeRequest,
    ReviewChangeRequestBody,
)

router = APIRouter(prefix="/projects/{project_id}/change-requests", tags=["change-requests"])


def _to_model(row: dict) -> FormChangeRequest:
    return FormChangeRequest(**row)


@router.get("", response_model=list[FormChangeRequest])
def list_change_requests(
    project_id: str,
    request: Request,
    status: str | None = None,
):
    require_role(project_id, request, "reader")
    rows = change_request_service.list_change_requests(project_id, status=status)
    return [_to_model(row) for row in rows]


@router.post("", response_model=FormChangeRequest, status_code=201)
def create_change_request(
    project_id: str,
    body: CreateChangeRequestBody,
    request: Request,
):
    user, role = require_role(project_id, request, "editor")
    if role == "admin":
        raise HTTPException(
            status_code=400,
            detail="Admins can save draft fields directly; change requests are for editors.",
        )
    try:
        created = change_request_service.submit_change_request(
            project_id,
            body.fields,
            user,
            body.message,
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    return _to_model(created)


@router.post("/{request_id}/approve", response_model=ApproveChangeRequestResponse)
def approve_change_request(
    project_id: str,
    request_id: str,
    body: ReviewChangeRequestBody,
    request: Request,
):
    user, _ = require_role(project_id, request, "admin")
    try:
        result = change_request_service.promote_pending_request(
            project_id,
            request_id,
            user,
            body.review_note,
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    return ApproveChangeRequestResponse(
        request=_to_model(result["request"]),
        fields=result["fields"],
        schema_version=result["schema_version"],
    )


@router.post("/{request_id}/reject", response_model=FormChangeRequest)
def reject_change_request(
    project_id: str,
    request_id: str,
    body: ReviewChangeRequestBody,
    request: Request,
):
    user, _ = require_role(project_id, request, "admin")
    try:
        updated = change_request_service.reject_change_request(
            project_id,
            request_id,
            user,
            body.review_note,
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    return _to_model(updated)


@router.post("/{request_id}/withdraw", response_model=FormChangeRequest)
def withdraw_change_request(
    project_id: str,
    request_id: str,
    request: Request,
):
    user, _ = require_role(project_id, request, "editor")
    try:
        updated = change_request_service.withdraw_change_request(
            project_id,
            request_id,
            user,
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    return _to_model(updated)
