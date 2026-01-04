"""Welcome email API endpoints."""

import logging

from fastapi import APIRouter, BackgroundTasks, Request
from pydantic import BaseModel, Field, field_validator

from app.core.security import CurrentUser
from app.main import limiter
from app.services.email import schedule_welcome_emails

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/welcome", tags=["welcome"])


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


@router.post("/emails")
@limiter.limit("3/hour")
async def trigger_welcome_emails(
    request: Request,
    user: CurrentUser,
    body: WelcomeEmailRequest,
    background_tasks: BackgroundTasks,
) -> dict[str, str]:
    """Schedule welcome email sequence for new user.

    This endpoint should be called immediately after successful signup.
    It schedules all welcome emails in the background using Resend's
    scheduled_at feature.
    """
    display_name = body.display_name or "there"

    logger.info(
        "Triggering welcome emails",
        extra={
            "user_id": user.id,
            "email": user.email,
            "display_name": display_name,
        },
    )

    background_tasks.add_task(
        schedule_welcome_emails,
        user.email,
        display_name,
    )

    return {"status": "scheduled"}
