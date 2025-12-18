"""Schemas for traveler classification endpoint."""

from pydantic import BaseModel, Field, field_validator

# Maximum number of countries in the database
MAX_COUNTRIES = 227

# Interest tag limits to prevent prompt injection / abuse
MAX_INTEREST_TAGS = 10
MAX_TAG_LENGTH = 50

# Phrases that suggest prompt injection attempts (case-insensitive)
# These are checked as substrings to catch common injection patterns
PROMPT_INJECTION_PHRASES = frozenset(
    [
        "ignore",
        "disregard",
        "forget",
        "instruction",
        "previous",
        "system",
        "prompt",
        "override",
        "bypass",
        "assistant",
        "claude",
        "gpt",
        "json",
        "output",
        "respond",
    ]
)


def _contains_injection_keywords(text: str) -> bool:
    """Check if text contains potential prompt injection keywords."""
    text_lower = text.lower()
    return any(keyword in text_lower for keyword in PROMPT_INJECTION_PHRASES)


class TravelerClassificationRequest(BaseModel):
    """Request to classify a traveler based on their visited countries."""

    countries_visited: list[str] = Field(
        ...,
        min_length=1,
        max_length=MAX_COUNTRIES,
        description="Country codes (e.g., ['US', 'JP', 'FR'])",
    )
    interest_tags: list[str] = Field(
        default=[],
        max_length=MAX_INTEREST_TAGS,
        description="Optional interest tags for classification hints",
    )

    @field_validator("interest_tags")
    @classmethod
    def validate_interest_tags(cls, tags: list[str]) -> list[str]:
        """Validate and sanitize interest tags to prevent prompt injection."""
        sanitized = []
        for tag in tags:
            # Truncate overly long tags
            if len(tag) > MAX_TAG_LENGTH:
                tag = tag[:MAX_TAG_LENGTH]
            # Strip whitespace and skip empty tags
            tag = tag.strip()
            if not tag:
                continue
            # Skip tags that contain prompt injection keywords
            if _contains_injection_keywords(tag):
                continue
            sanitized.append(tag)
        return sanitized


class TravelerClassificationResponse(BaseModel):
    """Response with traveler classification results."""

    traveler_type: str = Field(
        ..., description="2-4 word traveler type label, Title Case"
    )
    signature_country: str = Field(
        ..., description="Country code representing their travel identity"
    )
    confidence: float = Field(..., ge=0, le=1, description="Classification confidence")
    rationale_short: str = Field(
        ..., max_length=100, description="Brief explanation of classification"
    )
