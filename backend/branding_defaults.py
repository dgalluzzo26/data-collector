"""Default branding — Databricks palette is the shipped default."""

from __future__ import annotations

from typing import Any

from backend.branding_presets import palette_branding

DEFAULT_BRANDING: dict[str, Any] = palette_branding("databricks")
