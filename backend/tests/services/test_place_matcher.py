"""Tests for the place_matcher service."""

import asyncio
from typing import Any
from unittest.mock import AsyncMock, MagicMock

import httpx
import pytest

from app.schemas.entries import EntryType
from app.services.photo_vision import VisionResult
from app.services.place_matcher import (
    INSTITUTIONAL_TYPES,
    MIN_REVIEW_COUNT,
    NON_TOURIST_TYPES,
    TYPE_TO_CATEGORY,
    DensityLevel,
    PlaceMatcher,
    PlacesCache,
    RateLimitError,
)
from app.services.place_matcher._matcher_ranking import (
    VISION_HIGH_CONFIDENCE_BONUS,
    VISION_MEDIUM_CONFIDENCE_BONUS,
)
from app.services.place_matcher._matcher_search import TieredSearchResult
from app.services.place_matcher.utils import name_matches_candidate


def _tiered(places: list[dict], radius_used: int = 15) -> TieredSearchResult:
    """Build a TieredSearchResult for cluster-processing mocks.

    Mirrors the cheap-scalar fields the real search would populate so the
    cluster-processing flow gets a faithful shape: radii_searched and
    raw_count_per_radius are keyed on the (single) returned radius.
    """
    return TieredSearchResult(
        places=places,
        radius_used=radius_used,
        radii_searched={radius_used},
        raw_count_per_radius={radius_used: len(places)},
        raw_places_per_radius={},
        stopped_early=bool(places),
        density=DensityLevel.DENSE,
    )


class TestHaversineDistance:
    """Tests for haversine distance calculation."""

    def test_same_location_returns_zero(self) -> None:
        """Test that same coordinates return 0 distance."""
        distance = PlaceMatcher._haversine(35.6762, 139.6503, 35.6762, 139.6503)
        assert distance == 0

    def test_known_distance_tokyo_to_kyoto(self) -> None:
        """Test distance between Tokyo and Kyoto (~370km)."""
        lat1, lon1 = 35.6812, 139.7671
        lat2, lon2 = 34.9855, 135.7589

        distance = PlaceMatcher._haversine(lat1, lon1, lat2, lon2)

        # Should be approximately 370km (within 10% margin)
        assert 330000 < distance < 410000

    def test_short_distance(self) -> None:
        """Test short distance between nearby points."""
        lat1, lon1 = 35.6762, 139.6503
        lat2, lon2 = 35.6772, 139.6503

        distance = PlaceMatcher._haversine(lat1, lon1, lat2, lon2)

        assert 100 < distance < 130

    def test_handles_negative_coordinates(self) -> None:
        """Test with negative longitude."""
        lat1, lon1 = 40.7128, -74.0060
        lat2, lon2 = 40.7128, -74.0050

        distance = PlaceMatcher._haversine(lat1, lon1, lat2, lon2)

        assert 0 < distance < 100


class TestNameMatchesCandidate:
    """Tests for the text-search-suppression name matcher (U5)."""

    def test_exact_match(self) -> None:
        assert name_matches_candidate("Tsukiji Ramen", "Tsukiji Ramen")

    def test_case_insensitive(self) -> None:
        assert name_matches_candidate("TSUKIJI RAMEN", "tsukiji ramen")

    def test_punctuation_normalized_to_whitespace(self) -> None:
        # Trailing punctuation/extra spaces must not defeat the match.
        assert name_matches_candidate("Blue Bottle Coffee!", "Blue Bottle Coffee")

    def test_candidate_is_substring_of_name(self) -> None:
        # Vision reads "Tsukiji Ramen"; Google's full name is longer.
        assert name_matches_candidate("Tsukiji Ramen Honten Tokyo", "Tsukiji Ramen")

    def test_name_is_substring_of_candidate(self) -> None:
        assert name_matches_candidate("Ramen", "Tsukiji Ramen")

    def test_different_names_do_not_match(self) -> None:
        assert not name_matches_candidate("Nearby Cafe", "Signboard Ramen House")

    def test_empty_inputs_do_not_match(self) -> None:
        assert not name_matches_candidate("", "Ramen")
        assert not name_matches_candidate("Ramen", "")

    def test_too_short_candidate_does_not_match(self) -> None:
        # A 1-2 char candidate must not trivially match via containment.
        assert not name_matches_candidate("A Big Restaurant", "a")


class TestTypeToCategoryMapping:
    """Tests for Google Places type to category mapping."""

    def test_restaurant_maps_to_food(self) -> None:
        """Test that restaurant types map to food category."""
        assert TYPE_TO_CATEGORY.get("restaurant") == "food"
        assert TYPE_TO_CATEGORY.get("cafe") == "food"
        assert TYPE_TO_CATEGORY.get("bakery") == "food"

    def test_lodging_maps_to_stay(self) -> None:
        """Test that lodging types map to stay category."""
        assert TYPE_TO_CATEGORY.get("lodging") == "stay"
        assert TYPE_TO_CATEGORY.get("hotel") == "stay"

    def test_attraction_maps_to_experience(self) -> None:
        """Test that attraction types map to experience category."""
        assert TYPE_TO_CATEGORY.get("tourist_attraction") == "experience"
        assert TYPE_TO_CATEGORY.get("museum") == "experience"
        assert TYPE_TO_CATEGORY.get("amusement_park") == "experience"

    def test_default_is_none_for_unknown(self) -> None:
        """Test that unknown types return None."""
        assert TYPE_TO_CATEGORY.get("unknown_type") is None

    def test_all_categories_are_valid_entry_types(self) -> None:
        """Test that all TYPE_TO_CATEGORY values are valid EntryType enum values.

        This prevents runtime errors if someone adds a mapping to a category
        that doesn't exist in EntryType.
        """
        valid_values = {e.value for e in EntryType}
        for google_type, category in TYPE_TO_CATEGORY.items():
            assert category in valid_values, (
                f"TYPE_TO_CATEGORY['{google_type}'] = '{category}' "
                f"is not a valid EntryType. Valid values: {valid_values}"
            )


# ============================================================================
# PlacesCache TTL Tests
# ============================================================================


class TestPlacesCacheTTL:
    """Tests for PlacesCache TTL-based expiration."""

    @pytest.mark.asyncio
    async def test_cache_returns_none_for_expired_entry(
        self, mock_time, monkeypatch
    ) -> None:
        """Test that expired cache entries return None."""
        monkeypatch.setattr(
            "app.services.place_matcher.cache.time.time", mock_time["get"]
        )

        # Create cache with 1-hour TTL
        cache = PlacesCache(ttl_hours=1, max_size=100)

        # Cache a value at T0
        await cache.set("key1", [{"place": "data"}])

        # Verify it's retrievable within TTL
        result = await cache.get("key1")
        assert result == [{"place": "data"}]

        # Advance time past TTL (3601 seconds > 3600)
        mock_time["advance"](3601)

        # Should return None for expired entry
        result = await cache.get("key1")
        assert result is None

    @pytest.mark.asyncio
    async def test_cache_returns_value_within_ttl(self, mock_time, monkeypatch) -> None:
        """Test that cache entries within TTL are returned."""
        monkeypatch.setattr(
            "app.services.place_matcher.cache.time.time", mock_time["get"]
        )

        cache = PlacesCache(ttl_hours=1, max_size=100)

        # Cache a value at T0
        await cache.set("key1", [{"place": "data"}])

        # Advance time but stay within TTL (3599 seconds < 3600)
        mock_time["advance"](3599)

        # Should still return the cached value
        result = await cache.get("key1")
        assert result == [{"place": "data"}]

    @pytest.mark.asyncio
    async def test_expired_entry_is_removed_on_get(
        self, mock_time, monkeypatch
    ) -> None:
        """Test that expired entries are removed from cache on access."""
        monkeypatch.setattr(
            "app.services.place_matcher.cache.time.time", mock_time["get"]
        )

        cache = PlacesCache(ttl_hours=1, max_size=100)

        # Cache a value
        await cache.set("key1", [{"place": "data"}])
        assert cache.size == 1

        # Advance time past TTL
        mock_time["advance"](3601)

        # Access the expired entry
        result = await cache.get("key1")
        assert result is None

        # Entry should be removed from cache
        assert cache.size == 0


# ============================================================================
# PlacesCache LRU Tests
# ============================================================================


class TestPlacesCacheLRU:
    """Tests for PlacesCache LRU eviction."""

    @pytest.mark.asyncio
    async def test_lru_eviction_at_capacity(self, mock_time, monkeypatch) -> None:
        """Test that oldest entry is evicted when cache reaches max_size."""
        monkeypatch.setattr(
            "app.services.place_matcher.cache.time.time", mock_time["get"]
        )

        cache = PlacesCache(ttl_hours=24, max_size=3)

        # Add 3 entries (at capacity)
        await cache.set("key1", [{"place": "data1"}])
        await cache.set("key2", [{"place": "data2"}])
        await cache.set("key3", [{"place": "data3"}])
        assert cache.size == 3

        # Add 4th entry - should evict key1 (oldest)
        await cache.set("key4", [{"place": "data4"}])
        assert cache.size == 3

        # key1 should be evicted
        assert await cache.get("key1") is None

        # Other keys should still exist
        assert await cache.get("key2") == [{"place": "data2"}]
        assert await cache.get("key3") == [{"place": "data3"}]
        assert await cache.get("key4") == [{"place": "data4"}]

    @pytest.mark.asyncio
    async def test_lru_access_moves_to_end(self, mock_time, monkeypatch) -> None:
        """Test that accessing an entry moves it to most-recently-used."""
        monkeypatch.setattr(
            "app.services.place_matcher.cache.time.time", mock_time["get"]
        )

        cache = PlacesCache(ttl_hours=24, max_size=3)

        # Add 3 entries
        await cache.set("key1", [{"place": "data1"}])
        await cache.set("key2", [{"place": "data2"}])
        await cache.set("key3", [{"place": "data3"}])

        # Access key1 (moves it to end/most recently used)
        _ = await cache.get("key1")

        # Add key4 - should evict key2 (now oldest), not key1
        await cache.set("key4", [{"place": "data4"}])

        # key2 should be evicted (was oldest after key1 was accessed)
        assert await cache.get("key2") is None

        # key1 should still exist (was moved to end by access)
        assert await cache.get("key1") == [{"place": "data1"}]
        assert await cache.get("key3") == [{"place": "data3"}]
        assert await cache.get("key4") == [{"place": "data4"}]

    @pytest.mark.asyncio
    async def test_updating_existing_key_refreshes_position(
        self, mock_time, monkeypatch
    ) -> None:
        """Test that setting an existing key moves it to end."""
        monkeypatch.setattr(
            "app.services.place_matcher.cache.time.time", mock_time["get"]
        )

        cache = PlacesCache(ttl_hours=24, max_size=3)

        # Add 3 entries
        await cache.set("key1", [{"place": "data1"}])
        await cache.set("key2", [{"place": "data2"}])
        await cache.set("key3", [{"place": "data3"}])

        # Update key1 (should move to end)
        await cache.set("key1", [{"place": "updated1"}])

        # Add key4 - should evict key2 (oldest after key1 was updated)
        await cache.set("key4", [{"place": "data4"}])

        # key2 should be evicted
        assert await cache.get("key2") is None

        # key1 should exist with updated value
        assert await cache.get("key1") == [{"place": "updated1"}]

    @pytest.mark.asyncio
    async def test_clear_removes_all_entries(self) -> None:
        """Test that clear() empties the cache."""
        cache = PlacesCache(ttl_hours=24, max_size=100)

        # Use synchronous internal access for this simple test
        cache._cache["key1"] = ([{"place": "data1"}], 1000000.0)
        cache._cache["key2"] = ([{"place": "data2"}], 1000000.0)
        assert cache.size == 2

        await cache.clear()

        assert cache.size == 0

    def test_size_property_returns_entry_count(self) -> None:
        """Test that size property reflects cache state."""
        cache = PlacesCache(ttl_hours=24, max_size=100)

        assert cache.size == 0

        cache._cache["key1"] = ([{"place": "data1"}], 1000000.0)
        assert cache.size == 1

        cache._cache["key2"] = ([{"place": "data2"}], 1000000.0)
        assert cache.size == 2


# ============================================================================
# PlacesCache Concurrency and Key Generation Tests
# ============================================================================


class TestPlacesCacheConcurrency:
    """Tests for PlacesCache thread safety."""

    @pytest.mark.asyncio
    async def test_concurrent_access_is_safe(self, mock_time, monkeypatch) -> None:
        """Test that concurrent get/set operations don't corrupt cache."""
        monkeypatch.setattr(
            "app.services.place_matcher.cache.time.time", mock_time["get"]
        )

        cache = PlacesCache(ttl_hours=24, max_size=100)

        async def write_task(key: str, value: list[dict]) -> None:
            await cache.set(key, value)

        async def read_task(key: str) -> list[dict] | None:
            return await cache.get(key)

        # Run multiple concurrent writes
        write_tasks = [
            write_task(f"key{i}", [{"place": f"data{i}"}]) for i in range(20)
        ]
        await asyncio.gather(*write_tasks)

        # All writes should have succeeded (up to max_size)
        assert cache.size <= 100

        # Run concurrent reads and writes
        mixed_tasks = [
            write_task(f"mixed{i}", [{"place": f"mixed{i}"}]) for i in range(10)
        ] + [read_task(f"key{i}") for i in range(20)]

        results = await asyncio.gather(*mixed_tasks, return_exceptions=True)

        # No exceptions should have occurred
        exceptions = [r for r in results if isinstance(r, Exception)]
        assert len(exceptions) == 0


