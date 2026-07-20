"""SQL permission errors surfaced to API clients."""

from __future__ import annotations


class SqlPermissionError(Exception):
    """Unity Catalog denied the current SQL connection."""

    def __init__(self, message: str, *, original: Exception | None = None) -> None:
        super().__init__(message)
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
    from backend import config

    return SqlPermissionError(
        "You do not have permission to access this Unity Catalog resource. "
        f"Grant USE CATALOG / USE SCHEMA / SELECT / MODIFY on "
        f"{config.SCHEMA_FQN} to the app service principal (deployed app) "
        f"or your user (local dev). Run ./scripts/setup.sh if metadata tables "
        f"are missing.",
        original=exc,
    )
