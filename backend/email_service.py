"""Send notification emails to app administrators."""

from __future__ import annotations

import logging
import os
import smtplib
import ssl
from email.mime.multipart import MIMEMultipart
from email.mime.text import MIMEText
from typing import Iterable
from urllib.parse import quote

from backend.app_admin import app_admin_emails

logger = logging.getLogger(__name__)


def admin_recipients() -> list[str]:
    return sorted(app_admin_emails())


def smtp_configured() -> bool:
    return bool(os.environ.get("SMTP_HOST", "").strip())


def _smtp_settings() -> dict[str, str | int | bool]:
    port_raw = os.environ.get("SMTP_PORT", "587").strip()
    return {
        "host": os.environ.get("SMTP_HOST", "").strip(),
        "port": int(port_raw) if port_raw.isdigit() else 587,
        "user": os.environ.get("SMTP_USER", "").strip(),
        "password": os.environ.get("SMTP_PASSWORD", "").strip(),
        "from_addr": (
            os.environ.get("SMTP_FROM", "").strip()
            or os.environ.get("SMTP_USER", "").strip()
            or "brick-constructor@localhost"
        ),
        "use_tls": os.environ.get("SMTP_USE_TLS", "true").strip().lower() not in ("0", "false", "no"),
    }


def build_mailto_url(
    *,
    recipients: Iterable[str],
    subject: str,
    body: str,
) -> str:
    to = ",".join(recipients)
    return f"mailto:{to}?subject={quote(subject)}&body={quote(body)}"


def send_admin_email(
    *,
    subject: str,
    body: str,
    reply_to: str | None = None,
) -> tuple[bool, list[str], str | None]:
    """Send to APP_ADMIN_EMAILS. Returns (sent_via_smtp, recipients, error_message)."""
    recipients = admin_recipients()
    if not recipients:
        return False, [], "APP_ADMIN_EMAILS is not configured"

    if not smtp_configured():
        return False, recipients, "SMTP is not configured"

    settings = _smtp_settings()
    message = MIMEMultipart()
    message["Subject"] = subject
    message["From"] = str(settings["from_addr"])
    message["To"] = ", ".join(recipients)
    if reply_to:
        message["Reply-To"] = reply_to
    message.attach(MIMEText(body, "plain", "utf-8"))

    try:
        with smtplib.SMTP(str(settings["host"]), int(settings["port"]), timeout=30) as client:
            if settings["use_tls"]:
                client.starttls(context=ssl.create_default_context())
            if settings["user"] and settings["password"]:
                client.login(str(settings["user"]), str(settings["password"]))
            client.sendmail(str(settings["from_addr"]), recipients, message.as_string())
        logger.info("Sent admin email to %s: %s", recipients, subject)
        return True, recipients, None
    except Exception as exc:
        logger.warning("Failed to send admin email: %s", exc)
        return False, recipients, str(exc)
