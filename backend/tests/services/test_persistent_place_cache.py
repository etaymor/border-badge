"""Tests for the Postgres/Supabase-backed persistent place cache (L2).

Covers the search-response cache, the per-place details cache, best-effort error
degradation, and the L2 wiring into ``PlacesCache.get_or_fetch``.
"""

from datetime import UTC, datetime, timedelta
from unittest.mock import AsyncMock, patch

import pytest

from app.services.place_matcher import persistent_cache as pc
from app.services.place_matcher.cache import PlacesCache

PATCH_TARGET = "app.services.place_matcher.persistent_cache.get_supabase_client"


@pytest.fixture(autouse=True)
def _enable_persistent_cache():
    """Force the L2 enabled-guard on so cache tests exercise the DB path.

    The guard short-circuits when Supabase is unconfigured (as in the test env);
    these tests assert the configured behavior, so we patch it True.
    """
    with patch(
        "app.services.place_matcher.persistent_cache._persistent_cache_enabled",
        return_value=True,
    ):
        yield


def _future(seconds: int = 3600) -> str:
    return (datetime.now(UTC) + timedelta(seconds=seconds)).isoformat()


def _past(seconds: int = 3600) -> str:
    return (datetime.now(UTC) - timedelta(seconds=seconds)).isoformat()


# ============================================================================
# Search-response cache
# ============================================================================


class TestSearchCache:
    @pytest.mark.asyncio
    async def test_hit_returns_response(self) -> None:
        places = [{"id": "p1"}, {"id": "p2"}]
        mock_db = AsyncMock()
        mock_db.get = AsyncMock(
            return_value=[{"response": places, "expires_at": _future()}]
        )
        with patch(PATCH_TARGET, return_value=mock_db):
            result = await pc.get_search_cache("nearby_1_2_15_abcd")
        assert result == places

    @pytest.mark.asyncio
    async def test_miss_returns_none(self) -> None:
        mock_db = AsyncMock()
        mock_db.get = AsyncMock(return_value=[])
        with patch(PATCH_TARGET, return_value=mock_db):
            result = await pc.get_search_cache("nearby_1_2_15_abcd")
        assert result is None

    @pytest.mark.asyncio
    async def test_expired_returns_none(self) -> None:
        mock_db = AsyncMock()
        mock_db.get = AsyncMock(
            return_value=[{"response": [{"id": "p1"}], "expires_at": _past()}]
        )
        with patch(PATCH_TARGET, return_value=mock_db):
            result = await pc.get_search_cache("nearby_1_2_15_abcd")
        assert result is None

    @pytest.mark.asyncio
    async def test_db_error_degrades_to_miss(self) -> None:
        mock_db = AsyncMock()
        mock_db.get = AsyncMock(side_effect=RuntimeError("db down"))
        with patch(PATCH_TARGET, return_value=mock_db):
            result = await pc.get_search_cache("nearby_1_2_15_abcd")
        assert result is None

    @pytest.mark.asyncio
    async def test_set_upserts_with_ttl(self) -> None:
        mock_db = AsyncMock()
        mock_db.upsert = AsyncMock(return_value=[])
        with patch(PATCH_TARGET, return_value=mock_db):
            await pc.set_search_cache("nearby_1_2_15_abcd", [{"id": "p1"}])
        mock_db.upsert.assert_awaited_once()
        args, kwargs = mock_db.upsert.call_args
        assert args[0] == "places_search_cache"
        row = args[1][0]
        assert row["cache_key"] == "nearby_1_2_15_abcd"
        assert row["response"] == [{"id": "p1"}]
        assert "expires_at" in row
        assert kwargs.get("on_conflict") == "cache_key" or args[2] == "cache_key"

    @pytest.mark.asyncio
    async def test_set_db_error_swallowed(self) -> None:
        mock_db = AsyncMock()
        mock_db.upsert = AsyncMock(side_effect=RuntimeError("db down"))
        with patch(PATCH_TARGET, return_value=mock_db):
            # Must not raise — caching is best-effort.
            await pc.set_search_cache("k", [{"id": "p1"}])


# ============================================================================
# Per-place details cache
# ============================================================================


