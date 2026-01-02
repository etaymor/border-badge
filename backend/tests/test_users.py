"""Tests for user-related endpoints (search, profile, username check)."""

from typing import Any
from unittest.mock import AsyncMock, patch

from fastapi.testclient import TestClient

from app.core.security import AuthUser, get_current_user
from app.main import app
from tests.conftest import (
    OTHER_USER_ID,
    TEST_USER_ID,
    mock_auth_dependency,
)

# ============================================================================
# Username Availability Tests
# ============================================================================


def test_check_username_available(
    client: TestClient,
    mock_supabase_client: AsyncMock,
) -> None:
    """Test checking an available username."""
    mock_supabase_client.get.return_value = []  # Username not taken

    with patch(
        "app.api.users.get_service_supabase_client", return_value=mock_supabase_client
    ):
        response = client.get("/users/check-username", params={"username": "newuser"})

    assert response.status_code == 200
    data = response.json()
    assert data["available"] is True
    assert data["reason"] is None


def test_check_username_taken_with_suggestions(
    client: TestClient,
    mock_supabase_client: AsyncMock,
) -> None:
    """Test checking a taken username returns suggestions."""
    # First call: username taken, then generate suggestions
    mock_supabase_client.get.side_effect = [
        [{"id": "existing-profile-id"}],  # Username taken
        [],  # newuser_1 available
        [],  # newuser_2 available
        [],  # newuser_3 available
    ]

    with patch(
        "app.api.users.get_service_supabase_client", return_value=mock_supabase_client
    ):
        response = client.get("/users/check-username", params={"username": "newuser"})

    assert response.status_code == 200
    data = response.json()
    assert data["available"] is False
    assert data["reason"] == "Username is already taken"
    assert len(data["suggestions"]) >= 1


def test_check_username_invalid_format(
    client: TestClient,
) -> None:
    """Test checking a username with invalid characters."""
    response = client.get("/users/check-username", params={"username": "user@name!"})

    assert response.status_code == 200
    data = response.json()
    assert data["available"] is False
    assert "letters, numbers, and underscores" in data["reason"]


def test_check_username_too_short(
    client: TestClient,
) -> None:
    """Test checking a username that's too short."""
    response = client.get("/users/check-username", params={"username": "ab"})

    assert response.status_code == 422  # Validation error


# ============================================================================
# User Search Tests
# ============================================================================


def test_search_users_requires_auth(client: TestClient) -> None:
    """Test that searching users requires authentication."""
    response = client.get("/users/search", params={"q": "test"})
    assert response.status_code == 403


def test_search_users_by_prefix(
    client: TestClient,
    mock_supabase_client: AsyncMock,
    mock_user: AuthUser,
    auth_headers: dict[str, str],
) -> None:
    """Test searching users by username prefix."""
    sample_profile: dict[str, Any] = {
        "id": "profile-id",
        "user_id": OTHER_USER_ID,
        "username": "traveler",
        "avatar_url": "https://example.com/avatar.jpg",
    }

    mock_supabase_client.get.side_effect = [
        [sample_profile],  # Search results
        [{"following_id": OTHER_USER_ID}],  # Following check
    ]
    mock_supabase_client.rpc.return_value = [{"user_id": OTHER_USER_ID, "count": 25}]

    app.dependency_overrides[get_current_user] = mock_auth_dependency(mock_user)
    try:
        with patch(
            "app.api.users.get_supabase_client", return_value=mock_supabase_client
        ):
            response = client.get(
                "/users/search", headers=auth_headers, params={"q": "trav"}
            )
        assert response.status_code == 200
        data = response.json()
        assert len(data) == 1
        assert data[0]["username"] == "traveler"
        assert data[0]["country_count"] == 25
        assert data[0]["is_following"] is True
    finally:
        app.dependency_overrides.clear()


def test_search_users_excludes_self(
    client: TestClient,
    mock_supabase_client: AsyncMock,
    mock_user: AuthUser,
    auth_headers: dict[str, str],
) -> None:
    """Test that search results exclude the current user."""
    # Return current user in search - should be filtered out by the query
    mock_supabase_client.get.return_value = []

    app.dependency_overrides[get_current_user] = mock_auth_dependency(mock_user)
    try:
        with patch(
            "app.api.users.get_supabase_client", return_value=mock_supabase_client
        ):
            response = client.get(
                "/users/search", headers=auth_headers, params={"q": "test"}
            )
        assert response.status_code == 200
        # Verify the query excluded the current user
        call_args = mock_supabase_client.get.call_args_list[0]
        assert f"neq.{mock_user.id}" in str(call_args)
    finally:
        app.dependency_overrides.clear()


