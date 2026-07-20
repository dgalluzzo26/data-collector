from __future__ import annotations

from fastapi import APIRouter, HTTPException, Request

from backend import auth, email_service
from backend.models import TableConstructionRequestBody, TableConstructionRequestResult

router = APIRouter(prefix="/table-construction-requests", tags=["table-requests"])


def _build_email_body(
    *,
    requester: str,
    table_name: str,
    catalog: str | None,
    schema_name: str | None,
    description: str | None,
) -> str:
    lines = [
        "A Brick Constructor user has requested construction of a new Unity Catalog table.",
        "",
        f"Requested by: {requester}",
        f"Table name: {table_name}",
    ]
    if catalog:
        lines.append(f"Catalog: {catalog}")
    if schema_name:
        lines.append(f"Schema: {schema_name}")
    if description:
        lines.extend(["", "Details:", description])
    lines.extend(
        [
            "",
            "Please create the table and grant the requester access, or reply with next steps.",
        ]
    )
    return "\n".join(lines)


@router.post("", response_model=TableConstructionRequestResult)
def request_table_construction(body: TableConstructionRequestBody, request: Request):
    requester = auth.get_user_email(request)
    recipients = email_service.admin_recipients()
    if not recipients:
        raise HTTPException(
            status_code=503,
            detail="No administrators configured. Set APP_ADMIN_EMAILS in the app environment.",
        )

    subject = f"Brick Constructor: New table request — {body.table_name.strip()}"
    email_body = _build_email_body(
        requester=requester,
        table_name=body.table_name.strip(),
        catalog=body.catalog.strip() if body.catalog else None,
        schema_name=body.schema_name.strip() if body.schema_name else None,
        description=body.description.strip() if body.description else None,
    )
    mailto_url = email_service.build_mailto_url(
        recipients=recipients,
        subject=subject,
        body=email_body,
    )

    sent, _, smtp_error = email_service.send_admin_email(
        subject=subject,
        body=email_body,
        reply_to=requester,
    )

    if sent:
        return TableConstructionRequestResult(
            sent=True,
            recipients=recipients,
            mailto_url=None,
            message=f"Request emailed to {', '.join(recipients)}.",
        )

    if email_service.smtp_configured():
        raise HTTPException(
            status_code=502,
            detail=f"Could not send email: {smtp_error or 'unknown error'}",
        )

    return TableConstructionRequestResult(
        sent=False,
        recipients=recipients,
        mailto_url=mailto_url,
        message="SMTP is not configured — open your email client to send this request to administrators.",
    )
