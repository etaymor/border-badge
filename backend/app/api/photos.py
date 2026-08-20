"""Photo import API endpoints.

Provides place suggestions for photo GPS clusters using Google Places Nearby Search.
Optionally uses vision classification (Gemini Flash Lite) to improve accuracy.
"""

import asyncio
import logging

import httpx
from fastapi import APIRouter, HTTPException, Request, status
from limits import RateLimitItem, RateLimitItemPerMinute

from app.api.subscriptions import (
    PhotoImportEntitlement,
    charge_photo_import_usage,
    read_photo_import_entitlement,
)
from app.api.utils import get_token_from_request
from app.core.config import get_settings
from app.core.http_client import get_places_client
from app.core.security import AuthUser, CurrentUser
from app.db.session import get_supabase_client
from app.main import get_rate_limit_key, limiter, register_rate_limit_window
from app.schemas.photos import (
    ClusterSuggestion,
    PlaceSuggestionRequest,
    PlaceSuggestionResponse,
)
from app.services.photo_vision import classify_cluster_photos
from app.services.place_matcher import (
    ConfigurationError,
    PlaceMatcher,
    QuotaExhaustedError,
    RateLimitError,
    SlotUnavailableError,
)
from app.services.place_matcher.instrumentation import record_retry, request_metrics

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/photos", tags=["photos"])

# Vision-enabled endpoint: the limit caps API cost exposure, but it has to clear
# one legitimate import. A big trip is 50-100 clusters and the client chunks them
# 5 at a time, so a single honest import spends 10-20 requests -- at 10/minute it
# rate-limited itself partway through and the remaining clusters surfaced as
# "Couldn't check this location" with retry disabled.
#
# NOTE: this ceiling is on *requests*, and per-request spend is not yet bounded,
# so raising it does raise the ceiling on spend. (A later unit caps per-cluster
# cost; until then, treat this number as a spend lever, not just a traffic one.)
SUGGEST_PLACES_RATE_LIMIT = "40/minute"

# Burst cap alongside the sustained limit (U7). The limiter uses a FIXED
# window, so a caller that fills one window just before it rolls and fills the
# next just after issues ~2x the nominal rate back-to-back -- 80 requests in a
# moment, each of which fans out to Google. This second, short window bounds
# what any instant can cost regardless of where the minute boundary falls.
#
# 5/second sits comfortably above the client's planned concurrency of 3 (so
# honest traffic is never rejected) and far below the sustained 40/minute, so
# it can only fire on a genuine burst.
SUGGEST_PLACES_BURST_LIMIT = "5/second"

# Both limits on one decorator: slowapi parses a ";"-joined spec into separate
# windows, so this stays a single source of truth for the pair.
SUGGEST_PLACES_LIMITS = f"{SUGGEST_PLACES_RATE_LIMIT};{SUGGEST_PLACES_BURST_LIMIT}"

# NOTE: these limits, like the outbound concurrency bound in the place matcher,
# are PER PROCESS. Adding a uvicorn worker or a replica multiplies the accepted
# request rate and the outbound Google fan-out together, so capacity has to be
# reasoned about as one number rather than two independent ones.

# Give this route's 429s a truthful Retry-After. The registered window is the
# SUSTAINED one and acts as the fallback; when the burst cap is what fired, the
# handler prefers the tripped limit's own (1s) window so a momentary burst does
# not tell the client to wait a minute.
register_rate_limit_window(f"{router.prefix}/suggest-places", SUGGEST_PLACES_RATE_LIMIT)

# U16: the limits above count REQUESTS, and a request is not a unit of cost.
# Every cluster in a request fans out to Google, and every attached vision image
# is a separate metered call, so a caller staying inside 40 requests/minute can
# still drive an order of magnitude more paid calls than an honest import by
# filling each request to the per-request ceiling. These two budgets meter the
# actual cost drivers on the SAME limiter storage and strategy as the request
# limits above -- one accounting mechanism, three windows.
#
# Per KTD17 the cost budgets are settings-driven (they are an operational dial,
# tuned against observed spend) while the plain request-rate limit stays a
# module constant.
_COST_BUDGET_SCOPES = {
    "clusters": "photos:suggest-places:clusters",
    "vision_images": "photos:suggest-places:vision-images",
}


