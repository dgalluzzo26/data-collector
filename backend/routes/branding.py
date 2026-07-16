"""App branding settings (logo, title, colors)."""

from __future__ import annotations

from fastapi import APIRouter, HTTPException, Query, Request

from backend import branding_repository
from backend.branding_presets import BRANDING_PALETTES, get_palette, palette_branding
from backend.deps import require_app_admin
from backend.models import BrandingConfig, BrandingUpdateRequest

router = APIRouter()


@router.get("/branding/presets")
def list_branding_presets() -> list[dict]:
    return [
        {
            "id": preset["id"],
            "label": preset["label"],
            "description": preset["description"],
        }
        for preset in BRANDING_PALETTES
    ]


@router.get("/branding", response_model=BrandingConfig)
def get_branding() -> BrandingConfig:
    return BrandingConfig.model_validate(branding_repository.get_branding())


@router.put("/branding", response_model=BrandingConfig)
def update_branding(request: Request, body: BrandingUpdateRequest) -> BrandingConfig:
    email = require_app_admin(request)
    updates = body.model_dump(exclude_unset=True)
    if body.clear_logo:
        updates["logo_data_url"] = None
    updates.pop("clear_logo", None)
    if not updates:
        return BrandingConfig.model_validate(branding_repository.get_branding())
    saved = branding_repository.save_branding(updates, email)
    return BrandingConfig.model_validate(saved)


@router.post("/branding/reset", response_model=BrandingConfig)
def reset_branding(
    request: Request,
    preset: str = Query(default="databricks", description="Palette preset id"),
) -> BrandingConfig:
    email = require_app_admin(request)
    preset_data = get_palette(preset)
    if not preset_data:
        raise HTTPException(status_code=400, detail=f"Unknown palette preset: {preset}")
    updates = {
        "chrome": preset_data["chrome"],
        "light": preset_data["light"],
        "dark": preset_data["dark"],
    }
    saved = branding_repository.save_branding(updates, email)
    return BrandingConfig.model_validate(saved)
