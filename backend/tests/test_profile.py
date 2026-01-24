"""Tests for user profile endpoints."""

from typing import Any
from unittest.mock import AsyncMock, Mock, patch

import httpx
from fastapi.testclient import TestClient

from app.core.security import AuthUser, get_current_user
from app.main import app
from tests.conftest import TEST_USER_ID, mock_auth_dependency

# ============================================================================
# Profile Fixtures
# ============================================================================


def sample_profile(user_id: str = TEST_USER_ID) -> dict[str, Any]:
    """Sample profile data."""
    return {
        "id": "550e8400-e29b-41d4-a716-446655440100",
        "user_id": user_id,
        "display_name": "Test User",
        "avatar_url": None,
        "home_country_code": "US",
        "travel_motives": ["adventure", "culture"],
        "persona_tags": ["explorer"],
        "tracking_preference": "full_atlas",
        "created_at": "2024-01-01T00:00:00Z",
        "updated_at": "2024-01-01T00:00:00Z",
    }


# ============================================================================
# Get Profile Tests
# ============================================================================


def test_get_profile_requires_auth(client: TestClient) -> None:
    """Test that getting profile requires authentication."""
    response = client.get("/profile")
    assert response.status_code == 403


def test_get_profile_success(
    client: TestClient,
    mock_supabase_client: AsyncMock,
    mock_user: AuthUser,
    auth_headers: dict[str, str],
) -> None:
    """Test getting user profile successfully."""
    mock_supabase_client.get.return_value = [sample_profile()]

    app.dependency_overrides[get_current_user] = mock_auth_dependency(mock_user)
    try:
        with patch(
            "app.api.profile.get_supabase_client", return_value=mock_supabase_client
        ):
            response = client.get("/profile", headers=auth_headers)
        assert response.status_code == 200
        data = response.json()
        assert data["display_name"] == "Test User"
        assert data["tracking_preference"] == "full_atlas"
    finally:
        app.dependency_overrides.clear()


def test_get_profile_not_found(
    client: TestClient,
    mock_supabase_client: AsyncMock,
    mock_user: AuthUser,
    auth_headers: dict[str, str],
) -> None:
    """Test getting profile when none exists returns 404."""
    mock_supabase_client.get.return_value = []

    app.dependency_overrides[get_current_user] = mock_auth_dependency(mock_user)
    try:
        with patch(
            "app.api.profile.get_supabase_client", return_value=mock_supabase_client
        ):
            response = client.get("/profile", headers=auth_headers)
        assert response.status_code == 404
    finally:
        app.dependency_overrides.clear()


# ============================================================================
# Update Profile Tests
# ============================================================================


def test_update_profile_requires_auth(client: TestClient) -> None:
    """Test that updating profile requires authentication."""
    response = client.patch("/profile", json={"display_name": "New Name"})
    assert response.status_code == 403


def test_update_profile_success(
    client: TestClient,
    mock_supabase_client: AsyncMock,
    mock_user: AuthUser,
    auth_headers: dict[str, str],
) -> None:
    """Test updating user profile successfully."""
    updated_profile = sample_profile()
    updated_profile["home_country_code"] = "CA"

    mock_supabase_client.patch.return_value = [updated_profile]

    app.dependency_overrides[get_current_user] = mock_auth_dependency(mock_user)
    try:
        with patch(
            "app.api.profile.get_supabase_client", return_value=mock_supabase_client
        ):
            response = client.patch(
                "/profile",
                headers=auth_headers,
                json={"home_country_code": "CA"},
            )
        assert response.status_code == 200
        data = response.json()
        assert data["home_country_code"] == "CA"
    finally:
        app.dependency_overrides.clear()


def test_update_profile_no_fields(
    client: TestClient,
    mock_supabase_client: AsyncMock,
    mock_user: AuthUser,
    auth_headers: dict[str, str],
) -> None:
    """Test updating profile with no fields returns 400."""
    app.dependency_overrides[get_current_user] = mock_auth_dependency(mock_user)
    try:
        with patch(
            "app.api.profile.get_supabase_client", return_value=mock_supabase_client
        ):
            response = client.patch(
                "/profile",
                headers=auth_headers,
                json={},
            )
        assert response.status_code == 400
        assert "No fields to update" in response.json()["detail"]
    finally:
        app.dependency_overrides.clear()


def test_update_profile_not_found(
    client: TestClient,
    mock_supabase_client: AsyncMock,
    mock_user: AuthUser,
    auth_headers: dict[str, str],
) -> None:
    """Test updating profile when none exists returns 404."""
    mock_supabase_client.patch.return_value = []

    app.dependency_overrides[get_current_user] = mock_auth_dependency(mock_user)
    try:
        with patch(
            "app.api.profile.get_supabase_client", return_value=mock_supabase_client
        ):
            response = client.patch(
                "/profile",
                headers=auth_headers,
                json={"home_country_code": "FR"},
            )
        assert response.status_code == 404
    finally:
        app.dependency_overrides.clear()


# ============================================================================
# Tracking Preference Tests
# ============================================================================


