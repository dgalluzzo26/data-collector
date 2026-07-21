"""API authorization helpers."""

from fastapi import HTTPException, Request

from backend import auth, repository
from backend.app_admin import is_app_admin as user_is_app_admin
from backend.models import ProjectRole

_ROLE_RANK = {"reader": 1, "editor": 2, "admin": 3}


def access_denied_detail(project_id: str) -> dict:
    project = repository.get_project(project_id)
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")
    admin_emails = repository.list_admin_emails(project_id)
    if not admin_emails and project.get("created_by"):
        admin_emails = [project["created_by"]]
    return {
        "message": "Not a member of this project",
        "collection_name": project.get("name"),
        "admin_emails": admin_emails,
    }


def deny_not_member(project_id: str) -> None:
    raise HTTPException(status_code=403, detail=access_denied_detail(project_id))


def assert_role(role: ProjectRole | None, minimum: ProjectRole, project_id: str | None = None) -> None:
    if not role:
        if project_id:
            deny_not_member(project_id)
        raise HTTPException(status_code=403, detail="Not a member of this project")
    if _ROLE_RANK[role] < _ROLE_RANK[minimum]:
        raise HTTPException(status_code=403, detail=f"Requires {minimum} role")


def require_role(project_id: str, request: Request, minimum: ProjectRole) -> tuple[str, ProjectRole]:
    email = auth.get_user_email(request)
    role = repository.get_member_role(project_id, email)
    if not role:
        deny_not_member(project_id)
    if _ROLE_RANK[role] < _ROLE_RANK[minimum]:
        raise HTTPException(status_code=403, detail=f"Requires {minimum} role")
    return email, role


def project_to_summary(row: dict, role: ProjectRole | None = None) -> dict:
    summary = {
        "project_id": row["project_id"],
        "name": row["name"],
        "slug": row["slug"],
        "description": row.get("description"),
        "storage_type": row["storage_type"],
        "status": row["status"],
        "schema_version": int(row["schema_version"]),
        "role": role or row.get("role"),
        "created_at": row["created_at"],
        "created_by": row["created_by"],
        "updated_at": row.get("updated_at"),
    }
    if summary["role"] == "admin":
        from backend import change_request_service

        summary["pending_change_request_count"] = change_request_service.count_pending(
            row["project_id"]
        )
    else:
        summary["pending_change_request_count"] = 0
    return summary


def require_app_admin(request: Request) -> str:
    email = auth.get_user_email(request)
    if not user_is_app_admin(email):
        raise HTTPException(status_code=403, detail="App administrator access required")
    return email