class TestPlacesCacheCacheKeyGeneration:
    """Tests for cache key generation."""

    def test_get_cache_key_truncates_coordinates(self) -> None:
        """Test that coordinates are truncated to 5 decimal places (~1.1m precision)."""
        cache = PlacesCache()

        key1 = cache.get_cache_key(35.6789123456, 139.6503245678, 30)
        key2 = cache.get_cache_key(35.67891, 139.65032, 30)

        # Both should produce same key due to truncation to 5 decimal places
        assert key1 == key2
        assert key1 == "nearby_35.67891_139.65032_30"

    def test_get_cache_key_type_set_hash_disambiguates(self) -> None:
        """Different included-type sets must produce different keys.

        A narrowed search must never return a wider search's cached result.
        """
        cache = PlacesCache()

        key_no_hash = cache.get_cache_key(35.67891, 139.65032, 30)
        key_hash_a = cache.get_cache_key(35.67891, 139.65032, 30, "aaaa")
        key_hash_b = cache.get_cache_key(35.67891, 139.65032, 30, "bbbb")

        assert key_no_hash == "nearby_35.67891_139.65032_30"
        assert key_hash_a == "nearby_35.67891_139.65032_30_aaaa"
        assert key_hash_a != key_hash_b
        assert key_hash_a != key_no_hash

    def test_get_cache_key_includes_radius(self) -> None:
        """Test that different radii produce different keys."""
        cache = PlacesCache()

        key1 = cache.get_cache_key(35.67912, 139.65034, 30)
        key2 = cache.get_cache_key(35.67912, 139.65034, 75)

        assert key1 != key2
        assert "30" in key1
        assert "75" in key2

    def test_get_cache_key_handles_negative_coordinates(self) -> None:
        """Test that negative coordinates are handled correctly."""
        cache = PlacesCache()

        key = cache.get_cache_key(-33.86881, 151.20934, 30)

        assert "-33.86881" in key
        assert "151.20934" in key


# ============================================================================
# PlacesCache Single-Flight Pattern Tests
# ============================================================================


class TestPlacesCacheSingleFlight:
    """Tests for single-flight pattern in get_or_fetch()."""

    @pytest.mark.asyncio
    async def test_concurrent_requests_make_single_api_call(
        self, mock_time, monkeypatch
    ) -> None:
        """Multiple concurrent requests for same key should only call fetch once."""
        monkeypatch.setattr(
            "app.services.place_matcher.cache.time.time", mock_time["get"]
        )

        cache = PlacesCache(ttl_hours=24, max_size=100)
        call_count = [0]

        async def slow_fetch() -> list[dict]:
            call_count[0] += 1
            await asyncio.sleep(0.1)  # Simulate API latency
            return [{"place": "data"}]

        # Launch 10 concurrent requests for the same key
        tasks = [cache.get_or_fetch("same_key", slow_fetch) for _ in range(10)]
        results = await asyncio.gather(*tasks)

        # All results should be identical
        assert all(r == [{"place": "data"}] for r in results)
        # Only one API call should have been made
        assert call_count[0] == 1

    @pytest.mark.asyncio
    async def test_error_propagates_to_all_waiting_callers(
        self, mock_time, monkeypatch
    ) -> None:
        """When fetch fails, all waiting callers receive the same exception."""
        monkeypatch.setattr(
            "app.services.place_matcher.cache.time.time", mock_time["get"]
        )

        cache = PlacesCache(ttl_hours=24, max_size=100)

        async def failing_fetch() -> list[dict]:
            await asyncio.sleep(0.1)
            raise ValueError("API error")

        # Launch 5 concurrent requests for the same key
        tasks = [cache.get_or_fetch("error_key", failing_fetch) for _ in range(5)]
        results = await asyncio.gather(*tasks, return_exceptions=True)

        # All callers should receive the same exception type
        assert all(isinstance(r, ValueError) for r in results)
        assert all(str(r) == "API error" for r in results)

    @pytest.mark.asyncio
    async def test_in_flight_cleanup_on_success(self, mock_time, monkeypatch) -> None:
        """In-flight tracking is cleaned up after successful fetch."""
        monkeypatch.setattr(
            "app.services.place_matcher.cache.time.time", mock_time["get"]
        )

        cache = PlacesCache(ttl_hours=24, max_size=100)

        async def fetch() -> list[dict]:
            return [{"place": "data"}]

        # Verify in-flight is empty before
        assert len(cache._in_flight) == 0

        await cache.get_or_fetch("key1", fetch)

        # In-flight should be cleaned up after success
        assert len(cache._in_flight) == 0
        # But cache should have the entry
        assert cache.size == 1

    @pytest.mark.asyncio
    async def test_in_flight_cleanup_on_failure(self, mock_time, monkeypatch) -> None:
        """In-flight tracking is cleaned up after failed fetch."""
        monkeypatch.setattr(
            "app.services.place_matcher.cache.time.time", mock_time["get"]
        )

        cache = PlacesCache(ttl_hours=24, max_size=100)

        async def failing_fetch() -> list[dict]:
            raise ValueError("API error")

        # Verify in-flight is empty before
        assert len(cache._in_flight) == 0

        with pytest.raises(ValueError):
            await cache.get_or_fetch("key1", failing_fetch)

        # In-flight should be cleaned up after failure
        assert len(cache._in_flight) == 0
        # Cache should remain empty
        assert cache.size == 0

    @pytest.mark.asyncio
    async def test_cache_expiry_during_concurrent_reads(
        self, mock_time, monkeypatch
    ) -> None:
        """When cache expires during concurrent reads, only one refetch occurs."""
        monkeypatch.setattr(
            "app.services.place_matcher.cache.time.time", mock_time["get"]
        )

        cache = PlacesCache(ttl_hours=1, max_size=100)
        call_count = [0]

        async def fetch() -> list[dict]:
            call_count[0] += 1
            await asyncio.sleep(0.05)
            return [{"place": f"data-{call_count[0]}"}]

        # Pre-populate cache
        await cache.set("key1", [{"place": "old-data"}])
        assert call_count[0] == 0  # fetch wasn't called

        # Advance time past TTL
        mock_time["advance"](3601)

        # Launch concurrent requests - cache is expired, should trigger refetch
        tasks = [cache.get_or_fetch("key1", fetch) for _ in range(5)]
        results = await asyncio.gather(*tasks)

        # Only one refetch should have occurred
        assert call_count[0] == 1
        # All results should be from the refetch
        assert all(r == [{"place": "data-1"}] for r in results)

    @pytest.mark.asyncio
    async def test_different_keys_fetch_independently(
        self, mock_time, monkeypatch
    ) -> None:
        """Different keys should fetch independently, not share in-flight."""
        monkeypatch.setattr(
            "app.services.place_matcher.cache.time.time", mock_time["get"]
        )

        cache = PlacesCache(ttl_hours=24, max_size=100)
        call_count = {"key1": 0, "key2": 0}

        async def fetch_for_key(key: str) -> list[dict]:
            call_count[key] += 1
            await asyncio.sleep(0.05)
            return [{"place": f"data-{key}"}]

        # Launch concurrent requests for two different keys
        tasks = [
            cache.get_or_fetch("key1", lambda: fetch_for_key("key1")),
            cache.get_or_fetch("key1", lambda: fetch_for_key("key1")),
            cache.get_or_fetch("key2", lambda: fetch_for_key("key2")),
            cache.get_or_fetch("key2", lambda: fetch_for_key("key2")),
        ]
        results = await asyncio.gather(*tasks)

        # Each key should be fetched exactly once
        assert call_count["key1"] == 1
        assert call_count["key2"] == 1
        # Results should match their keys
        assert results[0] == results[1] == [{"place": "data-key1"}]
        assert results[2] == results[3] == [{"place": "data-key2"}]

    @pytest.mark.asyncio
    async def test_cancelled_owner_cleans_up_in_flight(
        self, mock_time, monkeypatch
    ) -> None:
        """When the owner task is cancelled, in-flight is cleaned up and waiters don't hang."""
        monkeypatch.setattr(
            "app.services.place_matcher.cache.time.time", mock_time["get"]
        )

        cache = PlacesCache(ttl_hours=24, max_size=100)
        fetch_started = asyncio.Event()

        async def slow_fetch() -> list[dict]:
            fetch_started.set()
            await asyncio.sleep(10)  # Will be cancelled before completing
            return [{"place": "data"}]

        # Start the owner task
        owner_task = asyncio.create_task(cache.get_or_fetch("cancel_key", slow_fetch))
        await fetch_started.wait()

        # Start a waiter that will await the owner's future
        waiter_task = asyncio.create_task(cache.get_or_fetch("cancel_key", slow_fetch))
        await asyncio.sleep(0.01)  # Let waiter register

        # Cancel the owner task
        owner_task.cancel()
        with pytest.raises(asyncio.CancelledError):
            await owner_task

        # Waiter should not hang - it should get CancelledError
        with pytest.raises((asyncio.CancelledError, Exception)):
            await asyncio.wait_for(waiter_task, timeout=1.0)

        # In-flight should be cleaned up so new requests can proceed
        assert len(cache._in_flight) == 0

    @pytest.mark.asyncio
    async def test_retry_succeeds_after_previous_failure(
        self, mock_time, monkeypatch
    ) -> None:
        """After a failed fetch, a new request for the same key retries and succeeds."""
        monkeypatch.setattr(
            "app.services.place_matcher.cache.time.time", mock_time["get"]
        )

        cache = PlacesCache(ttl_hours=24, max_size=100)

        async def failing_fetch() -> list[dict]:
            raise ValueError("transient error")

        async def succeeding_fetch() -> list[dict]:
            return [{"place": "recovered"}]

        # First request fails
        with pytest.raises(ValueError):
            await cache.get_or_fetch("retry_key", failing_fetch)

        # In-flight should be cleaned up
        assert len(cache._in_flight) == 0

        # Second request should retry and succeed
        result = await cache.get_or_fetch("retry_key", succeeding_fetch)
        assert result == [{"place": "recovered"}]


# ============================================================================
# Partial Cluster Failure Tests
# ============================================================================


