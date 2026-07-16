"""User identity for Databricks Apps and local development."""
import os
import re
from pathlib import Path

from dotenv import load_dotenv
from fastapi import Request

load_dotenv(Path(__file__).resolve().parent.parent / ".env")

_LOCAL_DEV_EMAIL = "local-dev@example.com"
_EMAIL_LIKE = re.compile(r"^[^@\s]+@[^@\s]+\.[^@\s]+$")


def get_user_email(request: Request) -> str:
    for header in (
        "X-Forwarded-Email",
        "X-Forwarded-Preferred-Username",
        "X-Forwarded-User",
    ):
        value = (request.headers.get(header) or "").strip()
        if value and _EMAIL_LIKE.match(value):
            return value

    dev = (os.environ.get("DEV_USER_EMAIL") or "").strip()
    if dev:
        return dev
    return _LOCAL_DEV_EMAIL


def get_user_access_token(request: Request) -> str | None:
    """Short-lived OBO token forwarded by Databricks Apps (User authorization)."""
    for header in ("X-Forwarded-Access-Token", "x-forwarded-access-token"):
        value = (request.headers.get(header) or "").strip()
        if value:
            return value
    return None


def resolve_data_access_token(request: Request | None = None) -> str | None:
    """User OBO token for UC data-plane SQL; falls back to local PAT in development."""
    if request is not None:
        token = get_user_access_token(request)
        if token:
            return token
    token = (os.environ.get("DATABRICKS_TOKEN") or "").strip()
    if token and "REPLACE_WITH" not in token:
        return token
    return None


def get_display_name(request: Request) -> str:
    preferred = (request.headers.get("X-Forwarded-Preferred-Username") or "").strip()
    if preferred and not preferred.startswith("local-dev"):
        return preferred
    email = get_user_email(request)
    return email.split("@")[0] if "@" in email else email
