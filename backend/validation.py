"""Server-side validation for collection record values."""

from __future__ import annotations

import re
from dataclasses import dataclass
from typing import Any
from urllib.parse import urlparse

from backend.models import FieldDefinition, LookupRow

_EMAIL_RE = re.compile(r"^[^@\s]+@[^@\s]+\.[^@\s]+$")


def _is_empty(value: Any) -> bool:
    if value is None:
        return True
    if isinstance(value, str) and not value.strip():
        return True
    if isinstance(value, list) and len(value) == 0:
        return True
    return False


@dataclass
class CascadeGroup:
    lookup_id: str
    field_keys: list[str]
    fields: list[FieldDefinition]


def _resolve_value_column(field: FieldDefinition) -> str:
    config = field.config_json or {}
    return str(config.get("value_column") or "code")


def _build_cascade_groups(fields: list[FieldDefinition]) -> list[CascadeGroup]:
    lookup_fields = [
        field
        for field in fields
        if field.field_type == "lookup" and (field.config_json or {}).get("lookup_id")
    ]
    by_key = {field.field_key: field for field in lookup_fields}
    visited: set[str] = set()
    groups: list[CascadeGroup] = []

    for field in lookup_fields:
        config = field.config_json or {}
        cascade_with = config.get("cascade_with") or []
        if not cascade_with or field.field_key in visited:
            continue

        lookup_id = str(config.get("lookup_id"))
        stack = [field.field_key]
        group_keys: set[str] = set()

        while stack:
            key = stack.pop()
            if key in visited or key in group_keys:
                continue
            member = by_key.get(key)
            if not member:
                continue
            member_config = member.config_json or {}
            if str(member_config.get("lookup_id")) != lookup_id:
                continue
            group_keys.add(key)
            visited.add(key)
            for linked_key in member_config.get("cascade_with") or []:
                if linked_key not in group_keys:
                    stack.append(str(linked_key))

        if group_keys:
            group_fields = sorted(
                [by_key[key] for key in group_keys if key in by_key],
                key=lambda item: item.sort_order,
            )
            groups.append(
                CascadeGroup(
                    lookup_id=lookup_id,
                    field_keys=[item.field_key for item in group_fields],
                    fields=group_fields,
                )
            )

    return groups


def _matching_rows(
    rows: list[LookupRow],
    group_fields: list[FieldDefinition],
    values: dict[str, Any],
    exclude_field_key: str | None = None,
) -> list[LookupRow]:
    matches: list[LookupRow] = []
    for row in rows:
        ok = True
        for field in group_fields:
            if field.field_key == exclude_field_key:
                continue
            current = values.get(field.field_key)
            if _is_empty(current):
                continue
            value_col = _resolve_value_column(field)
            if str(row.values.get(value_col, "")) != str(current):
                ok = False
                break
        if ok:
            matches.append(row)
    return matches


def _validate_cascade_combinations(
    fields: list[FieldDefinition],
    values: dict[str, Any],
    rows_by_lookup_id: dict[str, list[LookupRow]],
) -> dict[str, str]:
    errors: dict[str, str] = {}
    message = "These values don't match the same lookup row"

    for group in _build_cascade_groups(fields):
        rows = rows_by_lookup_id.get(group.lookup_id, [])
        filled = [field for field in group.fields if not _is_empty(values.get(field.field_key))]
        if not filled:
            continue
        if _matching_rows(rows, group.fields, values):
            continue
        for field in filled:
            errors[field.field_key] = message

    return errors


def coerce_value_for_storage(field: FieldDefinition, value: Any) -> Any:
    """Normalize record values before writing to typed SQL columns."""
    if value is None:
        return None
    if isinstance(value, (list, dict)):
        return value

    if isinstance(value, str):
        stripped = value.strip()
        if not stripped:
            if field.field_type in ("number", "boolean", "date", "datetime"):
                return None
            return value
        if field.field_type == "number":
            try:
                return float(stripped.replace(",", ""))
            except ValueError:
                return value
        if field.field_type == "boolean":
            lower = stripped.lower()
            if lower in ("true", "yes", "1", "y"):
                return True
            if lower in ("false", "no", "0", "n"):
                return False
        return value

    if field.field_type == "number" and isinstance(value, (int, float)):
        return float(value)

    return value