def _cost_budget_items() -> dict[str, RateLimitItem]:
    """Per-minute budget windows for this route's two cost drivers."""
    settings = get_settings()
    return {
        "clusters": RateLimitItemPerMinute(
            settings.suggest_places_cluster_budget_per_minute
        ),
        "vision_images": RateLimitItemPerMinute(
            settings.suggest_places_vision_image_budget_per_minute
        ),
    }


def _release_cost_budget(item: RateLimitItem, scope: str, key: str, cost: int) -> None:
    """Give back a budget charge that the request is not going to use.

    `hit` on a fixed window increments FIRST and only then reports whether the
    window had room, so a rejected charge is still recorded. Handing it back
    keeps a rejected request costing the caller nothing -- the same property the
    old test-then-hit pass had, without its race.

    Best effort: only some `limits` storages expose `decr`. Leaving a charge in
    place over-counts, which errs toward rejecting traffic rather than serving
    it for free.
    """
    decr = getattr(limiter.limiter.storage, "decr", None)
    if decr is None:  # pragma: no cover - depends on the configured storage
        return
    try:
        decr(item.key_for(scope, key), cost)
    except Exception:  # pragma: no cover - never fail a request on bookkeeping
        logger.debug("Could not release a photo import cost budget charge")


def _consume_cost_budget(
    request: Request, cluster_count: int, vision_image_count: int
) -> None:
    """Charge this request's real cost against the caller's rolling budgets.

    Each driver is charged with the limiter's ATOMIC `hit`, and every charge
    made for a request that ends up rejected is handed back. A separate `test`
    pass followed by a `hit` pass left a window in which concurrent requests all
    saw room and all charged, overshooting the budget by up to (concurrent
    requests x per-request cost) -- five simultaneous 25-cluster requests could
    serve ~125 clusters past a nearly-full budget.

    Raises:
        HTTPException: 429 when either budget is exhausted. This is a traffic
            rejection like the request-rate 429 beside it, so it carries a
            truthful `Retry-After` of that budget's window. (Entitlement
            rejections are a different condition and carry no header at all --
            see `_enforce_photo_import_entitlement`.)
    """
    if not limiter.enabled:
        return

    key = get_rate_limit_key(request)
    items = _cost_budget_items()
    charges = [
        (driver, items[driver], _COST_BUDGET_SCOPES[driver], cost)
        for driver, cost in (
            ("clusters", cluster_count),
            ("vision_images", vision_image_count),
        )
        if cost > 0
    ]

    charged: list[tuple[RateLimitItem, str, int]] = []
    for driver, item, scope, cost in charges:
        if limiter.limiter.hit(item, scope, key, cost=cost):
            charged.append((item, scope, cost))
            continue

        # Rejected: unwind this charge and any earlier driver's, so a request
        # turned away on its vision images has not burned its cluster budget.
        _release_cost_budget(item, scope, key, cost)
        for done_item, done_scope, done_cost in charged:
            _release_cost_budget(done_item, done_scope, key, done_cost)

        record_retry(f"cost_budget_{driver}")
        # R27: aggregate counts only -- no cluster ids, coordinates, or
        # place ids in an always-on log line.
        logger.warning(
            "Photo import cost budget exhausted for user key %s: "
            "driver=%s requested=%d budget=%s",
            key,
            driver,
            cost,
            item.amount,
        )
        raise HTTPException(
            status_code=status.HTTP_429_TOO_MANY_REQUESTS,
            detail=(
                "Photo import cost budget exceeded. Please wait a moment and try again."
            ),
            headers={"Retry-After": str(item.get_expiry())},
        )


async def _caller_owns_trip(db: object, user_id: str, trip_id: str) -> bool:
    """Whether `trip_id` is a live trip belonging to `user_id`.

    The client supplies `trip_id`, and it is the key to the R17 exemption, so it
    has to be tied to the caller before it can grant anything. Matches the
    ownership predicate the increment RPC applies, so the endpoint and the
    database agree on what "your trip" means.
    """
    rows = await db.get(  # type: ignore[attr-defined]
        "trip",
        params={
            "select": "id",
            "id": f"eq.{trip_id}",
            "user_id": f"eq.{user_id}",
            "deleted_at": "is.null",
        },
    )
    return bool(rows)


