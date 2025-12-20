"""Tests for Skimlinks API client and caching."""

from datetime import UTC, datetime, timedelta
from unittest.mock import AsyncMock, MagicMock, patch

import httpx
import pytest

from app.schemas.affiliate import ResolutionPath
from app.services.skimlinks import (
    API_TIMEOUT_SECONDS,
    DEFAULT_CACHE_TTL_HOURS,
    SKIMLINKS_API_URL,
    _build_subid,
    _is_configured,
    cache_url,
    cleanup_expired_cache,
    get_cached_url,
    invalidate_cache,
    resolve_with_skimlinks,
    wrap_url,
    wrap_url_with_cache,
)

# Test data
TEST_ORIGINAL_URL = "https://www.booking.com/hotel/us/grand-hyatt.html"
TEST_WRAPPED_URL = "https://go.skimresources.com/?id=12345&url=https%3A%2F%2Fwww.booking.com%2Fhotel%2Fus%2Fgrand-hyatt.html"
TEST_TRIP_ID = "550e8400-e29b-41d4-a716-446655440001"
TEST_ENTRY_ID = "550e8400-e29b-41d4-a716-446655440002"
TEST_CACHE_ID = "550e8400-e29b-41d4-a716-446655440099"


class TestBuildSubid:
    """Tests for subid formatting."""

    def test_build_subid_with_both_ids(self) -> None:
        """Test subid with both trip and entry IDs."""
        subid = _build_subid(TEST_TRIP_ID, TEST_ENTRY_ID)
        assert subid == f"trip_{TEST_TRIP_ID}_entry_{TEST_ENTRY_ID}"

    def test_build_subid_with_trip_only(self) -> None:
        """Test subid with only trip ID."""
        subid = _build_subid(TEST_TRIP_ID, None)
        assert subid == f"trip_{TEST_TRIP_ID}_entry_none"

    def test_build_subid_with_entry_only(self) -> None:
        """Test subid with only entry ID."""
        subid = _build_subid(None, TEST_ENTRY_ID)
        assert subid == f"trip_none_entry_{TEST_ENTRY_ID}"

    def test_build_subid_with_neither(self) -> None:
        """Test subid with neither ID."""
        subid = _build_subid(None, None)
        assert subid == "trip_none_entry_none"


class TestIsConfigured:
    """Tests for configuration check."""

    def test_is_configured_when_both_set(self) -> None:
        """Test configured returns True when both keys are set."""
        mock_settings = MagicMock()
        mock_settings.skimlinks_api_key = "test-api-key"
        mock_settings.skimlinks_publisher_id = "test-publisher-id"

        with patch("app.services.skimlinks.get_settings", return_value=mock_settings):
            assert _is_configured() is True

    def test_is_configured_when_api_key_missing(self) -> None:
        """Test configured returns False when API key is missing."""
        mock_settings = MagicMock()
        mock_settings.skimlinks_api_key = ""
        mock_settings.skimlinks_publisher_id = "test-publisher-id"

        with patch("app.services.skimlinks.get_settings", return_value=mock_settings):
            assert _is_configured() is False

    def test_is_configured_when_publisher_id_missing(self) -> None:
        """Test configured returns False when publisher ID is missing."""
        mock_settings = MagicMock()
        mock_settings.skimlinks_api_key = "test-api-key"
        mock_settings.skimlinks_publisher_id = ""

        with patch("app.services.skimlinks.get_settings", return_value=mock_settings):
            assert _is_configured() is False


