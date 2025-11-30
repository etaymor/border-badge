"""Tests for country endpoints."""

from typing import Any
from unittest.mock import AsyncMock, patch

from fastapi.testclient import TestClient

from app.core.security import AuthUser, get_current_user
from app.main import app
from tests.conftest import mock_auth_dependency


def test_list_countries_returns_empty_list(
    client: TestClient,
    mock_supabase_client: AsyncMock,
) -> None:
    """Test listing countries returns empty list when no countries exist."""
    mock_supabase_client.get.return_value = []

    with patch("app.api.countries.get_supabase_client", return_value=mock_supabase_client):
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

    with patch("app.api.countries.get_supabase_client", return_value=mock_supabase_client):
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
    mock_supabase_client.get.return_value = [sample_country]

    with patch("app.api.countries.get_supabase_client", return_value=mock_supabase_client):
        response = client.get("/countries?search=United")

    assert response.status_code == 200
    # Verify search param was passed to client
    call_args = mock_supabase_client.get.call_args
    assert "or" in call_args[0][1]


def test_list_countries_with_region_filter(
    client: TestClient,
    mock_supabase_client: AsyncMock,
    sample_country: dict[str, Any],
) -> None:
    """Test filtering countries by region."""
    mock_supabase_client.get.return_value = [sample_country]

    with patch("app.api.countries.get_supabase_client", return_value=mock_supabase_client):
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

    with patch("app.api.countries.get_supabase_client", return_value=mock_supabase_client):
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
        with patch("app.api.countries.get_supabase_client", return_value=mock_supabase_client):
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

    mock_supabase_client.get.return_value = []  # No existing entry
    mock_supabase_client.post.return_value = [
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
        with patch("app.api.countries.get_supabase_client", return_value=mock_supabase_client):
            response = client.post(
                "/countries/user",
                headers=auth_headers,
                json={"country_id": TEST_COUNTRY_ID, "status": "visited"},
            )
        assert response.status_code == 201
        data = response.json()
        assert data["status"] == "visited"
    finally:
        app.dependency_overrides.clear()