class TestFindPlacesForClustersPartialFailures:
    """Tests for partial failure handling in find_places_for_clusters."""

    @pytest.fixture
    def sample_clusters(self) -> list[dict[str, Any]]:
        """Generate test clusters."""
        return [
            {
                "id": f"cluster-{i}",
                "centroid": {"latitude": 35.6762 + i * 0.01, "longitude": 139.6503},
                "photos": [{"asset_id": f"photo-{i}-1"}],
            }
            for i in range(5)
        ]

    @pytest.fixture
    def mock_places_response(self) -> dict[str, Any]:
        """Sample Places API response with quality fields."""
        return {
            "places": [
                {
                    "id": "place-123",
                    "displayName": {"text": "Test Restaurant"},
                    "formattedAddress": "123 Test St",
                    "location": {"latitude": 35.6762, "longitude": 139.6503},
                    "primaryType": "restaurant",
                    "types": ["restaurant", "food"],
                    "rating": 4.5,
                    "userRatingCount": 100,
                    "businessStatus": "OPERATIONAL",
                }
            ]
        }

    @pytest.fixture
    def mock_settings(self, monkeypatch):
        """Mock settings for PlaceMatcher tests."""
        settings = MagicMock()
        settings.google_places_api_key = "test-key"
        settings.places_api_timeout_seconds = 5.0
        settings.places_cluster_timeout_seconds = 15.0
        # Real values for the recall tunables read by _search_nearby_tiered;
        # a bare MagicMock attribute would break the `>=` comparison / `if`.
        settings.places_min_quality_results_before_stop = 5
        settings.places_diagnostics = False
        monkeypatch.setattr(
            "app.services.place_matcher.matcher.get_settings", lambda: settings
        )
        return settings

    @pytest.fixture
    async def clean_cache(self):
        """Clear the module-level places cache before each test."""
        from app.services.place_matcher import places_cache

        await places_cache.clear()
        yield
        await places_cache.clear()

    @pytest.mark.asyncio
    async def test_returns_successful_results_when_some_clusters_fail(
        self,
        sample_clusters,
        mock_places_response,
        mock_settings,
        clean_cache,
    ) -> None:
        """Test that successful cluster results are returned despite failures."""
        # Track which clusters should fail by their latitude (unique per cluster)
        fail_latitudes = {35.6862, 35.7062}  # Clusters 1 and 3

        async def mock_post(*args, **kwargs):
            # Extract latitude from request to identify the cluster
            request_json = kwargs.get("json", {})
            location = request_json.get("locationRestriction", {}).get("circle", {})
            center = location.get("center", {})
            lat = center.get("latitude", 0)

            # Fail if this latitude matches a cluster that should fail
            if any(abs(lat - fail_lat) < 0.001 for fail_lat in fail_latitudes):
                raise httpx.TimeoutException("Simulated timeout")

            # Success response for others
            mock_response = MagicMock()
            mock_response.status_code = 200
            mock_response.json.return_value = mock_places_response
            return mock_response

        mock_client = AsyncMock()
        mock_client.post = mock_post

        matcher = PlaceMatcher(http_client=mock_client)
        results, failed_count = await matcher.find_places_for_clusters(sample_clusters)

        # Should have 3 successful results (5 clusters - 2 failures)
        assert len(results) == 3
        assert failed_count == 2
        # All results should have valid structure
        for result in results:
            assert "cluster_id" in result
            assert "places" in result

    @pytest.mark.asyncio
    async def test_handles_timeout_for_individual_cluster(
        self,
        sample_clusters,
        mock_places_response,
        mock_settings,
        clean_cache,
        monkeypatch,
    ) -> None:
        """Test that per-cluster timeout is handled gracefully."""
        # Use a very short cluster timeout
        mock_settings.places_cluster_timeout_seconds = 0.01

        async def slow_post(*args, **kwargs):
            await asyncio.sleep(1)  # Will exceed the 0.01s timeout
            mock_response = MagicMock()
            mock_response.status_code = 200
            mock_response.json.return_value = mock_places_response
            return mock_response

        mock_client = AsyncMock()
        mock_client.post = slow_post

        matcher = PlaceMatcher(http_client=mock_client)

        # All clusters should timeout, but no exception should be raised
        results, failed_count = await matcher.find_places_for_clusters(
            sample_clusters[:2]
        )

        # All clusters timed out, so empty results
        assert len(results) == 0
        assert failed_count == 2

    @pytest.mark.asyncio
    async def test_handles_http_error_for_individual_cluster(
        self,
        sample_clusters,
        mock_places_response,
        mock_settings,
        clean_cache,
    ) -> None:
        """Test that HTTP errors for one cluster don't affect others."""
        # Cluster 2 has latitude 35.6962 - fail HTTP for that one
        fail_latitude = 35.6962

        async def mock_post(*args, **kwargs):
            # Extract latitude from request to identify the cluster
            request_json = kwargs.get("json", {})
            location = request_json.get("locationRestriction", {}).get("circle", {})
            center = location.get("center", {})
            lat = center.get("latitude", 0)

            # Return HTTP 500 for the target cluster
            if abs(lat - fail_latitude) < 0.001:
                mock_response = MagicMock()
                mock_response.status_code = 500
                mock_response.text = "Internal Server Error"
                return mock_response

            # Success response for others
            mock_response = MagicMock()
            mock_response.status_code = 200
            mock_response.json.return_value = mock_places_response
            return mock_response

        mock_client = AsyncMock()
        mock_client.post = mock_post

        matcher = PlaceMatcher(http_client=mock_client)
        results, failed_count = await matcher.find_places_for_clusters(sample_clusters)

        # Should have 5 results (HTTP error cluster returns with empty places)
        # Failed count includes only the HTTP error (not "no places found" clusters)
        assert len(results) == 5
        assert failed_count == 0  # HTTP 500 returns empty places, not an exception

        # Verify the failed cluster has empty places
        failed_cluster = next(r for r in results if r["cluster_id"] == "cluster-2")
        assert failed_cluster["places"] == []

    @pytest.mark.asyncio
    async def test_handles_rate_limit_error_gracefully(
        self,
        sample_clusters,
        mock_places_response,
        mock_settings,
        clean_cache,
    ) -> None:
        """Test that RateLimitError is filtered as exception."""
        call_count = [0]

        async def mock_post(*args, **kwargs):
            idx = call_count[0]
            call_count[0] += 1

            # Cluster 3 raises rate limit (429)
            if idx == 3:
                mock_response = MagicMock()
                mock_response.status_code = 429
                mock_response.json.return_value = {
                    "error": {"status": "RESOURCE_EXHAUSTED"}
                }
                return mock_response

            # Success response for others
            mock_response = MagicMock()
            mock_response.status_code = 200
            mock_response.json.return_value = mock_places_response
            return mock_response

        mock_client = AsyncMock()
        mock_client.post = mock_post

        matcher = PlaceMatcher(http_client=mock_client)
        results, failed_count = await matcher.find_places_for_clusters(sample_clusters)

        # RateLimitError gets raised and filtered, other clusters succeed
        assert len(results) == 4
        assert failed_count == 1

    @pytest.mark.asyncio
    async def test_all_clusters_fail_returns_empty_list(
        self,
        sample_clusters,
        mock_settings,
        clean_cache,
    ) -> None:
        """Test that if all clusters fail, empty list is returned."""

        async def mock_post(*args, **kwargs):
            raise httpx.TimeoutException("All fail")

        mock_client = AsyncMock()
        mock_client.post = mock_post

        matcher = PlaceMatcher(http_client=mock_client)
        results, failed_count = await matcher.find_places_for_clusters(sample_clusters)

        # All clusters failed, return empty list
        assert results == []
        assert failed_count == 5

    @pytest.mark.asyncio
    async def test_no_results_for_cluster_returns_empty_places(
        self,
        sample_clusters,
        mock_settings,
        clean_cache,
    ) -> None:
        """Test that clusters with no places return with empty places array."""

        async def mock_post(*args, **kwargs):
            # Return empty places list
            mock_response = MagicMock()
            mock_response.status_code = 200
            mock_response.json.return_value = {"places": []}
            return mock_response

        mock_client = AsyncMock()
        mock_client.post = mock_post

        matcher = PlaceMatcher(http_client=mock_client)
        results, failed_count = await matcher.find_places_for_clusters(sample_clusters)

        # All clusters returned no places - but they're still included in results
        # This allows the UI to display "photo-only" cards for manual entry
        assert len(results) == 5
        assert failed_count == 0
        # All should have empty places
        for result in results:
            assert result["places"] == []

    @pytest.mark.asyncio
    async def test_mixed_success_empty_and_exceptions(
        self,
        sample_clusters,
        mock_places_response,
        mock_settings,
        clean_cache,
    ) -> None:
        """Test combination of successes, empty results, and exceptions."""
        # Use latitudes to identify clusters (more reliable than call count)
        # Clusters have latitudes: 35.6762, 35.6862, 35.6962, 35.7062, 35.7162
        # Note: httpx.TimeoutException is the only way to reliably fail a cluster
        # because httpx.RequestError triggers tenacity retries which may succeed
        timeout_lat_1 = 35.6962  # Cluster 2: throws timeout
        timeout_lat_2 = 35.7162  # Cluster 4: throws timeout
        empty_lat = 35.6862  # Cluster 1: returns empty places

        async def mock_post(*args, **kwargs):
            request_json = kwargs.get("json", {})
            location = request_json.get("locationRestriction", {}).get("circle", {})
            center = location.get("center", {})
            lat = center.get("latitude", 0)

            # Cluster 2 and 4: Timeout (these reliably fail)
            if abs(lat - timeout_lat_1) < 0.001 or abs(lat - timeout_lat_2) < 0.001:
                raise httpx.TimeoutException("Timeout")

            # Cluster 1: Empty places (all radii)
            if abs(lat - empty_lat) < 0.001:
                mock_response = MagicMock()
                mock_response.status_code = 200
                mock_response.json.return_value = {"places": []}
                return mock_response

            # All other clusters: Success
            mock_response = MagicMock()
            mock_response.status_code = 200
            mock_response.json.return_value = mock_places_response
            return mock_response

        mock_client = AsyncMock()
        mock_client.post = mock_post

        matcher = PlaceMatcher(http_client=mock_client)
        results, failed_count = await matcher.find_places_for_clusters(sample_clusters)

        # Should have 3 results:
        # - Cluster 0: success with places
        # - Cluster 1: success with empty places (no longer counted as failed)
        # - Cluster 3: success with places
        # Failures: cluster 2 (timeout), cluster 4 (timeout)
        assert len(results) == 3
        assert failed_count == 2

        # Verify cluster 1 has empty places
        empty_cluster = next(
            (r for r in results if r["cluster_id"] == "cluster-1"), None
        )
        assert empty_cluster is not None
        assert empty_cluster["places"] == []


# ============================================================================
# Quality Filtering Tests
# ============================================================================


class TestQualityFiltering:
    """Tests for the _filter_low_quality_places method."""

    @pytest.fixture
    def matcher(self, monkeypatch):
        """Create a PlaceMatcher with mocked settings."""
        settings = MagicMock()
        settings.google_places_api_key = "test-key"
        settings.places_api_timeout_seconds = 5.0
        settings.places_cluster_timeout_seconds = 15.0
        settings.places_min_quality_results_before_stop = 5
        settings.places_diagnostics = False
        monkeypatch.setattr(
            "app.services.place_matcher.matcher.get_settings", lambda: settings
        )
        mock_client = AsyncMock()
        return PlaceMatcher(http_client=mock_client)

    def test_filters_places_with_no_name(self, matcher) -> None:
        """Test that places with empty display name are filtered out."""
        places = [
            {
                "id": "place-1",
                "displayName": {"text": ""},
                "userRatingCount": 100,
                "primaryType": "restaurant",
            },
            {
                "id": "place-2",
                "displayName": {},
                "userRatingCount": 50,
                "primaryType": "cafe",
            },
            {
                "id": "place-3",
                "displayName": {"text": "Good Restaurant"},
                "userRatingCount": 10,
                "primaryType": "restaurant",
            },
        ]

        filtered = matcher._filter_low_quality_places(places)

        assert len(filtered) == 1
        assert filtered[0]["id"] == "place-3"

    def test_filters_permanently_closed_places(self, matcher) -> None:
        """Test that permanently closed places are filtered out."""
        places = [
            {
                "id": "place-1",
                "displayName": {"text": "Closed Restaurant"},
                "businessStatus": "CLOSED_PERMANENTLY",
                "userRatingCount": 100,
                "primaryType": "restaurant",
            },
            {
                "id": "place-2",
                "displayName": {"text": "Open Restaurant"},
                "businessStatus": "OPERATIONAL",
                "userRatingCount": 10,
                "primaryType": "restaurant",
            },
        ]

        filtered = matcher._filter_low_quality_places(places)

        assert len(filtered) == 1
        assert filtered[0]["id"] == "place-2"

    def test_filters_places_with_few_reviews(self, matcher) -> None:
        """Test that places with fewer than MIN_REVIEW_COUNT reviews are filtered."""
        places = [
            {
                "id": "place-1",
                "displayName": {"text": "Few Reviews"},
                "userRatingCount": MIN_REVIEW_COUNT - 1,
                "primaryType": "restaurant",
            },
            {
                "id": "place-2",
                "displayName": {"text": "Enough Reviews"},
                "userRatingCount": MIN_REVIEW_COUNT,
                "primaryType": "restaurant",
            },
            {
                "id": "place-3",
                "displayName": {"text": "Many Reviews"},
                "userRatingCount": 100,
                "primaryType": "cafe",
            },
        ]

        filtered = matcher._filter_low_quality_places(places)

        assert len(filtered) == 2
        assert {p["id"] for p in filtered} == {"place-2", "place-3"}

    def test_institutional_types_pass_without_reviews(self, matcher) -> None:
        """Test that institutional types pass even without reviews."""
        places = [
            {
                "id": "place-1",
                "displayName": {"text": "Local Museum"},
                "userRatingCount": 0,
                "primaryType": "museum",
            },
            {
                "id": "place-2",
                "displayName": {"text": "National Park"},
                "userRatingCount": 2,
                "primaryType": "national_park",
            },
            {
                "id": "place-3",
                "displayName": {"text": "Random Cafe"},
                "userRatingCount": 2,
                "primaryType": "cafe",
            },
        ]

        filtered = matcher._filter_low_quality_places(places)

        # Museum and national_park pass (institutional), cafe filtered (not enough reviews)
        assert len(filtered) == 2
        assert {p["id"] for p in filtered} == {"place-1", "place-2"}

    def test_all_institutional_types_are_recognized(self, matcher) -> None:
        """Test that all defined institutional types pass the filter."""
        for inst_type in INSTITUTIONAL_TYPES:
            places = [
                {
                    "id": f"place-{inst_type}",
                    "displayName": {"text": f"Test {inst_type}"},
                    "userRatingCount": 0,  # No reviews
                    "primaryType": inst_type,
                }
            ]

            filtered = matcher._filter_low_quality_places(places)

            assert len(filtered) == 1, f"Institutional type '{inst_type}' should pass"

    def test_handles_missing_fields_gracefully(self, matcher) -> None:
        """Test that places with missing optional fields are handled.

        With the two-pass field mask (U3), the WIDE search omits rating fields,
        so a place without ``userRatingCount`` skips the review-count gate (the
        gate is re-applied after the finalist is enriched). Both places pass.
        """
        places = [
            {
                "id": "place-1",
                "displayName": {"text": "Good Place"},
                # Missing userRatingCount, businessStatus, primaryType
            },
            {
                "id": "place-2",
                "displayName": {"text": "Place with Museum Type"},
                "primaryType": "museum",
                # Missing userRatingCount
            },
        ]

        filtered = matcher._filter_low_quality_places(places)

        # Both pass: review-count gate is skipped when userRatingCount is absent.
        assert len(filtered) == 2
        assert {p["id"] for p in filtered} == {"place-1", "place-2"}

    def test_drop_counts_tally_each_reason(self, matcher) -> None:
        """An optional drop_counts dict is populated with per-reason tallies."""
        places = [
            # Non-tourist primary type -> non_tourist
            {
                "id": "nt",
                "displayName": {"text": "Gas Station"},
                "primaryType": "gas_station",
                "types": ["gas_station"],
                "userRatingCount": 100,
            },
            # Permanently closed -> closed
            {
                "id": "cl",
                "displayName": {"text": "Closed Cafe"},
                "primaryType": "cafe",
                "types": ["cafe"],
                "businessStatus": "CLOSED_PERMANENTLY",
                "userRatingCount": 100,
            },
            # Empty name -> no_name
            {
                "id": "nn",
                "displayName": {"text": ""},
                "primaryType": "restaurant",
                "types": ["restaurant"],
                "userRatingCount": 100,
            },
            # Three valid places (carry ratings so the gate doesn't drop them)
            {
                "id": "ok-1",
                "displayName": {"text": "Good One"},
                "primaryType": "restaurant",
                "types": ["restaurant"],
                "userRatingCount": 100,
            },
            {
                "id": "ok-2",
                "displayName": {"text": "Good Two"},
                "primaryType": "cafe",
                "types": ["cafe"],
                "userRatingCount": 50,
            },
            {
                "id": "ok-3",
                "displayName": {"text": "Good Three"},
                "primaryType": "museum",
                "types": ["museum"],
                "userRatingCount": 25,
            },
        ]

        drop_counts: dict[str, int] = {}
        filtered = matcher._filter_low_quality_places(places, drop_counts=drop_counts)

        assert len(filtered) == 3
        assert drop_counts == {
            "non_tourist": 1,
            "closed": 1,
            "no_name": 1,
            "low_reviews": 0,
        }

    def test_drop_counts_low_reviews_zero_in_search_phase(self, matcher) -> None:
        """In the wide/search phase (no userRatingCount) low_reviews stays 0.

        Even with a place that WOULD fail the review gate, the gate doesn't fire
        without a rating count, so the trace must not read "reviews never
        filter" — it must distinguish search-phase 0 from enrich-phase nonzero.
        """
        places = [
            {
                "id": "wide",
                "displayName": {"text": "Wide Pass Place"},
                "primaryType": "cafe",
                "types": ["cafe"],
                # No userRatingCount -> gate skipped even though it'd fail
            },
        ]

        drop_counts: dict[str, int] = {}
        filtered = matcher._filter_low_quality_places(places, drop_counts=drop_counts)

        assert len(filtered) == 1
        assert drop_counts["low_reviews"] == 0

    def test_drop_counts_low_reviews_nonzero_in_enrich_phase(self, matcher) -> None:
        """With ratings present, a sub-threshold non-institutional place tallies."""
        places = [
            {
                "id": "few",
                "displayName": {"text": "Few Reviews"},
                "primaryType": "cafe",
                "types": ["cafe"],
                "userRatingCount": MIN_REVIEW_COUNT - 1,
            },
        ]

        drop_counts: dict[str, int] = {}
        filtered = matcher._filter_low_quality_places(places, drop_counts=drop_counts)

        assert filtered == []
        assert drop_counts["low_reviews"] == 1

    def test_drop_counts_optional_no_behavior_change(self, matcher) -> None:
        """Omitting drop_counts leaves the filtered result identical."""
        places = [
            {
                "id": "ok",
                "displayName": {"text": "Good"},
                "primaryType": "restaurant",
                "types": ["restaurant"],
                "userRatingCount": 100,
            },
            {
                "id": "nt",
                "displayName": {"text": "Laundry"},
                "primaryType": "laundry",
                "types": ["laundry"],
                "userRatingCount": 100,
            },
        ]

        filtered = matcher._filter_low_quality_places(places)

        assert [p["id"] for p in filtered] == ["ok"]