async def _enforce_photo_import_entitlement(
    request: Request, data: PlaceSuggestionRequest, user: AuthUser
) -> PhotoImportEntitlement:
    """Reject a caller with no right to run this import, before any paid call.

    KTD23: server-side enforcement is authoritative and the device marker is a
    fast path. This endpoint fronts two metered paid APIs, so the check runs
    ahead of both vision classification and place matching.

    Returns:
        The entitlement that was read, so the charge after a successful match
        does not pay for a second profile read.

    Raises:
        HTTPException: 402 when the caller has consumed their free import and
            this is not the trip that consumed it (or that trip's cluster
            allowance is spent); 403 when a non-premium caller claims a trip
            that is not theirs; 503 (header-less, i.e. transient by the
            client's quota-vs-transient rule) when the entitlement itself could
            not be read.
    """
    token = get_token_from_request(request)
    db = get_supabase_client(user_token=token)
    trip_id = str(data.trip_id) if data.trip_id else None

    try:
        entitlement = await read_photo_import_entitlement(db, str(user.id))
    except Exception as e:
        logger.warning(
            "Photo import entitlement lookup failed for user %s: %s", user.id, e
        )
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Unable to verify photo import access. Please try again.",
        ) from e

    # Ownership matters only where the trip id can buy something: it is the
    # exemption key and the thing the charge records. Premium callers have no
    # entitlement to launder, and a degraded read cannot use the trip at all.
    if not entitlement.is_premium and not entitlement.columns_degraded and trip_id:
        try:
            owns_trip = await _caller_owns_trip(db, str(user.id), trip_id)
        except Exception as e:
            logger.warning(
                "Photo import trip ownership lookup failed for user %s: %s",
                user.id,
                e,
            )
            raise HTTPException(
                status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
                detail="Unable to verify photo import access. Please try again.",
            ) from e

        if not owns_trip:
            record_retry("entitlement_trip_not_owned")
            # R27: no trip id on an always-on log line.
            logger.warning(
                "Photo import requested for a trip user %s does not own", user.id
            )
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail={
                    "code": "PHOTO_IMPORT_TRIP_NOT_FOUND",
                    "message": "Trip not found.",
                },
            )

    if entitlement.allows(trip_id):
        return entitlement

    record_retry("entitlement_denied")
    logger.info("Photo import entitlement exhausted for user %s", user.id)
    # 402, deliberately NOT a 503 with `Retry-After`: waiting changes nothing
    # here, and the client reads a 503 carrying that header as an upstream
    # quota wall. This is an upgrade prompt, not a retry hint.
    raise HTTPException(
        status_code=status.HTTP_402_PAYMENT_REQUIRED,
        detail={
            "code": "PHOTO_IMPORT_LIMIT_REACHED",
            "message": (
                f"Free tier includes {entitlement.limit} photo import. "
                "Upgrade to premium for unlimited photo imports."
            ),
            "limit": entitlement.limit,
            "current_count": entitlement.photo_import_count,
            "consumed_trip_id": entitlement.consumed_trip_id,
        },
    )


async def _charge_photo_import(
    data: PlaceSuggestionRequest,
    user: AuthUser,
    entitlement: PhotoImportEntitlement,
    processed_cluster_count: int,
) -> None:
    """Charge the caller for the matching this request just performed (F1).

    The gate above enforces a counter, and until now that counter was written
    exclusively by the mobile client volunteering a call to
    `POST /subscriptions/usage/increment`. Blocking that one request -- a proxy
    rule, a firewall, a patched client -- left the count at 0 forever, so the
    "authoritative" server-side check was authoritative over a number the client
    controlled. The charge now happens here, with the service role, on the same
    request that spent the money.

    Charged only when work was actually performed and only for a non-premium
    caller. A request in which every cluster failed is not charged: the user
    should not lose their one free import to an outage, and replaying failures
    is already bounded by the per-minute cost budgets.

    `processed_cluster_count` is both the gate AND the amount, on BOTH charge
    paths -- the first charge (which grants the allowance) and the draw-down a
    later request on the recorded trip makes. Charging every SUBMITTED cluster
    billed the same failure twice: once when it failed, again when the client
    retried it, so a trip with repeated partial failures could exhaust the R17
    allowance and 402 the user out of the trip they already paid for.

    Never raises: the paid calls have already been made and the results are
    valid, so a bookkeeping failure is logged rather than turned into a 5xx.
    """
    if entitlement.is_premium or entitlement.columns_degraded:
        return
    if processed_cluster_count <= 0:
        logger.info(
            "Photo import not charged for user %s: no cluster was processed",
            user.id,
        )
        return

    trip_id = str(data.trip_id) if data.trip_id else None
    # Service role on purpose: the charge must not depend on the caller's token
    # or on the caller choosing to report anything.
    db = get_supabase_client(user_token=None)
    try:
        await charge_photo_import_usage(
            db, str(user.id), trip_id, processed_cluster_count
        )
    except Exception as e:
        logger.error("Photo import charge failed for user %s: %s", user.id, e)


