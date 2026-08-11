"""Travel photo quiz API endpoints.

The authenticated owner surface: the draft-creation anchor, the vision
eligibility gate, and the full quiz lifecycle -- signed quiz-owned uploads
(KTD5), finalize with server-generated options (KTD6), server-graded owner
play with one-time score-to-beat seeding, pre-share swap/remove, share-time
slug minting (KTD8), revoke, and draft deletion. Lifecycle transitions (KTD7)
are all conditional writes against the expected prior state: zero rows updated
means a concurrent transition won, surfaced as 409. The public anonymous play
surface lives in app/api/public_quiz.py; it reuses
`app.services.quiz_grading.grade_answer` (KTD4).

The quiz tables are backend-only (RLS enabled with no user policies), so every
route uses the service-role Supabase client and enforces ownership explicitly
in query filters -- never rely on RLS here.

Cost control (KTD3): eligibility classification is a free, shareable surface,
so spend is bounded server-side twice:
- Per draft: quiz.classified_count accumulates every image sent to the vision
  model for that draft; batches that would exceed the budget are rejected
  BEFORE any model call. The count is reserved with an optimistic-concurrency
  PATCH so concurrent workers cannot double-spend a budget slice.
- Globally: a daily circuit breaker derived from DB state (sum of
  classified_count over quizzes created today), so it holds across workers
  and restarts. Tripping it returns a service-limit error, never "ineligible".
"""

import logging
import random
import re
import secrets
import uuid as uuid_mod
from dataclasses import asdict
from datetime import UTC, datetime
from typing import Any
from uuid import UUID

from fastapi import APIRouter, HTTPException, Request, status

from app.core.config import get_settings
from app.core.media import build_media_url
from app.core.security import CurrentUser
from app.db.session import SupabaseClient, get_http_client, get_supabase_client
from app.main import limiter
from app.schemas.quiz import (
    QuizAnswerRequest,
    QuizAnswerResponse,
    QuizCompleteRequest,
    QuizCompleteResponse,
    QuizDetailResponse,
    QuizDraftResponse,
    QuizEligibilityRequest,
    QuizEligibilityResponse,
    QuizEligibilityResult,
    QuizFinalizePhoto,
    QuizFinalizeRequest,
    QuizListResponse,
    QuizOwnerLeaderboardEntry,
    QuizOwnerLeaderboardResponse,
    QuizPlayResponse,
    QuizQuestionPayload,
    QuizRevokeResponse,
    QuizSessionHideResponse,
    QuizShareResponse,
    QuizSummary,
    QuizSwapRequest,
    QuizUploadTarget,
    QuizUploadUrlRequest,
    QuizUploadUrlResponse,
    ScoreToBeat,
)
from app.services.photo_vision.quiz_classifier import (
    QuizImageOutcome,
    classify_quiz_images,
)
from app.services.quiz_grading import grade_answer
from app.services.quiz_leaderboard import (
    OWNER_SESSION_TOKEN_PREFIX,
    aggregate_leaderboard,
    completed_public_sessions,
)
from app.services.quiz_storage import (
    QuizStorageDeletionError,
    delete_quiz_storage_objects,
)

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/quiz", tags=["quiz"])


@router.post("", response_model=QuizDraftResponse, status_code=status.HTTP_201_CREATED)
# Creation-scale limit: each draft anchors its own ~70-image classification
# budget, so the number of drafts a user can open per hour is the outermost
# lever on vision spend. 10/hour covers honest retries while keeping one
# account's worst-case daily exposure trivially small.
@limiter.limit("10/hour")
async def create_quiz_draft(
    request: Request,  # Required for rate limiter
    user: CurrentUser,
) -> QuizDraftResponse:
    """Create an empty draft quiz in state 'building' owned by the caller.

    Deliberately minimal: state and classified_count come from column
    defaults. The creation flow builds the full quiz around this anchor.
    """
    db = get_supabase_client()  # service role: quiz tables are backend-only
    rows = await db.post("quiz", {"owner_id": user.id})
    if not rows:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Failed to create quiz draft",
        )
    return QuizDraftResponse(id=rows[0]["id"], state=rows[0]["state"])


@router.get("", response_model=QuizListResponse)
async def list_quizzes(user: CurrentUser) -> QuizListResponse:
    """Every quiz the caller owns, newest first.

    The management-surface list: lifecycle state, question count, the seeded
    score-to-beat pair, and the share link while (and only while) the quiz is
    'shared'. Quizzes are fully independent of one another (R17). Sorted here
    rather than via PostgREST so ordering never depends on the client wrapper.
    """
    db = get_supabase_client()  # service role: quiz tables are backend-only
    rows = await db.get("quiz", {"owner_id": f"eq.{user.id}"})
    rows.sort(key=lambda r: str(r.get("created_at") or ""), reverse=True)

    counts: dict[str, int] = {}
    if rows:
        ids = ",".join(str(r["id"]) for r in rows)
        questions = await db.get(
            "quiz_question", {"quiz_id": f"in.({ids})", "select": "id,quiz_id"}
        )
        for q in questions:
            counts[str(q["quiz_id"])] = counts.get(str(q["quiz_id"]), 0) + 1

    summaries: list[QuizSummary] = []
    for r in rows:
        score_to_beat = None
        if r.get("score_to_beat_correct") is not None:
            score_to_beat = ScoreToBeat(
                correct=r["score_to_beat_correct"], total=r["score_to_beat_total"]
            )
        slug = r.get("slug") if r.get("state") == "shared" else None
        summaries.append(
            QuizSummary(
                id=r["id"],
                state=r["state"],
                slug=slug,
                share_url=_share_url(slug) if slug else None,
                score_to_beat=score_to_beat,
                question_count=counts.get(str(r["id"]), 0),
                created_at=str(r["created_at"]),
                revoked_at=r.get("revoked_at"),
            )
        )
    return QuizListResponse(quizzes=summaries)