class TestQualityRanking:
    """Tests for quality-based tie-breaking in ranking."""

    @pytest.fixture
    def matcher(self, monkeypatch):
        """Create a PlaceMatcher with mocked settings."""
        settings = MagicMock()
        settings.google_places_api_key = "test-key"
        settings.places_api_timeout_seconds = 5.0
        settings.places_cluster_timeout_seconds = 15.0
        settings.places_min_quality_results_before_stop = 5
        settings.places_diagnostics = False
        monkeypatch.setattr(
            "app.services.place_matcher.matcher.get_settings", lambda: settings
        )
        mock_client = AsyncMock()
        return PlaceMatcher(http_client=mock_client)

    def test_ranks_by_distance_primarily(self, matcher) -> None:
        """Test that distance is the primary ranking factor."""
        cluster = {
            "centroid": {"latitude": 35.6762, "longitude": 139.6503},
        }
        # Place 1: far but many reviews
        # Place 2: close but few reviews
        places = [
            {
                "id": "place-1",
                "displayName": {"text": "Far Place"},
                "location": {"latitude": 35.6862, "longitude": 139.6503},  # ~1km away
                "userRatingCount": 1000,
                "primaryType": "restaurant",
                "types": ["restaurant"],
            },
            {
                "id": "place-2",
                "displayName": {"text": "Close Place"},
                "location": {"latitude": 35.6763, "longitude": 139.6503},  # ~11m away
                "userRatingCount": 5,
                "primaryType": "cafe",
                "types": ["cafe"],
            },
        ]

        ranked = matcher._rank_by_distance(places, cluster)

        # Close place should be first despite fewer reviews
        assert ranked[0]["place_id"] == "place-2"
        assert ranked[1]["place_id"] == "place-1"

    def test_uses_review_count_for_tie_breaking(self, matcher) -> None:
        """Test that review count breaks ties for places at similar distances."""
        cluster = {
            "centroid": {"latitude": 35.6762, "longitude": 139.6503},
        }
        # Both places are within same 5m bucket (2m vs 3m)
        places = [
            {
                "id": "place-1",
                "displayName": {"text": "Few Reviews"},
                "location": {"latitude": 35.67622, "longitude": 139.6503},  # ~2m
                "userRatingCount": 10,
                "primaryType": "restaurant",
                "types": ["restaurant"],
            },
            {
                "id": "place-2",
                "displayName": {"text": "Many Reviews"},
                "location": {"latitude": 35.67623, "longitude": 139.6503},  # ~3m
                "userRatingCount": 500,
                "primaryType": "restaurant",
                "types": ["restaurant"],
            },
        ]

        ranked = matcher._rank_by_distance(places, cluster)

        # Many reviews should come first (same distance bucket, higher quality)
        assert ranked[0]["place_id"] == "place-2"
        assert ranked[1]["place_id"] == "place-1"

    def test_rating_count_not_in_response(self, matcher) -> None:
        """Test that internal _rating_count field is not in the response."""
        cluster = {
            "centroid": {"latitude": 35.6762, "longitude": 139.6503},
        }
        places = [
            {
                "id": "place-1",
                "displayName": {"text": "Test Place"},
                "location": {"latitude": 35.6763, "longitude": 139.6503},
                "userRatingCount": 100,
                "primaryType": "restaurant",
                "types": ["restaurant"],
            },
        ]

        ranked = matcher._rank_by_distance(places, cluster)

        assert "_rating_count" not in ranked[0]
        assert "_rating" not in ranked[0]
        assert "_primary_type" not in ranked[0]
        assert "place_id" in ranked[0]
        assert "name" in ranked[0]
        assert "distance_m" in ranked[0]


# ============================================================================
# Density Detection Tests
# ============================================================================


class TestDensityDetection:
    """Tests for _detect_density static method."""

    def test_dense_when_3_or_more_results(self) -> None:
        assert PlaceMatcher._detect_density(3) == DensityLevel.DENSE
        assert PlaceMatcher._detect_density(10) == DensityLevel.DENSE

    def test_medium_when_1_or_2_results(self) -> None:
        assert PlaceMatcher._detect_density(1) == DensityLevel.MEDIUM
        assert PlaceMatcher._detect_density(2) == DensityLevel.MEDIUM

    def test_sparse_when_0_results(self) -> None:
        assert PlaceMatcher._detect_density(0) == DensityLevel.SPARSE


# ============================================================================
# Tiered Search Radius Reuse Tests (U2)
# ============================================================================


def _quality_place(place_id: str = "p1") -> dict:
    """A minimal place that survives _filter_low_quality_places."""
    return {
        "id": place_id,
        "displayName": {"text": "Test Cafe"},
        "primaryType": "cafe",
        "types": ["cafe"],
        "userRatingCount": 100,
        "rating": 4.5,
        "businessStatus": "OPERATIONAL",
        "location": {"latitude": 0.0, "longitude": 0.0},
    }


class TestTieredSearchRadiusReuse:
    """`_search_nearby_tiered` must never re-search a radius and must not drop
    the sparse profile's smallest tier (regression for the old `[1:]` slice)."""

    def _matcher_recording_radii(
        self, radii_seen: list[int], results_by_radius: dict[int, list[dict]]
    ) -> PlaceMatcher:
        matcher = PlaceMatcher(http_client=MagicMock())
        # get_settings() is lru_cached, so the matcher shares one global Settings
        # instance. Give each test matcher its own copy so per-test overrides
        # (stop threshold, diagnostics) don't leak across tests.
        matcher._settings = matcher._settings.model_copy()

        async def fake_execute_search(latitude, longitude, radius):
            radii_seen.append(int(radius))
            return results_by_radius.get(int(radius), [])

        matcher._execute_search = fake_execute_search  # type: ignore[method-assign]
        return matcher

    @pytest.mark.asyncio
    async def test_dense_stops_when_enough_candidates(self) -> None:
        # 5+ quality results at 15m satisfy MIN_QUALITY_RESULTS_BEFORE_STOP ->
        # stop after a single call.
        radii_seen: list[int] = []
        results = {15: [_quality_place(f"p{i}") for i in range(5)]}
        matcher = self._matcher_recording_radii(radii_seen, results)

        result = await matcher._search_nearby_tiered(0.0, 0.0)
        places, radius_used = result.places, result.radius_used

        assert radius_used == 15
        assert len(places) == 5
        assert radii_seen == [15]  # no redundant calls
        assert result.radii_searched == {15}
        assert result.stopped_early is True

    @pytest.mark.asyncio
    async def test_dense_accumulates_across_tiers_until_min_candidates(self) -> None:
        # 3 quality results at 15m used to stop the search cold; with GPS drift
        # the visited place is often one tier out. Now the search expands and
        # UNIONS results until it has MIN_QUALITY_RESULTS_BEFORE_STOP candidates.
        radii_seen: list[int] = []
        results = {
            15: [_quality_place(f"p{i}") for i in range(3)],
            # 35m returns one duplicate of p0 plus two new places
            35: [_quality_place("p0"), _quality_place("p3"), _quality_place("p4")],
        }
        matcher = self._matcher_recording_radii(radii_seen, results)

        result = await matcher._search_nearby_tiered(0.0, 0.0)
        places, radius_used = result.places, result.radius_used

        assert radii_seen == [15, 35]  # stopped once 5 candidates accumulated
        assert radius_used == 35
        assert [p["id"] for p in places] == ["p0", "p1", "p2", "p3", "p4"]
        assert result.radii_searched == {15, 35}

    @pytest.mark.asyncio
    async def test_no_radius_searched_twice(self) -> None:
        # Empty everywhere: every density tier is attempted exactly once, and the
        # 15m probe radius is never re-issued by the expansion loop.
        radii_seen: list[int] = []
        matcher = self._matcher_recording_radii(radii_seen, {})

        result = await matcher._search_nearby_tiered(0.0, 0.0)

        assert len(radii_seen) == len(set(radii_seen))  # no duplicates
        # Exhausted all configured radii without reaching the threshold.
        assert result.stopped_early is False
        assert result.radii_searched == set(radii_seen)

    @pytest.mark.asyncio
    async def test_medium_does_not_repeat_15m_probe(self) -> None:
        # 1-2 raw results at 15m -> MEDIUM ([15, 50, 125]); none pass quality so
        # we expand. The 15m tier must not be searched a second time.
        radii_seen: list[int] = []
        # One low-quality place at 15m (passes density >=1, fails quality filter)
        low_quality = {
            "id": "lq",
            "displayName": {"text": "Laundro"},
            "primaryType": "laundry",
            "types": ["laundry"],
            "userRatingCount": 0,
            "businessStatus": "OPERATIONAL",
            "location": {"latitude": 0.0, "longitude": 0.0},
        }
        results = {15: [low_quality], 50: [_quality_place()]}
        matcher = self._matcher_recording_radii(radii_seen, results)

        result = await matcher._search_nearby_tiered(0.0, 0.0)
        places, radius_used = result.places, result.radius_used

        assert radius_used == 50
        # 15 not repeated; 125m tier still attempted (only 1 candidate so far,
        # below MIN_QUALITY_RESULTS_BEFORE_STOP)
        assert radii_seen == [15, 50, 125]
        assert len(places) == 1
        # Only 1 quality candidate < threshold, so the radii were exhausted.
        assert result.stopped_early is False
        assert result.radii_searched == {15, 50, 125}

    @pytest.mark.asyncio
    async def test_sparse_skips_redundant_25m_tier(self) -> None:
        # 0 results at 15m -> SPARSE ([100, 250]). The 25m tier was removed:
        # it nearly duplicates the 15m probe's coverage and in empty areas it
        # was a guaranteed wasted paid call.
        radii_seen: list[int] = []
        results = {100: [_quality_place()]}
        matcher = self._matcher_recording_radii(radii_seen, results)

        result = await matcher._search_nearby_tiered(0.0, 0.0)
        places, radius_used = result.places, result.radius_used

        assert radius_used == 100
        assert 25 not in radii_seen
        assert radii_seen == [15, 100, 250]
        assert len(places) == 1

    @pytest.mark.asyncio
    async def test_result_carries_raw_count_per_radius(self) -> None:
        # Happy path: stop at tier 1 -> result.raw_count_per_radius[15] equals
        # the mock's raw count (BEFORE filtering), keys match radii_searched.
        radii_seen: list[int] = []
        raw = [_quality_place(f"p{i}") for i in range(6)]
        results = {15: raw}
        matcher = self._matcher_recording_radii(radii_seen, results)

        result = await matcher._search_nearby_tiered(0.0, 0.0)

        assert result.stopped_early is True
        assert result.radii_searched == {15}
        assert result.raw_count_per_radius == {15: 6}
        # raw_count keys are exactly the radii searched.
        assert set(result.raw_count_per_radius.keys()) == result.radii_searched

    @pytest.mark.asyncio
    async def test_raised_threshold_reaches_outer_radius(self) -> None:
        # Edge: raising the stop threshold via config makes the search reach an
        # outer radius it would otherwise have skipped (proves the config wiring).
        # 5 quality results at 15m would normally stop at tier 1; raise the
        # threshold to 6 so the search must expand to the 35m dense tier.
        radii_seen: list[int] = []
        results = {
            15: [_quality_place(f"p{i}") for i in range(5)],
            35: [_quality_place("p5")],
        }
        matcher = self._matcher_recording_radii(radii_seen, results)
        matcher._settings.places_min_quality_results_before_stop = 6

        result = await matcher._search_nearby_tiered(0.0, 0.0)

        # With the default threshold (5) this would have stopped at {15}.
        assert 35 in result.radii_searched
        assert result.radii_searched == {15, 35}
        assert result.radius_used == 35
        assert len(result.places) == 6

    @pytest.mark.asyncio
    async def test_radius_used_consistent_with_stopped_early(self) -> None:
        # Edge: when the threshold is NOT met, stopped_early is False and every
        # configured radius is searched; radius_used reflects the last
        # contributing tier. 0 results at 15m -> SPARSE profile ([100, 250]);
        # the only contributing tier is 100.
        radii_seen: list[int] = []
        results = {100: [_quality_place()]}
        matcher = self._matcher_recording_radii(radii_seen, results)

        result = await matcher._search_nearby_tiered(0.0, 0.0)

        assert result.stopped_early is False
        assert result.radius_used == 100
        assert set(result.raw_count_per_radius.keys()) == result.radii_searched

    @pytest.mark.asyncio
    async def test_diagnostics_off_omits_raw_places(self) -> None:
        # Edge: diagnostics off (default) -> raw_places_per_radius is empty {},
        # but the cheap scalar fields are still populated.
        radii_seen: list[int] = []
        results = {15: [_quality_place(f"p{i}") for i in range(5)]}
        matcher = self._matcher_recording_radii(radii_seen, results)
        assert matcher._settings.places_diagnostics is False

        result = await matcher._search_nearby_tiered(0.0, 0.0)

        assert result.raw_places_per_radius == {}
        # Scalars still present.
        assert result.radii_searched == {15}
        assert result.raw_count_per_radius == {15: 5}
        assert result.stopped_early is True
        assert result.density == DensityLevel.DENSE

    @pytest.mark.asyncio
    async def test_diagnostics_on_populates_raw_places(self) -> None:
        # Diagnostics on -> raw_places_per_radius carries the full per-radius
        # world (every place, pre-filter), keyed by searched radius.
        radii_seen: list[int] = []
        low_quality = {
            "id": "lq",
            "displayName": {"text": "Laundro"},
            "primaryType": "laundry",
            "types": ["laundry"],
            "userRatingCount": 0,
            "businessStatus": "OPERATIONAL",
            "location": {"latitude": 0.0, "longitude": 0.0},
        }
        # 15m: one low-quality (MEDIUM density), 50m: one quality place.
        results = {15: [low_quality], 50: [_quality_place()]}
        matcher = self._matcher_recording_radii(radii_seen, results)
        matcher._settings.places_diagnostics = True

        result = await matcher._search_nearby_tiered(0.0, 0.0)

        # Raw world retained per radius, INCLUDING the filtered-out place.
        assert set(result.raw_places_per_radius.keys()) == result.radii_searched
        assert [p["id"] for p in result.raw_places_per_radius[15]] == ["lq"]
        assert result.raw_places_per_radius[50][0]["id"] == "p1"

    @pytest.mark.asyncio
    async def test_result_carries_density(self) -> None:
        # Density is surfaced on the result.
        radii_seen: list[int] = []
        matcher = self._matcher_recording_radii(radii_seen, {})

        result = await matcher._search_nearby_tiered(0.0, 0.0)

        # 0 results at 15m -> SPARSE.
        assert result.density == DensityLevel.SPARSE


