"""Email service for sending transactional emails via Resend."""

import logging
from datetime import UTC, datetime, timedelta
from pathlib import Path

import resend

from app.core.config import get_settings

logger = logging.getLogger(__name__)

# Template directory path
TEMPLATES_DIR = Path(__file__).parent.parent / "templates" / "emails" / "welcome"

# Welcome email sequence configuration
# Each email is scheduled relative to signup time
WELCOME_EMAILS = [
    {
        "delay_hours": 2,
        "subject": "Welcome to Atlasi!",
        "template": "welcome",
    },
    {
        "delay_hours": 72,  # 3 days
        "subject": "Quick tip for your travel memories",
        "template": "day3",
    },
    {
        "delay_hours": 168,  # 1 week
        "subject": "How's your travel tracking going?",
        "template": "week1",
    },
    {
        "delay_hours": 336,  # 2 weeks
        "subject": "Your passport is looking good",
        "template": "week2",
    },
    {
        "delay_hours": 720,  # 30 days
        "subject": "One month with Atlasi",
        "template": "month1",
    },
]


def load_email_template(template_name: str, display_name: str) -> str:
    """Load and format an email template from file.

    Args:
        template_name: Name of the template file (without .txt extension)
        display_name: User's display name for personalization

    Returns:
        Formatted email body with display_name substituted
    """
    template_path = TEMPLATES_DIR / f"{template_name}.txt"

    try:
        content = template_path.read_text()
        return content.format(display_name=display_name)
    except FileNotFoundError:
        logger.error(f"Email template not found: {template_path}")
        return f"Hi {display_name},\n\nWelcome to Atlasi!\n\nEmerson"


async def schedule_welcome_emails(email: str, display_name: str) -> list[str]:
    """Schedule all welcome emails for a new user.

    Args:
        email: User's email address
        display_name: User's display name for personalization

    Returns:
        List of Resend email IDs for scheduled emails
    """
    settings = get_settings()

    if not settings.resend_api_key:
        logger.warning("Resend API key not configured, skipping welcome emails")
        return []

    resend.api_key = settings.resend_api_key
    email_ids = []
    now = datetime.now(UTC)

    for config in WELCOME_EMAILS:
        try:
            scheduled_at = (now + timedelta(hours=config["delay_hours"])).isoformat()
            body = load_email_template(config["template"], display_name)

            params: resend.Emails.SendParams = {
                "from": settings.welcome_email_from,
                "to": [email],
                "subject": config["subject"],
                "text": body,
                "scheduled_at": scheduled_at,
            }

            result = resend.Emails.send(params)
            email_ids.append(result["id"])

            logger.info(
                "Scheduled welcome email",
                extra={
                    "email_id": result["id"],
                    "template": config["template"],
                    "scheduled_at": scheduled_at,
                    "recipient": email,
                },
            )

        except Exception as e:
            logger.error(
                "Failed to schedule welcome email",
                extra={
                    "template": config["template"],
                    "recipient": email,
                    "error": str(e),
                },
            )
            # Continue scheduling remaining emails even if one fails

    return email_ids