def test_update_profile_tracking_preference_classic(
    client: TestClient,
    mock_supabase_client: AsyncMock,
    mock_user: AuthUser,
    auth_headers: dict[str, str],
) -> None:
    """Test updating tracking preference to classic."""
    updated_profile = sample_profile()
    updated_profile["tracking_preference"] = "classic"

    mock_supabase_client.patch.return_value = [updated_profile]

    app.dependency_overrides[get_current_user] = mock_auth_dependency(mock_user)
    try:
        with patch(
            "app.api.profile.get_supabase_client", return_value=mock_supabase_client
        ):
            response = client.patch(
                "/profile",
                headers=auth_headers,
                json={"tracking_preference": "classic"},
            )
        assert response.status_code == 200
        data = response.json()
        assert data["tracking_preference"] == "classic"
    finally:
        app.dependency_overrides.clear()


def test_update_profile_tracking_preference_un_complete(
    client: TestClient,
    mock_supabase_client: AsyncMock,
    mock_user: AuthUser,
    auth_headers: dict[str, str],
) -> None:
    """Test updating tracking preference to un_complete."""
    updated_profile = sample_profile()
    updated_profile["tracking_preference"] = "un_complete"

    mock_supabase_client.patch.return_value = [updated_profile]

    app.dependency_overrides[get_current_user] = mock_auth_dependency(mock_user)
    try:
        with patch(
            "app.api.profile.get_supabase_client", return_value=mock_supabase_client
        ):
            response = client.patch(
                "/profile",
                headers=auth_headers,
                json={"tracking_preference": "un_complete"},
            )
        assert response.status_code == 200
        data = response.json()
        assert data["tracking_preference"] == "un_complete"
    finally:
        app.dependency_overrides.clear()


def test_update_profile_tracking_preference_explorer_plus(
    client: TestClient,
    mock_supabase_client: AsyncMock,
    mock_user: AuthUser,
    auth_headers: dict[str, str],
) -> None:
    """Test updating tracking preference to explorer_plus."""
    updated_profile = sample_profile()
    updated_profile["tracking_preference"] = "explorer_plus"

    mock_supabase_client.patch.return_value = [updated_profile]

    app.dependency_overrides[get_current_user] = mock_auth_dependency(mock_user)
    try:
        with patch(
            "app.api.profile.get_supabase_client", return_value=mock_supabase_client
        ):
            response = client.patch(
                "/profile",
                headers=auth_headers,
                json={"tracking_preference": "explorer_plus"},
            )
        assert response.status_code == 200
        data = response.json()
        assert data["tracking_preference"] == "explorer_plus"
    finally:
        app.dependency_overrides.clear()


def test_update_profile_tracking_preference_full_atlas(
    client: TestClient,
    mock_supabase_client: AsyncMock,
    mock_user: AuthUser,
    auth_headers: dict[str, str],
) -> None:
    """Test updating tracking preference to full_atlas."""
    updated_profile = sample_profile()
    updated_profile["tracking_preference"] = "full_atlas"

    mock_supabase_client.patch.return_value = [updated_profile]

    app.dependency_overrides[get_current_user] = mock_auth_dependency(mock_user)
    try:
        with patch(
            "app.api.profile.get_supabase_client", return_value=mock_supabase_client
        ):
            response = client.patch(
                "/profile",
                headers=auth_headers,
                json={"tracking_preference": "full_atlas"},
            )
        assert response.status_code == 200
        data = response.json()
        assert data["tracking_preference"] == "full_atlas"
    finally:
        app.dependency_overrides.clear()


def test_update_profile_tracking_preference_invalid(
    client: TestClient,
    mock_supabase_client: AsyncMock,
    mock_user: AuthUser,
    auth_headers: dict[str, str],
) -> None:
    """Test updating tracking preference with invalid value returns 422."""
    app.dependency_overrides[get_current_user] = mock_auth_dependency(mock_user)
    try:
        with patch(
            "app.api.profile.get_supabase_client", return_value=mock_supabase_client
        ):
            response = client.patch(
                "/profile",
                headers=auth_headers,
                json={"tracking_preference": "invalid_preference"},
            )
        assert response.status_code == 422
    finally:
        app.dependency_overrides.clear()


def test_update_profile_multiple_fields_with_tracking_preference(
    client: TestClient,
    mock_supabase_client: AsyncMock,
    mock_user: AuthUser,
    auth_headers: dict[str, str],
) -> None:
    """Test updating multiple fields including tracking preference."""
    updated_profile = sample_profile()
    updated_profile["tracking_preference"] = "un_complete"
    updated_profile["home_country_code"] = "JP"
    updated_profile["travel_motives"] = ["food", "history"]

    mock_supabase_client.patch.return_value = [updated_profile]

    app.dependency_overrides[get_current_user] = mock_auth_dependency(mock_user)
    try:
        with patch(
            "app.api.profile.get_supabase_client", return_value=mock_supabase_client
        ):
            response = client.patch(
                "/profile",
                headers=auth_headers,
                json={
                    "tracking_preference": "un_complete",
                    "home_country_code": "JP",
                    "travel_motives": ["food", "history"],
                },
            )
        assert response.status_code == 200
        data = response.json()
        assert data["tracking_preference"] == "un_complete"
        assert data["home_country_code"] == "JP"
        assert data["travel_motives"] == ["food", "history"]
    finally:
        app.dependency_overrides.clear()


