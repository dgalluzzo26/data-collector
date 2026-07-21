"""SQL execution helpers."""

from __future__ import annotations

import logging
import time
from contextlib import contextmanager
from contextvars import ContextVar
from enum import Enum
from typing import Any, Iterator, Optional

from fastapi import Request

from backend import auth
from backend.db import get_connection, get_metadata_connection
from backend.sql_errors import (
    UserAuthorizationRequiredError,
    as_permission_error,
    is_permission_denied,
)
from backend.uc_data_access import (
    get_uc_data_access_mode,
    use_user_token_for_project,
    use_user_token_for_uc_browse,
)
from backend.timing import get_timer

logger = logging.getLogger(__name__)

_metadata_connection: ContextVar[Any | None] = ContextVar("sql_metadata_connection", default=None)
_data_connection: ContextVar[Any | None] = ContextVar("sql_data_connection", default=None)
_user_token_present: ContextVar[bool] = ContextVar("sql_user_token_present", default=False)
_user_data_connection_error: ContextVar[str | None] = ContextVar("sql_user_data_connection_error", default=None)
_project_context: ContextVar[Any | None] = ContextVar("sql_project_context", default=None)
_force_user_data: ContextVar[bool] = ContextVar("sql_force_user_data", default=False)
_connection_depth: ContextVar[int] = ContextVar("sql_connection_depth", default=0)


class ConnectionTarget(str, Enum):
    METADATA = "metadata"
    DATA = "data"


@contextmanager
def project_data_scope(project: Any | None) -> Iterator[None]:
    """Set collection context so UC data SQL can pick SP vs user token."""
    token = _project_context.set(project)
    try:
        yield
    finally:
        _project_context.reset(token)


@contextmanager
def user_data_access() -> Iterator[None]:
    """Force UC SQL to use the signed-in user's token (user_obo browse mode)."""
    token = _force_user_data.set(True)
    try:
        yield
    finally:
        _force_user_data.reset(token)


@contextmanager
def uc_browse_scope() -> Iterator[None]:
    """Pick SP vs user token for UC schema/table pickers based on access mode."""
    if use_user_token_for_uc_browse():
        with user_data_access():
            yield
    else:
        yield


def _open_user_data_connection(user_token: str) -> Any | None:
    try:
        return get_connection(access_token=user_token)
    except Exception as exc:
        _user_data_connection_error.set(str(exc))
        mode = get_uc_data_access_mode()
        if mode == "user_obo":
            raise UserAuthorizationRequiredError(
                f"Could not open a Unity Catalog SQL session as the signed-in user: {exc}"
            ) from exc
        logger.warning("User OBO SQL connection unavailable (existing UC collections may not work): %s", exc)
        return None


def _user_data_connection_required_error() -> UserAuthorizationRequiredError:
    err = _user_data_connection_error.get()
    if err:
        return UserAuthorizationRequiredError(
            "Could not run Unity Catalog SQL as you. "
            f"Details: {err} "
            "Common fixes: grant yourself CAN USE on the app's SQL warehouse; "
            "re-open the app and approve the sql scope; log out and back in."
        )
    if not _user_token_present.get():
        return UserAuthorizationRequiredError(
            "The app did not receive your user access token (X-Forwarded-Access-Token). "
            "Enable User authorization with the sql scope on the app, restart it, "
            "then open the app URL in a fresh browser session and approve access."
        )
    return UserAuthorizationRequiredError()


def _resolve_data_connection() -> Any:
    if _force_user_data.get():
        conn = _data_connection.get()
        if conn is None:
            raise _user_data_connection_required_error()
        return conn

    project = _project_context.get()
    if project is not None and not use_user_token_for_project(project):
        conn = _metadata_connection.get()
        if conn is None:
            raise RuntimeError("Metadata SQL connection is not available")
        return conn

    mode = get_uc_data_access_mode()
    if mode in ("hybrid", "service_principal"):
        if project is None:
            # UC browse / introspection without a collection — app service principal.
            conn = _metadata_connection.get()
            if conn is None:
                raise RuntimeError("Metadata SQL connection is not available")
            return conn
        if mode == "service_principal":
            conn = _metadata_connection.get()
            if conn is None:
                raise RuntimeError("Metadata SQL connection is not available")
            return conn

    conn = _data_connection.get()
    if conn is None:
        raise _user_data_connection_required_error()
    return conn


