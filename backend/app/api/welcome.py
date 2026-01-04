"""Welcome email API endpoints."""

import hashlib
import logging

from fastapi import APIRouter, Request
from pydantic import BaseModel, Field, field_validator

from app.core.security import CurrentUser
from app.db.session import get_supabase_client
from app.main import limiter
from app.services.email import schedule_welcome_emails

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/welcome", tags=["welcome"])


def _redact_email(email: str) -> str:
    """Redact email for safe logging. Returns hash prefix for correlation."""
    return hashlib.sha256(email.encode()).hexdigest()[:12]


class WelcomeEmailRequest(BaseModel):
    """Request body for triggering welcome emails."""

    display_name: str | None = Field(None, max_length=100)

    @field_validator("display_name")
    @classmethod
    def sanitize_display_name(cls, v: str | None) -> str | None:
        """Remove newlines and strip whitespace to prevent email header injection."""
        if v:
            return v.replace("\n", "").replace("\r", "").strip()
        return v


class WelcomeEmailResponse(BaseModel):
    """Response body for welcome email endpoint."""

    status: str
    email_count: int = 0


@router.post("/emails", response_model=WelcomeEmailResponse)
@limiter.limit("3/hour")
async def trigger_welcome_emails(
    request: Request,
    user: CurrentUser,
    body: WelcomeEmailRequest,
) -> WelcomeEmailResponse:
    """Schedule welcome email sequence for new user.

    This endpoint should be called immediately after successful signup.
    It schedules all welcome emails using Resend's scheduled_at feature.

    Includes idempotency protection: if welcome emails have already been
    scheduled for this user, the endpoint returns early without duplicating.
    """
    display_name = body.display_name or "there"
    redacted_email = _redact_email(user.email)

    # Use service role client for profile lookup/update (bypasses RLS)
    supabase = get_supabase_client()

    # Idempotency check: see if user already has welcome_emails_scheduled flag
    profiles = await supabase.get(
        "user_profile",
        params={"user_id": f"eq.{user.id}", "select": "welcome_emails_scheduled"},
    )

    if profiles and profiles[0].get("welcome_emails_scheduled"):
        logger.info(
            "Welcome emails already scheduled, skipping",
            extra={"user_id": user.id, "recipient_hash": redacted_email},
        )
        return WelcomeEmailResponse(status="already_scheduled")

    logger.info(
        "Triggering welcome emails",
        extra={
            "user_id": user.id,
            "recipient_hash": redacted_email,
            "display_name": display_name,
        },
    )

    # Schedule emails (async, no blocking)
    email_ids = await schedule_welcome_emails(user.email, display_name)

    # Mark welcome emails as scheduled to prevent duplicates
    if email_ids:
        await supabase.upsert(
            "user_profile",
            data=[{"user_id": user.id, "welcome_emails_scheduled": True}],
            on_conflict="user_id",
        )

    return WelcomeEmailResponse(status="scheduled", email_count=len(email_ids))
