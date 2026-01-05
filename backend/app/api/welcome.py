"""Welcome email API endpoints."""

import hashlib
import logging

from fastapi import APIRouter, HTTPException, Request, status
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
    # Guard: ensure user has an email before scheduling
    if user.email is None:
        logger.error(
            "Cannot schedule welcome emails: user email is missing",
            extra={"user_id": user.id},
        )
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="User email is missing",
        )

    user_email = user.email  # Now guaranteed to be str
    display_name = body.display_name or "there"
    redacted_email = _redact_email(user_email)

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
    result = await schedule_welcome_emails(user_email, display_name)

    # Handle different outcomes
    if result.skipped:
        # API key not configured - skip silently in dev, but don't mark as scheduled
        return WelcomeEmailResponse(status="skipped", email_count=0)

    if result.all_failed:
        # All emails failed to schedule - log error but don't mark as scheduled
        # This allows retry on next signup attempt
        logger.error(
            "All welcome emails failed to schedule",
            extra={
                "user_id": user.id,
                "recipient_hash": redacted_email,
                "total_attempted": result.total_attempted,
            },
        )
        return WelcomeEmailResponse(status="failed", email_count=0)

    # At least some emails scheduled - mark as scheduled to prevent duplicates
    await supabase.upsert(
        "user_profile",
        data=[{"user_id": user.id, "welcome_emails_scheduled": True}],
        on_conflict="user_id",
    )

    # Log if partial failure
    if result.failed_count > 0:
        logger.warning(
            "Some welcome emails failed to schedule",
            extra={
                "user_id": user.id,
                "recipient_hash": redacted_email,
                "success_count": result.success_count,
                "failed_count": result.failed_count,
            },
        )

    return WelcomeEmailResponse(status="scheduled", email_count=result.success_count)