@router.post("/suggest-places", response_model=PlaceSuggestionResponse)
@limiter.limit(SUGGEST_PLACES_LIMITS)
async def suggest_places(
    request: Request,  # Required for rate limiter
    data: PlaceSuggestionRequest,
    user: CurrentUser,
) -> PlaceSuggestionResponse:
    """
    Receive photo clusters, return place suggestions ranked by distance.

    Users see "15m away" and decide Yes/No - no confidence percentages.

    When vision image payloads are provided per cluster (up to 3 representative
    images), runs vision classification in parallel with place matching to
    improve accuracy.

    Rate limited per user (see SUGGEST_PLACES_LIMITS) to control vision API
    costs: a sustained per-minute limit plus a per-second burst cap, and (U16)
    rolling per-minute budgets on the actual cost drivers -- clusters and
    vision images. Free-tier entitlement is enforced here, before any paid call.
    """
    logger.info(
        f"Processing {len(data.clusters)} clusters for user {user.id}",
        extra={"cluster_count": len(data.clusters), "user_id": str(user.id)},
    )

    # Enter the request-scoped metrics context HERE rather than inside the
    # matcher: the vision task below copies the current context at
    # `create_task` time, so a context entered later would leave the vision
    # aggregates recording into nothing. Emits one metrics line on exit (U15).
    with request_metrics():
        # Both gates run BEFORE any paid call. Cheapest first: the budget check
        # is in-process, the entitlement check costs one database read.
        _consume_cost_budget(request, len(data.clusters), data.vision_image_count)
        entitlement = await _enforce_photo_import_entitlement(request, data, user)
        response = await _suggest_places(data)
        # ...and the charge runs after, on the work that was actually done.
        await _charge_photo_import(
            data,
            user,
            entitlement,
            processed_cluster_count=len(data.clusters) - response.failed_cluster_count,
        )
        return response


