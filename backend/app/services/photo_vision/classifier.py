"""Photo vision classifier using Gemini Flash Lite via OpenRouter."""

import asyncio
import json
import logging
import time
import weakref
from dataclasses import dataclass, field

import httpx

from app.core.config import get_settings
from app.core.http_client import VISION_POOL_TIMEOUT_SECONDS, get_vision_client
from app.core.llm_utils import OPENROUTER_API_URL, extract_content

from .constants import (
    CLASSIFICATION_RESPONSE_FORMAT,
    CLASSIFICATION_SYSTEM_PROMPT,
    CLASSIFICATION_USER_PROMPT,
    GENERIC_TEXT_WORDS,
    GENERIC_VENUE_WORDS,
    VISION_CATEGORIES,
    VISION_CONFIDENCE_LEVELS,
    VISION_NULL_EMPTY_RESPONSE,
    VISION_NULL_EXCEPTION,
    VISION_NULL_HTTP_ERROR,
    VISION_NULL_NO_API_KEY,
    VISION_NULL_REQUEST_ERROR,
    VISION_NULL_SLOT_UNAVAILABLE,
    VISION_NULL_TIMEOUT,
    VISION_NULL_UNKNOWN,
)

logger = logging.getLogger(__name__)


@dataclass
class VisionResult:
    """Result from vision classification."""

    category: (
        str  # food, landmark, stay, shopping, nature, nightlife, transport, unknown
    )
    detected_text: list[str] = field(default_factory=list)
    confidence: str = "low"  # high, medium, low
    # Common name of a visually recognized famous landmark ("Eiffel Tower"),
    # independent of readable signage — monument photos usually have none.
    # Costs nothing extra (same LLM call); powers the landmark text-rescue.
    landmark_name: str | None = None

    @staticmethod
    def _is_business_name_text(text: str) -> bool:
        """Whether a detected text string plausibly names a business.

        Multi-word phrases qualify unless any word is generic (EXIT, OPEN...).
        Single words qualify too — many iconic venues have one-word names
        (Noma, Nobu, Aman, Gucci) that would otherwise never earn the
        name-match ranking bonus — but require 4+ characters, at least one
        letter, and absence from the generic-word list to keep OCR noise out.
        """
        stripped = text.strip()
        if not stripped:
            return False
        lower = stripped.lower()
        if lower in GENERIC_TEXT_WORDS:
            return False
        words = stripped.split()
        if len(words) >= 2:
            return not any(w.lower() in GENERIC_TEXT_WORDS for w in words)
        return (
            len(stripped) >= 4
            and any(c.isalpha() for c in stripped)
            and lower not in GENERIC_VENUE_WORDS
        )

    @property
    def has_business_name(self) -> bool:
        """Check if detected text contains potential business names."""
        return any(self._is_business_name_text(t) for t in self.detected_text)

    @property
    def business_name_candidates(self) -> list[str]:
        """Get non-generic text strings suitable for text search."""
        return [
            text.strip()
            for text in self.detected_text
            if self._is_business_name_text(text)
        ]