def _run_sql(cur: Any, sql: str, params: Optional[tuple | list]) -> None:
    try:
        cur.execute(sql, params or ())
    except Exception as exc:
        if is_permission_denied(exc):
            raise as_permission_error(exc) from exc
        raise


@contextmanager
def request_connections(request: Request | None = None) -> Iterator[None]:
    """Open service-principal metadata SQL and optional user OBO data SQL."""
    if _metadata_connection.get() is not None:
        depth = _connection_depth.get()
        token_depth = _connection_depth.set(depth + 1)
        try:
            yield
        finally:
            _connection_depth.reset(token_depth)
        return

    timer = get_timer()
    connect_started = time.perf_counter()
    metadata_conn = get_metadata_connection()
    user_token = auth.resolve_data_access_token(request)
    token_present = bool(request is not None and auth.get_user_access_token(request))
    token_err = _user_data_connection_error.set(None)
    token_present_var = _user_token_present.set(token_present)
    data_conn = _open_user_data_connection(user_token) if user_token else None
    if timer is not None:
        timer.add_phase("db_connect_ms", (time.perf_counter() - connect_started) * 1000)

    token_meta = _metadata_connection.set(metadata_conn)
    token_data = _data_connection.set(data_conn)
    token_depth = _connection_depth.set(1)
    try:
        yield
    finally:
        _metadata_connection.reset(token_meta)
        _data_connection.reset(token_data)
        _connection_depth.reset(token_depth)
        _user_token_present.reset(token_present_var)
        _user_data_connection_error.reset(token_err)
        metadata_conn.close()
        if data_conn is not None:
            data_conn.close()


@contextmanager
def request_connection() -> Iterator[None]:
    """Backward-compatible alias: metadata connection only."""
    if _metadata_connection.get() is not None:
        depth = _connection_depth.get()
        token_depth = _connection_depth.set(depth + 1)
        try:
            yield
        finally:
            _connection_depth.reset(token_depth)
        return

    timer = get_timer()
    connect_started = time.perf_counter()
    conn = get_metadata_connection()
    if timer is not None:
        timer.add_phase("db_connect_ms", (time.perf_counter() - connect_started) * 1000)

    token_meta = _metadata_connection.set(conn)
    token_depth = _connection_depth.set(1)
    try:
        yield
    finally:
        _metadata_connection.reset(token_meta)
        _connection_depth.reset(token_depth)
        conn.close()


@contextmanager
def cursor(*, connection: ConnectionTarget = ConnectionTarget.METADATA) -> Iterator[Any]:
    if connection is ConnectionTarget.DATA:
        conn = _resolve_data_connection()
        with conn.cursor() as cur:
            yield cur
        return

    conn = _metadata_connection.get()
    if conn is not None:
        with conn.cursor() as cur:
            yield cur
        return

    timer = get_timer()
    connect_started = time.perf_counter()
    with get_metadata_connection() as conn:
        if timer is not None:
            timer.add_phase("db_connect_ms", (time.perf_counter() - connect_started) * 1000)
        with conn.cursor() as cur:
            yield cur


def fetchall(
    sql: str,
    params: Optional[tuple | list] = None,
    *,
    connection: ConnectionTarget = ConnectionTarget.METADATA,
) -> list[dict[str, Any]]:
    timer = get_timer()
    with cursor(connection=connection) as cur:
        execute_started = time.perf_counter()
        _run_sql(cur, sql, params)
        if timer is not None:
            timer.add_phase("db_execute_ms", (time.perf_counter() - execute_started) * 1000)
        fetch_started = time.perf_counter()
        columns = [desc[0] for desc in cur.description] if cur.description else []
        rows = cur.fetchall()
        if timer is not None:
            timer.add_phase("db_fetch_ms", (time.perf_counter() - fetch_started) * 1000)
        return [dict(zip(columns, row)) for row in rows]