# ============================================================================
# Tourist Relevance Filter Tests
# ============================================================================


class TestTouristRelevanceFilter:
    """Tests for NON_TOURIST_TYPES filtering in _filter_low_quality_places."""

    @pytest.fixture
    def matcher(self, monkeypatch):
        settings = MagicMock()
        settings.google_places_api_key = "test-key"
        settings.places_api_timeout_seconds = 5.0
        settings.places_cluster_timeout_seconds = 15.0
        settings.places_min_quality_results_before_stop = 5
        settings.places_diagnostics = False
        monkeypatch.setattr(
            "app.services.place_matcher.matcher.get_settings", lambda: settings
        )
        mock_client = AsyncMock()
        return PlaceMatcher(http_client=mock_client)

    def test_filters_laundromat_by_primary_type(self, matcher) -> None:
        places = [
            {
                "id": "place-1",
                "displayName": {"text": "Quick Clean Laundry"},
                "userRatingCount": 50,
                "primaryType": "laundry",
                "types": ["laundry"],
            },
        ]
        filtered = matcher._filter_low_quality_places(places)
        assert len(filtered) == 0

    def test_filters_gas_station(self, matcher) -> None:
        places = [
            {
                "id": "place-1",
                "displayName": {"text": "Shell Station"},
                "userRatingCount": 100,
                "primaryType": "gas_station",
                "types": ["gas_station"],
            },
        ]
        filtered = matcher._filter_low_quality_places(places)
        assert len(filtered) == 0

    def test_filters_parking(self, matcher) -> None:
        places = [
            {
                "id": "place-1",
                "displayName": {"text": "City Parking"},
                "userRatingCount": 200,
                "primaryType": "parking",
                "types": ["parking"],
            },
        ]
        filtered = matcher._filter_low_quality_places(places)
        assert len(filtered) == 0

    def test_keeps_touristy_primary_with_non_tourist_secondary(self, matcher) -> None:
        """A restaurant that also offers parking must stay recallable.

        The secondary-type blocklist only applies when the primary type is not
        itself clearly touristy — otherwise multi-use places (museum in a
        historic bank, restaurant with parking) become unrecallable.
        """
        places = [
            {
                "id": "place-1",
                "displayName": {"text": "Restaurant with Parking"},
                "userRatingCount": 100,
                "primaryType": "restaurant",
                "types": ["restaurant", "parking"],
            },
            {
                "id": "place-2",
                "displayName": {"text": "Museum in Historic Bank"},
                "userRatingCount": 800,
                "primaryType": "museum",
                "types": ["museum", "bank"],
            },
        ]
        filtered = matcher._filter_low_quality_places(places)
        assert {p["id"] for p in filtered} == {"place-1", "place-2"}

    def test_filters_generic_primary_with_non_tourist_secondary(self, matcher) -> None:
        """A generic primary type with a non-tourist secondary is still dropped."""
        places = [
            {
                "id": "place-1",
                "displayName": {"text": "Downtown ATM Kiosk"},
                "userRatingCount": 40,
                "primaryType": "point_of_interest",
                "types": ["point_of_interest", "atm"],
            },
        ]
        filtered = matcher._filter_low_quality_places(places)
        assert len(filtered) == 0

    def test_keeps_tourist_places(self, matcher) -> None:
        places = [
            {
                "id": "place-1",
                "displayName": {"text": "Sushi Dai"},
                "userRatingCount": 500,
                "primaryType": "restaurant",
                "types": ["restaurant", "food"],
            },
        ]
        filtered = matcher._filter_low_quality_places(places)
        assert len(filtered) == 1

    def test_all_non_tourist_types_are_strings(self) -> None:
        """Ensure all NON_TOURIST_TYPES are valid strings."""
        for t in NON_TOURIST_TYPES:
            assert isinstance(t, str)
            assert len(t) > 0


# ============================================================================
# Enhanced Ranking Tests
# ============================================================================


class TestBayesianRating:
    """Tests for Bayesian rating adjustment."""

    def test_low_review_count_pulls_toward_mean(self) -> None:
        """4.8 stars with 5 reviews should be pulled toward 3.8."""
        result = PlaceMatcher._bayesian_rating(4.8, 5)
        assert 3.8 < result < 4.0

    def test_high_review_count_preserves_rating(self) -> None:
        """4.5 stars with 2000 reviews should be close to 4.5."""
        result = PlaceMatcher._bayesian_rating(4.5, 2000)
        assert result > 4.4

    def test_zero_reviews_returns_prior_mean(self) -> None:
        result = PlaceMatcher._bayesian_rating(5.0, 0)
        assert result == 3.8

    def test_no_rating_returns_prior_mean(self) -> None:
        result = PlaceMatcher._bayesian_rating(0, 100)
        assert result == 3.8


class TestFameBonus:
    """Tests for continuous fame bonus."""

    def test_below_floor_returns_zero(self) -> None:
        assert PlaceMatcher._fame_bonus(10) == 0.0
        assert PlaceMatcher._fame_bonus(49) == 0.0

    def test_at_floor_returns_zero(self) -> None:
        assert PlaceMatcher._fame_bonus(50) == 0.0

    def test_increases_with_reviews(self) -> None:
        bonus_500 = PlaceMatcher._fame_bonus(500)
        bonus_5000 = PlaceMatcher._fame_bonus(5000)
        assert bonus_500 > 0
        assert bonus_5000 > bonus_500

    def test_diminishing_returns(self) -> None:
        """Growth rate slows at higher review counts."""
        bonus_500 = PlaceMatcher._fame_bonus(500)
        bonus_5000 = PlaceMatcher._fame_bonus(5000)
        bonus_50000 = PlaceMatcher._fame_bonus(50000)
        # Each 10x increase in reviews adds the same absolute bonus (log scale)
        # but relative growth is smaller
        assert bonus_50000 > bonus_5000 > bonus_500
        assert bonus_50000 < bonus_5000 * 3  # Not linear growth


class TestDwellCategoryBonus:
    """Tests for dwell-tiered time bonus with category matching."""

    def test_long_dwell_high_bonus(self) -> None:
        bonus = PlaceMatcher._dwell_category_bonus(150, ["museum"], None)
        assert bonus == 0.8

    def test_medium_dwell(self) -> None:
        bonus = PlaceMatcher._dwell_category_bonus(90, ["restaurant"], None)
        assert bonus == 0.5

    def test_short_dwell(self) -> None:
        bonus = PlaceMatcher._dwell_category_bonus(30, ["cafe"], None)
        assert bonus == 0.3

    def test_very_short_dwell(self) -> None:
        bonus = PlaceMatcher._dwell_category_bonus(10, ["store"], None)
        assert bonus == 0.2

    def test_time_hint_match_adds_bonus(self) -> None:
        """Category match with time_hint adds 0.3."""
        bonus_with = PlaceMatcher._dwell_category_bonus(30, ["restaurant"], "food")
        bonus_without = PlaceMatcher._dwell_category_bonus(30, ["restaurant"], None)
        assert bonus_with == bonus_without + 0.3

    def test_time_hint_no_match_no_extra_bonus(self) -> None:
        """Non-matching hint doesn't add bonus."""
        bonus = PlaceMatcher._dwell_category_bonus(30, ["museum"], "food")
        assert bonus == 0.3  # Just dwell bonus, no category match

    def test_none_dwell_only_time_hint(self) -> None:
        """When dwell is None, only time hint contributes."""
        bonus = PlaceMatcher._dwell_category_bonus(None, ["restaurant"], "food")
        assert bonus == 0.3  # Only category match bonus


class TestEnhancedRanking:
    """Tests for the enhanced ranking algorithm with all signals."""

    @pytest.fixture
    def matcher(self, monkeypatch):
        settings = MagicMock()
        settings.google_places_api_key = "test-key"
        settings.places_api_timeout_seconds = 5.0
        settings.places_cluster_timeout_seconds = 15.0
        settings.places_min_quality_results_before_stop = 5
        settings.places_diagnostics = False
        monkeypatch.setattr(
            "app.services.place_matcher.matcher.get_settings", lambda: settings
        )
        mock_client = AsyncMock()
        return PlaceMatcher(http_client=mock_client)

    def test_famous_landmark_beats_random_business(self, matcher) -> None:
        """A famous 4.5-star landmark at 40m should beat a random 3.5-star at 10m."""
        cluster = {
            "centroid": {"latitude": 35.6762, "longitude": 139.6503},
        }
        places = [
            {
                "id": "random-biz",
                "displayName": {"text": "Random Business"},
                "location": {"latitude": 35.67621, "longitude": 139.6503},  # ~1m
                "userRatingCount": 15,
                "rating": 3.5,
                "primaryType": "store",
                "types": ["store"],
            },
            {
                "id": "famous-landmark",
                "displayName": {"text": "Famous Temple"},
                "location": {"latitude": 35.67656, "longitude": 139.6503},  # ~40m
                "userRatingCount": 5000,
                "rating": 4.5,
                "primaryType": "tourist_attraction",
                "types": ["tourist_attraction"],
            },
        ]
        ranked = matcher._rank_by_distance(places, cluster)
        assert ranked[0]["place_id"] == "famous-landmark"

    def test_time_hint_boosts_matching_category(self, matcher) -> None:
        """With time_hint='food', a restaurant should rank higher."""
        cluster = {
            "centroid": {"latitude": 35.6762, "longitude": 139.6503},
            "start_time": "2024-01-15T12:00:00Z",
            "end_time": "2024-01-15T12:30:00Z",
        }
        places = [
            {
                "id": "museum",
                "displayName": {"text": "Museum"},
                "location": {"latitude": 35.67625, "longitude": 139.6503},
                "userRatingCount": 200,
                "rating": 4.2,
                "primaryType": "museum",
                "types": ["museum"],
            },
            {
                "id": "restaurant",
                "displayName": {"text": "Restaurant"},
                "location": {"latitude": 35.67625, "longitude": 139.6503},
                "userRatingCount": 200,
                "rating": 4.2,
                "primaryType": "restaurant",
                "types": ["restaurant"],
            },
        ]
        ranked = matcher._rank_by_distance(places, cluster, time_hint="food")
        assert ranked[0]["place_id"] == "restaurant"

    def test_internal_fields_removed_from_output(self, matcher) -> None:
        """Verify all internal fields are stripped from results."""
        cluster = {
            "centroid": {"latitude": 35.6762, "longitude": 139.6503},
        }
        places = [
            {
                "id": "place-1",
                "displayName": {"text": "Test Place"},
                "location": {"latitude": 35.6763, "longitude": 139.6503},
                "userRatingCount": 100,
                "rating": 4.0,
                "primaryType": "restaurant",
                "types": ["restaurant"],
            },
        ]
        ranked = matcher._rank_by_distance(places, cluster)
        assert "_rating_count" not in ranked[0]
        assert "_rating" not in ranked[0]
        assert "_primary_type" not in ranked[0]


# ============================================================================
# Vision Ranking Tests
# ============================================================================


