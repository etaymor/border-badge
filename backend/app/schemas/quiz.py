"""Pydantic schemas for the travel photo quiz.

U2 scope: the minimal draft-creation response and the vision eligibility
request/response. Caps mirror ``app/schemas/photos.py`` (same 768px JPEG
base64 convention, <=50 images per request, 200k chars per image). Unlike the
photos endpoint -- where vision payloads are optional garnish and get
truncated -- the images here ARE the request, so oversized requests are
REJECTED with a validation error rather than silently trimmed.
"""

import base64
from typing import Literal
from uuid import UUID

from pydantic import BaseModel, Field, field_validator

# Mirrors MAX_VISION_IMAGES_PER_REQUEST in schemas/photos.py: one vision call
# per image, so this is also the per-request classification-cost envelope.
MAX_QUIZ_ELIGIBILITY_IMAGES = 50
# Mirrors the photos per-image cap (768px JPEG as base64 fits comfortably).
MAX_QUIZ_IMAGE_CHARS = 200_000
# Request-wide payload ceiling (~6MB decoded). Deliberately below
# 50 x 200k so a pathological all-max-size batch is rejected.
MAX_QUIZ_ELIGIBILITY_PAYLOAD_CHARS = 8_000_000


class QuizDraftResponse(BaseModel):
    """A newly created draft quiz (state 'building')."""

    id: UUID
    state: str


class QuizEligibilityImage(BaseModel):
    """One candidate photo: client-side id + base64 JPEG (768px max side)."""

    id: str = Field(..., min_length=1, max_length=256)
    image_base64: str = Field(..., min_length=1)

    @field_validator("image_base64")
    @classmethod
    def validate_image_base64(cls, v: str) -> str:
        # Length check BEFORE decoding to bound memory use on hostile input.
        if len(v) > MAX_QUIZ_IMAGE_CHARS:
            raise ValueError(f"image_base64 must be <= {MAX_QUIZ_IMAGE_CHARS} chars")
        try:
            base64.b64decode(v, validate=True)
        except Exception as e:
            raise ValueError("image_base64 must be valid base64") from e
        return v


class QuizEligibilityRequest(BaseModel):
    """Batch eligibility check, anchored to a draft quiz for budgeting."""

    quiz_id: UUID
    images: list[QuizEligibilityImage] = Field(
        ..., min_length=1, max_length=MAX_QUIZ_ELIGIBILITY_IMAGES
    )

    @field_validator("images")
    @classmethod
    def validate_total_payload(
        cls, v: list[QuizEligibilityImage]
    ) -> list[QuizEligibilityImage]:
        total_chars = sum(len(img.image_base64) for img in v)
        if total_chars > MAX_QUIZ_ELIGIBILITY_PAYLOAD_CHARS:
            raise ValueError(
                f"Total image payload must be <= "
                f"{MAX_QUIZ_ELIGIBILITY_PAYLOAD_CHARS} chars, got {total_chars}"
            )
        return v


class QuizEligibilityResult(BaseModel):
    """Per-image verdict.

    status:
    - "eligible": passed the R2 gate (no people, outdoor, allowed category).
    - "ineligible": definitive no -- including fail-closed unparseable output.
    - "error": transport failure; retryable, distinct from a real verdict.
    """

    id: str
    eligible: bool
    status: Literal["eligible", "ineligible", "error"]
    reason: str | None = None


class QuizEligibilityResponse(BaseModel):
    """Batch verdicts plus the draft's budget position after this batch."""

    results: list[QuizEligibilityResult]
    classified_count: int
    budget_remaining: int
