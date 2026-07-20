"""Server-side validation for collection record values."""

from __future__ import annotations

import re
from typing import Any
from urllib.parse import urlparse

from backend.models import FieldDefinition

_EMAIL_RE = re.compile(r"^[^@\s]+@[^@\s]+\.[^@\s]+$")


def _is_empty(value: Any) -> bool:
    if value is None:
        return True
    if isinstance(value, str) and not value.strip():
        return True
    if isinstance(value, list) and len(value) == 0:
        return True
    return False


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
) -> dict[str, str]:
    """Return field_key -> error message for invalid values."""
    errors: dict[str, str] = {}
    lookup_allowed = lookup_allowed or {}

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
            options = config.get("options") or []
            if options and str(value) not in [str(o) for o in options]:
                errors[key] = "Select a valid option"
        elif field.field_type == "lookup":
            allowed = lookup_allowed.get(key)
            if allowed is not None and str(value) not in allowed:
                errors[key] = "Select a valid lookup value"
        elif field.field_type == "multi_select":
            selected = value if isinstance(value, list) else [value]
            options = config.get("options") or []
            if options:
                allowed_opts = {str(o) for o in options}
                if any(str(item) not in allowed_opts for item in selected):
                    errors[key] = "Select valid option(s)"

    return errors


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
        allowed[field.field_key] = {
            str(row.values.get(value_col, "")) for row in rows if row.values.get(value_col) is not None
        }
    return allowed
