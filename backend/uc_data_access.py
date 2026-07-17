"""How Unity Catalog data-plane SQL chooses service principal vs user token."""

from __future__ import annotations

import os
from typing import Any, Literal

UcDataAccessMode = Literal["hybrid", "service_principal", "user_obo"]


def get_uc_data_access_mode() -> UcDataAccessMode:
    raw = (os.environ.get("UC_DATA_ACCESS_MODE") or "hybrid").strip().lower()
    if raw in ("hybrid", "service_principal", "user_obo"):
        return raw  # type: ignore[return-value]
    return "hybrid"


def _is_lakebase(project: dict[str, Any]) -> bool:
    return project.get("storage_type") == "lakebase"


def _is_existing_uc(project: dict[str, Any]) -> bool:
    return (project.get("storage_mode") or "managed") == "existing_uc"


def _is_managed_uc(project: dict[str, Any]) -> bool:
    return project.get("storage_type") == "uc_delta" and not _is_existing_uc(project)


def use_user_token_for_uc_browse() -> bool:
    """True when UC schema/table pickers should run as the signed-in user."""
    mode = get_uc_data_access_mode()
    # hybrid: browse and existing-UC publish both use the user token.
    return mode in ("user_obo", "hybrid")


def use_user_token_for_project(project: dict[str, Any]) -> bool:
    """True when UC data SQL should run as the signed-in user (on-behalf-of)."""
    if _is_lakebase(project):
        return False
    mode = get_uc_data_access_mode()
    if mode == "service_principal":
        return False
    if mode == "user_obo":
        return True
    # hybrid: managed collections use the app SP; existing UC tables use the user.
    return _is_existing_uc(project)


def should_auto_grant_uc_members(project: dict[str, Any]) -> bool:
    """Whether to GRANT UC privileges when members are added or on publish."""
    if _is_lakebase(project) or project.get("storage_type") != "uc_delta":
        return False
    return get_uc_data_access_mode() == "hybrid"


def auto_grant_targets_existing_uc(project: dict[str, Any]) -> bool:
    return should_auto_grant_uc_members(project) and _is_existing_uc(project)
