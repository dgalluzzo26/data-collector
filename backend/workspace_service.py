"""Workspace user directory and Databricks App permission helpers."""

from __future__ import annotations

import logging
import os
import re
from typing import Any

from databricks.sdk.service.apps import AppAccessControlRequest, AppPermissionLevel

from backend.workspace_client import workspace_client

logger = logging.getLogger(__name__)

_EMAIL_LIKE = re.compile(r"^[^@\s]+@[^@\s]+\.[^@\s]+$")


def resolved_app_name() -> str | None:
    name = (os.environ.get("DATABRICKS_APP_NAME") or "").strip()
    return name or None


def _user_email(user: Any) -> str | None:
    user_name = (getattr(user, "user_name", None) or "").strip()
    if user_name and _EMAIL_LIKE.match(user_name):
        return user_name.lower()
    emails = getattr(user, "emails", None) or []
    for entry in emails:
        value = (getattr(entry, "value", None) or "").strip()
        if value and _EMAIL_LIKE.match(value):
            return value.lower()
    return None


def _user_has_app_access(client: Any, app_name: str, email: str) -> bool:
    perms = client.apps.get_permissions(app_name)
    email_l = email.lower()
    for acl in perms.access_control_list or []:
        if acl.user_name and acl.user_name.lower() == email_l:
            for permission in acl.all_permissions or []:
                if permission.permission_level in (
                    AppPermissionLevel.CAN_USE,
                    AppPermissionLevel.CAN_MANAGE,
                ):
                    return True
    return False


def list_workspace_users(query: str | None = None, *, limit: int = 25) -> list[dict[str, str]]:
    """Search active workspace users for the member picker."""
    client = workspace_client()
    kwargs: dict[str, Any] = {"count": limit}
    q = (query or "").strip()
    if q:
        escaped = q.replace('"', '\\"')
        kwargs["filter"] = f'userName co "{escaped}" or displayName co "{escaped}"'

    results: list[dict[str, str]] = []
    seen: set[str] = set()
    for user in client.users.list(**kwargs):
        if user.active is False:
            continue
        email = _user_email(user)
        if not email or email in seen:
            continue
        seen.add(email)
        results.append(
            {
                "email": email,
                "display_name": (user.display_name or email.split("@")[0]).strip(),
            }
        )
        if len(results) >= limit:
            break
    return results


def ensure_app_user_access(user_email: str) -> tuple[bool, str | None]:
    """Grant CAN_USE on this app when the user lacks access. Returns (granted, note)."""
    app_name = resolved_app_name()
    if not app_name:
        return False, "DATABRICKS_APP_NAME is not configured; skipped app permission grant"

    email = user_email.strip().lower()
    if not email:
        return False, "Invalid user email"

    try:
        client = workspace_client()
        if _user_has_app_access(client, app_name, email):
            return False, None
        client.apps.update_permissions(
            app_name,
            access_control_list=[
                AppAccessControlRequest(
                    user_name=email,
                    permission_level=AppPermissionLevel.CAN_USE,
                )
            ],
        )
        logger.info("Granted CAN_USE on app %s to %s", app_name, email)
        return True, f"Granted Can use on app {app_name}"
    except Exception as exc:
        logger.warning("Failed to grant app access to %s on %s: %s", email, app_name, exc)
        return False, f"Could not grant app access: {exc}"
