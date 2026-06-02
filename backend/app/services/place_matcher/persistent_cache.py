"""Postgres/Supabase-backed persistent cache for Google Places responses (L2).

This is the durable layer behind the in-memory ``PlacesCache`` (L1). It survives
restarts/deploys and is shared across all server instances and users, so the same
physical location resolves from our DB instead of being re-bought from Google.

Two complementary caches, both backend-only (service role, RLS-enabled with no
user policies):

* :func:`get_search_cache` / :func:`set_search_cache` — raw Nearby/Text Search
  responses keyed by a quantized ``(lat, lng, radius, type-set-hash)`` cache key,
  stored in ``places_search_cache``.
* :func:`get_place_details_cache` / :func:`set_place_details_cache` — enriched
  per-place fields keyed by ``google_place_id``, stored in ``cached_google_place``,
  consulted before any Place Details call (social ingest).

All operations are best-effort: a DB failure logs and degrades to a cache miss
rather than failing the request. The migration is ``0057_persistent_place_cache``.
"""

import logging
from datetime import UTC, datetime, timedelta
from typing import Any

from app.core.config import get_settings
from app.db.session import get_supabase_client

logger = logging.getLogger(__name__)


def _persistent_cache_enabled() -> bool:
    """Persistent L2 is usable only when Supabase is configured.

    Without a configured URL/key the REST calls would fail anyway; short-circuiting
    avoids a wasted (and slow) network attempt per lookup and keeps the in-memory
    L1 path clean in unconfigured environments (e.g. tests).
    """
    settings = get_settings()
    return bool(settings.supabase_url and settings.supabase_service_role_key)


# Place sets near a coordinate (and a place's own metadata) are very stable, so
# the persistent layer uses a long TTL. The short in-memory TTL still guards
# against intra-day churn for the hottest entries.
SEARCH_CACHE_TTL_DAYS = 60
PLACE_DETAILS_CACHE_TTL_DAYS = 60


def _now() -> datetime:
    return datetime.now(UTC)


def _is_expired(expires_at: str | None) -> bool:
    """Return True when an ISO ``expires_at`` is missing or in the past."""
    if not expires_at:
        return True
    try:
        expiry = datetime.fromisoformat(expires_at.replace("Z", "+00:00"))
    except ValueError:
        return True
    return expiry <= _now()


# =============================================================================
# Search-response cache (places_search_cache)
# =============================================================================


async def get_search_cache(cache_key: str) -> list[dict] | None:
    """Fetch a cached Places search response by cache key.

    Returns the cached places list, or None on miss/expiry/error.
    """
    if not _persistent_cache_enabled():
        return None
    try:
        db = get_supabase_client()
        rows = await db.get(
            "places_search_cache",
            {
                "cache_key": f"eq.{cache_key}",
                "select": "response,expires_at",
            },
        )
    except Exception as e:  # best-effort: never fail the request on cache error
        logger.debug(f"places_search_cache_get_error: {e}")
        return None

    if not rows:
        return None

    row = rows[0]
    if _is_expired(row.get("expires_at")):
        return None

    response = row.get("response")
    return response if isinstance(response, list) else None


async def set_search_cache(cache_key: str, places: list[dict]) -> None:
    """Store a Places search response under ``cache_key`` (best-effort upsert)."""
    if not _persistent_cache_enabled():
        return
    expires_at = (_now() + timedelta(days=SEARCH_CACHE_TTL_DAYS)).isoformat()
    try:
        db = get_supabase_client()
        await db.upsert(
            "places_search_cache",
            [
                {
                    "cache_key": cache_key,
                    "response": places,
                    "expires_at": expires_at,
                }
            ],
            on_conflict="cache_key",
        )
    except Exception as e:
        logger.debug(f"places_search_cache_set_error: {e}")


# =============================================================================
# Per-place details cache (cached_google_place)
# =============================================================================


async def get_place_details_cache(google_place_id: str) -> dict | None:
    """Fetch enriched Place Details by ``google_place_id``.

    Returns the cached details dict, or None on miss/expiry/error.
    """
    if not google_place_id or not _persistent_cache_enabled():
        return None
    try:
        db = get_supabase_client()
        rows = await db.get(
            "cached_google_place",
            {
                "google_place_id": f"eq.{google_place_id}",
                "select": "details,expires_at",
            },
        )
    except Exception as e:
        logger.debug(f"cached_google_place_get_error: {e}")
        return None

    if not rows:
        return None

    row = rows[0]
    if _is_expired(row.get("expires_at")):
        return None

    details = row.get("details")
    return details if isinstance(details, dict) else None


async def set_place_details_cache(
    google_place_id: str, details: dict[str, Any]
) -> None:
    """Store enriched Place Details keyed by ``google_place_id`` (best-effort)."""
    if not google_place_id or not isinstance(details, dict):
        return
    if not _persistent_cache_enabled():
        return
    now = _now()
    now_iso = now.isoformat()
    expires_at = (now + timedelta(days=PLACE_DETAILS_CACHE_TTL_DAYS)).isoformat()
    try:
        db = get_supabase_client()
        await db.upsert(
            "cached_google_place",
            [
                {
                    "google_place_id": google_place_id,
                    "details": details,
                    "updated_at": now_iso,
                    "expires_at": expires_at,
                }
            ],
            on_conflict="google_place_id",
        )
    except Exception as e:
        logger.debug(f"cached_google_place_set_error: {e}")