def test_get_profile_with_tracking_preference(
    client: TestClient,
    mock_supabase_client: AsyncMock,
    mock_user: AuthUser,
    auth_headers: dict[str, str],
) -> None:
    """Test that get profile returns tracking_preference field."""
    profile_data = sample_profile()
    profile_data["tracking_preference"] = "explorer_plus"

    mock_supabase_client.get.return_value = [profile_data]

    app.dependency_overrides[get_current_user] = mock_auth_dependency(mock_user)
    try:
        with patch(
            "app.api.profile.get_supabase_client", return_value=mock_supabase_client
        ):
            response = client.get("/profile", headers=auth_headers)
        assert response.status_code == 200
        data = response.json()
        assert "tracking_preference" in data
        assert data["tracking_preference"] == "explorer_plus"
    finally:
        app.dependency_overrides.clear()


# ============================================================================
# Delete Account Tests
# ============================================================================


def test_delete_account_requires_auth(client: TestClient) -> None:
    """Test that deleting account requires authentication."""
    response = client.delete("/profile")
    assert response.status_code == 403


def test_delete_account_success(
    client: TestClient,
    mock_user: AuthUser,
    auth_headers: dict[str, str],
) -> None:
    """Test successful account deletion."""
    # Mock HTTP client for Supabase Auth API call
    mock_http_response = Mock()
    mock_http_response.status_code = 200
    mock_http_response.raise_for_status = Mock()

    mock_http_client = AsyncMock()
    mock_http_client.delete = AsyncMock(return_value=mock_http_response)

    app.dependency_overrides[get_current_user] = mock_auth_dependency(mock_user)
    try:
        with patch("app.api.profile.get_http_client", return_value=mock_http_client):
            response = client.delete("/profile", headers=auth_headers)
        assert response.status_code == 200
        data = response.json()
        assert data["message"] == "Account deleted successfully"

        # Verify the HTTP client was called with correct parameters
        mock_http_client.delete.assert_called_once()
        call_args = mock_http_client.delete.call_args
        assert f"/auth/v1/admin/users/{mock_user.id}" in str(call_args)
    finally:
        app.dependency_overrides.clear()


def test_delete_account_http_error(
    client: TestClient,
    mock_user: AuthUser,
    auth_headers: dict[str, str],
) -> None:
    """Test account deletion when Supabase returns HTTP error."""
    # Mock HTTP client that raises HTTPStatusError
    mock_http_response = Mock()
    mock_http_response.status_code = 500
    mock_http_response.text = "Internal server error from Supabase"

    mock_http_client = AsyncMock()
    mock_http_client.delete = AsyncMock(
        side_effect=httpx.HTTPStatusError(
            "Error", request=Mock(), response=mock_http_response
        )
    )

    app.dependency_overrides[get_current_user] = mock_auth_dependency(mock_user)
    try:
        with patch("app.api.profile.get_http_client", return_value=mock_http_client):
            response = client.delete("/profile", headers=auth_headers)
        assert response.status_code == 500
        data = response.json()
        assert "Failed to delete account" in data["detail"]
    finally:
        app.dependency_overrides.clear()


def test_delete_account_network_error(
    client: TestClient,
    mock_user: AuthUser,
    auth_headers: dict[str, str],
) -> None:
    """Test account deletion when network error occurs."""
    # Mock HTTP client that raises RequestError
    mock_http_client = AsyncMock()
    mock_http_client.delete = AsyncMock(
        side_effect=httpx.RequestError("Network error", request=Mock())
    )

    app.dependency_overrides[get_current_user] = mock_auth_dependency(mock_user)
    try:
        with patch("app.api.profile.get_http_client", return_value=mock_http_client):
            response = client.delete("/profile", headers=auth_headers)
        assert response.status_code == 503
        data = response.json()
        assert "Service temporarily unavailable" in data["detail"]
    finally:
        app.dependency_overrides.clear()


def test_delete_account_rate_limiting(
    client: TestClient,
    mock_user: AuthUser,
    auth_headers: dict[str, str],
) -> None:
    """Test that account deletion is rate limited to 5/hour."""
    # Mock HTTP client for successful deletions
    mock_http_response = Mock()
    mock_http_response.status_code = 200
    mock_http_response.raise_for_status = Mock()

    mock_http_client = AsyncMock()
    mock_http_client.delete = AsyncMock(return_value=mock_http_response)

    app.dependency_overrides[get_current_user] = mock_auth_dependency(mock_user)
    try:
        with patch("app.api.profile.get_http_client", return_value=mock_http_client):
            # Make 6 requests - 6th should be rate limited
            responses = []
            for _ in range(6):
                responses.append(client.delete("/profile", headers=auth_headers))

            # First 5 should succeed
            for i in range(5):
                assert responses[i].status_code == 200, f"Request {i+1} failed"

            # 6th should be rate limited
            assert responses[5].status_code == 429
    finally:
        app.dependency_overrides.clear()