@router.post("/eligibility", response_model=QuizEligibilityResponse)
# Cost logic for this limit: each image is one vision call (~$0.00008 at
# 768px, same envelope as /photos/suggest-places). A full draft can spend at
# most the ~70-image budget, delivered in <=50-image batches, so an honest
# creation needs only 2-3 requests -- 30/hour leaves generous room for
# batching plus resampling after ineligible photos, while the per-draft budget
# and the global daily circuit breaker (both enforced below, server-side)
# bound the actual spend regardless of request count.
@limiter.limit("30/hour")
async def check_photo_eligibility(
    request: Request,  # Required for rate limiter
    data: QuizEligibilityRequest,
    user: CurrentUser,
) -> QuizEligibilityResponse:
    """Classify candidate photos for quiz eligibility (R2).

    Eligible = no people/faces AND outdoor AND category in
    scenery/landmark/building-exterior. Unparseable model output fails closed
    to "ineligible"; transport failures surface as retryable "error" outcomes.

    Every image in an accepted batch counts against the draft's budget
    (reserved up front, before classification), including images whose
    classification later fails -- attempts are what cost money.
    """
    settings = get_settings()

    if not settings.openrouter_api_key:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Photo eligibility service is not configured.",
        )

    db = get_supabase_client()  # service role: quiz tables are backend-only
    batch_size = len(data.images)

    # 1. The draft must exist, belong to the caller, and still be building.
    rows = await db.get(
        "quiz",
        {
            "id": f"eq.{data.quiz_id}",
            "owner_id": f"eq.{user.id}",
            "state": "eq.building",
            "select": "id,state,classified_count",
        },
    )
    if not rows:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Quiz draft not found",
        )
    classified_count = int(rows[0].get("classified_count") or 0)

    # 2. Per-draft budget: reject past-budget batches before any model call.
    budget = settings.quiz_classification_budget_per_quiz
    if classified_count + batch_size > budget:
        raise HTTPException(
            status_code=status.HTTP_429_TOO_MANY_REQUESTS,
            detail={
                "code": "QUIZ_CLASSIFICATION_BUDGET_EXCEEDED",
                "message": (
                    "This quiz has used its photo-check budget. "
                    "Continue with the photos already checked."
                ),
                "limit": budget,
                "classified_count": classified_count,
            },
        )

    # 3. Global daily circuit breaker, derived from DB state so it holds
    # across workers. "Quizzes created today" slightly undercounts drafts
    # that span midnight UTC -- acceptable for a coarse spend breaker.
    today = datetime.now(UTC).date().isoformat()
    day_rows = await db.get(
        "quiz",
        {"created_at": f"gte.{today}", "select": "classified_count"},
    )
    daily_total = sum(int(r.get("classified_count") or 0) for r in day_rows)
    if daily_total + batch_size > settings.quiz_classification_daily_cap:
        logger.warning(
            "Quiz classification daily cap reached: %d + %d > %d",
            daily_total,
            batch_size,
            settings.quiz_classification_daily_cap,
        )
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail=(
                "Photo checks are temporarily unavailable due to high demand. "
                "Please try again tomorrow."
            ),
            headers={"Retry-After": "3600"},
        )

    # 4. Reserve the budget BEFORE classifying. The classified_count filter is
    # an optimistic lock: if another worker reserved concurrently, zero rows
    # match and the client simply retries.
    updated = await db.patch(
        "quiz",
        {"classified_count": classified_count + batch_size},
        {
            "id": f"eq.{data.quiz_id}",
            "classified_count": f"eq.{classified_count}",
        },
    )
    if not updated:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Another eligibility check is in progress. Please retry.",
        )

    # 5. Classify (bounded by the shared vision concurrency semaphore).
    outcomes = await classify_quiz_images([img.image_base64 for img in data.images])

    # Defensive fail-closed padding: a missing per-image outcome must never
    # read as eligible.
    while len(outcomes) < batch_size:
        outcomes.append(QuizImageOutcome(result=None, retryable=False))

    results: list[QuizEligibilityResult] = []
    for image, outcome in zip(data.images, outcomes, strict=False):
        if outcome.retryable:
            results.append(
                QuizEligibilityResult(
                    id=image.id,
                    eligible=False,
                    status="error",
                    reason="classification_unavailable",
                )
            )
        elif outcome.result is None:
            # Fail-closed: model output unusable => ineligible.
            results.append(
                QuizEligibilityResult(
                    id=image.id,
                    eligible=False,
                    status="ineligible",
                    reason="unclassifiable",
                )
            )
        elif outcome.result.eligible:
            results.append(
                QuizEligibilityResult(id=image.id, eligible=True, status="eligible")
            )
        else:
            if outcome.result.has_people:
                reason = "people_present"
            elif outcome.result.setting != "outdoor":
                reason = "indoor"
            else:
                reason = "category_not_allowed"
            results.append(
                QuizEligibilityResult(
                    id=image.id,
                    eligible=False,
                    status="ineligible",
                    reason=reason,
                )
            )

    new_count = classified_count + batch_size
    return QuizEligibilityResponse(
        results=results,
        classified_count=new_count,
        budget_remaining=max(0, budget - new_count),
    )


# ============================================================================
# Lifecycle constants and helpers
# ============================================================================

MIN_QUIZ_PHOTOS = 5
MAX_QUIZ_PHOTOS = 10
# Signed quiz uploads are cached briefly only: the objects are immutable once
# written, but a short cacheControl keeps a revoked quiz's photos from living
# on in shared caches (KTD5).
QUIZ_UPLOAD_CACHE_CONTROL_SECONDS = "60"
# OWNER_SESSION_TOKEN_PREFIX lives in app/services/quiz_leaderboard.py (shared
# with the aggregation); imported above and re-exported here for callers.
# States in which the owner may still edit questions (swap/remove).
PRE_SHARE_EDITABLE_STATES = ("awaiting_owner_play", "playable")
_SLUG_MINT_ATTEMPTS = 5
# Object names under quiz/{quiz_id}/ are server-minted (uuid hex + extension);
# accept exactly that shape and nothing traversal-capable.
_STORAGE_OBJECT_NAME_RE = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$")


