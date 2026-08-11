"""Pydantic schemas for the travel photo quiz.

U2: the draft-creation response and the vision eligibility request/response.
Caps mirror ``app/schemas/photos.py`` (same 768px JPEG base64 convention,
<=50 images per request, 200k chars per image). Unlike the photos endpoint --
where vision payloads are optional garnish and get truncated -- the images
here ARE the request, so oversized requests are REJECTED with a validation
error rather than silently trimmed.

U3: the authenticated lifecycle -- signed uploads, finalize, owner play
(sanitized question payloads with NO ground truth), grading, share, revoke.
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


# ============================================================================
# U3: creation (uploads + finalize)
# ============================================================================


class QuizUploadUrlRequest(BaseModel):
    """How many quiz-owned upload slots to mint (one per photo)."""

    count: int = Field(..., ge=1, le=10)


class QuizUploadTarget(BaseModel):
    """One signed upload slot at a user-anonymous quiz/{quiz_id}/{random} path.

    Upload with PUT to `upload_url`, sending `cache_control` as the storage
    cacheControl (i.e. a `cache-control: max-age=<value>` header).
    """

    storage_path: str
    upload_url: str
    cache_control: str


class QuizUploadUrlResponse(BaseModel):
    uploads: list[QuizUploadTarget]


class QuizFinalizePhoto(BaseModel):
    """One uploaded quiz photo with its client-resolved ground truth."""

    storage_path: str = Field(..., min_length=1, max_length=512)
    country_code: str = Field(..., min_length=2, max_length=2)
    capture_year: int | None = Field(None, ge=1900, le=2100)

    @field_validator("country_code")
    @classmethod
    def normalize_country_code(cls, v: str) -> str:
        v = v.strip().upper()
        if not v.isalpha():
            raise ValueError("country_code must be a two-letter ISO code")
        return v


class QuizFinalizeRequest(BaseModel):
    """Finalize a draft into questions. The 5-10 photo bound is enforced in
    the endpoint so out-of-range counts return a guidance-shaped error."""

    photos: list[QuizFinalizePhoto] = Field(..., min_length=1, max_length=50)


class QuizSwapRequest(QuizFinalizePhoto):
    """Pre-share replacement photo for an existing question."""


# ============================================================================
# U3: play payloads (NO ground truth) and grading
# ============================================================================


class QuizQuestionPayload(BaseModel):
    """A question as served to any player.

    Deliberately excludes correct_index, capture_year, and the storage path's
    answer-bearing metadata -- ground truth is revealed only by grading.
    """

    id: UUID
    position: int
    image_url: str
    options: list[str]
    year_options: list[int] | None = None


class ScoreToBeat(BaseModel):
    """The owner's place-question result, captured together as a pair."""

    correct: int
    total: int


class QuizDetailResponse(BaseModel):
    """Owner-facing quiz detail (sanitized questions, lifecycle state)."""

    id: UUID
    state: str
    questions: list[QuizQuestionPayload]
    score_to_beat: ScoreToBeat | None = None
    slug: str | None = None
    share_url: str | None = None


class QuizPlayResponse(BaseModel):
    """A freshly started owner play session."""

    session_id: UUID
    token: str
    questions: list[QuizQuestionPayload]


class QuizAnswerRequest(BaseModel):
    session_id: UUID
    question_id: UUID
    selected_option_index: int = Field(..., ge=0, le=3)
    selected_year: int | None = Field(None, ge=1800, le=2100)


class QuizAnswerResponse(BaseModel):
    """The server's verdict, revealing the ground truth for this question."""

    place_correct: bool
    year_correct: bool | None = None
    correct_option_index: int
    correct_option: str
    correct_year: int | None = None
    score: int


class QuizCompleteRequest(BaseModel):
    session_id: UUID


class QuizCompleteResponse(BaseModel):
    """Owner results. The memory (year) score lives ONLY here -- it is never
    stored on the quiz row nor served on any public-facing field."""

    correct: int
    total: int
    memory_correct: int
    memory_total: int
    score_to_beat: ScoreToBeat
    state: str


# ============================================================================
# U3: share / revoke
# ============================================================================


class QuizShareResponse(BaseModel):
    slug: str
    share_url: str
    state: str


class QuizRevokeResponse(BaseModel):
    state: str
    revoked_at: str
