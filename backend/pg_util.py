"""Postgres query helpers for Lakebase-backed collection tables."""

from __future__ import annotations

import time
from contextlib import contextmanager
from typing import Any, Iterator, Optional

from backend.lakebase_db import get_pool
from backend.timing import get_timer


@contextmanager
def cursor() -> Iterator[Any]:
    timer = get_timer()
    checkout_started = time.perf_counter()
    with get_pool().connection() as conn:
        if timer is not None:
            timer.add_phase("pg_checkout_ms", (time.perf_counter() - checkout_started) * 1000)
        with conn.cursor() as cur:
            yield cur
            conn.commit()


def fetchall(sql: str, params: Optional[tuple | list] = None) -> list[dict[str, Any]]:
    timer = get_timer()
    with cursor() as cur:
        execute_started = time.perf_counter()
        cur.execute(sql, params or ())
        if timer is not None:
            timer.add_phase("pg_execute_ms", (time.perf_counter() - execute_started) * 1000)
        fetch_started = time.perf_counter()
        columns = [desc[0] for desc in cur.description] if cur.description else []
        rows = cur.fetchall()
        if timer is not None:
            timer.add_phase("pg_fetch_ms", (time.perf_counter() - fetch_started) * 1000)
        return [dict(zip(columns, row)) for row in rows]


def fetchone(sql: str, params: Optional[tuple | list] = None) -> Optional[dict[str, Any]]:
    rows = fetchall(sql, params)
    return rows[0] if rows else None


def execute(sql: str, params: Optional[tuple | list] = None) -> None:
    with cursor() as cur:
        cur.execute(sql, params or ())
