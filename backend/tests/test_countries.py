"""Tests for country endpoints."""

from typing import Any
from unittest.mock import AsyncMock, patch

import pytest
from fastapi.testclient import TestClient

from app.core.security import AuthUser, get_current_user
from app.main import app
from tests.conftest import mock_auth_dependency


@pytest.fixture(autouse=True)
def clear_country_cache() -> None:
    """Ensure country code cache is cleared between tests."""
    from app.api.countries import clear_country_code_cache

    clear_country_code_cache()
    yield
    clear_country_code_cache()


def test_list_countries_returns_empty_list(
    client: TestClient,
    mock_supabase_client: AsyncMock,
) -> None:
    """Test listing countries returns empty list when no countries exist."""
    mock_supabase_client.get.return_value = []

    with patch(
        "app.api.countries.get_supabase_client", return_value=mock_supabase_client
    ):
        response = client.get("/countries")

    assert response.status_code == 200
    assert response.json() == []


def test_list_countries_returns_countries(
    client: TestClient,
    mock_supabase_client: AsyncMock,
    sample_country: dict[str, Any],
) -> None:
    """Test listing countries returns available countries."""
    mock_supabase_client.get.return_value = [sample_country]

    with patch(
        "app.api.countries.get_supabase_client", return_value=mock_supabase_client
    ):
        response = client.get("/countries")

    assert response.status_code == 200
    data = response.json()
    assert len(data) == 1
    assert data[0]["code"] == "US"
    assert data[0]["name"] == "United States"


def test_list_countries_with_search(
    client: TestClient,
    mock_supabase_client: AsyncMock,
    sample_country: dict[str, Any],
) -> None:
    """Test filtering countries by search term."""
    other_country = {
        **sample_country,
        "id": "11111111-2222-3333-4444-555555555555",
        "code": "CA",
        "name": "Canada",
    }
    mock_supabase_client.get.return_value = [sample_country, other_country]

    with patch(
        "app.api.countries.get_supabase_client", return_value=mock_supabase_client
    ):
        response = client.get("/countries?search=United")

    assert response.status_code == 200
    data = response.json()
    assert len(data) == 1
    assert data[0]["code"] == sample_country["code"]

    # Search filtering happens in application code, not PostgREST params
    call_args = mock_supabase_client.get.call_args
    assert "or" not in call_args[0][1]


def test_list_countries_with_special_char_search(
    client: TestClient,
    mock_supabase_client: AsyncMock,
) -> None:
    """Ensure search terms with PostgREST syntax chars do not inject filters."""
    mock_supabase_client.get.return_value = []

    with patch(
        "app.api.countries.get_supabase_client", return_value=mock_supabase_client
    ):
        response = client.get("/countries?search=US),code.eq.null")

    assert response.status_code == 200
    params = mock_supabase_client.get.call_args[0][1]
    assert "or" not in params
    assert params == {"select": "*", "order": "name.asc"}


def test_list_countries_with_region_filter(
    client: TestClient,
    mock_supabase_client: AsyncMock,
    sample_country: dict[str, Any],
) -> None:
    """Test filtering countries by region."""
    mock_supabase_client.get.return_value = [sample_country]

    with patch(
        "app.api.countries.get_supabase_client", return_value=mock_supabase_client
    ):
        response = client.get("/countries?region=Americas")

    assert response.status_code == 200
    call_args = mock_supabase_client.get.call_args
    assert call_args[0][1]["region"] == "eq.Americas"


def test_list_regions(
    client: TestClient,
    mock_supabase_client: AsyncMock,
) -> None:
    """Test listing unique regions."""
    mock_supabase_client.get.return_value = [
        {"region": "Americas"},
        {"region": "Europe"},
        {"region": "Americas"},  # Duplicate
    ]

    with patch(
        "app.api.countries.get_supabase_client", return_value=mock_supabase_client
    ):
        response = client.get("/countries/regions")

    assert response.status_code == 200
    data = response.json()
    assert len(data) == 2
    assert "Americas" in data
    assert "Europe" in data


def test_get_user_countries_requires_auth(
    client: TestClient,
) -> None:
    """Test that user countries endpoint requires authentication."""
    response = client.get("/countries/user")
    assert response.status_code == 403  # No auth header