def _is_valid_url(value: str) -> bool:
    parsed = urlparse(value.strip())
    return bool(parsed.scheme and parsed.netloc)


def validate_record_values(
    fields: list[FieldDefinition],
    values: dict[str, Any],
    *,
    lookup_allowed: dict[str, set[str]] | None = None,
    rows_by_lookup_id: dict[str, list[LookupRow]] | None = None,
    lenient_select_fields: set[str] | None = None,
) -> dict[str, str]:
    """Return field_key -> error message for invalid values."""
    errors: dict[str, str] = {}
    lookup_allowed = lookup_allowed or {}
    rows_by_lookup_id = rows_by_lookup_id or {}

    for field in fields:
        key = field.field_key
        value = values.get(key)
        label = field.label
        config = field.config_json or {}

        if field.is_required:
            if field.field_type == "boolean":
                if value is not True:
                    errors[key] = f"{label} must be checked"
                    continue
            elif _is_empty(value):
                errors[key] = f"{label} is required"
                continue

        if _is_empty(value):
            continue

        if field.field_type == "email":
            if not _EMAIL_RE.match(str(value).strip()):
                errors[key] = "Enter a valid email address"
        elif field.field_type == "url":
            if not _is_valid_url(str(value)):
                errors[key] = "Enter a valid URL (include https://)"
        elif field.field_type == "number":
            try:
                float(value)
            except (TypeError, ValueError):
                errors[key] = "Enter a valid number"
        elif field.field_type == "single_select":
            if lenient_select_fields and key in lenient_select_fields:
                continue
            options = config.get("options") or []
            if options and str(value) not in [str(o) for o in options]:
                errors[key] = "Select a valid option"
        elif field.field_type == "lookup":
            allowed = lookup_allowed.get(key)
            if allowed is not None and str(value) not in allowed:
                errors[key] = "Select a valid lookup value"
        elif field.field_type == "multi_select":
            if lenient_select_fields and key in lenient_select_fields:
                continue
            selected = value if isinstance(value, list) else [value]
            options = config.get("options") or []
            if options:
                allowed_opts = {str(o) for o in options}
                if any(str(item) not in allowed_opts for item in selected):
                    errors[key] = "Select valid option(s)"

    cascade_errors = _validate_cascade_combinations(fields, values, rows_by_lookup_id)
    for key, message in cascade_errors.items():
        errors.setdefault(key, message)

    return errors


def build_lookup_rows_by_id(
    fields: list[FieldDefinition],
    project_id: str,
) -> dict[str, list[LookupRow]]:
    from backend import lookup_repository

    rows_by_lookup_id: dict[str, list[LookupRow]] = {}
    lookup_ids: set[str] = set()
    for field in fields:
        if field.field_type != "lookup":
            continue
        lookup_id = (field.config_json or {}).get("lookup_id")
        if lookup_id:
            lookup_ids.add(str(lookup_id))
    for lookup_id in lookup_ids:
        rows_by_lookup_id[lookup_id] = lookup_repository.list_lookup_rows(lookup_id)
    return rows_by_lookup_id


def build_lookup_allowed(
    fields: list[FieldDefinition],
    project_id: str,
) -> dict[str, set[str]]:
    from backend import lookup_repository

    allowed: dict[str, set[str]] = {}
    for field in fields:
        if field.field_type != "lookup":
            continue
        config = field.config_json or {}
        lookup_id = config.get("lookup_id")
        if not lookup_id:
            continue
        value_col = config.get("value_column") or "code"
        rows = lookup_repository.list_lookup_rows(str(lookup_id))
        seen: set[str] = set()
        field_allowed: set[str] = set()
        for row in rows:
            raw = row.values.get(value_col)
            if raw is None:
                continue
            value = str(raw)
            if value in seen:
                continue
            seen.add(value)
            field_allowed.add(value)
        allowed[field.field_key] = field_allowed
    return allowed
