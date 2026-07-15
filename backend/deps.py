"""API authorization helpers."""

from fastapi import HTTPException, Request

from backend import auth, repository
from backend.models import ProjectRole

_ROLE_RANK = {"reader": 1, "editor": 2, "admin": 3}


def assert_role(role: ProjectRole | None, minimum: ProjectRole) -> None:
    if not role:
        raise HTTPException(status_code=403, detail="Not a member of this project")
    if _ROLE_RANK[role] < _ROLE_RANK[minimum]:
        raise HTTPException(status_code=403, detail=f"Requires {minimum} role")


def require_role(project_id: str, request: Request, minimum: ProjectRole) -> tuple[str, ProjectRole]:
    email = auth.get_user_email(request)
    role = repository.get_member_role(project_id, email)
    if not role:
        raise HTTPException(status_code=403, detail="Not a member of this project")
    if _ROLE_RANK[role] < _ROLE_RANK[minimum]:
        raise HTTPException(status_code=403, detail=f"Requires {minimum} role")
    return email, role


def project_to_summary(row: dict, role: ProjectRole | None = None) -> dict:
    return {
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
