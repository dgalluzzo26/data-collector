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
            return value.lower()

    dev = (os.environ.get("DEV_USER_EMAIL") or "").strip()
    if dev:
        return dev.lower()
    return _LOCAL_DEV_EMAIL


def get_display_name(request: Request) -> str:
    preferred = (request.headers.get("X-Forwarded-Preferred-Username") or "").strip()
    if preferred and not preferred.startswith("local-dev"):
        return preferred
    email = get_user_email(request)
    return email.split("@")[0] if "@" in email else email