class TestVisionRanking:
    """Tests for vision-based ranking bonus in _rank_by_distance."""

    @pytest.fixture
    def matcher(self, monkeypatch):
        """Create a PlaceMatcher with mocked settings."""
        settings = MagicMock()
        settings.google_places_api_key = "test-key"
        settings.places_api_timeout_seconds = 5.0
        settings.places_cluster_timeout_seconds = 15.0
        settings.places_min_quality_results_before_stop = 5
        settings.places_diagnostics = False
        monkeypatch.setattr(
            "app.services.place_matcher.matcher.get_settings", lambda: settings
        )
        mock_client = AsyncMock()
        return PlaceMatcher(http_client=mock_client)

    @pytest.fixture
    def cluster(self) -> dict[str, Any]:
        """Standard cluster for vision ranking tests."""
        return {
            "centroid": {"latitude": 35.6762, "longitude": 139.6503},
        }

    @pytest.fixture
    def two_equidistant_places(self) -> list[dict[str, Any]]:
        """Two places at the same distance with same reviews: one food, one museum."""
        return [
            {
                "id": "museum-1",
                "displayName": {"text": "Tokyo Museum"},
                "location": {"latitude": 35.67625, "longitude": 139.6503},
                "userRatingCount": 200,
                "rating": 4.2,
                "primaryType": "museum",
                "types": ["museum", "tourist_attraction"],
            },
            {
                "id": "restaurant-1",
                "displayName": {"text": "Sushi Dai"},
                "location": {"latitude": 35.67625, "longitude": 139.6503},
                "userRatingCount": 200,
                "rating": 4.2,
                "primaryType": "restaurant",
                "types": ["restaurant", "food"],
            },
        ]

    def test_high_confidence_boosts_matching_place_types(
        self, matcher, cluster, two_equidistant_places
    ) -> None:
        """Vision with high confidence food should boost the restaurant over the museum."""
        vision = VisionResult(
            category="food",
            detected_text=["Sushi Dai"],
            confidence="high",
        )

        ranked = matcher._rank_by_distance(
            two_equidistant_places, cluster, vision_result=vision
        )

        # Restaurant should be ranked first because vision says "food" with high confidence
        assert ranked[0]["place_id"] == "restaurant-1"
        assert ranked[1]["place_id"] == "museum-1"

    def test_medium_confidence_gives_smaller_boost(
        self, matcher, cluster, two_equidistant_places
    ) -> None:
        """Vision with medium confidence food should still boost restaurant, but less."""
        vision_medium = VisionResult(
            category="food",
            detected_text=[],
            confidence="medium",
        )
        vision_high = VisionResult(
            category="food",
            detected_text=[],
            confidence="high",
        )

        ranked_medium = matcher._rank_by_distance(
            two_equidistant_places, cluster, vision_result=vision_medium
        )
        ranked_high = matcher._rank_by_distance(
            two_equidistant_places, cluster, vision_result=vision_high
        )

        # Both should rank restaurant first
        assert ranked_medium[0]["place_id"] == "restaurant-1"
        assert ranked_high[0]["place_id"] == "restaurant-1"

        # Verify the constants reflect high > medium
        assert VISION_HIGH_CONFIDENCE_BONUS > VISION_MEDIUM_CONFIDENCE_BONUS

    def test_low_confidence_is_ignored(
        self, matcher, cluster, two_equidistant_places
    ) -> None:
        """Vision with low confidence should produce same ranking as no vision."""
        vision_low = VisionResult(
            category="food",
            detected_text=[],
            confidence="low",
        )

        ranked_with_low = matcher._rank_by_distance(
            two_equidistant_places, cluster, vision_result=vision_low
        )
        ranked_without = matcher._rank_by_distance(
            two_equidistant_places, cluster, vision_result=None
        )

        # Rankings should be identical when confidence is low vs no vision
        assert [p["place_id"] for p in ranked_with_low] == [
            p["place_id"] for p in ranked_without
        ]

    def test_no_matching_types_gives_no_bonus(self, matcher, cluster) -> None:
        """Vision category with no matching place types should not change ranking."""
        # "transport" maps to airport/train_station types, neither place has those
        vision = VisionResult(
            category="transport",
            detected_text=[],
            confidence="high",
        )

        places = [
            {
                "id": "restaurant-1",
                "displayName": {"text": "Sushi Place"},
                "location": {"latitude": 35.67625, "longitude": 139.6503},
                "userRatingCount": 200,
                "rating": 4.2,
                "primaryType": "restaurant",
                "types": ["restaurant"],
            },
            {
                "id": "museum-1",
                "displayName": {"text": "Art Museum"},
                "location": {"latitude": 35.67625, "longitude": 139.6503},
                "userRatingCount": 200,
                "rating": 4.2,
                "primaryType": "museum",
                "types": ["museum"],
            },
        ]

        ranked_with_vision = matcher._rank_by_distance(
            places, cluster, vision_result=vision
        )
        ranked_without = matcher._rank_by_distance(places, cluster, vision_result=None)

        # Order should be the same - transport doesn't match restaurant or museum
        assert [p["place_id"] for p in ranked_with_vision] == [
            p["place_id"] for p in ranked_without
        ]

    def test_vision_category_included_in_output(
        self, matcher, cluster, two_equidistant_places
    ) -> None:
        """Vision result should populate vision_category field in output."""
        vision = VisionResult(
            category="food",
            detected_text=[],
            confidence="high",
        )

        ranked = matcher._rank_by_distance(
            two_equidistant_places, cluster, vision_result=vision
        )

        # All results should have the vision category set
        for place in ranked:
            assert place["vision_category"] == "food"

    def test_no_vision_result_sets_vision_category_none(
        self, matcher, cluster, two_equidistant_places
    ) -> None:
        """Without vision result, vision_category should be None."""
        ranked = matcher._rank_by_distance(
            two_equidistant_places, cluster, vision_result=None
        )

        for place in ranked:
            assert place["vision_category"] is None

    def test_ranking_weights_change_ordering(self, matcher, cluster) -> None:
        """Changing configured weights should change rank preference."""
        places = [
            {
                "id": "close-low-signal",
                "displayName": {"text": "Close Place"},
                "location": {"latitude": 35.67625, "longitude": 139.6503},
                "userRatingCount": 5,
                "rating": 3.8,
                "primaryType": "restaurant",
                "types": ["restaurant", "food"],
            },
            {
                "id": "far-high-signal",
                "displayName": {"text": "Famous Place"},
                "location": {"latitude": 35.6773, "longitude": 139.6503},
                "userRatingCount": 5000,
                "rating": 4.8,
                "primaryType": "restaurant",
                "types": ["restaurant", "food"],
            },
        ]

        # Favor review/rating/fame over distance.
        matcher._settings.places_rank_distance_weight = 0.2
        matcher._settings.places_rank_review_weight = 2.0
        matcher._settings.places_rank_rating_weight = 2.0
        matcher._settings.places_rank_fame_weight = 2.0
        matcher._settings.places_rank_dwell_weight = 1.0
        matcher._settings.places_rank_vision_weight = 1.0
        ranked_signal_heavy = matcher._rank_by_distance(places, cluster)
        assert ranked_signal_heavy[0]["place_id"] == "far-high-signal"

        # Favor distance over quality signals.
        matcher._settings.places_rank_distance_weight = 3.0
        matcher._settings.places_rank_review_weight = 0.1
        matcher._settings.places_rank_rating_weight = 0.1
        matcher._settings.places_rank_fame_weight = 0.1
        matcher._settings.places_rank_dwell_weight = 1.0
        matcher._settings.places_rank_vision_weight = 1.0
        ranked_distance_heavy = matcher._rank_by_distance(places, cluster)
        assert ranked_distance_heavy[0]["place_id"] == "close-low-signal"

    @pytest.mark.asyncio
    async def test_find_places_for_clusters_passes_vision_to_ranking(
        self, matcher, monkeypatch
    ) -> None:
        """find_places_for_clusters should pass vision results to _rank_by_distance."""
        clusters = [
            {
                "id": "cluster-1",
                "centroid": {"latitude": 35.6762, "longitude": 139.6503},
                "photos": [{"asset_id": "photo-1"}],
            },
        ]

        mock_places_response = {
            "places": [
                {
                    "id": "place-123",
                    "displayName": {"text": "Test Restaurant"},
                    "formattedAddress": "123 Test St",
                    "location": {"latitude": 35.6762, "longitude": 139.6503},
                    "primaryType": "restaurant",
                    "types": ["restaurant", "food"],
                    "rating": 4.5,
                    "userRatingCount": 100,
                    "businessStatus": "OPERATIONAL",
                }
            ]
        }

        async def mock_post(*args, **kwargs):
            mock_response = MagicMock()
            mock_response.status_code = 200
            mock_response.json.return_value = mock_places_response
            return mock_response

        matcher._client.post = mock_post

        # Clear module-level cache
        from app.services.place_matcher import places_cache

        await places_cache.clear()

        # Create a resolved task with vision results
        vision_result = VisionResult(
            category="food",
            detected_text=["Test Restaurant"],
            confidence="high",
        )

        async def make_vision_task():
            return {"cluster-1": vision_result}

        vision_task = asyncio.ensure_future(make_vision_task())

        results, failed_count = await matcher.find_places_for_clusters(
            clusters, vision_results_task=vision_task
        )

        assert failed_count == 0
        assert len(results) == 1
        # The vision_category should be set on the returned places
        assert results[0]["places"][0]["vision_category"] == "food"

        await places_cache.clear()

    @pytest.mark.asyncio
    async def test_text_search_rate_limit_falls_back_to_nearby_results(
        self, matcher, monkeypatch
    ) -> None:
        """Rate-limited text search should not fail cluster suggestion results."""
        clusters = [
            {
                "id": "cluster-1",
                "centroid": {"latitude": 35.6762, "longitude": 139.6503},
                "photos": [{"asset_id": "photo-1"}],
            },
        ]

        nearby_places = [
            {
                "id": "place-nearby-1",
                "displayName": {"text": "Nearby Cafe"},
                "formattedAddress": "123 Nearby St",
                "location": {"latitude": 35.6762, "longitude": 139.6503},
                "primaryType": "cafe",
                "types": ["cafe", "coffee_shop"],
                "rating": 4.3,
                "userRatingCount": 120,
                "businessStatus": "OPERATIONAL",
            }
        ]

        async def mock_search_nearby_tiered(
            latitude: float, longitude: float
        ) -> TieredSearchResult:
            return _tiered(nearby_places)

        async def mock_execute_text_search(
            text_query: str, latitude: float, longitude: float, radius: float = 200.0
        ) -> list[dict]:
            raise RateLimitError("Text search rate limited")

        monkeypatch.setattr(matcher, "_search_nearby_tiered", mock_search_nearby_tiered)
        monkeypatch.setattr(matcher, "_execute_text_search", mock_execute_text_search)

        # Detected name differs from the nearby place so the text search is NOT
        # suppressed and we genuinely exercise the rate-limit fallback path.
        vision_result = VisionResult(
            category="food",
            detected_text=["Signboard Ramen House"],
            confidence="high",
        )

        async def make_vision_task():
            return {"cluster-1": vision_result}

        vision_task = asyncio.ensure_future(make_vision_task())

        results, failed_count = await matcher.find_places_for_clusters(
            clusters, vision_results_task=vision_task
        )

        assert failed_count == 0
        assert len(results) == 1
        assert len(results[0]["places"]) == 1
        assert results[0]["places"][0]["place_id"] == "place-nearby-1"

    @pytest.mark.asyncio
    async def test_text_search_respects_semaphore_concurrency(
        self, matcher, monkeypatch
    ) -> None:
        """Text searches must be bounded by the same semaphore as nearby searches.

        Regression test: text searches previously used unbounded asyncio.gather,
        which could fire all requests concurrently and exhaust API quota.
        """
        num_clusters = 10
        clusters = [
            {
                "id": f"cluster-{i}",
                "centroid": {"latitude": 35.6762 + i * 0.01, "longitude": 139.6503},
                "photos": [{"asset_id": f"photo-{i}"}],
            }
            for i in range(num_clusters)
        ]

        nearby_place_template = {
            "formattedAddress": "123 Nearby St",
            "primaryType": "cafe",
            "types": ["cafe"],
            "rating": 4.0,
            "userRatingCount": 100,
            "businessStatus": "OPERATIONAL",
        }

        async def mock_search_nearby_tiered(
            latitude: float, longitude: float
        ) -> TieredSearchResult:
            return _tiered(
                [
                    {
                        **nearby_place_template,
                        "id": f"nearby-{latitude:.4f}",
                        "displayName": {"text": "Nearby Place"},
                        "location": {"latitude": latitude, "longitude": longitude},
                    }
                ]
            )

        # Track peak concurrency of text searches
        concurrent_text_searches = 0
        peak_text_concurrency = 0

        async def mock_execute_text_search(
            text_query: str,
            latitude: float,
            longitude: float,
            radius: float = 200.0,
        ) -> list[dict]:
            nonlocal concurrent_text_searches, peak_text_concurrency
            concurrent_text_searches += 1
            peak_text_concurrency = max(peak_text_concurrency, concurrent_text_searches)
            await asyncio.sleep(0.05)  # Simulate API latency
            concurrent_text_searches -= 1
            return [
                {
                    **nearby_place_template,
                    "id": f"text-{latitude:.4f}",
                    "displayName": {"text": text_query},
                    "location": {"latitude": latitude, "longitude": longitude},
                }
            ]

        monkeypatch.setattr(matcher, "_search_nearby_tiered", mock_search_nearby_tiered)
        monkeypatch.setattr(matcher, "_execute_text_search", mock_execute_text_search)

        # Every cluster gets a vision result with a business name → triggers text search
        vision_map = {
            f"cluster-{i}": VisionResult(
                category="food",
                detected_text=[f"Restaurant {i}"],
                confidence="high",
            )
            for i in range(num_clusters)
        }

        async def make_vision_task():
            return vision_map

        vision_task = asyncio.ensure_future(make_vision_task())

        results, failed_count = await matcher.find_places_for_clusters(
            clusters, vision_results_task=vision_task
        )

        assert failed_count == 0
        assert len(results) == num_clusters
        # The semaphore limit is MAX_CONCURRENT_PLACES_REQUESTS (5).
        # Peak concurrency must not exceed it.
        assert peak_text_concurrency <= 5, (
            f"Text search peak concurrency was {peak_text_concurrency}, "
            f"expected <= 5 (semaphore limit). "
            f"Text searches are bypassing the concurrency semaphore."
        )

    @pytest.mark.asyncio
    async def test_text_search_suppressed_when_nearby_already_matches(
        self, matcher, monkeypatch
    ) -> None:
        """If a nearby result already matches the vision name, skip the text search.

        The Enterprise-tier Text Search would only re-find a place we already have,
        so it must be suppressed (U5 LLM-gating cost saving).
        """
        clusters = [
            {
                "id": "cluster-1",
                "centroid": {"latitude": 35.6762, "longitude": 139.6503},
                "photos": [{"asset_id": "photo-1"}],
            }
        ]
        nearby_places = [
            {
                "id": "place-ramen",
                "displayName": {"text": "Tsukiji Ramen Honten"},
                "formattedAddress": "1 Tsukiji",
                "location": {"latitude": 35.6762, "longitude": 139.6503},
                "primaryType": "restaurant",
                "types": ["restaurant", "ramen_restaurant"],
                "rating": 4.4,
                "userRatingCount": 420,
                "businessStatus": "OPERATIONAL",
            }
        ]

        async def mock_search_nearby_tiered(latitude, longitude):
            return _tiered(nearby_places)

        text_search_called = False

        async def mock_execute_text_search(
            text_query, latitude, longitude, radius=200.0
        ):
            nonlocal text_search_called
            text_search_called = True
            return []

        # Enrichment is irrelevant here; keep ratings already present.
        async def mock_enrich(place_ids):
            return {}

        monkeypatch.setattr(matcher, "_search_nearby_tiered", mock_search_nearby_tiered)
        monkeypatch.setattr(matcher, "_execute_text_search", mock_execute_text_search)
        monkeypatch.setattr(matcher, "_enrich_place_ratings", mock_enrich)

        # Vision detects "Tsukiji Ramen" — already present in the nearby results.
        vision_result = VisionResult(
            category="food",
            detected_text=["Tsukiji Ramen"],
            confidence="high",
        )

        async def make_vision_task():
            return {"cluster-1": vision_result}

        results, failed_count = await matcher.find_places_for_clusters(
            clusters, vision_results_task=asyncio.ensure_future(make_vision_task())
        )

        assert failed_count == 0
        assert text_search_called is False  # suppressed
        assert results[0]["places"][0]["place_id"] == "place-ramen"

    @pytest.mark.asyncio
    async def test_low_confidence_text_search_rescues_empty_nearby(
        self, matcher, monkeypatch
    ) -> None:
        """Low vision confidence still triggers text search when Nearby is empty.

        Confidence reflects scene clarity (dark/blurry), not OCR validity — a
        dark nightlife photo can carry a crisp readable sign. When Nearby found
        nothing, the text search is the only recall path, so the low-confidence
        gate must not block it.
        """
        clusters = [
            {
                "id": "cluster-1",
                "centroid": {"latitude": 40.7306, "longitude": -73.9866},
                "photos": [{"asset_id": "photo-1"}],
            }
        ]

        async def mock_search_nearby_tiered(latitude, longitude):
            return _tiered([], radius_used=0)  # nothing nearby

        text_queries: list[str] = []

        async def mock_execute_text_search(
            text_query, latitude, longitude, radius=200.0
        ):
            text_queries.append(text_query)
            return [
                {
                    "id": "place-neon-cellar",
                    "displayName": {"text": "Neon Cellar"},
                    "formattedAddress": "130 2nd Ave",
                    "location": {"latitude": 40.7306, "longitude": -73.9866},
                    "primaryType": "bar",
                    "types": ["bar", "night_club"],
                    "businessStatus": "OPERATIONAL",
                }
            ]

        async def mock_enrich(place_ids):
            return {}

        monkeypatch.setattr(matcher, "_search_nearby_tiered", mock_search_nearby_tiered)
        monkeypatch.setattr(matcher, "_execute_text_search", mock_execute_text_search)
        monkeypatch.setattr(matcher, "_enrich_place_ratings", mock_enrich)

        vision_result = VisionResult(
            category="nightlife",
            detected_text=["Neon Cellar"],
            confidence="low",  # dark photo — but the sign text is readable
        )

        async def make_vision_task():
            return {"cluster-1": vision_result}

        results, failed_count = await matcher.find_places_for_clusters(
            clusters, vision_results_task=asyncio.ensure_future(make_vision_task())
        )

        assert failed_count == 0
        assert text_queries == ["Neon Cellar"]
        assert results[0]["places"][0]["place_id"] == "place-neon-cellar"

    @pytest.mark.asyncio
    async def test_text_search_runs_when_nearby_does_not_match(
        self, matcher, monkeypatch
    ) -> None:
        """When no nearby result matches the vision name, the text search must run."""
        clusters = [
            {
                "id": "cluster-1",
                "centroid": {"latitude": 35.6762, "longitude": 139.6503},
                "photos": [{"asset_id": "photo-1"}],
            }
        ]
        nearby_places = [
            {
                "id": "place-other",
                "displayName": {"text": "Some Other Cafe"},
                "formattedAddress": "2 Elsewhere",
                "location": {"latitude": 35.6762, "longitude": 139.6503},
                "primaryType": "cafe",
                "types": ["cafe"],
                "rating": 4.0,
                "userRatingCount": 50,
                "businessStatus": "OPERATIONAL",
            }
        ]

        async def mock_search_nearby_tiered(latitude, longitude):
            return _tiered(nearby_places)

        text_search_called = False

        async def mock_execute_text_search(
            text_query, latitude, longitude, radius=200.0
        ):
            nonlocal text_search_called
            text_search_called = True
            return []

        async def mock_enrich(place_ids):
            return {}

        monkeypatch.setattr(matcher, "_search_nearby_tiered", mock_search_nearby_tiered)
        monkeypatch.setattr(matcher, "_execute_text_search", mock_execute_text_search)
        monkeypatch.setattr(matcher, "_enrich_place_ratings", mock_enrich)

        vision_result = VisionResult(
            category="food",
            detected_text=["Tsukiji Ramen Honten"],
            confidence="high",
        )

        async def make_vision_task():
            return {"cluster-1": vision_result}

        await matcher.find_places_for_clusters(
            clusters, vision_results_task=asyncio.ensure_future(make_vision_task())
        )

        assert text_search_called is True  # not suppressed — genuinely different