async def _suggest_places(data: PlaceSuggestionRequest) -> PlaceSuggestionResponse:
    """Run vision + place matching for the request's clusters."""
    cluster_dicts = [c.model_dump() for c in data.clusters]

    # Run vision classification in parallel with place matching setup
    # Vision results are used during ranking (not blocking search)
    #
    # The client is the long-lived private Places pool, not a per-request one:
    # rebuilding it per request threw away every keep-alive connection and paid
    # a fresh TLS handshake on the first call of every chunk. It is owned by the
    # application lifespan, so it is deliberately NOT closed here.
    client = get_places_client()
    matcher = PlaceMatcher(http_client=client)

    # Run vision + place matching in parallel
    vision_task: asyncio.Task | None = None
    try:
        vision_task = asyncio.create_task(classify_cluster_photos(cluster_dicts))
        suggestion_dicts, failed_count = await matcher.find_places_for_clusters(
            cluster_dicts, vision_results_task=vision_task
        )

        # Capacity failures are OUR saturation, not an upstream fault, and they
        # must not be reported as ordinary per-cluster failures. Every call site
        # inside the matcher catches its own exceptions, so a tripped circuit
        # breaker or an exhausted outbound slot would otherwise return 200 with
        # an inflated `failed_cluster_count` -- which the client renders as
        # retry-ENABLED rows and a "Retry all" control that dispatches straight
        # back into the still-open breaker. Answering busy is what actually
        # slows the caller down.
        #
        # Read defensively: this is a diagnostic signal, not part of the
        # matcher's contract, so a test double or a future matcher variant that
        # does not publish it must degrade to "no capacity failures" rather
        # than 500 the endpoint. Decided here but RAISED BELOW, outside this
        # try, because the broad handler at the end turns any exception into a
        # 500 -- including an HTTPException we raised deliberately.
        capacity_failed = getattr(matcher, "last_capacity_failed_cluster_count", 0)
        if not isinstance(capacity_failed, int):
            capacity_failed = 0
        capacity_bound = capacity_failed > 0 and capacity_failed >= failed_count

        # Convert dicts to ClusterSuggestion models for validation
        suggestions = [ClusterSuggestion.model_validate(s) for s in suggestion_dicts]
        matched_response = PlaceSuggestionResponse(
            suggestions=suggestions,
            failed_cluster_count=failed_count,
        )
    except QuotaExhaustedError as e:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Place suggestion service quota exceeded. Please try again tomorrow.",
            headers={"Retry-After": "3600"},
        ) from e
    except RateLimitError as e:
        # Upstream Google rate limit -- a different condition from our own
        # limiter's 429, which is handled by rate_limit_exceeded_handler.
        raise HTTPException(
            status_code=status.HTTP_429_TOO_MANY_REQUESTS,
            detail="Too many requests to places service. Please wait a moment and try again.",
            headers={"Retry-After": "60"},
        ) from e
    except SlotUnavailableError as e:  # pragma: no cover - see note below
        # CURRENTLY UNREACHABLE, on purpose left in place as a backstop.
        #
        # `SlotUnavailableError` is raised inside `places_outbound_slot`, but
        # every call site in the matcher either catches it per cluster or is
        # collected by `asyncio.gather(..., return_exceptions=True)`, so it
        # never propagates out of `find_places_for_clusters`. What slot
        # starvation actually does today is DEGRADE: the starved clusters come
        # back in `failed_cluster_count` on a 200, and the client retries those
        # clusters. It does not produce the 503 described below.
        #
        # If a future matcher change ever lets it escape, U7's shape applies:
        # OUR concurrency bound was saturated, not Google's quota, so this is
        # deliberately header-less -- the mobile client tells a quota 503 from a
        # transient one by the presence of `Retry-After`, and this is a
        # seconds-long local blip the client should retry, not a day-long wall.
        logger.warning("Places outbound concurrency saturated; rejecting request")
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Place suggestion service is busy. Please try again in a moment.",
        ) from e
    except ConfigurationError as e:
        logger.error(f"Place matcher configuration error: {e}")
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Place suggestion service is not configured. Please contact support.",
        ) from e
    except httpx.PoolTimeout as e:
        # Local saturation, NOT a slow upstream. It must be caught ahead of
        # TimeoutException (which it subclasses) so it does not masquerade as a
        # Google timeout the client would blame on an upstream fault.
        #
        # Deliberately header-less: the mobile client tells a quota 503 from a
        # transient 503 by the presence of `Retry-After`, so attaching one here
        # would report "quota exceeded, try again tomorrow" and disable retry
        # for what is a seconds-long local blip.
        logger.warning("Places connection pool saturated; rejecting request")
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Place suggestion service is busy. Please try again in a moment.",
        ) from e
    except httpx.TimeoutException as e:
        logger.warning(f"Place matching timeout: {e}")
        raise HTTPException(
            status_code=status.HTTP_504_GATEWAY_TIMEOUT,
            detail="Place suggestion service timed out. Please try again.",
        ) from e
    except httpx.RequestError as e:
        logger.error(f"Place matching network error: {e}")
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Unable to reach place suggestion service.",
        ) from e
    except Exception as e:
        logger.error(f"Place matching failed: {e}", exc_info=True)
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Failed to find place suggestions",
        ) from e
    finally:
        if vision_task is not None and not vision_task.done():
            vision_task.cancel()

    # Raised outside the try so the broad handler above cannot turn a
    # deliberate busy signal into a 500. Header-less like the other capacity
    # 503s: the client tells a quota 503 from a transient one by the presence
    # of Retry-After, and this is a seconds-long local blip.
    if capacity_bound:
        logger.warning(
            "Place matching refused %d/%d clusters for capacity; reporting busy",
            capacity_failed,
            len(cluster_dicts),
        )
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Place suggestion service is busy. Please try again in a moment.",
        )

    return matched_response


# NOTE: No /confirm-entries endpoint - reuse existing entry creation at
# POST /trips/{trip_id}/entries. Client sends confirmed suggestions there.