def test_search_users_empty_results(
    client: TestClient,
    mock_supabase_client: AsyncMock,
    mock_user: AuthUser,
    auth_headers: dict[str, str],
) -> None:
    """Test search with no matching users."""
    mock_supabase_client.get.return_value = []

    app.dependency_overrides[get_current_user] = mock_auth_dependency(mock_user)
    try:
        with patch(
            "app.api.users.get_supabase_client", return_value=mock_supabase_client
        ):
            response = client.get(
                "/users/search", headers=auth_headers, params={"q": "nonexistent"}
            )
        assert response.status_code == 200
        assert response.json() == []
    finally:
        app.dependency_overrides.clear()


def test_search_users_invalid_query(
    client: TestClient,
    mock_supabase_client: AsyncMock,
    mock_user: AuthUser,
    auth_headers: dict[str, str],
) -> None:
    """Test search with invalid characters returns empty."""
    app.dependency_overrides[get_current_user] = mock_auth_dependency(mock_user)
    try:
        with patch(
            "app.api.users.get_supabase_client", return_value=mock_supabase_client
        ):
            response = client.get(
                "/users/search", headers=auth_headers, params={"q": "@#$%"}
            )
        assert response.status_code == 200
        assert response.json() == []
    finally:
        app.dependency_overrides.clear()


# ============================================================================
# Email Lookup Tests
# ============================================================================


def test_email_lookup_requires_auth(client: TestClient) -> None:
    """Test that email lookup requires authentication."""
    response = client.get(
        "/users/lookup-by-email", params={"email": "test@example.com"}
    )
    assert response.status_code == 403


def test_email_lookup_found(
    client: TestClient,
    mock_supabase_client: AsyncMock,
    mock_user: AuthUser,
    auth_headers: dict[str, str],
) -> None:
    """Test email lookup when user is found."""
    lookup_result = [
        {
            "user_id": OTHER_USER_ID,
            "username": "founduser",
            "avatar_url": None,
        }
    ]

    mock_supabase_client.rpc.side_effect = [
        lookup_result,  # Email lookup RPC
        [{"user_id": OTHER_USER_ID, "count": 10}],  # Country count
    ]
    mock_supabase_client.get.side_effect = [
        [],  # No blocks
        [],  # Not following
    ]

    app.dependency_overrides[get_current_user] = mock_auth_dependency(mock_user)
    try:
        with (
            patch(
                "app.api.users.get_service_supabase_client",
                return_value=mock_supabase_client,
            ),
            patch(
                "app.api.users.get_supabase_client", return_value=mock_supabase_client
            ),
        ):
            response = client.get(
                "/users/lookup-by-email",
                headers=auth_headers,
                params={"email": "found@example.com"},
            )
        assert response.status_code == 200
        data = response.json()
        assert data["username"] == "founduser"
        assert data["country_count"] == 10
        assert data["is_following"] is False
    finally:
        app.dependency_overrides.clear()


def test_email_lookup_not_found(
    client: TestClient,
    mock_supabase_client: AsyncMock,
    mock_user: AuthUser,
    auth_headers: dict[str, str],
) -> None:
    """Test email lookup when user is not found (with timing protection)."""
    mock_supabase_client.rpc.side_effect = [
        [],  # Email lookup returns empty
        [{"user_id": TEST_USER_ID, "count": 0}],  # Dummy query for timing
    ]
    mock_supabase_client.get.return_value = []  # Dummy follow check

    app.dependency_overrides[get_current_user] = mock_auth_dependency(mock_user)
    try:
        with (
            patch(
                "app.api.users.get_service_supabase_client",
                return_value=mock_supabase_client,
            ),
            patch(
                "app.api.users.get_supabase_client", return_value=mock_supabase_client
            ),
        ):
            response = client.get(
                "/users/lookup-by-email",
                headers=auth_headers,
                params={"email": "notfound@example.com"},
            )
        assert response.status_code == 200
        assert response.json() is None
    finally:
        app.dependency_overrides.clear()


def test_email_lookup_invalid_format(
    client: TestClient,
    mock_supabase_client: AsyncMock,
    mock_user: AuthUser,
    auth_headers: dict[str, str],
) -> None:
    """Test email lookup with invalid email format."""
    app.dependency_overrides[get_current_user] = mock_auth_dependency(mock_user)
    try:
        with patch(
            "app.api.users.get_supabase_client", return_value=mock_supabase_client
        ):
            response = client.get(
                "/users/lookup-by-email",
                headers=auth_headers,
                params={"email": "notanemail"},
            )
        assert response.status_code == 200
        assert response.json() is None
    finally:
        app.dependency_overrides.clear()


# ============================================================================
# User Profile Tests
# ============================================================================


