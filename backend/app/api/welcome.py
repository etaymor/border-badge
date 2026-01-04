"""Welcome email API endpoints."""

import logging

from fastapi import APIRouter, BackgroundTasks
from pydantic import BaseModel

from app.core.security import CurrentUser
from app.services.email import schedule_welcome_emails

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/welcome", tags=["welcome"])


class WelcomeEmailRequest(BaseModel):
    """Request body for triggering welcome emails."""

    display_name: str | None = None


@router.post("/emails")
async def trigger_welcome_emails(
    user: CurrentUser,
    request: WelcomeEmailRequest,
    background_tasks: BackgroundTasks,
) -> dict[str, str]:
    """Schedule welcome email sequence for new user.

    This endpoint should be called immediately after successful signup.
    It schedules all welcome emails in the background using Resend's
    scheduled_at feature.
    """
    display_name = request.display_name or "there"

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