class PhotoClassifier:
    """Classify photos using Gemini Flash Lite via OpenRouter.

    Sends 1 representative photo per cluster for vision analysis.
    Returns category, detected text, and confidence level.

    Cost: ~$0.00008 per photo at 768px (well within $0.25 budget).
    """

    def __init__(self, timeout: float = 5.0) -> None:
        self._timeout = timeout
        self._settings = get_settings()
        # U12: why each null happened, aggregated per classifier instance
        # (one per request). Counts of static reason names only — R27.
        self._null_reasons: dict[str, int] = {}

    @property
    def null_reasons(self) -> dict[str, int]:
        """Counts of null classifications by reason, for this instance."""
        return dict(self._null_reasons)

    def _record_null(self, reason: str) -> None:
        """Attribute one null classification to the outcome that caused it."""
        self._null_reasons[reason] = self._null_reasons.get(reason, 0) + 1

    async def classify(self, image_base64: str) -> VisionResult | None:
        """Classify a photo using vision AI.

        Args:
            image_base64: Base64-encoded JPEG image (768px max dimension)

        Returns:
            VisionResult if successful, None on failure (silent fallback)
        """
        if not self._settings.openrouter_api_key:
            logger.debug("Vision classification skipped: no OpenRouter API key")
            self._record_null(VISION_NULL_NO_API_KEY)
            return None

        try:
            # The PRIVATE vision pool, not the shared app client. The shared
            # client backs every Supabase REST call and its keepalive budget
            # (20) sits below what a single import's vision fan-out uses, so
            # importing used to evict the app's database connections.
            client = get_vision_client()
            response = await client.post(
                OPENROUTER_API_URL,
                json={
                    "model": self._settings.multimodal_model,
                    "messages": [
                        {
                            "role": "system",
                            "content": CLASSIFICATION_SYSTEM_PROMPT,
                        },
                        {
                            "role": "user",
                            "content": [
                                {
                                    "type": "image_url",
                                    "image_url": {
                                        "url": f"data:image/jpeg;base64,{image_base64}",
                                    },
                                },
                                {
                                    "type": "text",
                                    "text": CLASSIFICATION_USER_PROMPT,
                                },
                            ],
                        },
                    ],
                    "temperature": 0.1,
                    "max_tokens": 300,
                    "response_format": CLASSIFICATION_RESPONSE_FORMAT,
                },
                headers={
                    "Authorization": f"Bearer {self._settings.openrouter_api_key}",
                    "Content-Type": "application/json",
                    "HTTP-Referer": self._settings.base_url,
                    "X-Title": "Border Badge",
                },
                # Pool wait keeps its own (short) budget rather than inheriting
                # the model timeout: waiting for a free connection is a local
                # saturation failure, not a slow model.
                timeout=httpx.Timeout(self._timeout, pool=VISION_POOL_TIMEOUT_SECONDS),
            )

            if response.status_code != 200:
                if response.status_code in (401, 403):
                    logger.error(
                        f"Vision API auth error: status={response.status_code} "
                        f"— check OPENROUTER_API_KEY"
                    )
                else:
                    logger.debug(f"Vision API error: status={response.status_code}")
                self._record_null(VISION_NULL_HTTP_ERROR)
                return None

            data = response.json()
            content = extract_content(data)
            if not content:
                self._record_null(VISION_NULL_EMPTY_RESPONSE)
                return None

            parsed = self._parse_response(content)
            if parsed is None:
                self._record_null(VISION_NULL_EMPTY_RESPONSE)
            return parsed

        except httpx.TimeoutException:
            logger.debug("Vision classification timed out")
            self._record_null(VISION_NULL_TIMEOUT)
            return None
        except (httpx.RequestError, json.JSONDecodeError, KeyError) as e:
            logger.warning(f"Vision classification error: {e}")
            self._record_null(VISION_NULL_REQUEST_ERROR)
            return None

    @staticmethod
    def _parse_response(content: str) -> VisionResult | None:
        """Parse structured JSON response from vision model."""
        try:
            data = json.loads(content)
        except json.JSONDecodeError:
            logger.warning("Vision response is not valid JSON")
            return None

        if not isinstance(data, dict):
            return None

        category = data.get("category", "unknown")
        if category not in VISION_CATEGORIES:
            category = "unknown"

        confidence = data.get("confidence", "low")
        if confidence not in VISION_CONFIDENCE_LEVELS:
            confidence = "low"

        detected_text = data.get("detected_text", [])
        if not isinstance(detected_text, list):
            detected_text = []
        # Ensure all items are strings
        detected_text = [str(t) for t in detected_text if t]

        landmark_name = data.get("landmark_name")
        if not isinstance(landmark_name, str) or not landmark_name.strip():
            landmark_name = None
        else:
            landmark_name = landmark_name.strip()

        return VisionResult(
            category=category,
            detected_text=detected_text,
            confidence=confidence,
            landmark_name=landmark_name,
        )

    @staticmethod
    def aggregate_results(results: list[VisionResult | None]) -> VisionResult | None:
        """Aggregate per-photo classifications into a single cluster-level result."""
        valid_results = [r for r in results if r is not None]
        if not valid_results:
            return None

        confidence_weights = {"high": 3.0, "medium": 2.0, "low": 1.0}
        category_scores: dict[str, float] = {}

        for result in valid_results:
            score = confidence_weights.get(result.confidence, 1.0)
            category_scores[result.category] = (
                category_scores.get(result.category, 0.0) + score
            )

        # Stable tie-breaker by first seen order.
        first_seen: dict[str, int] = {}
        for idx, result in enumerate(valid_results):
            if result.category not in first_seen:
                first_seen[result.category] = idx

        best_category = sorted(
            category_scores.items(),
            key=lambda x: (-x[1], first_seen.get(x[0], 0)),
        )[0][0]

        sorted_scores = sorted(category_scores.values(), reverse=True)
        top_score = sorted_scores[0]
        second_score = sorted_scores[1] if len(sorted_scores) > 1 else 0.0
        margin = top_score - second_score

        if top_score >= 5.0 and margin >= 2.0:
            aggregate_confidence = "high"
        elif top_score >= 2.0 and margin >= 0.5:
            aggregate_confidence = "medium"
        else:
            aggregate_confidence = "low"

        seen_text: set[str] = set()
        detected_text: list[str] = []
        for result in valid_results:
            for text in result.detected_text:
                normalized = text.strip()
                if not normalized:
                    continue
                key = normalized.lower()
                if key in seen_text:
                    continue
                seen_text.add(key)
                detected_text.append(normalized)

        # Keep the most confident photo's recognized landmark name (ties by
        # first seen — same rule as the category vote).
        landmark_name: str | None = None
        best_weight = 0.0
        for result in valid_results:
            if not result.landmark_name:
                continue
            weight = confidence_weights.get(result.confidence, 1.0)
            if weight > best_weight:
                best_weight = weight
                landmark_name = result.landmark_name

        return VisionResult(
            category=best_category,
            detected_text=detected_text,
            confidence=aggregate_confidence,
            landmark_name=landmark_name,
        )