def _now_iso() -> str:
    return datetime.now(UTC).isoformat()


def _mint_slug() -> str:
    """Opaque share slug (KTD8). Isolated for testability of collision retry."""
    return secrets.token_hex(16)


def _share_url(slug: str) -> str:
    return f"{get_settings().base_url}/q/{slug}"


def _photo_count_error(provided: int) -> HTTPException:
    """Guidance-shaped rejection for out-of-bounds photo counts (AE2)."""
    return HTTPException(
        status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
        detail={
            "code": "QUIZ_PHOTO_COUNT_OUT_OF_RANGE",
            "message": (
                f"A quiz needs between {MIN_QUIZ_PHOTOS} and {MAX_QUIZ_PHOTOS} "
                f"photos; you have {provided}."
            ),
            "min": MIN_QUIZ_PHOTOS,
            "max": MAX_QUIZ_PHOTOS,
            "provided": provided,
        },
    )


async def _get_owned_quiz(
    db: SupabaseClient, quiz_id: UUID, user_id: str
) -> dict[str, Any]:
    """Fetch the quiz iff the caller owns it; 404 otherwise (no existence leak)."""
    rows = await db.get("quiz", {"id": f"eq.{quiz_id}", "owner_id": f"eq.{user_id}"})
    if not rows:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Quiz not found"
        )
    return rows[0]


def _validate_storage_path(path: str, quiz_id: UUID) -> None:
    """Reject storage paths outside this draft's own quiz/{quiz_id}/ prefix."""
    prefix = f"quiz/{quiz_id}/"
    object_name = path[len(prefix) :] if path.startswith(prefix) else ""
    if not object_name or not _STORAGE_OBJECT_NAME_RE.match(object_name):
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail={
                "code": "QUIZ_INVALID_STORAGE_PATH",
                "message": (
                    "Each photo must be an object uploaded for this quiz "
                    f"(under {prefix})."
                ),
            },
        )


def _validate_capture_year(photo: QuizFinalizePhoto) -> None:
    if photo.capture_year is None:
        return
    current_year = datetime.now(UTC).year
    if not 1900 <= photo.capture_year <= current_year:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail={
                "code": "QUIZ_INVALID_CAPTURE_YEAR",
                "message": f"capture_year must be between 1900 and {current_year}.",
            },
        )


async def _validate_countries(
    db: SupabaseClient, codes: list[str]
) -> dict[str, dict[str, Any]]:
    """Resolve ISO codes against the country reference table; 422 on unknowns."""
    unique = sorted(set(codes))
    rows = await db.get(
        "country",
        {"code": f"in.({','.join(unique)})", "select": "code,name,region"},
    )
    found = {r["code"]: r for r in rows}
    missing = [c for c in unique if c not in found]
    if missing:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail={
                "code": "QUIZ_UNKNOWN_COUNTRY",
                "message": "Unknown country code(s).",
                "unknown_codes": missing,
            },
        )
    return found


async def _build_place_options(
    db: SupabaseClient,
    corrects: list[dict[str, Any]],
    extra_excluded: set[str] | None = None,
) -> list[tuple[list[str], int]]:
    """Generate per-question options (KTD6): the correct country plus three
    decoys drawn from its region's neighbors in the country table, widening to
    the full table when the region is thin. Decoys never duplicate any correct
    answer in the quiz (dedup within the quiz). Options are shuffled ONCE here
    and stored ordered with a server-only correct index.
    """
    excluded = {c["name"] for c in corrects} | set(extra_excluded or ())
    region_pools: dict[str, list[str]] = {}
    for region in {c["region"] for c in corrects}:
        rows = await db.get(
            "country", {"region": f"eq.{region}", "select": "code,name,region"}
        )
        region_pools[region] = [r["name"] for r in rows]

    wider_pool: list[str] | None = None
    results: list[tuple[list[str], int]] = []
    for correct in corrects:
        candidates = [n for n in region_pools[correct["region"]] if n not in excluded]
        if len(candidates) < 3:
            if wider_pool is None:
                rows = await db.get("country", {"select": "code,name"})
                wider_pool = [r["name"] for r in rows]
            seen = set(candidates)
            for name in wider_pool:
                if name not in excluded and name not in seen:
                    candidates.append(name)
                    seen.add(name)
        if len(candidates) < 3:
            raise HTTPException(
                status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
                detail="Not enough countries available to build quiz options",
            )
        decoys = random.sample(candidates, 3)
        options = [correct["name"], *decoys]
        random.shuffle(options)
        results.append((options, options.index(correct["name"])))
    return results


def _year_options(capture_year: int) -> list[int]:
    """Four consecutive years bracketing the capture year (KTD6), positioned
    randomly within the window and never extending past the current year."""
    current_year = datetime.now(UTC).year
    start = capture_year - random.randint(0, 3)
    start = min(start, current_year - 3)
    return list(range(start, start + 4))


def _build_question_row(
    quiz_id: UUID,
    position: int,
    photo: QuizFinalizePhoto,
    options: list[str],
    correct_index: int,
) -> dict[str, Any]:
    return {
        "quiz_id": str(quiz_id),
        "position": position,
        "storage_path": photo.storage_path,
        "options": options,
        "correct_index": correct_index,
        "capture_year": photo.capture_year,
        "year_options": (
            _year_options(photo.capture_year)
            if photo.capture_year is not None
            else None
        ),
    }


def _sanitize_question(q: dict[str, Any]) -> QuizQuestionPayload:
    """Strip ALL ground truth: no correct_index, no capture_year."""
    return QuizQuestionPayload(
        id=q["id"],
        position=q["position"],
        image_url=build_media_url(q["storage_path"]),
        options=list(q["options"]),
        year_options=q.get("year_options"),
    )


