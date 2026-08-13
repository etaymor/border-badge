"""Pydantic schemas for the travel photo quiz.

Eligibility: the draft-creation response and the vision eligibility
request/response. Caps mirror ``app/schemas/photos.py`` (same 768px JPEG
base64 convention, <=50 images per request, 200k chars per image). Unlike the
photos endpoint -- where vision payloads are optional garnish and get
truncated -- the images here ARE the request, so oversized requests are
REJECTED with a validation error rather than silently trimmed.

Owner lifecycle: signed uploads, finalize, owner play (sanitized question
payloads with NO ground truth), grading, share, revoke.

Anonymous public play: opaque-token sessions, per-question grading verdicts,
idempotent completion, and the read-time leaderboard. Completion deliberately
accepts NO score field: extras are ignored and the score is always recomputed
server-side from recorded answers.
"""

import base64
import unicodedata
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
    landscape: str | None = None


class QuizEligibilityResponse(BaseModel):
    """Batch verdicts plus the draft's budget position after this batch."""

    results: list[QuizEligibilityResult]
    classified_count: int
    budget_remaining: int


# ============================================================================
# Creation (uploads + finalize)
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


# Mirrors QUIZ_LANDSCAPE_VALUES in quiz_constants (kept here so schemas
# do not import the vision service). Invalid values degrade to None.
_QUIZ_LANDSCAPES = frozenset(
    {
        "coastal",
        "mediterranean",
        "prairie",
        "alpine",
        "desert",
        "tropical",
        "temperate_forest",
        "urban",
        "other",
    }
)


class QuizFinalizePhoto(BaseModel):
    """One uploaded quiz photo with its client-resolved ground truth."""

    storage_path: str = Field(..., min_length=1, max_length=512)
    country_code: str = Field(..., min_length=2, max_length=2)
    capture_year: int | None = Field(None, ge=1900, le=2100)
    landscape: str | None = Field(None, max_length=32)

    @field_validator("country_code")
    @classmethod
    def normalize_country_code(cls, v: str) -> str:
        v = v.strip().upper()
        if not v.isalpha():
            raise ValueError("country_code must be a two-letter ISO code")
        return v

    @field_validator("landscape")
    @classmethod
    def normalize_landscape(cls, v: str | None) -> str | None:
        if v is None:
            return None
        v = v.strip().lower()
        if v not in _QUIZ_LANDSCAPES:
            return None
        return v


class QuizFinalizeRequest(BaseModel):
    """Finalize a draft into questions. The 5-10 photo bound is enforced in
    the endpoint so out-of-range counts return a guidance-shaped error."""

    photos: list[QuizFinalizePhoto] = Field(..., min_length=1, max_length=50)


class QuizSwapRequest(QuizFinalizePhoto):
    """Pre-share replacement photo for an existing question."""


# ============================================================================
# Play payloads (NO ground truth) and grading
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
# Share / revoke
# ============================================================================


class QuizShareResponse(BaseModel):
    slug: str
    share_url: str
    state: str


class QuizRevokeResponse(BaseModel):
    state: str
    revoked_at: str
    # True only once the quiz/{id}/ storage prefix has been verifiably
    # emptied. False = revoked-but-pending; re-calling revoke retries.
    objects_deleted: bool


# ============================================================================
# Anonymous public play (/q/{slug}/* JSON endpoints)
# ============================================================================

# Mirrors the app-wide display-name rule (see
# mobile/src/utils/displayNameValidation.ts and migration 0013): 2-50 chars
# after trimming. Stored raw; escaping happens at render sinks.
DISPLAY_NAME_MIN_LENGTH = 2
DISPLAY_NAME_MAX_LENGTH = 50
# Session tokens are secrets.token_urlsafe(32) (43 chars); the bound just
# keeps hostile payloads from carrying arbitrary-size strings into queries.
MAX_SESSION_TOKEN_LENGTH = 128


class PublicQuizSessionRequest(BaseModel):
    """Start or resume an anonymous play session ({} or {"token": ...})."""

    token: str | None = Field(None, min_length=1, max_length=MAX_SESSION_TOKEN_LENGTH)


class PublicAnsweredQuestion(BaseModel):
    """One already-recorded answer, echoed back on session resume."""

    question_id: str
    selected_option_index: int
    correct: bool
    correct_country: str


