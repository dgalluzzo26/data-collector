"""App Lakebase Data API settings."""

from __future__ import annotations

from fastapi import APIRouter, Request

from backend import lakebase_settings_repository
from backend.deps import require_app_admin
from backend.models import LakebaseSettingsConfig, LakebaseSettingsUpdateRequest

router = APIRouter()


@router.get("/lakebase-settings", response_model=LakebaseSettingsConfig)
def get_lakebase_settings() -> LakebaseSettingsConfig:
    return LakebaseSettingsConfig.model_validate(lakebase_settings_repository.get_lakebase_settings())


@router.put("/lakebase-settings", response_model=LakebaseSettingsConfig)
def update_lakebase_settings(
    request: Request, body: LakebaseSettingsUpdateRequest
) -> LakebaseSettingsConfig:
    email = require_app_admin(request)
    updates = body.model_dump(exclude_unset=True)
    if body.clear_data_api_url:
        updates["data_api_url"] = None
    updates.pop("clear_data_api_url", None)
    if not updates:
        return LakebaseSettingsConfig.model_validate(
            lakebase_settings_repository.get_lakebase_settings()
        )
    saved = lakebase_settings_repository.save_lakebase_settings(updates, email)
    return LakebaseSettingsConfig.model_validate(saved)