# ---------------------------------------------------------------------------
# Concurrency bounds (U12)
# ---------------------------------------------------------------------------
#
# The PER-REQUEST bound decides how many concurrency WAVES a batch costs. A
# full batch is 5 clusters (the client's chunk size) x up to 3 vision images =
# 15 images; at a bound of 5 those 15 images cost three sequential round-trip
# waves. Raising the bound to SINGLE_WAVE_VISION_CONCURRENCY buys the same work
# in ONE wave — identical call count, identical spend, different scheduling.
#
# The default deliberately stays at the historical value. Widening is gated on
# reading the vision-vs-search split off the U15 metrics line
# (`place_matcher_phase_metrics`: `phase_ms.vision_wait` — the residual wait
# vision adds on top of the concurrent search — together with
# `vision.total_ms`) on a real device. Until that reading exists, the claim
# that vision dominates is an estimate, so the widening ships as a
# one-environment-variable flip (VISION_MAX_CONCURRENT_REQUESTS) rather than as
# a new default.
MAX_CONCURRENT_VISION_REQUESTS = 5

# The per-request bound at which a full batch classifies in a single wave.
SINGLE_WAVE_VISION_CONCURRENCY = 15

# Process-wide ceiling across every concurrent request. The per-request bound
# alone bounds ONE request; nothing bounded the process, so N concurrent
# imports multiplied straight through to N x bound in-flight OpenRouter calls
# on the SHARED app client (100 connections, also serving every Supabase call).
# This ceiling keeps the vision fan-out to a minority of that pool whatever the
# per-request bound is set to, and sits above the per-request bound at both the
# default (5) and the single-wave value (15), so no single request can hold
# every slot.
#
# It is sized against the PRIVATE vision pool (`VISION_MAX_CONNECTIONS`, 40),
# not the shared app client: vision now has its own pool for the same reason
# Places does.
MAX_CONCURRENT_VISION_REQUESTS_PROCESS = 30