class TestWrapUrl:
    """Tests for Skimlinks API wrapping."""

    @pytest.mark.asyncio
    async def test_wrap_url_success(self) -> None:
        """Test successful URL wrapping."""
        mock_settings = MagicMock()
        mock_settings.skimlinks_api_key = "test-api-key"
        mock_settings.skimlinks_publisher_id = "test-publisher-id"

        mock_response = MagicMock()
        mock_response.text = TEST_WRAPPED_URL
        mock_response.raise_for_status = MagicMock()

        with (
            patch("app.services.skimlinks.get_settings", return_value=mock_settings),
            patch("httpx.AsyncClient") as mock_client_class,
        ):
            mock_client = AsyncMock()
            mock_client.get = AsyncMock(return_value=mock_response)
            mock_client.__aenter__ = AsyncMock(return_value=mock_client)
            mock_client.__aexit__ = AsyncMock()
            mock_client_class.return_value = mock_client

            result = await wrap_url(TEST_ORIGINAL_URL, TEST_TRIP_ID, TEST_ENTRY_ID)

            assert result == TEST_WRAPPED_URL
            mock_client.get.assert_called_once()

            # Verify call parameters
            call_args = mock_client.get.call_args
            assert call_args[0][0] == SKIMLINKS_API_URL
            params = call_args[1]["params"]
            assert params["url"] == TEST_ORIGINAL_URL
            assert params["apikey"] == "test-api-key"
            assert params["publisher_id"] == "test-publisher-id"
            assert params["xs"] == "1"
            assert f"trip_{TEST_TRIP_ID}" in params["custom_id"]

    @pytest.mark.asyncio
    async def test_wrap_url_not_configured(self) -> None:
        """Test URL wrap returns None when not configured."""
        mock_settings = MagicMock()
        mock_settings.skimlinks_api_key = ""
        mock_settings.skimlinks_publisher_id = ""

        with patch("app.services.skimlinks.get_settings", return_value=mock_settings):
            result = await wrap_url(TEST_ORIGINAL_URL)
            assert result is None

    @pytest.mark.asyncio
    async def test_wrap_url_timeout(self) -> None:
        """Test URL wrap returns None on timeout."""
        mock_settings = MagicMock()
        mock_settings.skimlinks_api_key = "test-api-key"
        mock_settings.skimlinks_publisher_id = "test-publisher-id"

        with (
            patch("app.services.skimlinks.get_settings", return_value=mock_settings),
            patch("httpx.AsyncClient") as mock_client_class,
        ):
            mock_client = AsyncMock()
            # TimeoutException can be raised directly without a message
            timeout_exc = httpx.TimeoutException(message="Connection timed out")
            mock_client.get = AsyncMock(side_effect=timeout_exc)
            mock_client.__aenter__ = AsyncMock(return_value=mock_client)
            mock_client.__aexit__ = AsyncMock()
            mock_client_class.return_value = mock_client

            result = await wrap_url(TEST_ORIGINAL_URL)
            assert result is None

    @pytest.mark.asyncio
    async def test_wrap_url_http_error(self) -> None:
        """Test URL wrap returns None on HTTP error."""
        mock_settings = MagicMock()
        mock_settings.skimlinks_api_key = "test-api-key"
        mock_settings.skimlinks_publisher_id = "test-publisher-id"

        mock_response = MagicMock()
        mock_response.status_code = 500
        mock_response.text = "Internal Server Error"

        with (
            patch("app.services.skimlinks.get_settings", return_value=mock_settings),
            patch("httpx.AsyncClient") as mock_client_class,
        ):
            mock_client = AsyncMock()
            mock_client.get = AsyncMock(
                side_effect=httpx.HTTPStatusError(
                    "500", request=MagicMock(), response=mock_response
                )
            )
            mock_client.__aenter__ = AsyncMock(return_value=mock_client)
            mock_client.__aexit__ = AsyncMock()
            mock_client_class.return_value = mock_client

            result = await wrap_url(TEST_ORIGINAL_URL)
            assert result is None

    @pytest.mark.asyncio
    async def test_wrap_url_request_error(self) -> None:
        """Test URL wrap returns None on network error."""
        mock_settings = MagicMock()
        mock_settings.skimlinks_api_key = "test-api-key"
        mock_settings.skimlinks_publisher_id = "test-publisher-id"

        with (
            patch("app.services.skimlinks.get_settings", return_value=mock_settings),
            patch("httpx.AsyncClient") as mock_client_class,
        ):
            mock_client = AsyncMock()
            # RequestError requires message kwarg
            request_err = httpx.RequestError(message="Network error")
            mock_client.get = AsyncMock(side_effect=request_err)
            mock_client.__aenter__ = AsyncMock(return_value=mock_client)
            mock_client.__aexit__ = AsyncMock()
            mock_client_class.return_value = mock_client

            result = await wrap_url(TEST_ORIGINAL_URL)
            assert result is None

    @pytest.mark.asyncio
    async def test_wrap_url_invalid_response(self) -> None:
        """Test URL wrap returns None on invalid response."""
        mock_settings = MagicMock()
        mock_settings.skimlinks_api_key = "test-api-key"
        mock_settings.skimlinks_publisher_id = "test-publisher-id"

        mock_response = MagicMock()
        mock_response.text = "NOT_A_URL"  # Invalid response
        mock_response.raise_for_status = MagicMock()

        with (
            patch("app.services.skimlinks.get_settings", return_value=mock_settings),
            patch("httpx.AsyncClient") as mock_client_class,
        ):
            mock_client = AsyncMock()
            mock_client.get = AsyncMock(return_value=mock_response)
            mock_client.__aenter__ = AsyncMock(return_value=mock_client)
            mock_client.__aexit__ = AsyncMock()
            mock_client_class.return_value = mock_client

            result = await wrap_url(TEST_ORIGINAL_URL)
            assert result is None