class TestNameMatchRanking:
    """Tests for the vision signage name-match bonus in _rank_by_distance."""

    @pytest.fixture
    def matcher(self, monkeypatch):
        settings = MagicMock()
        settings.google_places_api_key = "test-key"
        settings.places_api_timeout_seconds = 5.0
        settings.places_cluster_timeout_seconds = 15.0
        settings.places_min_quality_results_before_stop = 5
        settings.places_diagnostics = False
        monkeypatch.setattr(
            "app.services.place_matcher.matcher.get_settings", lambda: settings
        )
        return PlaceMatcher(http_client=AsyncMock())

    @pytest.fixture
    def cluster(self) -> dict[str, Any]:
        return {"centroid": {"latitude": 48.8574, "longitude": 2.2932}}

    @pytest.fixture
    def bistro_vs_landmark(self) -> list[dict[str, Any]]:
        """A small signage-matched bistro vs a closer mega-famous landmark."""
        return [
            {
                "id": "famous-landmark",
                "displayName": {"text": "Eiffel Tower"},
                "location": {"latitude": 48.85731, "longitude": 2.2932},
                "userRatingCount": 425000,
                "rating": 4.7,
                "primaryType": "tourist_attraction",
                "types": ["tourist_attraction", "historical_landmark"],
            },
            {
                "id": "small-bistro",
                "displayName": {"text": "Chez Louise"},
                "location": {"latitude": 48.85751, "longitude": 2.2932},
                "userRatingCount": 320,
                "rating": 4.5,
                "primaryType": "restaurant",
                "types": ["restaurant", "french_restaurant", "food"],
            },
        ]

    def test_name_match_beats_famous_neighbor(
        self, matcher, cluster, bistro_vs_landmark
    ) -> None:
        """A place matching vision-detected signage outranks a mega-famous neighbor."""
        vision = VisionResult(
            category="food",
            detected_text=["Chez Louise"],
            confidence="high",
        )

        ranked = matcher._rank_by_distance(
            bistro_vs_landmark, cluster, vision_result=vision
        )

        assert ranked[0]["place_id"] == "small-bistro"

    def test_without_name_match_famous_neighbor_wins(
        self, matcher, cluster, bistro_vs_landmark
    ) -> None:
        """Sanity: without detected signage, the landmark's fame wins this layout."""
        vision = VisionResult(category="food", detected_text=[], confidence="high")

        ranked = matcher._rank_by_distance(
            bistro_vs_landmark, cluster, vision_result=vision
        )

        assert ranked[0]["place_id"] == "famous-landmark"

    def test_partial_ocr_name_still_matches(
        self, matcher, cluster, bistro_vs_landmark
    ) -> None:
        """Containment matching: 'CHEZ LOUISE' OCR matches 'Chez Louise'."""
        vision = VisionResult(
            category="food",
            detected_text=["CHEZ LOUISE"],
            confidence="high",
        )

        ranked = matcher._rank_by_distance(
            bistro_vs_landmark, cluster, vision_result=vision
        )

        assert ranked[0]["place_id"] == "small-bistro"

    def test_generic_text_gets_no_bonus(
        self, matcher, cluster, bistro_vs_landmark
    ) -> None:
        """Single-word/generic OCR text is not a business-name candidate."""
        vision = VisionResult(
            category="food",
            detected_text=["OPEN", "Menu"],
            confidence="high",
        )

        ranked = matcher._rank_by_distance(
            bistro_vs_landmark, cluster, vision_result=vision
        )

        assert ranked[0]["place_id"] == "famous-landmark"

    def test_zero_weight_disables_name_match(
        self, matcher, cluster, bistro_vs_landmark
    ) -> None:
        """Setting places_rank_name_match_weight=0 restores prior behavior."""
        matcher._settings.places_rank_name_match_weight = 0.0
        vision = VisionResult(
            category="food",
            detected_text=["Chez Louise"],
            confidence="high",
        )

        ranked = matcher._rank_by_distance(
            bistro_vs_landmark, cluster, vision_result=vision
        )

        assert ranked[0]["place_id"] == "famous-landmark"

    def test_internal_name_match_field_not_leaked(
        self, matcher, cluster, bistro_vs_landmark
    ) -> None:
        """The _name_match working field must be stripped from returned suggestions."""
        vision = VisionResult(
            category="food",
            detected_text=["Chez Louise"],
            confidence="high",
        )

        ranked = matcher._rank_by_distance(
            bistro_vs_landmark, cluster, vision_result=vision
        )

        for place in ranked:
            assert "_name_match" not in place


# ============================================================================
# Two-Pass Field Mask Tests (U3)
# ============================================================================


class TestWideSearchFieldMask:
    """The bulk Nearby/Text Search must use the cheap WIDE mask (no rating)."""

    @pytest.fixture
    def matcher(self, monkeypatch):
        settings = MagicMock()
        settings.google_places_api_key = "test-key"
        settings.places_api_timeout_seconds = 5.0
        settings.places_cluster_timeout_seconds = 15.0
        settings.places_min_quality_results_before_stop = 5
        settings.places_diagnostics = False
        monkeypatch.setattr(
            "app.services.place_matcher.matcher.get_settings", lambda: settings
        )
        return PlaceMatcher(http_client=AsyncMock())

    @pytest.mark.asyncio
    async def test_nearby_search_omits_rating_fields(self, matcher) -> None:
        """Nearby Search must not request rating/userRatingCount (Enterprise SKU)."""
        from app.services.place_matcher import places_cache

        await places_cache.clear()
        captured = {}

        async def mock_post(*args, **kwargs):
            captured["mask"] = kwargs["headers"]["X-Goog-FieldMask"]
            mock_response = MagicMock()
            mock_response.status_code = 200
            mock_response.json.return_value = {"places": []}
            return mock_response

        matcher._client.post = mock_post
        await matcher._execute_search(35.0, 139.0, 30.0)
        await places_cache.clear()

        mask = captured["mask"]
        assert "rating" not in mask
        assert "userRatingCount" not in mask
        # businessStatus must remain so the closed-permanently filter works.
        assert "businessStatus" in mask
        assert "places.id" in mask

    @pytest.mark.asyncio
    async def test_text_search_omits_rating_fields(self, matcher) -> None:
        """Text Search must not request rating/userRatingCount either."""
        from app.services.place_matcher import places_cache

        await places_cache.clear()
        captured = {}

        async def mock_post(*args, **kwargs):
            captured["mask"] = kwargs["headers"]["X-Goog-FieldMask"]
            mock_response = MagicMock()
            mock_response.status_code = 200
            mock_response.json.return_value = {"places": []}
            return mock_response

        matcher._client.post = mock_post
        await matcher._execute_text_search("Sushi Dai", 35.0, 139.0)
        await places_cache.clear()

        mask = captured["mask"]
        assert "rating" not in mask
        assert "userRatingCount" not in mask