def test_get_user_countries_authenticated(
    client: TestClient,
    mock_supabase_client: AsyncMock,
    mock_user: AuthUser,
    auth_headers: dict[str, str],
) -> None:
    """Test getting user countries when authenticated."""
    mock_supabase_client.get.return_value = []

    app.dependency_overrides[get_current_user] = mock_auth_dependency(mock_user)
    try:
        with patch(
            "app.api.countries.get_supabase_client", return_value=mock_supabase_client
        ):
            response = client.get("/countries/user", headers=auth_headers)
        assert response.status_code == 200
        assert response.json() == []
    finally:
        app.dependency_overrides.clear()


def test_set_user_country(
    client: TestClient,
    mock_supabase_client: AsyncMock,
    mock_user: AuthUser,
    auth_headers: dict[str, str],
) -> None:
    """Test setting a user country status."""
    from tests.conftest import TEST_COUNTRY_ID, TEST_USER_COUNTRY_ID

    # First call: look up country by code, second call: check existing association
    mock_supabase_client.get.side_effect = [
        [{"id": TEST_COUNTRY_ID}],  # Country lookup by code
        [],  # No existing user_countries entry
    ]
    mock_supabase_client.post.return_value = [
        {
            "id": TEST_USER_COUNTRY_ID,
            "user_id": mock_user.id,
            "country_id": TEST_COUNTRY_ID,
            "country_code": "US",
            "status": "visited",
            "created_at": "2024-01-01T00:00:00Z",
        }
    ]

    app.dependency_overrides[get_current_user] = mock_auth_dependency(mock_user)
    try:
        with patch(
            "app.api.countries.get_supabase_client", return_value=mock_supabase_client
        ):
            response = client.post(
                "/countries/user",
                headers=auth_headers,
                json={"country_code": "US", "status": "visited"},
            )
        assert response.status_code == 201
        data = response.json()
        assert data["status"] == "visited"
        assert data["country_code"] == "US"
    finally:
        app.dependency_overrides.clear()


def test_delete_user_country(
    client: TestClient,
    mock_supabase_client: AsyncMock,
    mock_user: AuthUser,
    auth_headers: dict[str, str],
) -> None:
    """Test deleting a user country status."""
    from tests.conftest import TEST_COUNTRY_ID, TEST_USER_COUNTRY_ID

    mock_supabase_client.delete.return_value = [
        {
            "id": TEST_USER_COUNTRY_ID,
            "user_id": mock_user.id,
            "country_id": TEST_COUNTRY_ID,
            "status": "visited",
            "created_at": "2024-01-01T00:00:00Z",
        }
    ]

    app.dependency_overrides[get_current_user] = mock_auth_dependency(mock_user)
    try:
        with patch(
            "app.api.countries.get_supabase_client", return_value=mock_supabase_client
        ):
            response = client.delete(
                f"/countries/user/{TEST_COUNTRY_ID}",
                headers=auth_headers,
            )
        assert response.status_code == 204
    finally:
        app.dependency_overrides.clear()


def test_delete_user_country_idempotent(
    client: TestClient,
    mock_supabase_client: AsyncMock,
    mock_user: AuthUser,
    auth_headers: dict[str, str],
) -> None:
    """Test deleting a user country is idempotent (returns 204 even if not found)."""
    # DELETE is idempotent - returns 204 even when nothing is deleted
    mock_supabase_client.delete.return_value = []

    app.dependency_overrides[get_current_user] = mock_auth_dependency(mock_user)
    try:
        with patch(
            "app.api.countries.get_supabase_client", return_value=mock_supabase_client
        ):
            response = client.delete(
                "/countries/user/550e8400-e29b-41d4-a716-446655440999",
                headers=auth_headers,
            )
        assert response.status_code == 204
    finally:
        app.dependency_overrides.clear()