class TestPlaceDetailsCache:
    @pytest.mark.asyncio
    async def test_hit_returns_details(self) -> None:
        details = {"place_id": "abc", "name": "Cafe"}
        mock_db = AsyncMock()
        mock_db.get = AsyncMock(
            return_value=[{"details": details, "expires_at": _future()}]
        )
        with patch(PATCH_TARGET, return_value=mock_db):
            result = await pc.get_place_details_cache("abc")
        assert result == details

    @pytest.mark.asyncio
    async def test_empty_place_id_returns_none_without_query(self) -> None:
        mock_db = AsyncMock()
        mock_db.get = AsyncMock(return_value=[{"details": {}, "expires_at": _future()}])
        with patch(PATCH_TARGET, return_value=mock_db):
            result = await pc.get_place_details_cache("")
        assert result is None
        mock_db.get.assert_not_awaited()

    @pytest.mark.asyncio
    async def test_expired_returns_none(self) -> None:
        mock_db = AsyncMock()
        mock_db.get = AsyncMock(
            return_value=[{"details": {"name": "X"}, "expires_at": _past()}]
        )
        with patch(PATCH_TARGET, return_value=mock_db):
            result = await pc.get_place_details_cache("abc")
        assert result is None

    @pytest.mark.asyncio
    async def test_set_upserts(self) -> None:
        mock_db = AsyncMock()
        mock_db.upsert = AsyncMock(return_value=[])
        with patch(PATCH_TARGET, return_value=mock_db):
            await pc.set_place_details_cache("abc", {"place_id": "abc", "name": "X"})
        mock_db.upsert.assert_awaited_once()
        args, _ = mock_db.upsert.call_args
        assert args[0] == "cached_google_place"
        assert args[1][0]["google_place_id"] == "abc"

    @pytest.mark.asyncio
    async def test_set_ignores_empty_id(self) -> None:
        mock_db = AsyncMock()
        mock_db.upsert = AsyncMock(return_value=[])
        with patch(PATCH_TARGET, return_value=mock_db):
            await pc.set_place_details_cache("", {"name": "X"})
        mock_db.upsert.assert_not_awaited()


# ============================================================================
# L2 wiring in PlacesCache.get_or_fetch
# ============================================================================


class TestGetOrFetchL2Wiring:
    @pytest.mark.asyncio
    async def test_l2_hit_skips_fetch_fn(self) -> None:
        cache = PlacesCache()
        l2_value = [{"id": "from-l2"}]
        l2_get = AsyncMock(return_value=l2_value)
        l2_set = AsyncMock()
        fetch_fn = AsyncMock(return_value=[{"id": "from-api"}])

        result = await cache.get_or_fetch("k", fetch_fn, l2_get=l2_get, l2_set=l2_set)

        assert result == l2_value
        fetch_fn.assert_not_awaited()  # L2 hit must not call the API
        l2_set.assert_not_awaited()  # nothing fresh to write back

    @pytest.mark.asyncio
    async def test_l2_miss_calls_fetch_and_writes_through(self) -> None:
        cache = PlacesCache()
        api_value = [{"id": "from-api"}]
        l2_get = AsyncMock(return_value=None)
        l2_set = AsyncMock()
        fetch_fn = AsyncMock(return_value=api_value)

        result = await cache.get_or_fetch("k", fetch_fn, l2_get=l2_get, l2_set=l2_set)

        assert result == api_value
        fetch_fn.assert_awaited_once()
        l2_set.assert_awaited_once_with("k", api_value)

    @pytest.mark.asyncio
    async def test_l1_hit_skips_l2(self) -> None:
        cache = PlacesCache()
        await cache.set("k", [{"id": "from-l1"}])
        l2_get = AsyncMock(return_value=[{"id": "from-l2"}])
        fetch_fn = AsyncMock(return_value=[{"id": "from-api"}])

        result = await cache.get_or_fetch("k", fetch_fn, l2_get=l2_get)

        assert result == [{"id": "from-l1"}]
        l2_get.assert_not_awaited()  # L1 hit short-circuits before L2
        fetch_fn.assert_not_awaited()

    @pytest.mark.asyncio
    async def test_backward_compatible_without_l2(self) -> None:
        cache = PlacesCache()
        fetch_fn = AsyncMock(return_value=[{"id": "x"}])
        result = await cache.get_or_fetch("k", fetch_fn)
        assert result == [{"id": "x"}]
        fetch_fn.assert_awaited_once()