class PublicQuizSessionResponse(BaseModel):
    """The session snapshot the game resumes from.

    `score` is populated only for completed sessions; mid-run the client
    derives progress from `answered` and the server recomputes the score
    from recorded answers at every grade.
    """

    token: str
    answered: list[PublicAnsweredQuestion]
    completed: bool
    score: int | None = None


class PublicQuizAnswerRequest(BaseModel):
    token: str = Field(..., min_length=1, max_length=MAX_SESSION_TOKEN_LENGTH)
    question_id: UUID
    selected_option_index: int = Field(..., ge=0, le=3)


class PublicQuizAnswerResponse(BaseModel):
    """The verdict for one public answer -- the ONLY place ground truth for
    that question is revealed to an anonymous player."""

    correct: bool
    correct_country: str
    answered_count: int


class PublicQuizCompleteRequest(BaseModel):
    """Finish a session and post a display name to the leaderboard.

    There is deliberately no score field; a client-sent score is ignored by
    schema (extra fields dropped) and the response score is always recomputed
    server-side from the session's recorded answers.
    """

    token: str = Field(..., min_length=1, max_length=MAX_SESSION_TOKEN_LENGTH)
    # Loose Field bound so the trim-then-check validator owns the real rule
    # (" A " must fail as 1 char, not pass as 3).
    display_name: str = Field(..., max_length=200)

    @field_validator("display_name")
    @classmethod
    def validate_display_name(cls, v: str) -> str:
        v = v.strip()
        if len(v) < DISPLAY_NAME_MIN_LENGTH:
            raise ValueError(
                f"display_name must be at least {DISPLAY_NAME_MIN_LENGTH} " "characters"
            )
        if len(v) > DISPLAY_NAME_MAX_LENGTH:
            raise ValueError(
                f"display_name must be {DISPLAY_NAME_MAX_LENGTH} characters or less"
            )
        # Format/control characters (Cf/Cc, e.g. zero-width spaces) pass the
        # length checks and stay distinct after NFKC/casefold, so blank-looking
        # names could otherwise fill the distinct-name leaderboard cap.
        normalized = unicodedata.normalize("NFKC", v)
        if not any(unicodedata.category(c)[0] in ("L", "N") for c in normalized):
            raise ValueError("display_name must contain at least one letter or number")
        return v


class PublicLeaderboardEntry(BaseModel):
    """One aggregated leaderboard row (per canonicalized name -- AE4)."""

    display_name: str
    best_score: int
    attempts: int


class PublicCompleteLeaderboardEntry(PublicLeaderboardEntry):
    """Leaderboard row in the completion response, flagged for the player."""

    is_you: bool = False


class PublicQuizCompleteResponse(BaseModel):
    """Completion result: server-computed score plus the current board.

    `leaderboard_full` is the board-full indicator: the distinct-name cap was
    reached before this player's name joined, so their score is returned but
    no leaderboard entry was created for them. Not an error.
    """

    score: int
    total: int
    score_to_beat: ScoreToBeat | None = None
    leaderboard: list[PublicCompleteLeaderboardEntry]
    already_completed: bool
    leaderboard_full: bool = False


class PublicQuizLeaderboardResponse(BaseModel):
    score_to_beat: ScoreToBeat | None = None
    leaderboard: list[PublicLeaderboardEntry]


class QuizSessionHideResponse(BaseModel):
    """Owner-side acknowledgement that a session is hidden from the board."""

    session_id: UUID
    hidden: bool


# ============================================================================
# The owner's management surface (list + owner leaderboard)
# ============================================================================


class QuizSummary(BaseModel):
    """One owned quiz in the management list.

    `slug`/`share_url` are served only while the quiz is 'shared' (a revoked
    slug serves nothing publicly). `question_count` stands in for content the
    list never needs to load.
    """

    id: UUID
    state: str
    slug: str | None = None
    share_url: str | None = None
    score_to_beat: ScoreToBeat | None = None
    question_count: int
    created_at: str
    revoked_at: str | None = None


class QuizListResponse(BaseModel):
    quizzes: list[QuizSummary]


class QuizOwnerLeaderboardEntry(PublicLeaderboardEntry):
    """Owner view row (R14): hidden entries stay visible, marked.

    `session_ids` are every session folded into this entry, so the owner can
    hide the lot of them through the per-session hide endpoint.
    """

    hidden: bool = False
    session_ids: list[UUID] = Field(default_factory=list)


class QuizOwnerLeaderboardResponse(BaseModel):
    score_to_beat: ScoreToBeat | None = None
    leaderboard: list[QuizOwnerLeaderboardEntry]
