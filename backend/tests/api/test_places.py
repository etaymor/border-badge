"""Tests for places API endpoints."""

from collections.abc import Callable, Coroutine
from typing import Any
from unittest.mock import AsyncMock, patch

import pytest
from fastapi.testclient import TestClient

from app.core.security import AuthUser, get_current_user
from app.main import app

# Test constants
TEST_USER_ID = "550e8400-e29b-41d4-a716-446655440000"
TEST_PLACE_ID = "550e8400-e29b-41d4-a716-446655440004"


@pytest.fixture
def client() -> TestClient:
    """Create test client."""
    return TestClient(app)


@pytest.fixture
def mock_user() -> AuthUser:
    """Create mock authenticated user."""
    return AuthUser(user_id=TEST_USER_ID, email="test@example.com")


@pytest.fixture
def auth_override(
    mock_user: AuthUser,
) -> Callable[[], Coroutine[Any, Any, AuthUser]]:
    """Override auth dependency."""

    async def override() -> AuthUser:
        return mock_user

    return override


class TestPlaceAutocomplete:
    """Tests for POST /places/autocomplete endpoint."""

    def test_rejects_unauthenticated_request(self, client: TestClient) -> None:
        """Autocomplete requires authentication."""
        response = client.post(
            "/places/autocomplete",
            json={"query": "coffee shop"},
        )
        # FastAPI returns 403 Forbidden when no auth is provided
        assert response.status_code in (401, 403)

    def test_rejects_short_query(
        self,
        client: TestClient,
        auth_override: Callable[[], Coroutine[Any, Any, AuthUser]],
    ) -> None:
        """Query must be at least 2 characters."""
        app.dependency_overrides[get_current_user] = auth_override

        try:
            response = client.post(
                "/places/autocomplete",
                json={"query": "a"},
                headers={"Authorization": "Bearer test-token"},
            )
            assert response.status_code == 422  # Validation error
        finally:
            app.dependency_overrides.clear()

    def test_rejects_long_query(
        self,
        client: TestClient,
        auth_override: Callable[[], Coroutine[Any, Any, AuthUser]],
    ) -> None:
        """Query must be at most 200 characters."""
        app.dependency_overrides[get_current_user] = auth_override

        try:
            response = client.post(
                "/places/autocomplete",
                json={"query": "a" * 201},
                headers={"Authorization": "Bearer test-token"},
            )
            assert response.status_code == 422  # Validation error
        finally:
            app.dependency_overrides.clear()

    def test_rejects_invalid_country_code(
        self,
        client: TestClient,
        auth_override: Callable[[], Coroutine[Any, Any, AuthUser]],
    ) -> None:
        """Country code must be 2 letters (too long/short/numeric rejected)."""
        app.dependency_overrides[get_current_user] = auth_override

        try:
            # Test too long
            response = client.post(
                "/places/autocomplete",
                json={"query": "coffee shop", "country_code": "USA"},
                headers={"Authorization": "Bearer test-token"},
            )
            assert response.status_code == 422

            # Test too short
            response = client.post(
                "/places/autocomplete",
                json={"query": "coffee shop", "country_code": "U"},
                headers={"Authorization": "Bearer test-token"},
            )
            assert response.status_code == 422

            # Test numeric (should be rejected)
            response = client.post(
                "/places/autocomplete",
                json={"query": "coffee shop", "country_code": "12"},
                headers={"Authorization": "Bearer test-token"},
            )
            assert response.status_code == 422
        finally:
            app.dependency_overrides.clear()

    def test_normalizes_lowercase_country_code(
        self,
        client: TestClient,
        auth_override: Callable[[], Coroutine[Any, Any, AuthUser]],
    ) -> None:
        """Lowercase country codes are normalized to uppercase."""
        app.dependency_overrides[get_current_user] = auth_override

        try:
            with patch("app.api.places.google_places_configured", return_value=True):
                with patch(
                    "app.api.places.search_places", new_callable=AsyncMock
                ) as mock_search:
                    mock_search.return_value = []

                    response = client.post(
                        "/places/autocomplete",
                        json={"query": "restaurant", "country_code": "us"},
                        headers={"Authorization": "Bearer test-token"},
                    )

                    assert response.status_code == 200
                    # Verify the normalized uppercase code was passed to search
                    mock_search.assert_called_once_with(
                        query="restaurant",
                        country_code="US",
                    )
        finally:
            app.dependency_overrides.clear()

    def test_returns_503_when_not_configured(
        self,
        client: TestClient,
        auth_override: Callable[[], Coroutine[Any, Any, AuthUser]],
    ) -> None:
        """Returns 503 when Google Places API is not configured."""
        app.dependency_overrides[get_current_user] = auth_override

        try:
            with patch(
                "app.api.places.google_places_configured", return_value=False
            ) as mock_configured:
                response = client.post(
                    "/places/autocomplete",
                    json={"query": "coffee shop"},
                    headers={"Authorization": "Bearer test-token"},
                )

                assert response.status_code == 503
                assert "temporarily unavailable" in response.json()["detail"]
                mock_configured.assert_called_once()
        finally:
            app.dependency_overrides.clear()

    def test_returns_empty_list_when_no_results(
        self,
        client: TestClient,
        auth_override: Callable[[], Coroutine[Any, Any, AuthUser]],
    ) -> None:
        """Returns empty list when no places match."""
        app.dependency_overrides[get_current_user] = auth_override

        try:
            with patch("app.api.places.google_places_configured", return_value=True):
                with patch(
                    "app.api.places.search_places", new_callable=AsyncMock
                ) as mock_search:
                    mock_search.return_value = []

                    response = client.post(
                        "/places/autocomplete",
                        json={"query": "xyznonexistentplace123"},
                        headers={"Authorization": "Bearer test-token"},
                    )

                    assert response.status_code == 200
                    assert response.json() == []
                    mock_search.assert_called_once_with(
                        query="xyznonexistentplace123",
                        country_code=None,
                    )
        finally:
            app.dependency_overrides.clear()

    def test_returns_predictions_successfully(
        self,
        client: TestClient,
        auth_override: Callable[[], Coroutine[Any, Any, AuthUser]],
    ) -> None:
        """Successfully returns place predictions."""
        app.dependency_overrides[get_current_user] = auth_override

        mock_results = [
            {
                "place_id": "ChIJN1t_tDeuEmsRUsoyG83frY4",
                "name": "Central Park Coffee",
                "address": "123 Main St, New York, NY",
            },
            {
                "place_id": "ChIJabc123",
                "name": "Coffee House",
                "address": "456 Oak Ave, Brooklyn, NY",
            },
        ]

        try:
            with patch("app.api.places.google_places_configured", return_value=True):
                with patch(
                    "app.api.places.search_places", new_callable=AsyncMock
                ) as mock_search:
                    mock_search.return_value = mock_results

                    response = client.post(
                        "/places/autocomplete",
                        json={"query": "coffee shop"},
                        headers={"Authorization": "Bearer test-token"},
                    )

                    assert response.status_code == 200
                    data = response.json()
                    assert len(data) == 2

                    assert data[0]["place_id"] == "ChIJN1t_tDeuEmsRUsoyG83frY4"
                    assert data[0]["main_text"] == "Central Park Coffee"
                    assert data[0]["secondary_text"] == "123 Main St, New York, NY"
                    assert data[0]["types"] == []

                    assert data[1]["place_id"] == "ChIJabc123"
                    assert data[1]["main_text"] == "Coffee House"
        finally:
            app.dependency_overrides.clear()

    def test_passes_country_code_to_search(
        self,
        client: TestClient,
        auth_override: Callable[[], Coroutine[Any, Any, AuthUser]],
    ) -> None:
        """Country code is passed to search_places when provided."""
        app.dependency_overrides[get_current_user] = auth_override

        try:
            with patch("app.api.places.google_places_configured", return_value=True):
                with patch(
                    "app.api.places.search_places", new_callable=AsyncMock
                ) as mock_search:
                    mock_search.return_value = []

                    response = client.post(
                        "/places/autocomplete",
                        json={"query": "restaurant", "country_code": "US"},
                        headers={"Authorization": "Bearer test-token"},
                    )

                    assert response.status_code == 200
                    mock_search.assert_called_once_with(
                        query="restaurant",
                        country_code="US",
                    )
        finally:
            app.dependency_overrides.clear()

    def test_skips_results_without_place_id(
        self,
        client: TestClient,
        auth_override: Callable[[], Coroutine[Any, Any, AuthUser]],
    ) -> None:
        """Results without place_id are filtered out."""
        app.dependency_overrides[get_current_user] = auth_override

        mock_results = [
            {"place_id": "ChIJ123", "name": "Valid Place", "address": "123 St"},
            {"name": "Invalid Place", "address": "456 St"},  # No place_id
            {"place_id": "", "name": "Empty ID", "address": "789 St"},  # Empty place_id
            {"place_id": "ChIJ456", "name": "Another Valid", "address": "999 St"},
        ]

        try:
            with patch("app.api.places.google_places_configured", return_value=True):
                with patch(
                    "app.api.places.search_places", new_callable=AsyncMock
                ) as mock_search:
                    mock_search.return_value = mock_results

                    response = client.post(
                        "/places/autocomplete",
                        json={"query": "coffee"},
                        headers={"Authorization": "Bearer test-token"},
                    )

                    assert response.status_code == 200
                    data = response.json()
                    # Only 2 valid results (with non-empty place_id)
                    assert len(data) == 2
                    assert data[0]["place_id"] == "ChIJ123"
                    assert data[1]["place_id"] == "ChIJ456"
        finally:
            app.dependency_overrides.clear()

    def test_handles_search_exception_gracefully(
        self,
        client: TestClient,
        auth_override: Callable[[], Coroutine[Any, Any, AuthUser]],
    ) -> None:
        """Returns 503 when search_places raises an exception."""
        app.dependency_overrides[get_current_user] = auth_override

        try:
            with patch("app.api.places.google_places_configured", return_value=True):
                with patch(
                    "app.api.places.search_places", new_callable=AsyncMock
                ) as mock_search:
                    mock_search.side_effect = Exception("Network error")

                    response = client.post(
                        "/places/autocomplete",
                        json={"query": "coffee shop"},
                        headers={"Authorization": "Bearer test-token"},
                    )

                    assert response.status_code == 503
                    assert "temporarily unavailable" in response.json()["detail"]
        finally:
            app.dependency_overrides.clear()


