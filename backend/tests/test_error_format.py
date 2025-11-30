"""Tests for error response format consistency."""

from unittest.mock import AsyncMock, patch

from fastapi.testclient import TestClient

from app.core.security import AuthUser, get_current_user
from app.main import app
from tests.conftest import mock_auth_dependency


def test_404_error_format(
    client: TestClient,
    mock_supabase_client: AsyncMock,
) -> None:
    """Test that 404 errors return proper format."""
    mock_user = AuthUser(user_id="test-user", email="test@example.com")
    mock_supabase_client.get.return_value = []

    app.dependency_overrides[get_current_user] = mock_auth_dependency(mock_user)
    try:
        with patch(
            "app.api.trips.get_supabase_client", return_value=mock_supabase_client
        ):
            response = client.get(
                "/trips/550e8400-e29b-41d4-a716-446655440999",
                headers={"Authorization": "Bearer mock-token"},
            )
        assert response.status_code == 404
        data = response.json()
        assert "detail" in data
    finally:
        app.dependency_overrides.clear()


def test_409_conflict_error_format(
    client: TestClient,
    mock_supabase_client: AsyncMock,
) -> None:
    """Test that 409 errors return proper format."""
    mock_user = AuthUser(user_id="test-user", email="test@example.com")
    trip_id = "550e8400-e29b-41d4-a716-446655440002"
    tag = {
        "id": "tag-id-123",
        "trip_id": trip_id,
        "tagged_user_id": "test-user",
        "status": "approved",  # Already approved
    }
    mock_supabase_client.get.return_value = [tag]

    app.dependency_overrides[get_current_user] = mock_auth_dependency(mock_user)
    try:
        with patch(
            "app.api.trips.get_supabase_client", return_value=mock_supabase_client
        ):
            response = client.post(
                f"/trips/{trip_id}/approve",
                headers={"Authorization": "Bearer mock-token"},
            )
        assert response.status_code == 409
        data = response.json()
        assert "detail" in data
    finally:
        app.dependency_overrides.clear()


def test_400_bad_request_error_format(
    client: TestClient,
    mock_supabase_client: AsyncMock,
) -> None:
    """Test that 400 errors return proper format."""
    mock_user = AuthUser(user_id="test-user", email="test@example.com")

    app.dependency_overrides[get_current_user] = mock_auth_dependency(mock_user)
    try:
        with (
            patch(
                "app.api.media.get_supabase_client", return_value=mock_supabase_client
            ),
            patch("app.api.media.get_settings") as mock_settings,
        ):
            mock_settings.return_value.supabase_url = "https://test.supabase.co"
            # Missing required parent (trip_id or entry_id)
            response = client.post(
                "/media/files/upload-url",
                headers={"Authorization": "Bearer mock-token"},
                json={"filename": "photo.jpg", "content_type": "image/jpeg"},
            )
        assert response.status_code == 400
        data = response.json()
        assert "detail" in data
    finally:
        app.dependency_overrides.clear()


def test_validation_error_format(client: TestClient) -> None:
    """Test that validation errors return proper format."""
    mock_user = AuthUser(user_id="test-user", email="test@example.com")

    app.dependency_overrides[get_current_user] = mock_auth_dependency(mock_user)
    try:
        # Invalid UUID format
        response = client.get(
            "/trips/not-a-valid-uuid",
            headers={"Authorization": "Bearer mock-token"},
        )
        assert response.status_code == 422
        data = response.json()
        assert "detail" in data
    finally:
        app.dependency_overrides.clear()


def test_unauthorized_error_format(client: TestClient) -> None:
    """Test that 403 errors are returned when no auth is provided."""
    response = client.get("/trips")
    assert response.status_code == 403
    data = response.json()
    assert "detail" in data
