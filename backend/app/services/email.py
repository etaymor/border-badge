"""Email service for sending transactional emails via Resend."""

import hashlib
import logging
from datetime import UTC, datetime, timedelta
from functools import lru_cache
from pathlib import Path

import httpx

from app.core.config import get_settings

logger = logging.getLogger(__name__)

# Resend API endpoint
RESEND_API_URL = "https://api.resend.com/emails"

# Template directory path
TEMPLATES_DIR = Path(__file__).parent.parent / "templates" / "emails" / "welcome"

# Welcome email sequence configuration
# Each email is scheduled relative to signup time
WELCOME_EMAILS = [
    {
        "delay_hours": 0,  # Immediately after signup
        "subject": "You're awesome",
        "template": "welcome",
    },
    {
        "delay_hours": 24,  # Day 2
        "subject": "The apps out there just didn't cut it",
        "template": "day2",
    },
    {
        "delay_hours": 72,  # Day 4
        "subject": "The feature I use every single day",
        "template": "day4",
    },
    {
        "delay_hours": 144,  # Day 7
        "subject": '"Can you send me your recommendations?"',
        "template": "day7",
    },
]


@lru_cache(maxsize=10)
def _load_template_content(template_name: str) -> str | None:
    """Load raw template content from disk with caching.

    Args:
        template_name: Name of the template file (without .txt extension)

    Returns:
        Template content or None if not found
    """
    template_path = TEMPLATES_DIR / f"{template_name}.txt"
    try:
        return template_path.read_text()
    except FileNotFoundError:
        logger.error(f"Email template not found: {template_path}")
        return None


def load_email_template(template_name: str, display_name: str) -> str:
    """Load and format an email template from file.

    Args:
        template_name: Name of the template file (without .txt extension)
        display_name: User's display name for personalization

    Returns:
        Formatted email body with display_name substituted
    """
    fallback = f"Hi {display_name},\n\nWelcome to Atlasi!\n\nEmerson"
    content = _load_template_content(template_name)
    if content is None:
        return fallback

    try:
        return content.replace("{display_name}", display_name)
    except (KeyError, IndexError, ValueError) as e:
        template_path = TEMPLATES_DIR / f"{template_name}.txt"
        logger.error(
            "Template formatting failed",
            extra={"template_path": str(template_path), "error": str(e)},
        )
        return fallback


def _redact_email(email: str) -> str:
    """Redact email address for safe logging.

    Returns a hash prefix for correlation without exposing PII.
    Example: "user@example.com" -> "a1b2c3d4..."
    """
    return hashlib.sha256(email.encode()).hexdigest()[:12]


class WelcomeEmailResult:
    """Result of scheduling welcome emails."""

    def __init__(
        self,
        email_ids: list[str],
        total_attempted: int,
        skipped: bool = False,
    ):
        self.email_ids = email_ids
        self.total_attempted = total_attempted
        self.skipped = skipped

    @property
    def success_count(self) -> int:
        return len(self.email_ids)

    @property
    def failed_count(self) -> int:
        return self.total_attempted - len(self.email_ids)

    @property
    def all_failed(self) -> bool:
        return self.total_attempted > 0 and len(self.email_ids) == 0


async def schedule_welcome_emails(email: str, display_name: str) -> WelcomeEmailResult:
    """Schedule all welcome emails for a new user.

    Uses async httpx to call Resend API directly, avoiding blocking calls
    and global state mutation.

    Args:
        email: User's email address
        display_name: User's display name for personalization

    Returns:
        WelcomeEmailResult with email IDs and success/failure counts
    """
    settings = get_settings()
    redacted_email = _redact_email(email)

    if not settings.resend_api_key:
        logger.warning("Resend API key not configured, skipping welcome emails")
        return WelcomeEmailResult(email_ids=[], total_attempted=0, skipped=True)

    email_ids: list[str] = []
    total_attempted = len(WELCOME_EMAILS)
    now = datetime.now(UTC)

    # Use async httpx client with API key passed per-request (no global state)
    async with httpx.AsyncClient() as client:
        headers = {
            "Authorization": f"Bearer {settings.resend_api_key}",
            "Content-Type": "application/json",
        }

        for config in WELCOME_EMAILS:
            try:
                scheduled_at = (
                    now + timedelta(hours=config["delay_hours"])
                ).isoformat()
                body = load_email_template(config["template"], display_name)

                payload = {
                    "from": settings.welcome_email_from,
                    "to": [email],
                    "subject": config["subject"],
                    "text": body,
                    "scheduled_at": scheduled_at,
                }

                response = await client.post(
                    RESEND_API_URL, headers=headers, json=payload, timeout=30.0
                )
                response.raise_for_status()
                result = response.json()
                email_ids.append(result["id"])

                logger.info(
                    "Scheduled welcome email",
                    extra={
                        "email_id": result["id"],
                        "template": config["template"],
                        "scheduled_at": scheduled_at,
                        "recipient_hash": redacted_email,
                    },
                )

            except httpx.HTTPStatusError as e:
                logger.error(
                    "Failed to schedule welcome email - HTTP error",
                    extra={
                        "template": config["template"],
                        "recipient_hash": redacted_email,
                        "status_code": e.response.status_code,
                        "error": str(e),
                    },
                )
                # Continue scheduling remaining emails even if one fails
            except Exception as e:
                logger.error(
                    "Failed to schedule welcome email",
                    extra={
                        "template": config["template"],
                        "recipient_hash": redacted_email,
                        "error": str(e),
                    },
                )
                # Continue scheduling remaining emails even if one fails

    return WelcomeEmailResult(email_ids=email_ids, total_attempted=total_attempted)


async def send_contact_email(
    name: str,
    email: str,
    category: str,
    message: str,
) -> bool:
    """Send a contact form submission email.

    Args:
        name: Sender's name
        email: Sender's email address
        category: Contact category (feature_request, data_deletion, bug_report, general_inquiry)
        message: The message content

    Returns:
        True if email sent successfully, False otherwise
    """
    settings = get_settings()

    if not settings.resend_api_key:
        logger.warning("Resend API key not configured, skipping contact email")
        return False

    # Map category to human-readable label
    category_labels = {
        "feature_request": "Feature Request",
        "data_deletion": "Data Deletion Request",
        "bug_report": "Bug Report",
        "general_inquiry": "General Inquiry",
    }
    category_label = category_labels.get(category, category)

    subject = f"[Atlasi Contact] {category_label} from {name}"

    body = f"""New contact form submission:

Name: {name}
Email: {email}
Category: {category_label}

Message:
{message}

---
Reply directly to this email to respond to {name}.
"""

    try:
        async with httpx.AsyncClient() as client:
            headers = {
                "Authorization": f"Bearer {settings.resend_api_key}",
                "Content-Type": "application/json",
            }

            payload = {
                "from": settings.welcome_email_from,
                "to": [settings.contact_email_to],
                "reply_to": email,
                "subject": subject,
                "text": body,
            }

            response = await client.post(
                RESEND_API_URL,
                headers=headers,
                json=payload,
                timeout=30.0,
            )
            response.raise_for_status()
            result = response.json()

            logger.info(
                "Contact email sent successfully",
                extra={
                    "email_id": result.get("id"),
                    "category": category,
                },
            )
            return True

    except httpx.HTTPStatusError as e:
        logger.error(
            "Failed to send contact email - HTTP error",
            extra={
                "status_code": e.response.status_code,
                "error": str(e),
            },
        )
        return False
    except Exception as e:
        logger.error(f"Failed to send contact email: {e}")
        return False