def test_get_user_profile_requires_auth(client: TestClient) -> None:
    """Test that getting user profile requires authentication."""
    response = client.get("/users/someuser/profile")
    assert response.status_code == 403


def test_get_user_profile_success(
    client: TestClient,
    mock_supabase_client: AsyncMock,
    mock_user: AuthUser,
    auth_headers: dict[str, str],
) -> None:
    """Test getting a user's public profile."""
    sample_profile: dict[str, Any] = {
        "id": "profile-id",
        "user_id": OTHER_USER_ID,
        "username": "worldtraveler",
        "display_name": "World Traveler",
        "avatar_url": "https://example.com/avatar.jpg",
    }

    mock_supabase_client.get.side_effect = [
        [sample_profile],  # Profile lookup
        [],  # Block check - not blocked
        [{"id": "c1"}, {"id": "c2"}, {"id": "c3"}],  # Country count (3 countries)
        [{"id": "f1"}, {"id": "f2"}],  # Follower count (2 followers)
        [{"id": "fo1"}],  # Following count (1 following)
        [{"id": "is-following"}],  # Is following check
    ]

    app.dependency_overrides[get_current_user] = mock_auth_dependency(mock_user)
    try:
        with patch(
            "app.api.users.get_supabase_client", return_value=mock_supabase_client
        ):
            response = client.get("/users/worldtraveler/profile", headers=auth_headers)
        assert response.status_code == 200
        data = response.json()
        assert data["username"] == "worldtraveler"
        assert data["display_name"] == "World Traveler"
        assert data["country_count"] == 3
        assert data["follower_count"] == 2
        assert data["following_count"] == 1
        assert data["is_following"] is True
        assert data["is_blocked"] is False
    finally:
        app.dependency_overrides.clear()


def test_get_user_profile_not_found(
    client: TestClient,
    mock_supabase_client: AsyncMock,
    mock_user: AuthUser,
    auth_headers: dict[str, str],
) -> None:
    """Test getting a nonexistent user's profile."""
    mock_supabase_client.get.return_value = []  # Profile not found

    app.dependency_overrides[get_current_user] = mock_auth_dependency(mock_user)
    try:
        with patch(
            "app.api.users.get_supabase_client", return_value=mock_supabase_client
        ):
            response = client.get("/users/nonexistent/profile", headers=auth_headers)
        assert response.status_code == 404
        assert "User not found" in response.json()["detail"]
    finally:
        app.dependency_overrides.clear()


def test_get_user_profile_blocked_returns_404(
    client: TestClient,
    mock_supabase_client: AsyncMock,
    mock_user: AuthUser,
    auth_headers: dict[str, str],
) -> None:
    """Test getting a blocked user's profile returns 404 (hides existence)."""
    sample_profile: dict[str, Any] = {
        "id": "profile-id",
        "user_id": OTHER_USER_ID,
        "username": "blockeduser",
        "display_name": "Blocked User",
        "avatar_url": None,
    }

    mock_supabase_client.get.side_effect = [
        [sample_profile],  # Profile lookup
        [{"id": "block-id"}],  # Block check - IS blocked
    ]

    app.dependency_overrides[get_current_user] = mock_auth_dependency(mock_user)
    try:
        with patch(
            "app.api.users.get_supabase_client", return_value=mock_supabase_client
        ):
            response = client.get("/users/blockeduser/profile", headers=auth_headers)
        # Returns 404 to hide that user exists (security)
        assert response.status_code == 404
        assert "User not found" in response.json()["detail"]
    finally:
        app.dependency_overrides.clear()


def test_get_user_profile_not_following(
    client: TestClient,
    mock_supabase_client: AsyncMock,
    mock_user: AuthUser,
    auth_headers: dict[str, str],
) -> None:
    """Test getting a user's profile when not following them."""
    sample_profile: dict[str, Any] = {
        "id": "profile-id",
        "user_id": OTHER_USER_ID,
        "username": "stranger",
        "display_name": "Stranger",
        "avatar_url": None,
    }

    mock_supabase_client.get.side_effect = [
        [sample_profile],  # Profile lookup
        [],  # Block check - not blocked
        [],  # Country count (0)
        [],  # Follower count (0)
        [],  # Following count (0)
        [],  # Is following check - NOT following
    ]

    app.dependency_overrides[get_current_user] = mock_auth_dependency(mock_user)
    try:
        with patch(
            "app.api.users.get_supabase_client", return_value=mock_supabase_client
        ):
            response = client.get("/users/stranger/profile", headers=auth_headers)
        assert response.status_code == 200
        data = response.json()
        assert data["username"] == "stranger"
        assert data["is_following"] is False
    finally:
        app.dependency_overrides.clear()
