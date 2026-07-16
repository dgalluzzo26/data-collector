"""SQL execution helpers."""

from __future__ import annotations

import time
from contextlib import contextmanager
from contextvars import ContextVar
from enum import Enum
from typing import Any, Iterator, Optional

from fastapi import Request

from backend import auth
from backend.db import get_connection
from backend.sql_errors import (
    UserAuthorizationRequiredError,
    as_permission_error,
    is_permission_denied,
)
from backend.timing import get_timer

_metadata_connection: ContextVar[Any | None] = ContextVar("sql_metadata_connection", default=None)
_data_connection: ContextVar[Any | None] = ContextVar("sql_data_connection", default=None)
_connection_depth: ContextVar[int] = ContextVar("sql_connection_depth", default=0)


class ConnectionTarget(str, Enum):
    METADATA = "metadata"
    DATA = "data"


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
    metadata_conn = get_connection(as_service_principal=True)
    user_token = auth.resolve_data_access_token(request)
    data_conn = get_connection(access_token=user_token) if user_token else None
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
    conn = get_connection(as_service_principal=True)
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
        conn = _data_connection.get()
        if conn is None:
            raise UserAuthorizationRequiredError()
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
    with get_connection(as_service_principal=True) as conn:
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