async def _get_questions(db: SupabaseClient, quiz_id: UUID) -> list[dict[str, Any]]:
    rows = await db.get("quiz_question", {"quiz_id": f"eq.{quiz_id}"})
    return sorted(rows, key=lambda r: r["position"])


def _detail_response(
    quiz: dict[str, Any], questions: list[dict[str, Any]]
) -> QuizDetailResponse:
    score_to_beat = None
    if quiz.get("score_to_beat_correct") is not None:
        score_to_beat = ScoreToBeat(
            correct=quiz["score_to_beat_correct"], total=quiz["score_to_beat_total"]
        )
    slug = quiz.get("slug") if quiz.get("state") == "shared" else None
    return QuizDetailResponse(
        id=quiz["id"],
        state=quiz["state"],
        questions=[_sanitize_question(q) for q in questions],
        score_to_beat=score_to_beat,
        slug=slug,
        share_url=_share_url(slug) if slug else None,
    )


async def _get_owner_session(
    db: SupabaseClient, quiz_id: UUID, session_id: UUID
) -> dict[str, Any]:
    rows = await db.get(
        "quiz_session", {"id": f"eq.{session_id}", "quiz_id": f"eq.{quiz_id}"}
    )
    if not rows or not str(rows[0].get("token", "")).startswith(
        OWNER_SESSION_TOKEN_PREFIX
    ):
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Play session not found"
        )
    return rows[0]


async def _seeding_session(db: SupabaseClient, quiz_id: UUID) -> dict[str, Any] | None:
    """The owner's FIRST completed session -- the one whose result seeded (or
    will keep) the score-to-beat. Replays never become the seeding session."""
    rows = await db.get(
        "quiz_session",
        {"quiz_id": f"eq.{quiz_id}", "completed_at": "not.is.null"},
    )
    owner_rows = [
        r
        for r in rows
        if str(r.get("token", "")).startswith(OWNER_SESSION_TOKEN_PREFIX)
    ]
    if not owner_rows:
        return None
    return min(owner_rows, key=lambda r: str(r.get("created_at") or ""))


async def _recompute_score_to_beat_if_seeded(
    db: SupabaseClient, quiz_id: UUID, owner_id: str
) -> None:
    """Keep the seeded (correct, total) pair coherent with pre-share edits.

    Recomputes strictly from the seeding session's answers to the CURRENT
    question set -- replays never feed this, so the score-to-beat remains the
    owner's first play, rescaled to the edited quiz.
    """
    rows = await db.get(
        "quiz",
        {
            "id": f"eq.{quiz_id}",
            "owner_id": f"eq.{owner_id}",
            "select": "id,state,score_to_beat_correct",
        },
    )
    if not rows or rows[0].get("score_to_beat_correct") is None:
        return
    seeding = await _seeding_session(db, quiz_id)
    if seeding is None:
        return
    questions = await _get_questions(db, quiz_id)
    answers = await db.get(
        "quiz_answer",
        {"session_id": f"eq.{seeding['id']}", "select": "question_id,place_correct"},
    )
    question_ids = {str(q["id"]) for q in questions}
    correct = sum(
        1
        for a in answers
        if str(a["question_id"]) in question_ids and a.get("place_correct")
    )
    await db.patch(
        "quiz",
        {
            "score_to_beat_correct": correct,
            "score_to_beat_total": len(questions),
            "updated_at": _now_iso(),
        },
        {"id": f"eq.{quiz_id}", "owner_id": f"eq.{owner_id}"},
    )


async def _null_session_display_names(db: SupabaseClient, quiz_id: UUID) -> None:
    """AE5: revocation removes third-party player identity server-side.

    Display names are the only player-supplied data on a session row; the
    score/attempt counters survive (the funnel needs them). Idempotent --
    the filter matches only rows that still carry a name.
    """
    await db.patch(
        "quiz_session",
        {"display_name": None},
        {"quiz_id": f"eq.{quiz_id}", "display_name": "not.is.null"},
    )


async def _sweep_revoked_quiz_objects(db: SupabaseClient, quiz: dict[str, Any]) -> bool:
    """Phase two of the two-phase revoke (KTD7): physically empty the
    quiz/{id}/ storage prefix, and set objects_deleted_at only after the
    prefix has been re-listed and verified empty.

    Returns True when the objects are verifiably gone. On failure the quiz
    stays revoked-but-pending (revoked_at set, objects_deleted_at null) --
    the loud reconciliation surface, retried on the next owner action
    (an explicit revoke re-call or an owner detail read).
    """
    quiz_id = quiz["id"]
    try:
        await delete_quiz_storage_objects(quiz_id)
    except QuizStorageDeletionError as exc:
        logger.error(
            "Quiz %s revoke: storage sweep failed; objects_deleted_at stays "
            "null for reconciliation retry: %s",
            quiz_id,
            exc,
        )
        return False
    await db.patch(
        "quiz",
        {"objects_deleted_at": _now_iso(), "updated_at": _now_iso()},
        {"id": f"eq.{quiz_id}", "objects_deleted_at": "is.null"},
    )
    return True


# ============================================================================
# Creation -- signed uploads (KTD5) and finalize (KTD6)
# ============================================================================


