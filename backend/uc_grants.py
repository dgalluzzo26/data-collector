"""Unity Catalog GRANT/REVOKE for collection members (hybrid access mode)."""

from __future__ import annotations

import logging
import os
from typing import Any, Literal, Optional

PublishFailureKind = Literal[
    "user_authorization",
    "permission_denied",
    "table_not_visible",
    "generic",
]

from backend import config
from backend.models import ProjectRole
from backend.sql_util import execute
from backend.uc_data_access import (
    _is_existing_uc,
    _is_managed_uc,
    auto_grant_targets_existing_uc,
    should_auto_grant_uc_members,
    use_user_token_for_project,
)

logger = logging.getLogger(__name__)


def _quote_principal(email: str) -> str:
    escaped = email.strip().lower().replace("`", "``")
    return f"`{escaped}`"


def _table_fqn(project: dict[str, Any]) -> str:
    return config.table_fqn(
        project["target_catalog"],
        project["target_schema"],
        project["target_table"],
    )


def _schema_fqn(project: dict[str, Any]) -> str:
    return (
        f"{config.quote_identifier(project['target_catalog'])}."
        f"{config.quote_identifier(project['target_schema'])}"
    )


def _catalog_fqn(project: dict[str, Any]) -> str:
    return config.quote_identifier(project["target_catalog"])


def _privileges_for_role(role: ProjectRole) -> tuple[str, ...]:
    if role == "reader":
        return ("SELECT",)
    return ("SELECT", "MODIFY")


def _run_grant(sql: str) -> None:
    execute(sql)


def _grant_member_uc(project: dict[str, Any], email: str, role: ProjectRole) -> tuple[bool, Optional[str]]:
    if not should_auto_grant_uc_members(project):
        return False, None
    if project.get("status") != "published":
        return False, None

    principal = _quote_principal(email)
    catalog = _catalog_fqn(project)
    schema = _schema_fqn(project)
    table = _table_fqn(project)
    privileges = _privileges_for_role(role)
    priv_sql = ", ".join(privileges)

    try:
        _run_grant(f"GRANT USE CATALOG ON CATALOG {catalog} TO {principal}")
        _run_grant(f"GRANT USE SCHEMA ON SCHEMA {schema} TO {principal}")
        _run_grant(f"GRANT {priv_sql} ON TABLE {table} TO {principal}")
    except Exception as exc:
        msg = str(exc)
        if auto_grant_targets_existing_uc(project):
            return False, (
                "Could not auto-grant UC access on the existing table. "
                "The user must already have UC privileges, or grant the app service principal "
                "MANAGE on this table so the app can grant members automatically."
            )
        logger.warning("UC grant failed for %s on %s: %s", email, table, msg)
        return False, f"UC grant failed (app access still works for managed tables): {msg}"

    if _is_managed_uc(project):
        return True, f"Granted {priv_sql} on collection table (optional for notebook access)."
    return True, f"Granted {priv_sql} on existing UC table."


def _revoke_member_uc(project: dict[str, Any], email: str) -> None:
    if not should_auto_grant_uc_members(project):
        return
    if project.get("status") != "published":
        return

    principal = _quote_principal(email)
    catalog = _catalog_fqn(project)
    schema = _schema_fqn(project)
    table = _table_fqn(project)

    for sql in (
        f"REVOKE SELECT, MODIFY ON TABLE {table} FROM {principal}",
        f"REVOKE USE SCHEMA ON SCHEMA {schema} FROM {principal}",
        f"REVOKE USE CATALOG ON CATALOG {catalog} FROM {principal}",
    ):
        try:
            _run_grant(sql)
        except Exception as exc:
            logger.warning("UC revoke failed for %s: %s", email, exc)


def grant_member(
    project: dict[str, Any],
    email: str,
    role: ProjectRole,
) -> tuple[bool, Optional[str]]:
    return _grant_member_uc(project, email, role)


def revoke_member(project: dict[str, Any], email: str) -> None:
    _revoke_member_uc(project, email)


def sync_all_members(project: dict[str, Any], members: list[Any]) -> None:
    """Apply UC grants for every collection member (after publish)."""
    if not should_auto_grant_uc_members(project):
        return
    if project.get("status") != "published":
        return
    for member in members:
        email = member.user_email if hasattr(member, "user_email") else member["user_email"]
        role = member.role if hasattr(member, "role") else member["role"]
        granted, note = grant_member(project, email, role)
        if not granted and note and _is_existing_uc(project):
            logger.warning("sync_all_members: %s — %s", email, note)


def _service_principal_id() -> str | None:
    sp = (os.environ.get("DATABRICKS_CLIENT_ID") or "").strip()
    return sp or None


def _user_principal_sql(email: str) -> str:
    return _quote_principal(email.strip())


def _sp_principal_sql() -> str | None:
    sp_id = _service_principal_id()
    if not sp_id:
        return None
    return _quote_principal(sp_id)


def _table_path(project: dict[str, Any]) -> str:
    return _table_fqn(project)


def _app_user_authorization_steps() -> list[str]:
    return [
        "-- If DESCRIBE works in SQL but publish still fails in the deployed app,",
        "-- the app must forward your identity (on-behalf-of). An app admin should:",
        "--   1. Compute → Apps → your app → Edit",
        '--   2. Enable "User authorization" and add the "sql" API scope',
        "--   3. Stop and restart the app",
        "--   4. Compute → SQL Warehouses → your warehouse → Permissions",
        "--      Grant you CAN USE on the warehouse attached to the app",
    ]


