"""Travel photo quiz API endpoints.

U2 scope: a minimal authenticated draft-creation anchor (the U3 creation flow
builds on it) and the vision eligibility gate. Later units add the remaining
quiz routes (build, play, share) to this router.

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
from datetime import UTC, datetime

from fastapi import APIRouter, HTTPException, Request, status

from app.core.config import get_settings
from app.core.security import CurrentUser
from app.db.session import get_supabase_client
from app.main import limiter
from app.schemas.quiz import (
    QuizDraftResponse,
    QuizEligibilityRequest,
    QuizEligibilityResponse,
    QuizEligibilityResult,
)
from app.services.photo_vision.quiz_classifier import (
    QuizImageOutcome,
    classify_quiz_images,
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
    defaults. The U3 creation flow builds the full quiz around this anchor.
    """
    db = get_supabase_client()  # service role: quiz tables are backend-only
    rows = await db.post("quiz", {"owner_id": user.id})
    if not rows:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Failed to create quiz draft",
        )
    return QuizDraftResponse(id=rows[0]["id"], state=rows[0]["state"])


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
