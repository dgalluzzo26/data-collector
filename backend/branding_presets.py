"""Predefined branding color palettes."""

from __future__ import annotations

from typing import Any

DATABRICKS_PALETTE: dict[str, Any] = {
    "id": "databricks",
    "label": "Databricks",
    "description": "Lava red, teal, navy, and warm oat neutrals (databricks.com).",
    "chrome": {
        "header_background": "#0B2026",
        "header_mid": "#1B3139",
        "header_accent": "#FF3621",
        "sidebar_background": "#0B2026",
        "sidebar_mid": "#1B3139",
        "sidebar_end": "#0B2026",
    },
    "light": {
        "primary": "#FF3621",
        "primary_light": "#FF5C4D",
        "primary_dark": "#EB1600",
        "secondary": "#1B3139",
        "background": "#F9F7F4",
        "paper": "#FFFFFF",
        "text_primary": "#1B3139",
        "text_secondary": "#90A5B1",
    },
    "dark": {
        "primary": "#FF3621",
        "primary_light": "#FF6B5A",
        "primary_dark": "#EB1600",
        "secondary": "#1B5162",
        "background": "#0B2026",
        "paper": "#1B3139",
        "text_primary": "#FFFFFF",
        "text_secondary": "#90A5B1",
    },
}

DHS_PALETTE: dict[str, Any] = {
    "id": "dhs",
    "label": "DHS Government",
    "description": "Navy blues and official red accents (U.S. Department of Homeland Security).",
    "chrome": {
        "header_background": "#0C2340",
        "header_mid": "#112E51",
        "header_accent": "#0078AE",
        "sidebar_background": "#0C2340",
        "sidebar_mid": "#112E51",
        "sidebar_end": "#0C2A46",
    },
    "light": {
        "primary": "#005288",
        "primary_light": "#0078AE",
        "primary_dark": "#0C2340",
        "secondary": "#C41230",
        "background": "#F8F9FB",
        "paper": "#FFFFFF",
        "text_primary": "#1B1B1B",
        "text_secondary": "#5C5C5C",
    },
    "dark": {
        "primary": "#7DD3FC",
        "primary_light": "#BAE6FD",
        "primary_dark": "#005288",
        "secondary": "#E03A52",
        "background": "#0C2340",
        "paper": "#112E51",
        "text_primary": "#FFFFFF",
        "text_secondary": "#B8C5CE",
    },
}

SLATE_PALETTE: dict[str, Any] = {
    "id": "slate",
    "label": "Slate Neutral",
    "description": "Cool grays and charcoal — a minimal enterprise look.",
    "chrome": {
        "header_background": "#0F172A",
        "header_mid": "#1E293B",
        "header_accent": "#64748B",
        "sidebar_background": "#0F172A",
        "sidebar_mid": "#1E293B",
        "sidebar_end": "#0F172A",
    },
    "light": {
        "primary": "#475569",
        "primary_light": "#64748B",
        "primary_dark": "#334155",
        "secondary": "#0F172A",
        "background": "#F8FAFC",
        "paper": "#FFFFFF",
        "text_primary": "#0F172A",
        "text_secondary": "#64748B",
    },
    "dark": {
        "primary": "#94A3B8",
        "primary_light": "#CBD5E1",
        "primary_dark": "#64748B",
        "secondary": "#334155",
        "background": "#0F172A",
        "paper": "#1E293B",
        "text_primary": "#F8FAFC",
        "text_secondary": "#94A3B8",
    },
}

BRANDING_PALETTES: list[dict[str, Any]] = [
    DATABRICKS_PALETTE,
    DHS_PALETTE,
    SLATE_PALETTE,
]

_PALETTE_BY_ID = {preset["id"]: preset for preset in BRANDING_PALETTES}


def get_palette(preset_id: str) -> dict[str, Any] | None:
    return _PALETTE_BY_ID.get(preset_id)


def palette_branding(preset_id: str) -> dict[str, Any]:
    preset = get_palette(preset_id) or DATABRICKS_PALETTE
    agency = (
        "U.S. Department of Homeland Security"
        if preset["id"] == "dhs"
        else "Databricks"
    )
    return {
        "app_title": "Brick Constructor",
        "agency_name": agency,
        "logo_data_url": None,
        "chrome": preset["chrome"],
        "light": preset["light"],
        "dark": preset["dark"],
    }
