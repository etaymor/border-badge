"""In-memory LRU cache for Google Places API responses."""

import asyncio
import time
from typing import Any


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

    def get_cache_key(self, lat: float, lng: float, radius: int) -> str:
        """
        Generate a cache key from coordinates and radius.

        Truncates to 5 decimal places (~1.1m precision) to match input coordinate
        precision and avoid returning wrong places for nearby-but-different locations.

        Args:
            lat: Latitude
            lng: Longitude
            radius: Search radius in meters

        Returns:
            Cache key string
        """
        return f"{round(lat, 5)}_{round(lng, 5)}_{radius}"

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

    async def get_or_fetch(self, key: str, fetch_fn: Any) -> list[dict]:
        """
        Get cached result or fetch using provided function (single-flight pattern).

        Prevents cache stampedes by ensuring only one concurrent request per key.
        If a request is already in-flight for the same key, subsequent callers
        wait for that result instead of making duplicate API calls.

        Args:
            key: Cache key
            fetch_fn: Async callable that fetches data if not cached

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
            return await existing_future

        # We own this request - fetch the data
        assert our_future is not None  # Type narrowing for mypy/pyright
        try:
            result = await fetch_fn()
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
        except Exception as error:
            # On error, clean up and propagate exception to waiters
            async with self._lock:
                self._in_flight.pop(key, None)
                if not our_future.done():
                    # Propagate the exception to waiting callers so they receive
                    # the actual error instead of CancelledError.
                    # Catch secondary errors to ensure original error is not lost.
                    try:
                        our_future.set_exception(error)
                    except Exception:
                        # set_exception failed (e.g., InvalidStateError) - already done
                        pass
            raise


# Module-level cache instance (shared across requests)
#
# Memory impact: With max_size=1000 and typical responses of ~2KB per entry,
# worst-case memory usage is ~2MB. The 24h TTL prevents stale data while the
# LRU eviction ensures bounded growth. For high-traffic production deployments,
# consider reducing TTL or max_size, or moving to Redis for shared caching.
places_cache = PlacesCache()