@router.post("/{quiz_id}/upload-urls", response_model=QuizUploadUrlResponse)
@limiter.limit("60/hour")
async def create_quiz_upload_urls(
    request: Request,  # Required for rate limiter
    quiz_id: UUID,
    data: QuizUploadUrlRequest,
    user: CurrentUser,
) -> QuizUploadUrlResponse:
    """Mint signed upload URLs for quiz-owned storage copies (KTD5).

    Paths are user-anonymous (`quiz/{quiz_id}/{random}` -- no owner UUID
    segment anywhere) in the public media bucket. The URLs are signed with the
    service role because storage RLS knows nothing about quiz ownership; the
    ownership check happens right here instead. No media_files rows are
    created -- these objects belong to the quiz, not the media library.
    """
    settings = get_settings()
    if not settings.supabase_url:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Supabase URL is not configured; quiz uploads are disabled.",
        )

    db = get_supabase_client()  # service role: quiz tables are backend-only
    quiz = await _get_owned_quiz(db, quiz_id, user.id)
    # 'building' covers initial creation; the pre-share editable states cover
    # swap (R5), which uploads a replacement photo after the first play.
    if quiz["state"] != "building" and quiz["state"] not in PRE_SHARE_EDITABLE_STATES:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Photos can only be uploaded before the quiz is shared.",
        )

    client = get_http_client()
    headers = {
        "apikey": settings.supabase_service_role_key,
        "Authorization": f"Bearer {settings.supabase_service_role_key}",
        "Content-Type": "application/json",
    }
    uploads: list[QuizUploadTarget] = []
    for _ in range(data.count):
        path = f"quiz/{quiz_id}/{uuid_mod.uuid4().hex}.jpg"
        response = await client.post(
            f"{settings.supabase_url}/storage/v1/object/upload/sign/media/{path}",
            headers=headers,
            json={},
        )
        signed = response.json().get("url") if response.status_code == 200 else None
        if not signed:
            logger.error(
                "Failed to mint signed quiz upload URL (status %s)",
                response.status_code,
            )
            raise HTTPException(
                status_code=status.HTTP_502_BAD_GATEWAY,
                detail="Failed to mint upload URL. Please try again.",
            )
        if not signed.startswith("/"):
            signed = f"/{signed}"
        uploads.append(
            QuizUploadTarget(
                storage_path=path,
                upload_url=f"{settings.supabase_url}/storage/v1{signed}",
                cache_control=QUIZ_UPLOAD_CACHE_CONTROL_SECONDS,
            )
        )
    return QuizUploadUrlResponse(uploads=uploads)


@router.post("/{quiz_id}/finalize", response_model=QuizDetailResponse)
async def finalize_quiz(
    quiz_id: UUID,
    data: QuizFinalizeRequest,
    user: CurrentUser,
) -> QuizDetailResponse:
    """Turn a draft's uploaded photos into stored questions (KTD6) and move
    building -> awaiting_owner_play (KTD7).

    All validation happens BEFORE the state transition so a rejected finalize
    leaves the draft resumable. The transition is the concurrency claim: a
    conditional write from 'building' -- the loser of a double-finalize gets a
    409 before inserting anything.
    """
    db = get_supabase_client()  # service role: quiz tables are backend-only
    await _get_owned_quiz(db, quiz_id, user.id)

    n = len(data.photos)
    if not MIN_QUIZ_PHOTOS <= n <= MAX_QUIZ_PHOTOS:
        raise _photo_count_error(n)

    paths = [p.storage_path for p in data.photos]
    if len(set(paths)) != n:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail={
                "code": "QUIZ_DUPLICATE_STORAGE_PATH",
                "message": "Each photo must be a distinct uploaded object.",
            },
        )
    for photo in data.photos:
        _validate_storage_path(photo.storage_path, quiz_id)
        _validate_capture_year(photo)

    country_map = await _validate_countries(db, [p.country_code for p in data.photos])
    option_sets = await _build_place_options(
        db, [country_map[p.country_code] for p in data.photos]
    )

    # Claim the draft: conditional write from 'building' (KTD7).
    claimed = await db.patch(
        "quiz",
        {"state": "awaiting_owner_play", "updated_at": _now_iso()},
        {
            "id": f"eq.{quiz_id}",
            "owner_id": f"eq.{user.id}",
            "state": "eq.building",
        },
    )
    if not claimed:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="This quiz has already been finalized.",
        )

    question_rows = [
        _build_question_row(quiz_id, position, photo, options, correct_index)
        for position, (photo, (options, correct_index)) in enumerate(
            zip(data.photos, option_sets, strict=True)
        )
    ]
    inserted = await db.post("quiz_question", question_rows)
    if len(inserted) != n:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Failed to store quiz questions",
        )
    return _detail_response(claimed[0], sorted(inserted, key=lambda r: r["position"]))


# ============================================================================
# Owner-facing detail and play (server-graded, one grading path -- KTD4)
# ============================================================================


@router.get("/{quiz_id}", response_model=QuizDetailResponse)
async def get_quiz(quiz_id: UUID, user: CurrentUser) -> QuizDetailResponse:
    """Owner detail view. Question payloads carry NO ground truth."""
    db = get_supabase_client()  # service role: quiz tables are backend-only
    quiz = await _get_owned_quiz(db, quiz_id, user.id)
    if quiz.get("revoked_at") is not None and quiz.get("objects_deleted_at") is None:
        # Passive reconciliation retry trigger: any owner detail read of a
        # revoked-but-pending quiz re-runs the revocation cleanup sweep.
        await _null_session_display_names(db, quiz_id)
        if await _sweep_revoked_quiz_objects(db, quiz):
            quiz = await _get_owned_quiz(db, quiz_id, user.id)
    questions = await _get_questions(db, quiz_id)
    return _detail_response(quiz, questions)


