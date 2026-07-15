"""SQL execution helpers."""

from __future__ import annotations

import time
from contextlib import contextmanager
from contextvars import ContextVar
from typing import Any, Iterator, Optional

from backend.db import get_connection
from backend.timing import get_timer

_request_connection: ContextVar[Any | None] = ContextVar("sql_request_connection", default=None)
_request_connection_depth: ContextVar[int] = ContextVar("sql_request_connection_depth", default=0)


@contextmanager
def request_connection() -> Iterator[None]:
    """Reuse one SQL warehouse connection for nested sql_util calls within a request."""
    if _request_connection.get() is not None:
        depth = _request_connection_depth.get()
        token_depth = _request_connection_depth.set(depth + 1)
        try:
            yield
        finally:
            _request_connection_depth.reset(token_depth)
        return

    timer = get_timer()
    connect_started = time.perf_counter()
    conn = get_connection()
    if timer is not None:
        timer.add_phase("db_connect_ms", (time.perf_counter() - connect_started) * 1000)

    token_conn = _request_connection.set(conn)
    token_depth = _request_connection_depth.set(1)
    try:
        yield
    finally:
        _request_connection.reset(token_conn)
        _request_connection_depth.reset(token_depth)
        conn.close()


@contextmanager
def cursor() -> Iterator[Any]:
    conn = _request_connection.get()
    if conn is not None:
        with conn.cursor() as cur:
            yield cur
        return

    timer = get_timer()
    connect_started = time.perf_counter()
    with get_connection() as conn:
        if timer is not None:
            timer.add_phase("db_connect_ms", (time.perf_counter() - connect_started) * 1000)
        with conn.cursor() as cur:
            yield cur


def fetchall(sql: str, params: Optional[tuple | list] = None) -> list[dict[str, Any]]:
    timer = get_timer()
    with cursor() as cur:
        execute_started = time.perf_counter()
        cur.execute(sql, params or ())
        if timer is not None:
            timer.add_phase("db_execute_ms", (time.perf_counter() - execute_started) * 1000)
        fetch_started = time.perf_counter()
        columns = [desc[0] for desc in cur.description] if cur.description else []
        rows = cur.fetchall()
        if timer is not None:
            timer.add_phase("db_fetch_ms", (time.perf_counter() - fetch_started) * 1000)
        return [dict(zip(columns, row)) for row in rows]


def fetchone(sql: str, params: Optional[tuple | list] = None) -> Optional[dict[str, Any]]:
    rows = fetchall(sql, params)
    return rows[0] if rows else None


def execute(sql: str, params: Optional[tuple | list] = None) -> None:
    with cursor() as cur:
        cur.execute(sql, params or ())