class TestCacheFunctions:
    """Tests for cache CRUD operations."""

    @pytest.mark.asyncio
    async def test_get_cached_url_hit(self) -> None:
        """Test cache hit returns wrapped URL."""
        mock_db = AsyncMock()
        mock_db.get = AsyncMock(
            return_value=[
                {
                    "id": TEST_CACHE_ID,
                    "original_url": TEST_ORIGINAL_URL,
                    "wrapped_url": TEST_WRAPPED_URL,
                    "created_at": datetime.now(UTC).isoformat(),
                    "expires_at": (datetime.now(UTC) + timedelta(hours=24)).isoformat(),
                }
            ]
        )

        with patch("app.services.skimlinks.get_supabase_client", return_value=mock_db):
            result = await get_cached_url(TEST_ORIGINAL_URL)
            assert result == TEST_WRAPPED_URL

    @pytest.mark.asyncio
    async def test_get_cached_url_miss(self) -> None:
        """Test cache miss returns None."""
        mock_db = AsyncMock()
        mock_db.get = AsyncMock(return_value=[])

        with patch("app.services.skimlinks.get_supabase_client", return_value=mock_db):
            result = await get_cached_url(TEST_ORIGINAL_URL)
            assert result is None

    @pytest.mark.asyncio
    async def test_cache_url_stores_entry(self) -> None:
        """Test cache_url stores entry with correct TTL."""
        mock_db = AsyncMock()
        mock_db.upsert = AsyncMock(
            return_value=[
                {
                    "id": TEST_CACHE_ID,
                    "original_url": TEST_ORIGINAL_URL,
                    "wrapped_url": TEST_WRAPPED_URL,
                    "created_at": datetime.now(UTC).isoformat(),
                    "expires_at": (datetime.now(UTC) + timedelta(hours=48)).isoformat(),
                }
            ]
        )

        with patch("app.services.skimlinks.get_supabase_client", return_value=mock_db):
            result = await cache_url(TEST_ORIGINAL_URL, TEST_WRAPPED_URL)
            assert result.original_url == TEST_ORIGINAL_URL
            assert result.wrapped_url == TEST_WRAPPED_URL

            # Verify upsert was called with correct data
            mock_db.upsert.assert_called_once()
            call_args = mock_db.upsert.call_args
            assert call_args[0][0] == "skimlinks_cache"
            data = call_args[0][1][0]
            assert data["original_url"] == TEST_ORIGINAL_URL
            assert data["wrapped_url"] == TEST_WRAPPED_URL
            assert call_args[1]["on_conflict"] == "original_url"

    @pytest.mark.asyncio
    async def test_cache_url_custom_ttl(self) -> None:
        """Test cache_url respects custom TTL."""
        mock_db = AsyncMock()
        mock_db.upsert = AsyncMock(
            return_value=[
                {
                    "id": TEST_CACHE_ID,
                    "original_url": TEST_ORIGINAL_URL,
                    "wrapped_url": TEST_WRAPPED_URL,
                    "created_at": datetime.now(UTC).isoformat(),
                    "expires_at": (datetime.now(UTC) + timedelta(hours=24)).isoformat(),
                }
            ]
        )

        with patch("app.services.skimlinks.get_supabase_client", return_value=mock_db):
            await cache_url(TEST_ORIGINAL_URL, TEST_WRAPPED_URL, ttl_hours=24)
            mock_db.upsert.assert_called_once()

    @pytest.mark.asyncio
    async def test_invalidate_cache_success(self) -> None:
        """Test cache invalidation deletes entry."""
        mock_db = AsyncMock()
        mock_db.delete = AsyncMock(
            return_value=[{"id": TEST_CACHE_ID}]  # Deleted entry
        )

        with patch("app.services.skimlinks.get_supabase_client", return_value=mock_db):
            result = await invalidate_cache(TEST_ORIGINAL_URL)
            assert result is True
            mock_db.delete.assert_called_once_with(
                "skimlinks_cache",
                {"original_url": f"eq.{TEST_ORIGINAL_URL}"},
            )

    @pytest.mark.asyncio
    async def test_invalidate_cache_not_found(self) -> None:
        """Test cache invalidation returns False when not found."""
        mock_db = AsyncMock()
        mock_db.delete = AsyncMock(return_value=[])

        with patch("app.services.skimlinks.get_supabase_client", return_value=mock_db):
            result = await invalidate_cache(TEST_ORIGINAL_URL)
            assert result is False

    @pytest.mark.asyncio
    async def test_cleanup_expired_cache(self) -> None:
        """Test cleanup deletes expired entries."""
        mock_db = AsyncMock()
        mock_db.delete = AsyncMock(
            return_value=[{"id": "1"}, {"id": "2"}, {"id": "3"}]  # 3 deleted
        )

        with patch("app.services.skimlinks.get_supabase_client", return_value=mock_db):
            result = await cleanup_expired_cache()
            assert result == 3
            mock_db.delete.assert_called_once()