@router.get("/{quiz_id}/leaderboard", response_model=QuizOwnerLeaderboardResponse)
async def get_owner_quiz_leaderboard(
    quiz_id: UUID, user: CurrentUser
) -> QuizOwnerLeaderboardResponse:
    """The owner's view of their quiz's board (R14).

    Unlike the anonymous GET /q/{slug}/leaderboard, this serves any owned quiz
    regardless of state and INCLUDES hidden sessions: an entry absent from the
    public aggregation is returned with `hidden` true — marked, never removed
    from the owner's sight. Each entry carries its session ids so the owner
    can hide every session behind it. Same ONE aggregation implementation as
    the public surface (app/services/quiz_leaderboard.py).
    """
    db = get_supabase_client()  # service role: quiz tables are backend-only
    quiz = await _get_owned_quiz(db, quiz_id, user.id)

    sessions = await completed_public_sessions(db, quiz_id, include_hidden=True)
    entries = aggregate_leaderboard(sessions)
    # An entry is 'hidden' iff it would not surface on the public board.
    public_keys = {
        e["key"]
        for e in aggregate_leaderboard([s for s in sessions if not s.get("hidden")])
    }

    score_to_beat = None
    if quiz.get("score_to_beat_correct") is not None:
        score_to_beat = ScoreToBeat(
            correct=quiz["score_to_beat_correct"], total=quiz["score_to_beat_total"]
        )
    return QuizOwnerLeaderboardResponse(
        score_to_beat=score_to_beat,
        leaderboard=[
            QuizOwnerLeaderboardEntry(
                display_name=e["display_name"],
                best_score=e["best_score"],
                attempts=e["attempts"],
                hidden=e["key"] not in public_keys,
                session_ids=e["session_ids"],
            )
            for e in entries
        ],
    )


@router.post(
    "/{quiz_id}/play",
    response_model=QuizPlayResponse,
    status_code=status.HTTP_201_CREATED,
)
async def start_owner_play(quiz_id: UUID, user: CurrentUser) -> QuizPlayResponse:
    """Start an owner play session.

    Owner sessions live in the same table anonymous sessions will (one grading
    path, KTD4) but are distinguishable by token prefix and born hidden so
    they never surface on the public leaderboard.
    """
    db = get_supabase_client()  # service role: quiz tables are backend-only
    quiz = await _get_owned_quiz(db, quiz_id, user.id)
    if quiz["state"] not in ("awaiting_owner_play", "playable", "shared"):
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Finish building the quiz before playing it.",
        )
    questions = await _get_questions(db, quiz_id)
    if not questions:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="This quiz has no questions yet.",
        )
    token = f"{OWNER_SESSION_TOKEN_PREFIX}{secrets.token_hex(16)}"
    rows = await db.post(
        "quiz_session",
        {"quiz_id": str(quiz_id), "token": token, "hidden": True},
    )
    if not rows:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Failed to start play session",
        )
    return QuizPlayResponse(
        session_id=rows[0]["id"],
        token=token,
        questions=[_sanitize_question(q) for q in questions],
    )


@router.post("/{quiz_id}/answer", response_model=QuizAnswerResponse)
async def answer_quiz_question(
    quiz_id: UUID,
    data: QuizAnswerRequest,
    user: CurrentUser,
) -> QuizAnswerResponse:
    """Grade one owner answer through the shared grading path (KTD4)."""
    db = get_supabase_client()  # service role: quiz tables are backend-only
    quiz = await _get_owned_quiz(db, quiz_id, user.id)
    session = await _get_owner_session(db, quiz_id, data.session_id)
    questions = await db.get(
        "quiz_question",
        {"id": f"eq.{data.question_id}", "quiz_id": f"eq.{quiz_id}"},
    )
    if not questions:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Question not found"
        )

    graded = await grade_answer(
        db,
        session=session,
        question=questions[0],
        selected_option_index=data.selected_option_index,
        selected_year=data.selected_year,
    )

    # A pre-share swap deletes that question's owner answers; when the owner
    # re-answers, fold the result back into the seeded score-to-beat pair.
    # Strictly seeding-session-derived, so replays never re-seed.
    if (
        quiz.get("score_to_beat_correct") is not None
        and quiz["state"] in PRE_SHARE_EDITABLE_STATES
    ):
        await _recompute_score_to_beat_if_seeded(db, quiz_id, user.id)

    return QuizAnswerResponse(**asdict(graded))


@router.post("/{quiz_id}/complete", response_model=QuizCompleteResponse)
async def complete_owner_play(
    quiz_id: UUID,
    data: QuizCompleteRequest,
    user: CurrentUser,
) -> QuizCompleteResponse:
    """Complete an owner play-through.

    The FIRST completed owner play seeds the score-to-beat pair permanently
    (conditional write on the pair being unset -- replays and double submits
    update zero rows and change nothing). The memory (year) score is returned
    only in this owner results payload; it is never stored on the quiz row.
    """
    db = get_supabase_client()  # service role: quiz tables are backend-only
    await _get_owned_quiz(db, quiz_id, user.id)
    session = await _get_owner_session(db, quiz_id, data.session_id)

    questions = await _get_questions(db, quiz_id)
    answers = await db.get("quiz_answer", {"session_id": f"eq.{session['id']}"})
    by_question = {str(a["question_id"]): a for a in answers}
    missing = [q for q in questions if str(q["id"]) not in by_question]
    if missing:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail={
                "code": "QUIZ_PLAY_INCOMPLETE",
                "message": "Answer every question before finishing.",
                "unanswered": len(missing),
            },
        )

    relevant = [by_question[str(q["id"])] for q in questions]
    correct = sum(1 for a in relevant if a.get("place_correct"))
    total = len(questions)
    year_questions = [q for q in questions if q.get("capture_year") is not None]
    memory_total = len(year_questions)
    memory_correct = sum(
        1 for q in year_questions if by_question[str(q["id"])].get("year_correct")
    )

    # Preserve the first completion time on double submits.
    await db.patch(
        "quiz_session",
        {"completed_at": _now_iso()},
        {"id": f"eq.{session['id']}", "completed_at": "is.null"},
    )

    # Seed score-to-beat exactly once: conditional on the pair being unset.
    await db.patch(
        "quiz",
        {
            "score_to_beat_correct": correct,
            "score_to_beat_total": total,
            "updated_at": _now_iso(),
        },
        {
            "id": f"eq.{quiz_id}",
            "owner_id": f"eq.{user.id}",
            "score_to_beat_correct": "is.null",
        },
    )

    # First completion also unlocks the quiz (KTD7); zero rows when already past.
    await db.patch(
        "quiz",
        {"state": "playable", "updated_at": _now_iso()},
        {
            "id": f"eq.{quiz_id}",
            "owner_id": f"eq.{user.id}",
            "state": "eq.awaiting_owner_play",
        },
    )

    refreshed = await _get_owned_quiz(db, quiz_id, user.id)
    return QuizCompleteResponse(
        correct=correct,
        total=total,
        memory_correct=memory_correct,
        memory_total=memory_total,
        score_to_beat=ScoreToBeat(
            correct=refreshed["score_to_beat_correct"],
            total=refreshed["score_to_beat_total"],
        ),
        state=refreshed["state"],
    )