class TestQualityFilterRatingGate:
    """The review-count gate applies only when userRatingCount is present."""

    @pytest.fixture
    def matcher(self, monkeypatch):
        settings = MagicMock()
        settings.google_places_api_key = "test-key"
        settings.places_api_timeout_seconds = 5.0
        settings.places_cluster_timeout_seconds = 15.0
        settings.places_min_quality_results_before_stop = 5
        settings.places_diagnostics = False
        monkeypatch.setattr(
            "app.services.place_matcher.matcher.get_settings", lambda: settings
        )
        return PlaceMatcher(http_client=AsyncMock())

    def test_review_gate_skipped_when_rating_absent(self, matcher) -> None:
        """A wide-pass place (no userRatingCount) is kept despite no review data."""
        places = [
            {
                "id": "wide-1",
                "displayName": {"text": "Cafe From Wide Search"},
                "primaryType": "cafe",
                "types": ["cafe"],
                "businessStatus": "OPERATIONAL",
                # No userRatingCount -> review gate skipped
            },
        ]
        filtered = matcher._filter_low_quality_places(places)
        assert len(filtered) == 1
        assert filtered[0]["id"] == "wide-1"

    def test_review_gate_applied_when_rating_present(self, matcher) -> None:
        """A place that carries userRatingCount is still gated as before."""
        places = [
            {
                "id": "low",
                "displayName": {"text": "Few Reviews"},
                "primaryType": "cafe",
                "types": ["cafe"],
                "userRatingCount": MIN_REVIEW_COUNT - 1,
            },
            {
                "id": "ok",
                "displayName": {"text": "Enough Reviews"},
                "primaryType": "cafe",
                "types": ["cafe"],
                "userRatingCount": MIN_REVIEW_COUNT,
            },
        ]
        filtered = matcher._filter_low_quality_places(places)
        assert {p["id"] for p in filtered} == {"ok"}

    def test_other_gates_still_apply_without_rating(self, matcher) -> None:
        """Non-tourist / closed / unnamed places are still dropped in wide pass."""
        places = [
            {
                "id": "gas",
                "displayName": {"text": "Shell"},
                "primaryType": "gas_station",
                "types": ["gas_station"],
                "businessStatus": "OPERATIONAL",
            },
            {
                "id": "closed",
                "displayName": {"text": "Old Cafe"},
                "primaryType": "cafe",
                "types": ["cafe"],
                "businessStatus": "CLOSED_PERMANENTLY",
            },
            {
                "id": "noname",
                "displayName": {"text": ""},
                "primaryType": "cafe",
                "types": ["cafe"],
            },
            {
                "id": "good",
                "displayName": {"text": "Nice Cafe"},
                "primaryType": "cafe",
                "types": ["cafe"],
                "businessStatus": "OPERATIONAL",
            },
        ]
        filtered = matcher._filter_low_quality_places(places)
        assert {p["id"] for p in filtered} == {"good"}


class TestFinalistEnrichment:
    """Enrichment fetches rating only for finalists, merges, and re-ranks."""

    @pytest.fixture
    def matcher(self, monkeypatch):
        settings = MagicMock()
        settings.google_places_api_key = "test-key"
        settings.places_api_timeout_seconds = 5.0
        settings.places_cluster_timeout_seconds = 15.0
        settings.places_min_quality_results_before_stop = 5
        settings.places_diagnostics = False
        monkeypatch.setattr(
            "app.services.place_matcher.matcher.get_settings", lambda: settings
        )
        return PlaceMatcher(http_client=AsyncMock())

    @pytest.mark.asyncio
    async def test_enrich_place_ratings_returns_mask_and_values(
        self, matcher, monkeypatch
    ) -> None:
        """_enrich_place_ratings uses the ENRICH mask and returns rating values."""
        monkeypatch.setattr(
            "app.services.place_matcher._matcher_search.get_place_details_cache",
            AsyncMock(return_value=None),
        )
        monkeypatch.setattr(
            "app.services.place_matcher._matcher_search.set_place_details_cache",
            AsyncMock(return_value=None),
        )
        captured = {}

        async def mock_get(url, *args, **kwargs):
            captured["mask"] = kwargs["headers"]["X-Goog-FieldMask"]
            mock_response = MagicMock()
            mock_response.status_code = 200
            mock_response.json.return_value = {
                "id": url.rsplit("/", 1)[-1],
                "rating": 4.6,
                "userRatingCount": 321,
            }
            return mock_response

        matcher._client.get = mock_get

        result = await matcher._enrich_place_ratings(["place-a"])

        assert captured["mask"] == "id,rating,userRatingCount"
        assert result == {"place-a": {"rating": 4.6, "userRatingCount": 321}}

    @pytest.mark.asyncio
    async def test_enrich_uses_by_id_cache_without_http(
        self, matcher, monkeypatch
    ) -> None:
        """A cached place with rating must not trigger a Place Details HTTP call."""
        monkeypatch.setattr(
            "app.services.place_matcher._matcher_search.get_place_details_cache",
            AsyncMock(return_value={"rating": 4.1, "userRatingCount": 99}),
        )
        http_get = AsyncMock()
        matcher._client.get = http_get

        result = await matcher._enrich_place_ratings(["cached-1"])

        assert result == {"cached-1": {"rating": 4.1, "userRatingCount": 99}}
        http_get.assert_not_called()

    @pytest.mark.asyncio
    async def test_enrichment_merges_rating_and_reranks(
        self, matcher, monkeypatch
    ) -> None:
        """Finalists are enriched with rating, then re-ranked on that signal.

        Two equidistant restaurants: the wide search carries no rating, so the
        first pass cannot separate them. After enrichment, the higher-rated /
        more-reviewed place must surface first.
        """
        from app.services.place_matcher import places_cache

        await places_cache.clear()

        clusters = [
            {
                "id": "cluster-1",
                "centroid": {"latitude": 35.6762, "longitude": 139.6503},
                "photos": [{"asset_id": "photo-1"}],
            }
        ]
        # Both at the same location, no rating fields (wide-pass shape).
        wide_places = [
            {
                "id": "meh",
                "displayName": {"text": "Meh Diner"},
                "formattedAddress": "1 St",
                "location": {"latitude": 35.6762, "longitude": 139.6503},
                "primaryType": "restaurant",
                "types": ["restaurant"],
                "businessStatus": "OPERATIONAL",
            },
            {
                "id": "great",
                "displayName": {"text": "Great Diner"},
                "formattedAddress": "2 St",
                "location": {"latitude": 35.6762, "longitude": 139.6503},
                "primaryType": "restaurant",
                "types": ["restaurant"],
                "businessStatus": "OPERATIONAL",
            },
        ]

        async def mock_search_nearby_tiered(latitude, longitude):
            return _tiered(wide_places)

        async def mock_enrich(place_ids):
            return {
                "meh": {"rating": 3.6, "userRatingCount": 8},
                "great": {"rating": 4.8, "userRatingCount": 5000},
            }

        monkeypatch.setattr(matcher, "_search_nearby_tiered", mock_search_nearby_tiered)
        monkeypatch.setattr(matcher, "_enrich_place_ratings", mock_enrich)

        results, failed = await matcher.find_places_for_clusters(clusters)
        await places_cache.clear()

        assert failed == 0
        place_ids = [p["place_id"] for p in results[0]["places"]]
        assert place_ids[0] == "great"
        assert set(place_ids) == {"great", "meh"}

    @pytest.mark.asyncio
    async def test_enrichment_failure_degrades_to_first_pass(
        self, matcher, monkeypatch
    ) -> None:
        """If enrichment raises, the un-enriched first-pass ranking is returned."""
        from app.services.place_matcher import places_cache

        await places_cache.clear()

        clusters = [
            {
                "id": "cluster-1",
                "centroid": {"latitude": 35.6762, "longitude": 139.6503},
                "photos": [{"asset_id": "photo-1"}],
            }
        ]
        wide_places = [
            {
                "id": "close",
                "displayName": {"text": "Close Cafe"},
                "formattedAddress": "1 St",
                "location": {"latitude": 35.6762, "longitude": 139.6503},
                "primaryType": "cafe",
                "types": ["cafe"],
                "businessStatus": "OPERATIONAL",
            },
        ]

        async def mock_search_nearby_tiered(latitude, longitude):
            return _tiered(wide_places)

        async def boom(place_ids):
            raise RuntimeError("enrichment down")

        monkeypatch.setattr(matcher, "_search_nearby_tiered", mock_search_nearby_tiered)
        monkeypatch.setattr(matcher, "_enrich_place_ratings", boom)

        results, failed = await matcher.find_places_for_clusters(clusters)
        await places_cache.clear()

        # No crash; first-pass suggestion is still returned.
        assert failed == 0
        assert len(results) == 1
        assert results[0]["places"][0]["place_id"] == "close"

    @pytest.mark.asyncio
    async def test_low_review_finalist_dropped_and_backfilled_after_enrichment(
        self, matcher, monkeypatch
    ) -> None:
        """The review-count gate is re-applied once finalists carry live counts.

        The wide pass has no rating data, so a junk place can reach the finalist
        set on distance alone. After enrichment reveals it has too few reviews,
        it must be dropped and the next first-pass candidate backfilled.
        """
        from app.services.place_matcher import places_cache

        await places_cache.clear()

        clusters = [
            {
                "id": "cluster-1",
                "centroid": {"latitude": 35.6762, "longitude": 139.6503},
                "photos": [{"asset_id": "photo-1"}],
            }
        ]

        # Four wide-pass places (no rating fields), ordered by distance.
        def wide_place(pid: str, lat: float) -> dict[str, Any]:
            return {
                "id": pid,
                "displayName": {"text": f"Place {pid}"},
                "formattedAddress": "1 St",
                "location": {"latitude": lat, "longitude": 139.6503},
                "primaryType": "restaurant",
                "types": ["restaurant"],
                "businessStatus": "OPERATIONAL",
            }

        wide_places = [
            wide_place("junk-closest", 35.67624),
            wide_place("real-b", 35.67627),
            wide_place("real-c", 35.67629),
            wide_place("real-d", 35.67632),
        ]

        async def mock_search_nearby_tiered(latitude, longitude):
            return _tiered(wide_places)

        async def mock_enrich(place_ids):
            return {
                "junk-closest": {"rating": 5.0, "userRatingCount": 2},
                "real-b": {"rating": 4.4, "userRatingCount": 200},
                "real-c": {"rating": 4.3, "userRatingCount": 150},
            }

        monkeypatch.setattr(matcher, "_search_nearby_tiered", mock_search_nearby_tiered)
        monkeypatch.setattr(matcher, "_enrich_place_ratings", mock_enrich)

        results, failed = await matcher.find_places_for_clusters(clusters)
        await places_cache.clear()

        assert failed == 0
        place_ids = [p["place_id"] for p in results[0]["places"]]
        # Junk finalist (2 reviews) dropped, 4th-place candidate backfilled.
        assert "junk-closest" not in place_ids
        assert set(place_ids) == {"real-b", "real-c", "real-d"}

    @pytest.mark.asyncio
    async def test_signage_match_skips_enrichment_for_that_cluster(
        self, matcher, monkeypatch
    ) -> None:
        """A cluster whose top finalist matches detected signage is not enriched.

        The name-match bonus already decides the winner, so the Place Details
        calls would be pure cost. Clusters without a signage match must still be
        enriched as before.
        """
        import asyncio

        from app.services.place_matcher import places_cache

        await places_cache.clear()

        clusters = [
            {
                "id": "cluster-signage",
                "centroid": {"latitude": 35.6762, "longitude": 139.6503},
                "photos": [{"asset_id": "photo-1"}],
            },
            {
                "id": "cluster-plain",
                "centroid": {"latitude": 48.8584, "longitude": 2.2945},
                "photos": [{"asset_id": "photo-2"}],
            },
        ]

        signage_places = [
            {
                "id": "sushi-dai",
                "displayName": {"text": "Sushi Dai"},
                "formattedAddress": "1 St",
                "location": {"latitude": 35.6762, "longitude": 139.6503},
                "primaryType": "restaurant",
                "types": ["restaurant", "sushi_restaurant", "food"],
                "businessStatus": "OPERATIONAL",
            },
        ]
        plain_places = [
            {
                "id": "paris-cafe",
                "displayName": {"text": "Cafe de Mars"},
                "formattedAddress": "2 St",
                "location": {"latitude": 48.8584, "longitude": 2.2945},
                "primaryType": "cafe",
                "types": ["cafe", "food"],
                "businessStatus": "OPERATIONAL",
            },
        ]

        async def mock_search_nearby_tiered(latitude, longitude):
            if abs(latitude - 35.6762) < 0.01:
                return _tiered(signage_places)
            return _tiered(plain_places)

        enriched_ids: list[str] = []

        async def mock_enrich(place_ids):
            enriched_ids.extend(place_ids)
            return {pid: {"rating": 4.0, "userRatingCount": 100} for pid in place_ids}

        monkeypatch.setattr(matcher, "_search_nearby_tiered", mock_search_nearby_tiered)
        monkeypatch.setattr(matcher, "_enrich_place_ratings", mock_enrich)

        vision_result = VisionResult(
            category="food",
            detected_text=["Sushi Dai"],
            confidence="high",
        )

        async def make_vision_task():
            return {"cluster-signage": vision_result}

        vision_task = asyncio.ensure_future(make_vision_task())

        results, failed = await matcher.find_places_for_clusters(
            clusters, vision_results_task=vision_task
        )
        await places_cache.clear()

        assert failed == 0
        # Signage cluster's finalist was never sent to enrichment...
        assert "sushi-dai" not in enriched_ids
        # ...while the plain cluster still was.
        assert "paris-cafe" in enriched_ids
        # Both clusters still return their suggestion.
        by_cluster = {r["cluster_id"]: r for r in results}
        assert by_cluster["cluster-signage"]["places"][0]["place_id"] == "sushi-dai"
        assert by_cluster["cluster-plain"]["places"][0]["place_id"] == "paris-cafe"