# How long an image may wait for a process-wide slot before giving up.
#
# A process ceiling with an UNBOUNDED wait is not a bound, it is a queue. Before
# the ceiling existed there was no queue to grow; with it, and with Starlette
# leaving a server-side coroutine running after the client times out at 90s,
# abandoned work keeps holding slots while the queue behind it grows without
# limit. Matches PLACES_SLOT_WAIT_CEILING_SECONDS: both bound a purely LOCAL
# saturation wait, so neither queue can silently dominate the other.
#
# Expiry is a null classification, which vision already degrades to gracefully
# (the cluster drops back to distance-ranked results) and already counts.
VISION_SLOT_WAIT_CEILING_SECONDS = 2.0

# Why such a null happened (U12). Re-exported from
# `place_matcher.instrumentation`, which owns the reason registry, so the count
# lands in its own bucket in `RequestMetrics.vision_null_reasons` rather than
# folding into "unknown" — a self-inflicted capacity limit must not read as an
# upstream regression.


def resolve_vision_concurrency() -> tuple[int, int]:
    """Return the ``(per_request, process_wide)`` vision concurrency bounds.

    The per-request bound comes from settings and falls back to
    :data:`MAX_CONCURRENT_VISION_REQUESTS` when the field is absent or
    unusable, so an older settings object degrades to today's behaviour rather
    than to an unbounded fan-out. It is also clamped to the process-wide
    ceiling: a misconfigured value must never let one request hold every slot.
    """
    raw = getattr(get_settings(), "vision_max_concurrent_requests", None)
    try:
        per_request = int(raw)  # type: ignore[arg-type]
    except (TypeError, ValueError):
        per_request = MAX_CONCURRENT_VISION_REQUESTS
    if per_request < 1:
        per_request = MAX_CONCURRENT_VISION_REQUESTS
    process_wide = max(1, MAX_CONCURRENT_VISION_REQUESTS_PROCESS)
    return min(per_request, process_wide), process_wide


# Keyed by event loop so a semaphore is never awaited from a loop other than
# the one it was created on (each test gets its own loop), and rebuilt when the
# configured limit changes.
_process_semaphores: weakref.WeakKeyDictionary[
    asyncio.AbstractEventLoop, tuple[int, asyncio.Semaphore]
] = weakref.WeakKeyDictionary()


def _get_process_semaphore(limit: int) -> asyncio.Semaphore:
    """Return the process-wide vision semaphore for the running loop."""
    loop = asyncio.get_running_loop()
    entry = _process_semaphores.get(loop)
    if entry is not None and entry[0] == limit:
        return entry[1]
    semaphore = asyncio.Semaphore(limit)
    _process_semaphores[loop] = (limit, semaphore)
    return semaphore


