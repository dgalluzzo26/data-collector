"""Field-level audit log for collection records."""

from __future__ import annotations

import json
from datetime import datetime, timezone
from typing import Any, Optional

from backend import config
from backend.sql_util import execute, fetchall


def _now() -> datetime:
    return datetime.now(timezone.utc)


def _table() -> str:
    return config.t("record_audit_log")


def _serialize(value: Any) -> Optional[str]:
    if value is None:
        return None
    if isinstance(value, (list, dict)):
        return json.dumps(value)
    return str(value)


def _insert_audit_rows(rows: list[tuple[Any, ...]]) -> None:
    if not rows:
        return
    value_groups = ", ".join("(?, ?, ?, ?, ?, ?, ?)" for _ in rows)
    sql = f"""
        INSERT INTO {_table()} (
            project_id, record_id, field_key, old_value, new_value, changed_by, changed_at
        ) VALUES {value_groups}
    """
    params = [value for row in rows for value in row]
    execute(sql, params)


def _build_audit_rows(
    project_id: str,
    record_id: str,
    changes: list[tuple[Optional[str], Any, Any]],
    *,
    changed_by: str,
    changed_at: datetime,
) -> list[tuple[Any, ...]]:
    rows: list[tuple[Any, ...]] = []
    for field_key, old_value, new_value in changes:
        old_s = _serialize(old_value)
        new_s = _serialize(new_value)
        if old_s == new_s:
            continue
        rows.append((project_id, record_id, field_key, old_s, new_s, changed_by, changed_at))
    return rows


def log_field_change(
    project_id: str,
    record_id: str,
    *,
    field_key: Optional[str],
    old_value: Any,
    new_value: Any,
    changed_by: str,
) -> None:
    changed_at = _now()
    rows = _build_audit_rows(
        project_id,
        record_id,
        [(field_key, old_value, new_value)],
        changed_by=changed_by,
        changed_at=changed_at,
    )
    _insert_audit_rows(rows)


def log_record_created(
    project_id: str,
    record_id: str,
    values: dict[str, Any],
    *,
    changed_by: str,
) -> None:
    changed_at = _now()
    changes = [(key, None, val) for key, val in values.items()]
    rows = _build_audit_rows(
        project_id,
        record_id,
        changes,
        changed_by=changed_by,
        changed_at=changed_at,
    )
    _insert_audit_rows(rows)


def log_record_updated(
    project_id: str,
    record_id: str,
    old_values: dict[str, Any],
    new_values: dict[str, Any],
    *,
    changed_by: str,
) -> None:
    changed_at = _now()
    keys = set(old_values) | set(new_values)
    changes = [(key, old_values.get(key), new_values.get(key)) for key in keys]
    rows = _build_audit_rows(
        project_id,
        record_id,
        changes,
        changed_by=changed_by,
        changed_at=changed_at,
    )
    _insert_audit_rows(rows)


def log_records_created_batch(
    project_id: str,
    records: list[tuple[str, dict[str, Any]]],
    *,
    changed_by: str,
) -> None:
    if not records:
        return
    changed_at = _now()
    rows: list[tuple[Any, ...]] = []
    for record_id, values in records:
        changes = [(key, None, val) for key, val in values.items()]
        rows.extend(
            _build_audit_rows(
                project_id,
                record_id,
                changes,
                changed_by=changed_by,
                changed_at=changed_at,
            )
        )
    for i in range(0, len(rows), 500):
        _insert_audit_rows(rows[i : i + 500])


def log_records_updated_batch(
    project_id: str,
    updates: list[tuple[str, dict[str, Any], dict[str, Any]]],
    *,
    changed_by: str,
) -> None:
    if not updates:
        return
    changed_at = _now()
    rows: list[tuple[Any, ...]] = []
    for record_id, old_values, new_values in updates:
        keys = set(old_values) | set(new_values)
        changes = [(key, old_values.get(key), new_values.get(key)) for key in keys]
        rows.extend(
            _build_audit_rows(
                project_id,
                record_id,
                changes,
                changed_by=changed_by,
                changed_at=changed_at,
            )
        )
    for i in range(0, len(rows), 500):
        _insert_audit_rows(rows[i : i + 500])


def log_record_deleted(
    project_id: str,
    record_id: str,
    values: dict[str, Any],
    *,
    changed_by: str,
) -> None:
    changed_at = _now()
    changes = [(key, val, None) for key, val in values.items()]
    rows = _build_audit_rows(
        project_id,
        record_id,
        changes,
        changed_by=changed_by,
        changed_at=changed_at,
    )
    _insert_audit_rows(rows)


def list_record_audit(project_id: str, record_id: str) -> list[dict[str, Any]]:
    return fetchall(
        f"""
        SELECT field_key, old_value, new_value, changed_by, changed_at
        FROM {_table()}
        WHERE project_id = ? AND record_id = ?
        ORDER BY changed_at DESC, field_key NULLS LAST
        """,
        (project_id, record_id),
    )