class TestWrapUrlWithCache:
    """Tests for cached URL wrapping."""

    @pytest.mark.asyncio
    async def test_wrap_url_cache_hit(self) -> None:
        """Test cache hit returns cached URL without API call."""
        with (
            patch(
                "app.services.skimlinks.get_cached_url",
                return_value=TEST_WRAPPED_URL,
            ) as mock_get_cache,
            patch("app.services.skimlinks.wrap_url") as mock_wrap,
        ):
            result, from_cache = await wrap_url_with_cache(TEST_ORIGINAL_URL)

            assert result == TEST_WRAPPED_URL
            assert from_cache is True
            mock_get_cache.assert_called_once_with(TEST_ORIGINAL_URL)
            mock_wrap.assert_not_called()

    @pytest.mark.asyncio
    async def test_wrap_url_cache_miss_api_success(self) -> None:
        """Test cache miss calls API and caches result."""
        with (
            patch(
                "app.services.skimlinks.get_cached_url", return_value=None
            ) as mock_get_cache,
            patch(
                "app.services.skimlinks.wrap_url", return_value=TEST_WRAPPED_URL
            ) as mock_wrap,
            patch("app.services.skimlinks.cache_url") as mock_cache,
        ):
            result, from_cache = await wrap_url_with_cache(
                TEST_ORIGINAL_URL, TEST_TRIP_ID, TEST_ENTRY_ID
            )

            assert result == TEST_WRAPPED_URL
            assert from_cache is False
            mock_get_cache.assert_called_once()
            mock_wrap.assert_called_once_with(
                TEST_ORIGINAL_URL, TEST_TRIP_ID, TEST_ENTRY_ID
            )
            mock_cache.assert_called_once()

    @pytest.mark.asyncio
    async def test_wrap_url_cache_miss_api_failure(self) -> None:
        """Test cache miss with API failure returns None."""
        with (
            patch("app.services.skimlinks.get_cached_url", return_value=None),
            patch("app.services.skimlinks.wrap_url", return_value=None) as mock_wrap,
            patch("app.services.skimlinks.cache_url") as mock_cache,
        ):
            result, from_cache = await wrap_url_with_cache(TEST_ORIGINAL_URL)

            assert result is None
            assert from_cache is False
            mock_wrap.assert_called_once()
            mock_cache.assert_not_called()  # Don't cache failures

    @pytest.mark.asyncio
    async def test_wrap_url_cache_error_non_blocking(self) -> None:
        """Test cache error doesn't fail the wrap."""
        with (
            patch("app.services.skimlinks.get_cached_url", return_value=None),
            patch("app.services.skimlinks.wrap_url", return_value=TEST_WRAPPED_URL),
            patch(
                "app.services.skimlinks.cache_url",
                side_effect=Exception("DB error"),
            ),
        ):
            # Should not raise, just log warning
            result, from_cache = await wrap_url_with_cache(TEST_ORIGINAL_URL)

            assert result == TEST_WRAPPED_URL
            assert from_cache is False