def test_delete_user_country_by_code(
    client: TestClient,
    mock_supabase_client: AsyncMock,
    mock_user: AuthUser,
    auth_headers: dict[str, str],
) -> None:
    """Test deleting a user country by country code."""
    from tests.conftest import TEST_COUNTRY_ID

    mock_supabase_client.get.return_value = [{"id": TEST_COUNTRY_ID}]
    mock_supabase_client.delete.return_value = []

    app.dependency_overrides[get_current_user] = mock_auth_dependency(mock_user)
    try:
        with patch(
            "app.api.countries.get_supabase_client", return_value=mock_supabase_client
        ):
            response = client.delete(
                "/countries/user/by-code/US",
                headers=auth_headers,
            )
        assert response.status_code == 204
    finally:
        app.dependency_overrides.clear()


def test_delete_user_country_by_code_not_found(
    client: TestClient,
    mock_supabase_client: AsyncMock,
    mock_user: AuthUser,
    auth_headers: dict[str, str],
) -> None:
    """Test deleting non-existent country code returns 204 (idempotent)."""
    mock_supabase_client.get.return_value = []  # Country not found

    app.dependency_overrides[get_current_user] = mock_auth_dependency(mock_user)
    try:
        with patch(
            "app.api.countries.get_supabase_client", return_value=mock_supabase_client
        ):
            response = client.delete(
                "/countries/user/by-code/XX",
                headers=auth_headers,
            )
        assert response.status_code == 204
    finally:
        app.dependency_overrides.clear()


def test_delete_user_country_by_code_case_insensitive(
    client: TestClient,
    mock_supabase_client: AsyncMock,
    mock_user: AuthUser,
    auth_headers: dict[str, str],
) -> None:
    """Test country code lookup is case-insensitive (lowercase input uppercased)."""
    from tests.conftest import TEST_COUNTRY_ID

    mock_supabase_client.get.return_value = [{"id": TEST_COUNTRY_ID}]
    mock_supabase_client.delete.return_value = []

    app.dependency_overrides[get_current_user] = mock_auth_dependency(mock_user)
    try:
        with patch(
            "app.api.countries.get_supabase_client", return_value=mock_supabase_client
        ):
            response = client.delete(
                "/countries/user/by-code/us",
                headers=auth_headers,
            )
        assert response.status_code == 204
        # Verify uppercase was used in query
        mock_supabase_client.get.assert_called_once()
        call_args = mock_supabase_client.get.call_args
        assert "eq.US" in str(call_args)
    finally:
        app.dependency_overrides.clear()


@pytest.mark.asyncio
async def test_country_code_cache_hit(
    mock_supabase_client: AsyncMock,
) -> None:
    """Country code lookup hits the cache after first fetch."""
    from app.api.countries import get_country_id_by_code
    from tests.conftest import TEST_COUNTRY_ID

    mock_supabase_client.get.return_value = [{"id": TEST_COUNTRY_ID}]

    with patch(
        "app.api.countries.get_supabase_client", return_value=mock_supabase_client
    ):
        first = await get_country_id_by_code("us")
        second = await get_country_id_by_code("US")

    assert first == TEST_COUNTRY_ID
    assert second == TEST_COUNTRY_ID
    assert mock_supabase_client.get.await_count == 1


@pytest.mark.asyncio
async def test_country_code_cache_clear_forces_refresh(
    mock_supabase_client: AsyncMock,
) -> None:
    """Clearing the cache causes the next lookup to refetch from DB."""
    from app.api.countries import clear_country_code_cache, get_country_id_by_code
    from tests.conftest import TEST_COUNTRY_ID

    mock_supabase_client.get.return_value = [{"id": TEST_COUNTRY_ID}]

    with patch(
        "app.api.countries.get_supabase_client", return_value=mock_supabase_client
    ):
        await get_country_id_by_code("US")
        clear_country_code_cache()
        await get_country_id_by_code("US")

    assert mock_supabase_client.get.await_count == 2


@pytest.mark.asyncio
async def test_country_code_cache_miss_returns_none(
    mock_supabase_client: AsyncMock,
) -> None:
    """Missing country code returns None from cached lookup."""
    from app.api.countries import get_country_id_by_code

    mock_supabase_client.get.return_value = []

    with patch(
        "app.api.countries.get_supabase_client", return_value=mock_supabase_client
    ):
        result = await get_country_id_by_code("ZZ")

    assert result is None
    assert mock_supabase_client.get.await_count == 1