async def classify_cluster_photos(
    clusters: list[dict],
) -> dict[str, VisionResult]:
    """Run vision classification for clusters with vision image payloads.

    Returns a dict mapping cluster_id -> VisionResult.
    Failures are silently ignored (returns empty dict for failed clusters).
    """
    classifier = PhotoClassifier(timeout=5.0)
    vision_clusters = [c for c in clusters if c.get("vision_images_base64")]

    if not vision_clusters:
        return {}

    per_request_limit, process_limit = resolve_vision_concurrency()
    # Two bounds, acquired outer-to-inner: the request's own share first, so a
    # single request can never queue more than its share on the process-wide
    # semaphore, and the process-wide ceiling second.
    request_semaphore = asyncio.Semaphore(per_request_limit)
    process_semaphore = _get_process_semaphore(process_limit)
    started_at = time.perf_counter()
    # Per-request aggregates only (R27): counts, never cluster ids (U15).
    images_attempted = 0
    images_null = 0
    images_exception = 0

    async def classify_one(cluster: dict) -> tuple[str, VisionResult | None]:
        nonlocal images_attempted, images_null, images_exception
        images: list[str] = list(cluster["vision_images_base64"][:3])

        if not images:
            return cluster["id"], None

        images_attempted += len(images)

        async def classify_with_limit(image_base64: str) -> VisionResult | None:
            # The request's own share queues without a ceiling: it is this
            # request's work waiting for this request's slot, and nobody else
            # is starved by it. The PROCESS-wide slot does have a ceiling —
            # see VISION_SLOT_WAIT_CEILING_SECONDS.
            async with request_semaphore:
                try:
                    await asyncio.wait_for(
                        process_semaphore.acquire(),
                        timeout=VISION_SLOT_WAIT_CEILING_SECONDS,
                    )
                except TimeoutError:
                    # R27: static reason name and counts only.
                    classifier._record_null(VISION_NULL_SLOT_UNAVAILABLE)
                    return None
                try:
                    return await classifier.classify(image_base64)
                finally:
                    process_semaphore.release()

        single_results = await asyncio.gather(
            *[classify_with_limit(image_base64) for image_base64 in images],
            return_exceptions=True,
        )

        parsed_results: list[VisionResult | None] = []
        for item in single_results:
            if isinstance(item, VisionResult):
                parsed_results.append(item)
            elif isinstance(item, BaseException):
                # R27: cluster ids are geohash-derived, so the id never reaches
                # an always-on line. The exception itself is not an identifier
                # and stays at warning - it is the only thing that explains WHY
                # a cluster lost its vision signal. The id stays available at
                # debug level, and the count lands in
                # `vision.null_reasons.exception`.
                logger.warning("Vision classification exception: %s", item)
                logger.debug(
                    "Vision classification exception for cluster %s", cluster["id"]
                )
                images_exception += 1
                parsed_results.append(None)
            else:
                parsed_results.append(None)

        images_null += sum(1 for r in parsed_results if r is None)

        return cluster["id"], PhotoClassifier.aggregate_results(parsed_results)

    results = await asyncio.gather(
        *[classify_one(c) for c in vision_clusters],
        return_exceptions=True,
    )

    vision_map: dict[str, VisionResult] = {}
    failed_count = 0
    for r in results:
        if isinstance(r, tuple) and r[1] is not None:
            vision_map[r[0]] = r[1]
        elif isinstance(r, BaseException):
            failed_count += 1
            logger.warning("Vision cluster-level exception: %s", r)

    if failed_count:
        logger.warning(
            "Vision classification: %d/%d clusters raised exceptions",
            failed_count,
            len(vision_clusters),
        )

    # Why the nulls were null (U12). The classifier attributes every null it
    # produced itself; per-image exceptions are attributed here; anything left
    # over (a stubbed or patched classify, say) lands in "unknown" so the
    # reasons always sum to images_null rather than quietly under-counting.
    null_reasons = classifier.null_reasons
    if images_exception:
        null_reasons[VISION_NULL_EXCEPTION] = (
            null_reasons.get(VISION_NULL_EXCEPTION, 0) + images_exception
        )
    unattributed = images_null - sum(null_reasons.values())
    if unattributed > 0:
        null_reasons[VISION_NULL_UNKNOWN] = (
            null_reasons.get(VISION_NULL_UNKNOWN, 0) + unattributed
        )

    # Vision-null rate (R18): recorded for every request, including the all-null
    # one — the case a "clusters classified successfully" line stays silent about.
    #
    # Imported here, not at module scope: place_matcher imports photo_vision, so
    # a module-level import would close an import cycle and break every entry
    # point that reaches photo_vision first. Guarded by
    # test_no_import_cycle.py.
    from app.services.place_matcher.instrumentation import record_vision

    record_vision(
        clusters_attempted=len(vision_clusters),
        clusters_classified=len(vision_map),
        images_attempted=images_attempted,
        images_null=images_null,
        total_ms=(time.perf_counter() - started_at) * 1000,
        null_reasons=null_reasons,
    )

    if images_null:
        # Aggregate counts and static reason names only (R27). Warning level so
        # it survives production log filtering: a null classification is a
        # silent ranking degradation, not a debug detail.
        logger.warning(
            "Vision null classifications: %d/%d images by reason %s",
            images_null,
            images_attempted,
            {reason: count for reason, count in sorted(null_reasons.items()) if count},
        )

    if vision_map:
        logger.info(
            f"Vision classification: {len(vision_map)}/{len(vision_clusters)} "
            f"clusters classified successfully"
        )

    return vision_map