def fetchone(
    sql: str,
    params: Optional[tuple | list] = None,
    *,
    connection: ConnectionTarget = ConnectionTarget.METADATA,
) -> Optional[dict[str, Any]]:
    rows = fetchall(sql, params, connection=connection)
    return rows[0] if rows else None


def execute(
    sql: str,
    params: Optional[tuple | list] = None,
    *,
    connection: ConnectionTarget = ConnectionTarget.METADATA,
) -> None:
    with cursor(connection=connection) as cur:
        _run_sql(cur, sql, params)


def data_fetchall(sql: str, params: Optional[tuple | list] = None) -> list[dict[str, Any]]:
    return fetchall(sql, params, connection=ConnectionTarget.DATA)


def data_fetchone(sql: str, params: Optional[tuple | list] = None) -> Optional[dict[str, Any]]:
    return fetchone(sql, params, connection=ConnectionTarget.DATA)


def data_execute(sql: str, params: Optional[tuple | list] = None) -> None:
    execute(sql, params, connection=ConnectionTarget.DATA)


def diagnose_user_data_sql(request: Request | None) -> dict[str, Any]:
    """Probe whether the forwarded user token can run SQL (for /api/health)."""
    import os

    obo_token = auth.get_user_access_token(request) if request is not None else None
    warehouse_id = (os.environ.get("DATABRICKS_WAREHOUSE_ID") or "").strip()
    result: dict[str, Any] = {
        "obo_token_present": bool(obo_token),
        "obo_token_scopes": auth.jwt_token_scopes(obo_token) if obo_token else None,
        "obo_sql_ok": None,
        "obo_sql_error": None,
        "obo_sql_hint": None,
    }
    if not obo_token:
        result["obo_sql_hint"] = (
            "No X-Forwarded-Access-Token header. Enable User authorization with the sql scope, "
            "restart the app, and open it in a fresh browser session."
        )
        return result

    scopes = auth.jwt_token_scopes(obo_token)
    result["obo_token_scopes"] = scopes
    if scopes is not None and "sql" not in scopes:
        result["obo_sql_ok"] = False
        result["obo_sql_error"] = "OAuth token is missing the sql scope"
        result["obo_sql_hint"] = (
            "The app is configured for sql, but your session token does not include it. "
            "Stop the app, start it again, then open the app URL in an incognito window and "
            "approve the consent prompt. (Redeploy alone does not refresh an old session token.)"
        )
        return result

    try:
        conn = get_connection(access_token=obo_token)
        try:
            with conn.cursor() as cur:
                cur.execute("SELECT 1 AS ok")
        finally:
            conn.close()
        result["obo_sql_ok"] = True
    except Exception as exc:
        result["obo_sql_ok"] = False
        result["obo_sql_error"] = _format_sql_exception(exc)
        result["obo_sql_hint"] = (
            "Your token includes sql but the warehouse rejected the connection. "
            f"Ask a workspace admin to grant you CAN USE on SQL warehouse {warehouse_id or '(see warehouse_id in this response)'} "
            "(Compute → SQL Warehouses → Permissions), or run: "
            f'databricks warehouses update-permissions {warehouse_id} --json '
            '\'{"access_control_list":[{"user_name":"<your-email>","permission_level":"CAN_USE"}]}\''
        )
    return result


def _format_sql_exception(exc: Exception) -> str:
    parts: list[str] = []
    current: BaseException | None = exc
    seen: set[str] = set()
    while current is not None and len(parts) < 4:
        text = str(current).strip()
        if text and text not in seen:
            parts.append(text)
            seen.add(text)
        current = current.__cause__ or current.__context__
    return " | ".join(parts) if parts else repr(exc)