# ============================================================================
# Pre-share editing -- swap and remove (KTD7)
# ============================================================================


async def _claim_pre_share_edit(
    db: SupabaseClient, quiz_id: UUID, user_id: str
) -> None:
    """Conditional-write guard for question edits: only pre-share states pass.

    The write itself is the lock -- if a concurrent share (or revoke) moved
    the quiz out of an editable state, this updates zero rows and the edit
    loses with a 409 before touching any question.
    """
    guarded = await db.patch(
        "quiz",
        {"updated_at": _now_iso()},
        {
            "id": f"eq.{quiz_id}",
            "owner_id": f"eq.{user_id}",
            "state": f"in.({','.join(PRE_SHARE_EDITABLE_STATES)})",
        },
    )
    if not guarded:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="This quiz can no longer be edited.",
        )


@router.post(
    "/{quiz_id}/questions/{question_id}/swap", response_model=QuizDetailResponse
)
async def swap_quiz_question(
    quiz_id: UUID,
    question_id: UUID,
    data: QuizSwapRequest,
    user: CurrentUser,
) -> QuizDetailResponse:
    """Replace a question's photo pre-share (KTD7).

    Regenerates options for the new country, deletes the question's recorded
    answers, and rescales the seeded pair. The owner must answer the
    replacement (country + year) before sharing -- share asserts the
    owner-answers-to-questions bijection.
    """
    db = get_supabase_client()  # service role: quiz tables are backend-only
    await _get_owned_quiz(db, quiz_id, user.id)
    await _claim_pre_share_edit(db, quiz_id, user.id)

    existing = await db.get(
        "quiz_question",
        {"id": f"eq.{question_id}", "quiz_id": f"eq.{quiz_id}"},
    )
    if not existing:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Question not found"
        )
    _validate_storage_path(data.storage_path, quiz_id)
    _validate_capture_year(data)
    country_map = await _validate_countries(db, [data.country_code])
    correct = country_map[data.country_code]

    # Dedup within the quiz: the new decoys must not collide with the other
    # questions' correct answers.
    others = [
        q for q in await _get_questions(db, quiz_id) if str(q["id"]) != str(question_id)
    ]
    other_correct_names = {q["options"][q["correct_index"]] for q in others}
    options, correct_index = (
        await _build_place_options(db, [correct], extra_excluded=other_correct_names)
    )[0]

    await db.patch(
        "quiz_question",
        {
            "storage_path": data.storage_path,
            "options": options,
            "correct_index": correct_index,
            "capture_year": data.capture_year,
            "year_options": (
                _year_options(data.capture_year)
                if data.capture_year is not None
                else None
            ),
        },
        {"id": f"eq.{question_id}", "quiz_id": f"eq.{quiz_id}"},
    )
    # The old photo's answers are meaningless for the replacement.
    await db.delete("quiz_answer", {"question_id": f"eq.{question_id}"})
    await _recompute_score_to_beat_if_seeded(db, quiz_id, user.id)

    quiz = await _get_owned_quiz(db, quiz_id, user.id)
    return _detail_response(quiz, await _get_questions(db, quiz_id))


@router.delete("/{quiz_id}/questions/{question_id}", response_model=QuizDetailResponse)
async def remove_quiz_question(
    quiz_id: UUID,
    question_id: UUID,
    user: CurrentUser,
) -> QuizDetailResponse:
    """Remove a question pre-share (KTD7); rescales the seeded pair."""
    db = get_supabase_client()  # service role: quiz tables are backend-only
    await _get_owned_quiz(db, quiz_id, user.id)
    await _claim_pre_share_edit(db, quiz_id, user.id)

    questions = await _get_questions(db, quiz_id)
    if not any(str(q["id"]) == str(question_id) for q in questions):
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Question not found"
        )
    if len(questions) - 1 < MIN_QUIZ_PHOTOS:
        raise _photo_count_error(len(questions) - 1)

    await db.delete("quiz_answer", {"question_id": f"eq.{question_id}"})
    await db.delete(
        "quiz_question",
        {"id": f"eq.{question_id}", "quiz_id": f"eq.{quiz_id}"},
    )
    await _recompute_score_to_beat_if_seeded(db, quiz_id, user.id)

    quiz = await _get_owned_quiz(db, quiz_id, user.id)
    return _detail_response(quiz, await _get_questions(db, quiz_id))


# ============================================================================
# Share (KTD8), revoke, and draft deletion
# ============================================================================


