"""SQL permission errors surfaced to API clients."""

from __future__ import annotations


class SqlPermissionError(Exception):
    """Unity Catalog denied the current SQL connection."""

    def __init__(self, message: str, *, original: Exception | None = None) -> None:
        super().__init__(message)
        self.original = original


class LakebasePermissionError(Exception):
    """Lakebase Postgres denied the app's database role."""

    def __init__(self, message: str, *, original: Exception | None = None) -> None:
        super().__init__(message)
        self.original = original


class LakebaseDataError(Exception):
    """Lakebase Postgres rejected a value (constraint or type violation)."""

    def __init__(
        self,
        message: str,
        *,
        column: str | None = None,
        original: Exception | None = None,
    ) -> None:
        super().__init__(message)
        self.column = column
        self.original = original


class UserAuthorizationRequiredError(Exception):
    """UC data-plane SQL requires a user OBO token that was not provided."""

    def __init__(
        self,
        message: str = (
            "User authorization is required for Unity Catalog data access. "
            "Enable User authorization with the sql scope on the Databricks App, "
            "restart the app, and ensure your user has CAN USE on the SQL warehouse."
        ),
    ) -> None:
        super().__init__(message)


def is_table_not_found(exc: Exception) -> bool:
    msg = str(exc).upper()
    return (
        "TABLE_OR_VIEW_NOT_FOUND" in msg
        or "TABLE_OR_VIEW_CANNOT_BE_FOUND" in msg
        or "NO_SUCH_TABLE" in msg
        or ("DOES NOT EXIST" in msg and "TABLE" in msg)
    )


def is_permission_denied(exc: Exception) -> bool:
    msg = str(exc).upper()
    return (
        "INSUFFICIENT_PERMISSIONS" in msg
        or "PERMISSION_DENIED" in msg
        or "42501" in msg
    )


def as_permission_error(exc: Exception) -> SqlPermissionError:
    return SqlPermissionError(
        "You do not have permission to access this Unity Catalog resource.",
        original=exc,
    )


def _pg_sqlstate(exc: Exception) -> str | None:
    state = getattr(exc, "sqlstate", None)
    if state:
        return str(state)
    diag = getattr(exc, "diag", None)
    return str(diag.sqlstate) if diag is not None and getattr(diag, "sqlstate", None) else None


def is_lakebase_permission_denied(exc: Exception) -> bool:
    if _pg_sqlstate(exc) in ("42501", "3F000"):
        return True
    msg = str(exc).lower()
    return "permission denied" in msg or "must be owner" in msg


def as_lakebase_permission_error(exc: Exception) -> LakebasePermissionError:
    return LakebasePermissionError(
        "You do not have permission to access this Lakebase Postgres table. "
        "Ask a Lakebase admin to grant your database role access to the schema and table "
        "(see docs/LAKEBASE.md).",
        original=exc,
    )


def is_lakebase_data_error(exc: Exception) -> bool:
    """Postgres data exception (22xxx) or integrity constraint violation (23xxx)."""
    state = _pg_sqlstate(exc)
    return bool(state) and state[:2] in ("22", "23")


def as_lakebase_data_error(exc: Exception) -> LakebaseDataError:
    state = _pg_sqlstate(exc) or ""
    diag = getattr(exc, "diag", None)
    column = getattr(diag, "column_name", None) if diag is not None else None

    if state == "23502":
        target = column or "A column"
        message = f"{target} is required by the Lakebase table and cannot be empty."
    elif state == "23505":
        message = "A record with these values already exists in the Lakebase table."
    elif state == "23503":
        message = "This value references a row that does not exist in the related Lakebase table."
    elif state == "23514":
        message = "A value violates a check constraint on the Lakebase table."
    else:
        primary = getattr(diag, "message_primary", None) if diag is not None else None
        detail = primary or str(exc).strip().splitlines()[0]
        message = f"Lakebase rejected this value: {detail}"

    return LakebaseDataError(message, column=column, original=exc)