class TestResolveWithSkimlinks:
    """Tests for high-level resolution with fallback."""

    @pytest.mark.asyncio
    async def test_resolve_not_configured_returns_original(self) -> None:
        """Test returns original URL when Skimlinks not configured."""
        with patch("app.services.skimlinks._is_configured", return_value=False):
            url, path = await resolve_with_skimlinks(TEST_ORIGINAL_URL)

            assert url == TEST_ORIGINAL_URL
            assert path == ResolutionPath.ORIGINAL

    @pytest.mark.asyncio
    async def test_resolve_success_returns_skimlinks(self) -> None:
        """Test returns wrapped URL with SKIMLINKS path."""
        with (
            patch("app.services.skimlinks._is_configured", return_value=True),
            patch(
                "app.services.skimlinks.wrap_url_with_cache",
                return_value=(TEST_WRAPPED_URL, False),
            ),
        ):
            url, path = await resolve_with_skimlinks(
                TEST_ORIGINAL_URL, TEST_TRIP_ID, TEST_ENTRY_ID
            )

            assert url == TEST_WRAPPED_URL
            assert path == ResolutionPath.SKIMLINKS

    @pytest.mark.asyncio
    async def test_resolve_failure_returns_original(self) -> None:
        """Test returns original URL on wrap failure."""
        with (
            patch("app.services.skimlinks._is_configured", return_value=True),
            patch(
                "app.services.skimlinks.wrap_url_with_cache",
                return_value=(None, False),
            ),
        ):
            url, path = await resolve_with_skimlinks(TEST_ORIGINAL_URL)

            assert url == TEST_ORIGINAL_URL
            assert path == ResolutionPath.ORIGINAL

    @pytest.mark.asyncio
    async def test_resolve_cache_hit_returns_skimlinks(self) -> None:
        """Test cache hit returns SKIMLINKS path."""
        with (
            patch("app.services.skimlinks._is_configured", return_value=True),
            patch(
                "app.services.skimlinks.wrap_url_with_cache",
                return_value=(TEST_WRAPPED_URL, True),  # from_cache=True
            ),
        ):
            url, path = await resolve_with_skimlinks(TEST_ORIGINAL_URL)

            assert url == TEST_WRAPPED_URL
            assert path == ResolutionPath.SKIMLINKS


class TestConstants:
    """Tests for module constants."""

    def test_api_url_is_valid(self) -> None:
        """Test API URL is valid HTTPS."""
        assert SKIMLINKS_API_URL.startswith("https://")

    def test_timeout_is_reasonable(self) -> None:
        """Test timeout is between 2-5 seconds."""
        assert 2.0 <= API_TIMEOUT_SECONDS <= 5.0

    def test_default_ttl_is_reasonable(self) -> None:
        """Test TTL is between 24-72 hours."""
        assert 24 <= DEFAULT_CACHE_TTL_HOURS <= 72