class TestGetPlace:
    """Tests for GET /places/{place_id} endpoint."""

    def test_rejects_unauthenticated_request(self, client: TestClient) -> None:
        """Get place requires authentication."""
        response = client.get(f"/places/{TEST_PLACE_ID}")
        assert response.status_code in (401, 403)

    def test_returns_404_for_nonexistent_place(
        self,
        client: TestClient,
        auth_override: Callable[[], Coroutine[Any, Any, AuthUser]],
    ) -> None:
        """Returns 404 when place is not found."""
        app.dependency_overrides[get_current_user] = auth_override

        try:
            with patch("app.api.places.get_supabase_client") as mock_db:
                mock_client = AsyncMock()
                mock_client.get = AsyncMock(return_value=[])
                mock_db.return_value = mock_client

                with patch("app.api.places.get_token_from_request"):
                    response = client.get(
                        f"/places/{TEST_PLACE_ID}",
                        headers={"Authorization": "Bearer test-token"},
                    )

                    assert response.status_code == 404
                    assert "not found" in response.json()["detail"]
        finally:
            app.dependency_overrides.clear()

    def test_returns_place_successfully(
        self,
        client: TestClient,
        auth_override: Callable[[], Coroutine[Any, Any, AuthUser]],
    ) -> None:
        """Successfully returns place data."""
        app.dependency_overrides[get_current_user] = auth_override

        mock_place = {
            "id": TEST_PLACE_ID,
            "entry_id": "550e8400-e29b-41d4-a716-446655440003",
            "google_place_id": "ChIJN1t_tDeuEmsRUsoyG83frY4",
            "place_name": "Central Park",
            "lat": 40.7829,
            "lng": -73.9654,
            "address": "New York, NY, USA",
            "extra_data": {"website": "https://example.com"},
        }

        try:
            with patch("app.api.places.get_supabase_client") as mock_db:
                mock_client = AsyncMock()
                mock_client.get = AsyncMock(return_value=[mock_place])
                mock_db.return_value = mock_client

                with patch("app.api.places.get_token_from_request"):
                    response = client.get(
                        f"/places/{TEST_PLACE_ID}",
                        headers={"Authorization": "Bearer test-token"},
                    )

                    assert response.status_code == 200
                    data = response.json()
                    assert data["id"] == TEST_PLACE_ID
                    assert data["place_name"] == "Central Park"
                    assert data["google_place_id"] == "ChIJN1t_tDeuEmsRUsoyG83frY4"
        finally:
            app.dependency_overrides.clear()
