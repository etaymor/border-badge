"""In-memory LRU cache for Google Places API responses.

This is the fast L1 layer. An optional Postgres L2 (``persistent_cache``) sits
behind it via the ``l2_get``/``l2_set`` hooks on :meth:`PlacesCache.get_or_fetch`,
so a cold L1 (e.g. just after a deploy) still resolves popular locations from our
DB instead of re-buying them from Google.
"""

import asyncio
import time
from collections.abc import Awaitable, Callable
from typing import Any

from .instrumentation import (
    SOURCE_API,
    SOURCE_L1,
    SOURCE_L2,
    SOURCE_SINGLE_FLIGHT,
)


class PlacesCache:
    """
    In-memory LRU cache for Google Places API responses.

    Uses truncated coordinates (5 decimal places, ~1.1m precision) as cache keys
    to match input precision and avoid returning wrong places for different locations.

    Includes max_size limit with LRU eviction to prevent unbounded memory growth.

    Thread-safe via asyncio.Lock to prevent TOCTOU race conditions when
    multiple coroutines access the cache concurrently.

    Implements single-flight pattern via _in_flight tracking to prevent cache
    stampedes when concurrent requests arrive for the same location.
    """

    def __init__(self, ttl_hours: int = 24, max_size: int = 1000) -> None:
        """
        Initialize the cache.

        Args:
            ttl_hours: Time-to-live for cached entries in hours (default 24)
            max_size: Maximum number of entries before LRU eviction (default 1000)
        """
        self._cache: dict[str, tuple[list[dict], float]] = {}
        self._ttl = ttl_hours * 3600  # Convert to seconds
        self._max_size = max_size
        self._lock = asyncio.Lock()
        # Single-flight pattern: track in-flight requests to prevent stampedes
        self._in_flight: dict[str, asyncio.Future[list[dict]]] = {}

    def get_cache_key(
        self,
        lat: float,
        lng: float,
        radius: int,
        type_set_hash: str | None = None,
    ) -> str:
        """
        Generate a cache key from coordinates, radius, and the searched type set.

        Truncates to 5 decimal places (~1.1m precision) to match input coordinate
        precision and avoid returning wrong places for nearby-but-different locations.

        The ``type_set_hash`` disambiguates searches that differ only by their
        ``includedTypes`` (e.g. when the type list is narrowed per cluster), so a
        narrowed search never returns a wider search's cached result.

        Args:
            lat: Latitude
            lng: Longitude
            radius: Search radius in meters
            type_set_hash: Optional short hash of the searched ``includedTypes`` set

        Returns:
            Cache key string
        """
        base = f"nearby_{round(lat, 5)}_{round(lng, 5)}_{radius}"
        return f"{base}_{type_set_hash}" if type_set_hash else base

    async def get(self, key: str) -> list[dict] | None:
        """
        Retrieve cached data if it exists and hasn't expired.

        Moves the entry to end (most recently used) on access.

        Args:
            key: Cache key

        Returns:
            Cached places list or None if not found/expired
        """
        async with self._lock:
            if key in self._cache:
                data, timestamp = self._cache[key]
                if time.time() - timestamp < self._ttl:
                    # Move to end (most recently used)
                    self._cache[key] = self._cache.pop(key)
                    return data
                # Expired - remove from cache
                del self._cache[key]
            return None

    async def set(self, key: str, data: list[dict]) -> None:
        """
        Store data in the cache with LRU eviction.

        Args:
            key: Cache key
            data: Places list to cache
        """
        async with self._lock:
            # If key exists, remove it first to update position
            if key in self._cache:
                del self._cache[key]

            # Evict oldest entries if at capacity (guard against max_size=0)
            if self._max_size > 0:
                while len(self._cache) >= self._max_size:
                    oldest_key = next(iter(self._cache))
                    del self._cache[oldest_key]
                self._cache[key] = (data, time.time())

    async def clear(self) -> None:
        """Clear all cached entries and in-flight requests."""
        async with self._lock:
            self._cache.clear()
            self._in_flight.clear()

    @property
    def size(self) -> int:
        """Return the number of cached entries."""
        return len(self._cache)

    async def get_or_fetch(
        self,
        key: str,
        fetch_fn: Any,
        *,
        l2_get: Callable[[str], Awaitable[list[dict] | None]] | None = None,
        l2_set: Callable[[str, list[dict]], Awaitable[None]] | None = None,
        on_source: Callable[[str], None] | None = None,
    ) -> list[dict]:
        """
        Get cached result or fetch using provided function (single-flight pattern).

        Prevents cache stampedes by ensuring only one concurrent request per key.
        If a request is already in-flight for the same key, subsequent callers
        wait for that result instead of making duplicate API calls.

        An optional persistent L2 cache sits between L1 and ``fetch_fn``: the owner
        of a fresh request consults ``l2_get`` before calling ``fetch_fn``, and
        writes a freshly fetched result back via ``l2_set``. L2 is consulted only
        by the single-flight owner (waiters share the owner's result), so it is
        never stampeded.

        Args:
            key: Cache key
            fetch_fn: Async callable that fetches data if not cached
            l2_get: Optional async callable ``(key) -> list[dict] | None`` reading
                the persistent L2 cache
            l2_set: Optional async callable ``(key, data) -> None`` writing the
                persistent L2 cache
            on_source: Optional callback invoked exactly once per call with the
                layer that served it — one of ``"l1_hits"``,
                ``"single_flight_waits"``, ``"l2_hits"``, ``"google_calls"``.
                Instrumentation only (U15): a latency number is uninterpretable
                without knowing how much of it a warm cache absorbed. The four
                buckets are mutually exclusive, so they sum to the number of
                lookups attempted.

        Returns:
            Cached or freshly fetched places list
        """
        # Determine what to do under lock, then act outside lock
        existing_future: asyncio.Future[list[dict]] | None = None
        our_future: asyncio.Future[list[dict]] | None = None

        async with self._lock:
            # Check cache first
            if key in self._cache:
                data, timestamp = self._cache[key]
                if time.time() - timestamp < self._ttl:
                    # Move to end (most recently used)
                    self._cache[key] = self._cache.pop(key)
                    if on_source is not None:
                        on_source(SOURCE_L1)
                    return data
                # Expired - remove from cache
                del self._cache[key]

            # Check if request already in-flight
            if key in self._in_flight:
                existing_future = self._in_flight[key]
            else:
                # We're the first - create future and claim ownership
                loop = asyncio.get_event_loop()
                our_future = loop.create_future()
                self._in_flight[key] = our_future

        # If another request is in-flight, wait for it (outside lock)
        if existing_future is not None:
            if on_source is not None:
                on_source(SOURCE_SINGLE_FLIGHT)
            return await existing_future

        # We own this request - check L2, then fetch the data
        assert our_future is not None  # Type narrowing for mypy/pyright
        try:
            result: list[dict] | None = None

            # Consult persistent L2 before paying for a fresh API call.
            if l2_get is not None:
                result = await l2_get(key)

            if result is None:
                if on_source is not None:
                    on_source(SOURCE_API)
                result = await fetch_fn()
                # Write-through to L2 so other instances/deploys reuse this.
                if l2_set is not None:
                    await l2_set(key, result)
            elif on_source is not None:
                on_source(SOURCE_L2)
            # result is now guaranteed non-None (L2 hit or fresh fetch)
            assert result is not None  # Type narrowing for mypy/pyright
            # Cache and resolve future
            async with self._lock:
                # Store in cache with LRU eviction (guard against max_size=0)
                if self._max_size > 0:
                    if key in self._cache:
                        del self._cache[key]
                    while len(self._cache) >= self._max_size:
                        oldest_key = next(iter(self._cache))
                        del self._cache[oldest_key]
                    self._cache[key] = (result, time.time())

                # Resolve future for waiting callers
                if not our_future.done():
                    our_future.set_result(result)
                # Clean up in-flight tracking
                self._in_flight.pop(key, None)

            return result
        except BaseException as error:
            # Use BaseException to also catch CancelledError (which doesn't
            # inherit from Exception in Python 3.9+). Without this, a
            # cancelled owner task would leave stale _in_flight entries and
            # unresolved futures, causing waiters to hang forever.
            async with self._lock:
                self._in_flight.pop(key, None)
                if not our_future.done():
                    try:
                        if isinstance(error, asyncio.CancelledError):
                            our_future.cancel()
                        else:
                            our_future.set_exception(error)
                    except Exception:
                        # set_exception/cancel failed (e.g., InvalidStateError)
                        pass
            raise


# Module-level cache instance (shared across requests)
#
# Memory impact: With max_size=1000 and typical responses of ~2KB per entry,
# worst-case memory usage is ~2MB. The 24h TTL prevents stale data while the
# LRU eviction ensures bounded growth. For high-traffic production deployments,
# consider reducing TTL or max_size, or moving to Redis for shared caching.
places_cache = PlacesCache()
