"""Tests for the place_matcher service."""

import asyncio
from typing import Any
from unittest.mock import AsyncMock, MagicMock

import httpx
import pytest

from app.schemas.entries import EntryType
from app.services.place_matcher import (
    TYPE_TO_CATEGORY,
    PlaceMatcher,
    PlacesCache,
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
        monkeypatch.setattr("app.services.place_matcher.time.time", mock_time["get"])

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
        monkeypatch.setattr("app.services.place_matcher.time.time", mock_time["get"])

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
        monkeypatch.setattr("app.services.place_matcher.time.time", mock_time["get"])

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
        monkeypatch.setattr("app.services.place_matcher.time.time", mock_time["get"])

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
        monkeypatch.setattr("app.services.place_matcher.time.time", mock_time["get"])

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
        monkeypatch.setattr("app.services.place_matcher.time.time", mock_time["get"])

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

    def test_clear_removes_all_entries(self) -> None:
        """Test that clear() empties the cache."""
        cache = PlacesCache(ttl_hours=24, max_size=100)

        # Use synchronous internal access for this simple test
        cache._cache["key1"] = ([{"place": "data1"}], 1000000.0)
        cache._cache["key2"] = ([{"place": "data2"}], 1000000.0)
        assert cache.size == 2

        cache.clear()

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
        monkeypatch.setattr("app.services.place_matcher.time.time", mock_time["get"])

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
        """Test that coordinates are truncated to 3 decimal places."""
        cache = PlacesCache()

        key1 = cache.get_cache_key(35.67891234, 139.65032456, 30)
        key2 = cache.get_cache_key(35.679, 139.650, 30)

        # Both should produce same key due to truncation
        assert key1 == key2
        assert key1 == "35.679_139.65_30"

    def test_get_cache_key_includes_radius(self) -> None:
        """Test that different radii produce different keys."""
        cache = PlacesCache()

        key1 = cache.get_cache_key(35.679, 139.650, 30)
        key2 = cache.get_cache_key(35.679, 139.650, 75)

        assert key1 != key2
        assert "30" in key1
        assert "75" in key2

    def test_get_cache_key_handles_negative_coordinates(self) -> None:
        """Test that negative coordinates are handled correctly."""
        cache = PlacesCache()

        key = cache.get_cache_key(-33.8688, 151.2093, 30)

        assert "-33.869" in key
        assert "151.209" in key


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
        """Sample Places API response."""
        return {
            "places": [
                {
                    "id": "place-123",
                    "displayName": {"text": "Test Restaurant"},
                    "formattedAddress": "123 Test St",
                    "location": {"latitude": 35.6762, "longitude": 139.6503},
                    "primaryType": "restaurant",
                    "types": ["restaurant", "food"],
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
        monkeypatch.setattr("app.services.place_matcher.get_settings", lambda: settings)
        return settings

    @pytest.fixture
    def clean_cache(self):
        """Clear the module-level places cache before each test."""
        from app.services.place_matcher import places_cache

        places_cache.clear()
        yield
        places_cache.clear()

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
        results = await matcher.find_places_for_clusters(sample_clusters)

        # Should have 3 successful results (5 clusters - 2 failures)
        assert len(results) == 3
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
        results = await matcher.find_places_for_clusters(sample_clusters[:2])

        # All clusters timed out, so empty results
        assert len(results) == 0

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
        results = await matcher.find_places_for_clusters(sample_clusters)

        # Should have 4 successful results (5 clusters - 1 HTTP error)
        assert len(results) == 4

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
        results = await matcher.find_places_for_clusters(sample_clusters)

        # RateLimitError gets raised and filtered, other clusters succeed
        assert len(results) == 4

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
        results = await matcher.find_places_for_clusters(sample_clusters)

        # All clusters failed, return empty list
        assert results == []

    @pytest.mark.asyncio
    async def test_no_results_for_cluster_returns_none_filtered(
        self,
        sample_clusters,
        mock_settings,
        clean_cache,
    ) -> None:
        """Test that clusters with no places are filtered (return None)."""

        async def mock_post(*args, **kwargs):
            # Return empty places list
            mock_response = MagicMock()
            mock_response.status_code = 200
            mock_response.json.return_value = {"places": []}
            return mock_response

        mock_client = AsyncMock()
        mock_client.post = mock_post

        matcher = PlaceMatcher(http_client=mock_client)
        results = await matcher.find_places_for_clusters(sample_clusters)

        # All clusters returned no places, so all filtered out
        assert results == []

    @pytest.mark.asyncio
    async def test_mixed_success_none_and_exceptions(
        self,
        sample_clusters,
        mock_places_response,
        mock_settings,
        clean_cache,
    ) -> None:
        """Test combination of successes, no-results, and exceptions."""
        call_count = [0]

        async def mock_post(*args, **kwargs):
            idx = call_count[0]
            call_count[0] += 1

            # Cluster 0: Success
            if idx == 0:
                mock_response = MagicMock()
                mock_response.status_code = 200
                mock_response.json.return_value = mock_places_response
                return mock_response

            # Cluster 1: No places (returns None after ranking)
            if idx == 1:
                mock_response = MagicMock()
                mock_response.status_code = 200
                mock_response.json.return_value = {"places": []}
                return mock_response

            # Cluster 2: Exception
            if idx == 2:
                raise httpx.RequestError("Network error")

            # Cluster 3: Success
            if idx == 3:
                mock_response = MagicMock()
                mock_response.status_code = 200
                mock_response.json.return_value = mock_places_response
                return mock_response

            # Cluster 4: Timeout
            raise httpx.TimeoutException("Timeout")

        mock_client = AsyncMock()
        mock_client.post = mock_post

        matcher = PlaceMatcher(http_client=mock_client)
        results = await matcher.find_places_for_clusters(sample_clusters)

        # Should have 2 results (clusters 0 and 3 succeeded)
        assert len(results) == 2