def _catalog_admin_user_grants(
    project: dict[str, Any],
    user_email: str,
    *,
    role: ProjectRole = "admin",
) -> list[str]:
    """GRANT statements a catalog admin runs when the publishing user lacks UC access."""
    principal = _user_principal_sql(user_email)
    catalog = _catalog_fqn(project)
    schema = _schema_fqn(project)
    table = _table_path(project)
    lines = [
        "-- A catalog admin (or table owner) must run the GRANTs below.",
        f"GRANT USE CATALOG ON CATALOG {catalog} TO {principal}",
        f"GRANT USE SCHEMA ON SCHEMA {schema} TO {principal}",
    ]
    if _is_existing_uc(project):
        for privilege in _privileges_for_role(role):
            lines.append(f"GRANT {privilege} ON TABLE {table} TO {principal}")
    else:
        lines.append(f"GRANT CREATE TABLE ON SCHEMA {schema} TO {principal}")
        lines.append(f"GRANT MODIFY ON SCHEMA {schema} TO {principal}")
    return lines


def _catalog_admin_sp_grants(project: dict[str, Any]) -> list[str]:
    """GRANT statements for the app service principal on managed collection schemas."""
    sp = _sp_principal_sql()
    if not sp:
        return [
            "-- App service principal client id is not available in this environment.",
            "-- Find it: Compute → Apps → your app → Authorization → Service principal client ID",
            "-- Then replace SP_CLIENT_ID below and run as a catalog admin:",
            "GRANT USE CATALOG ON CATALOG <catalog> TO `SP_CLIENT_ID`",
            "GRANT USE SCHEMA ON SCHEMA <catalog>.<schema> TO `SP_CLIENT_ID`",
            "GRANT CREATE TABLE ON SCHEMA <catalog>.<schema> TO `SP_CLIENT_ID`",
            "GRANT MODIFY ON SCHEMA <catalog>.<schema> TO `SP_CLIENT_ID`",
        ]

    catalog = _catalog_fqn(project)
    schema = _schema_fqn(project)
    return [
        f"-- Catalog admin runs these for the app service principal {sp}:",
        f"GRANT USE CATALOG ON CATALOG {catalog} TO {sp}",
        f"GRANT USE SCHEMA ON SCHEMA {schema} TO {sp}",
        f"GRANT CREATE TABLE ON SCHEMA {schema} TO {sp}",
        f"GRANT MODIFY ON SCHEMA {schema} TO {sp}",
    ]


def grant_sql_for_publish_failure(
    project: dict[str, Any],
    user_email: str,
    *,
    role: ProjectRole = "admin",
    failure_kind: PublishFailureKind = "generic",
) -> str:
    """Step-by-step SQL and notes to fix UC publish failures."""
    if project.get("storage_type") != "uc_delta":
        return ""

    table = _table_path(project)
    principal = _user_principal_sql(user_email)
    lines: list[str] = [
        f"-- Collection table: {table}",
        f"-- Publishing user: {principal}",
        "",
    ]

    if failure_kind == "user_authorization":
        lines.extend(
            [
                "-- The app is not forwarding your SQL identity yet.",
                "-- Fix app configuration first (no GRANT will help until this is done):",
                "--   1. Compute → Apps → your app → Edit",
                '--   2. Enable "User authorization" and add the "sql" API scope',
                "--   3. Stop and restart the app",
                "--   4. Grant yourself CAN USE on the app's SQL warehouse",
                "",
                "-- Then verify your table access (run as yourself in a SQL warehouse):",
                f"DESCRIBE TABLE {table}",
                "",
            ]
        )
        if use_user_token_for_project(project):
            lines.append("-- If DESCRIBE fails, ask a catalog admin to run:")
            lines.append("")
            lines.extend(_catalog_admin_user_grants(project, user_email, role=role))
        else:
            lines.append("-- If DESCRIBE fails, ask a catalog admin to run:")
            lines.append("")
            lines.extend(_catalog_admin_sp_grants(project))
        return "\n".join(lines) + "\n"

    if use_user_token_for_project(project):
        lines.extend(
            [
                "-- Step 1: verify your access (run as yourself in a SQL warehouse):",
                f"DESCRIBE TABLE {table}",
                "",
                "-- Step 2: if DESCRIBE fails, ask a catalog admin to run:",
                "",
            ]
        )
        lines.extend(_catalog_admin_user_grants(project, user_email, role=role))
        lines.append("")
        lines.extend(_app_user_authorization_steps())
    else:
        lines.extend(
            [
                "-- Managed collection: the app service principal publishes the table.",
                "-- Ask a catalog admin to run:",
                "",
            ]
        )
        lines.extend(_catalog_admin_sp_grants(project))

    if auto_grant_targets_existing_uc(project):
        sp = _sp_principal_sql()
        lines.append("")
        lines.append("-- Optional: let the app auto-grant collection members on publish:")
        if sp:
            lines.append(f"GRANT MANAGE ON TABLE {table} TO {sp}")
        else:
            lines.append(
                f"GRANT MANAGE ON TABLE {table} TO `<app-service-principal-client-id>`"
            )

    return "\n".join(lines) + "\n"
