"""Email service for sending transactional emails via Resend."""

import asyncio
import hashlib
import logging
from datetime import UTC, datetime, timedelta
from functools import lru_cache
from pathlib import Path

import httpx

from app.core.config import get_settings
from app.db.session import get_supabase_client

logger = logging.getLogger(__name__)

# Resend API endpoints
RESEND_API_URL = "https://api.resend.com/emails"
RESEND_CANCEL_URL = "https://api.resend.com/emails/{email_id}/cancel"

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
        "subject": "I built this because nothing else worked",
        "template": "day2",
    },
    {
        "delay_hours": 72,  # Day 4
        "subject": "Two features that changed everything for me",
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


@lru_cache(maxsize=10)
def _load_html_template_content(template_name: str) -> str | None:
    """Load raw HTML template content from disk with caching.

    Args:
        template_name: Name of the template file (without .html extension)

    Returns:
        HTML template content or None if not found
    """
    template_path = TEMPLATES_DIR / f"{template_name}.html"
    try:
        return template_path.read_text()
    except FileNotFoundError:
        return None


def _wrap_html_email(content: str) -> str:
    """Wrap HTML email content in a minimal structure for consistent rendering.

    Adds DOCTYPE, viewport meta, and a centered 600px container with a clean
    font stack. No branding — just enough for readable text across email clients.
    """
    return (
        "<!DOCTYPE html>"
        '<html lang="en">'
        "<head>"
        '<meta charset="UTF-8">'
        '<meta name="viewport" content="width=device-width, initial-scale=1.0">'
        "</head>"
        '<body style="margin:0; padding:0; background-color:#ffffff;">'
        '<div style="max-width:600px; margin:0 auto; padding:24px 16px; '
        "font-family:-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, "
        "Helvetica, Arial, sans-serif; font-size:16px; line-height:1.5; "
        'color:#1a1a1a;">'
        f"{content}"
        "</div>"
        "</body>"
        "</html>"
    )


def load_email_template(
    template_name: str,
    display_name: str,
    unsubscribe_url: str | None = None,
) -> tuple[str, str | None]:
    """Load and format an email template from file.

    Args:
        template_name: Name of the template file (without .txt extension)
        display_name: User's display name for personalization
        unsubscribe_url: Optional URL for unsubscribe link

    Returns:
        Tuple of (text_body, html_body). html_body is None if no HTML template exists.
    """
    settings = get_settings()
    fallback = f"Hi {display_name},\n\nWelcome to Atlasi!\n\nEmerson"
    content = _load_template_content(template_name)
    if content is None:
        body = fallback
    else:
        try:
            body = content.replace("{display_name}", display_name)
        except (KeyError, IndexError, ValueError) as e:
            template_path = TEMPLATES_DIR / f"{template_name}.txt"
            logger.error(
                "Template formatting failed",
                extra={"template_path": str(template_path), "error": str(e)},
            )
            body = fallback

    # Append unsubscribe footer if URL provided
    if unsubscribe_url:
        body += f"\n\n---\nDon't want these emails? Unsubscribe: {unsubscribe_url}"

    # Load HTML version if it exists
    html_body = None
    html_content = _load_html_template_content(template_name)
    if html_content is not None:
        try:
            html_body = html_content.replace("{display_name}", display_name)
            html_body = html_body.replace("{base_url}", settings.base_url.rstrip("/"))

            if unsubscribe_url:
                unsubscribe_html = (
                    '<p style="margin-top:30px; padding-top:15px; '
                    'border-top:1px solid #e0e0e0; font-size:13px; color:#999;">'
                    "Don't want these emails? "
                    f'<a href="{unsubscribe_url}" style="color:#999;">Unsubscribe</a>'
                    "</p>"
                )
                html_body = html_body.replace("{unsubscribe_footer}", unsubscribe_html)
            else:
                html_body = html_body.replace("{unsubscribe_footer}", "")

            # Wrap in minimal email structure for consistent rendering
            html_body = _wrap_html_email(html_body)
        except (KeyError, IndexError, ValueError) as e:
            logger.error(
                "HTML template formatting failed",
                extra={"template_name": template_name, "error": str(e)},
            )
            html_body = None

    return body, html_body


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


async def schedule_welcome_emails(
    email: str,
    display_name: str,
    user_id: str | None = None,
    unsubscribe_token: str | None = None,
    base_url: str | None = None,
) -> WelcomeEmailResult:
    """Schedule all welcome emails for a new user.

    Uses async httpx to call Resend API directly, avoiding blocking calls
    and global state mutation.

    Args:
        email: User's email address
        display_name: User's display name for personalization
        user_id: User's UUID for tracking scheduled emails (optional)
        unsubscribe_token: User's unsubscribe token for generating links (optional)
        base_url: Base URL for unsubscribe links (optional)

    Returns:
        WelcomeEmailResult with email IDs and success/failure counts
    """
    settings = get_settings()
    redacted_email = _redact_email(email)

    if not settings.resend_api_key:
        logger.warning("Resend API key not configured, skipping welcome emails")
        return WelcomeEmailResult(email_ids=[], total_attempted=0, skipped=True)

    # Build unsubscribe URL if token and base_url provided
    unsubscribe_url = None
    if unsubscribe_token and base_url:
        unsubscribe_url = f"{base_url}/unsubscribe/{unsubscribe_token}"

    email_ids: list[str] = []
    total_attempted = len(WELCOME_EMAILS)
    now = datetime.now(UTC)

    # Get supabase client for storing scheduled email records
    db = get_supabase_client() if user_id else None

    # Use async httpx client with API key passed per-request (no global state)
    async with httpx.AsyncClient() as client:
        headers = {
            "Authorization": f"Bearer {settings.resend_api_key}",
            "Content-Type": "application/json",
        }

        for config in WELCOME_EMAILS:
            try:
                scheduled_at_dt = now + timedelta(hours=config["delay_hours"])
                scheduled_at = scheduled_at_dt.isoformat()
                text_body, html_body = load_email_template(
                    config["template"], display_name, unsubscribe_url
                )

                payload = {
                    "from": settings.welcome_email_from,
                    "to": [email],
                    "subject": config["subject"],
                    "text": text_body,
                }
                if html_body:
                    payload["html"] = html_body

                # Only include scheduled_at for future emails.
                # Resend silently drops emails with scheduled_at ≈ now.
                if config["delay_hours"] > 0:
                    payload["scheduled_at"] = scheduled_at

                # Retry with backoff for rate limits (Resend allows 2 req/s)
                resend_email_id = None
                for attempt in range(3):
                    response = await client.post(
                        RESEND_API_URL, headers=headers, json=payload, timeout=30.0
                    )
                    if response.status_code == 429:
                        wait = 1.0 * (attempt + 1)
                        logger.warning(
                            "Resend rate limited, retrying",
                            extra={
                                "template": config["template"],
                                "attempt": attempt + 1,
                                "wait_seconds": wait,
                            },
                        )
                        await asyncio.sleep(wait)
                        continue
                    response.raise_for_status()
                    result = response.json()
                    resend_email_id = result["id"]
                    break
                else:
                    # All retries exhausted — treat as failure
                    logger.error(
                        "Resend rate limit persisted after retries",
                        extra={
                            "template": config["template"],
                            "recipient_hash": redacted_email,
                        },
                    )
                    continue

                email_ids.append(resend_email_id)

                # Store email record for tracking/cancellation if user_id provided
                is_immediate = config["delay_hours"] == 0
                if db and user_id:
                    try:
                        await db.post(
                            "scheduled_email",
                            data={
                                "user_id": user_id,
                                "resend_email_id": resend_email_id,
                                "template_name": config["template"],
                                "scheduled_at": scheduled_at,
                                "status": "sent" if is_immediate else "scheduled",
                            },
                        )
                    except Exception as db_err:
                        # Log but don't fail - email is already scheduled
                        logger.warning(
                            "Failed to store scheduled email record",
                            extra={
                                "email_id": resend_email_id,
                                "user_id": user_id,
                                "error": str(db_err),
                            },
                        )

                logger.info(
                    "Scheduled welcome email",
                    extra={
                        "email_id": resend_email_id,
                        "template": config["template"],
                        "scheduled_at": scheduled_at,
                        "recipient_hash": redacted_email,
                    },
                )

                # Pace requests to stay under Resend's 2 req/s limit
                await asyncio.sleep(0.6)

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


async def cancel_scheduled_emails(user_id: str) -> int:
    """Cancel all pending scheduled emails for a user.

    Fetches pending scheduled_email records and cancels them via Resend API.

    Args:
        user_id: The user's UUID

    Returns:
        Number of emails successfully cancelled
    """
    settings = get_settings()

    if not settings.resend_api_key:
        logger.warning("Resend API key not configured, skipping email cancellation")
        return 0

    db = get_supabase_client()

    # Fetch all pending scheduled emails for user
    try:
        scheduled_emails = await db.get(
            "scheduled_email",
            params={
                "user_id": f"eq.{user_id}",
                "status": "eq.scheduled",
                "select": "id,resend_email_id",
            },
        )
    except Exception as e:
        logger.error(
            "Failed to fetch scheduled emails for cancellation",
            extra={"user_id": user_id, "error": str(e)},
        )
        return 0

    if not scheduled_emails:
        logger.info(
            "No scheduled emails to cancel",
            extra={"user_id": user_id},
        )
        return 0

    cancelled_count = 0

    async with httpx.AsyncClient() as client:
        headers = {
            "Authorization": f"Bearer {settings.resend_api_key}",
            "Content-Type": "application/json",
        }

        for record in scheduled_emails:
            resend_email_id = record["resend_email_id"]
            record_id = record["id"]

            try:
                # Cancel the email via Resend API
                cancel_url = RESEND_CANCEL_URL.format(email_id=resend_email_id)
                response = await client.post(cancel_url, headers=headers, timeout=30.0)
                response.raise_for_status()

                # Update status in our database
                await db.patch(
                    "scheduled_email",
                    data={"status": "cancelled"},
                    params={"id": f"eq.{record_id}"},
                )

                cancelled_count += 1
                logger.info(
                    "Cancelled scheduled email",
                    extra={
                        "resend_email_id": resend_email_id,
                        "user_id": user_id,
                    },
                )

            except httpx.HTTPStatusError as e:
                # Log but continue - email may have already been sent
                logger.warning(
                    "Failed to cancel scheduled email via Resend",
                    extra={
                        "resend_email_id": resend_email_id,
                        "user_id": user_id,
                        "status_code": e.response.status_code,
                        "error": str(e),
                    },
                )
            except Exception as e:
                logger.error(
                    "Failed to cancel scheduled email",
                    extra={
                        "resend_email_id": resend_email_id,
                        "user_id": user_id,
                        "error": str(e),
                    },
                )

    logger.info(
        "Completed email cancellation",
        extra={
            "user_id": user_id,
            "cancelled_count": cancelled_count,
            "total_attempted": len(scheduled_emails),
        },
    )

    return cancelled_count