@router.post("/{quiz_id}/share", response_model=QuizShareResponse)
async def share_quiz(quiz_id: UUID, user: CurrentUser) -> QuizShareResponse:
    """Mint the opaque share slug and lock the quiz (playable -> shared).

    Idempotent for already-shared quizzes (same slug back). Before minting,
    asserts the owner-answers-to-questions bijection: every current question
    must have a seeding-session answer (a swapped question the owner has not
    re-answered blocks sharing).
    """
    db = get_supabase_client()  # service role: quiz tables are backend-only
    quiz = await _get_owned_quiz(db, quiz_id, user.id)

    if quiz["state"] == "shared" and quiz.get("slug"):
        return QuizShareResponse(
            slug=quiz["slug"], share_url=_share_url(quiz["slug"]), state="shared"
        )
    if quiz["state"] != "playable":
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail={
                "code": "QUIZ_NOT_SHAREABLE",
                "message": "Play your quiz to set a score to beat before sharing.",
            },
        )

    questions = await _get_questions(db, quiz_id)
    seeding = await _seeding_session(db, quiz_id)
    answered_ids: set[str] = set()
    if seeding is not None:
        answers = await db.get(
            "quiz_answer",
            {"session_id": f"eq.{seeding['id']}", "select": "question_id"},
        )
        answered_ids = {str(a["question_id"]) for a in answers}
    if (
        seeding is None
        or not questions
        or any(str(q["id"]) not in answered_ids for q in questions)
    ):
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail={
                "code": "QUIZ_OWNER_ANSWERS_INCOMPLETE",
                "message": (
                    "Answer every question (including swapped photos) "
                    "before sharing."
                ),
            },
        )

    # Mint with bounded retry on slug-uniqueness collisions (KTD8).
    for _ in range(_SLUG_MINT_ATTEMPTS):
        slug = _mint_slug()
        try:
            rows = await db.patch(
                "quiz",
                {"slug": slug, "state": "shared", "updated_at": _now_iso()},
                {
                    "id": f"eq.{quiz_id}",
                    "owner_id": f"eq.{user.id}",
                    "state": "eq.playable",
                },
            )
        except HTTPException as exc:
            if exc.status_code == status.HTTP_409_CONFLICT:
                continue  # slug collision: retry with a fresh slug
            raise
        if rows:
            return QuizShareResponse(
                slug=slug, share_url=_share_url(slug), state="shared"
            )
        # Conditional write lost: a concurrent transition moved the state.
        refreshed = await _get_owned_quiz(db, quiz_id, user.id)
        if refreshed["state"] == "shared" and refreshed.get("slug"):
            return QuizShareResponse(
                slug=refreshed["slug"],
                share_url=_share_url(refreshed["slug"]),
                state="shared",
            )
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="The quiz changed while sharing. Please retry.",
        )
    raise HTTPException(
        status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
        detail="Could not mint a share link. Please try again.",
    )


@router.post(
    "/{quiz_id}/sessions/{session_id}/hide",
    response_model=QuizSessionHideResponse,
)
@limiter.limit("60/hour")
async def hide_quiz_session(
    request: Request,  # Required for rate limiter
    quiz_id: UUID,
    session_id: UUID,
    user: CurrentUser,
) -> QuizSessionHideResponse:
    """Hide a play session from the public leaderboard (owner moderation).

    Owner-only: the ownership check 404s for anyone else, exactly like every
    other quiz route (no existence leak). Hiding is a flag, not a delete --
    the session's answers stay recorded, but the read-time leaderboard
    aggregation never serves a hidden session again.
    """
    db = get_supabase_client()  # service role: quiz tables are backend-only
    await _get_owned_quiz(db, quiz_id, user.id)
    rows = await db.patch(
        "quiz_session",
        {"hidden": True},
        {"id": f"eq.{session_id}", "quiz_id": f"eq.{quiz_id}"},
    )
    if not rows:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Play session not found"
        )
    return QuizSessionHideResponse(session_id=session_id, hidden=True)


@router.post("/{quiz_id}/revoke", response_model=QuizRevokeResponse)
async def revoke_quiz(quiz_id: UUID, user: CurrentUser) -> QuizRevokeResponse:
    """Revoke a shared quiz (R15) -- two-phase (KTD7).

    Phase one is the conditional shared -> revoked write: page, public API,
    and card image are all gated on state the moment it commits. Phase two
    nulls player display names (AE5) and physically empties the quiz/{id}/
    storage prefix, setting objects_deleted_at only after verification. A
    failed sweep leaves the quiz revoked-but-pending (`objects_deleted`
    false in the response); calling revoke again on the already-revoked
    quiz is the explicit reconciliation retry trigger.
    """
    db = get_supabase_client()  # service role: quiz tables are backend-only
    quiz = await _get_owned_quiz(db, quiz_id, user.id)
    rows = await db.patch(
        "quiz",
        {"state": "revoked", "revoked_at": _now_iso(), "updated_at": _now_iso()},
        {
            "id": f"eq.{quiz_id}",
            "owner_id": f"eq.{user.id}",
            "state": "eq.shared",
        },
    )
    if rows:
        quiz = rows[0]
    elif quiz["state"] != "revoked":
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Only a shared quiz can be revoked.",
        )
    # Already-revoked falls through: idempotent retry of the cleanup phase.
    await _null_session_display_names(db, quiz_id)
    objects_deleted = quiz.get(
        "objects_deleted_at"
    ) is not None or await _sweep_revoked_quiz_objects(db, quiz)
    return QuizRevokeResponse(
        state="revoked",
        revoked_at=quiz["revoked_at"],
        objects_deleted=objects_deleted,
    )


@router.delete("/{quiz_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_quiz(quiz_id: UUID, user: CurrentUser) -> None:
    """Delete a quiz that is not currently shared (drafts included).

    A shared quiz must be revoked first -- deletion must never silently take
    a live share link down a different path than revocation. The storage
    prefix is emptied (and verified empty) BEFORE the rows go: a storage
    failure aborts loudly with the quiz row intact as the natural retry
    surface, never leaving silently orphaned objects. DB cascades then
    remove questions, sessions, and answers.
    """
    db = get_supabase_client()  # service role: quiz tables are backend-only
    quiz = await _get_owned_quiz(db, quiz_id, user.id)
    if quiz["state"] == "shared":
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Revoke the share link before deleting this quiz.",
        )
    try:
        await delete_quiz_storage_objects(quiz_id)
    except QuizStorageDeletionError as exc:
        logger.error(
            "Quiz %s delete: storage sweep failed; rows kept for retry: %s",
            quiz_id,
            exc,
        )
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail="Could not remove this quiz's photos. Please try again.",
        ) from exc
    removed = await db.delete(
        "quiz",
        {
            "id": f"eq.{quiz_id}",
            "owner_id": f"eq.{user.id}",
            "state": "neq.shared",
        },
    )
    if not removed:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="The quiz changed while deleting. Please retry.",
        )
