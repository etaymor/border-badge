"""Tests for aggregated social endpoints."""

from unittest.mock import AsyncMock, patch

from fastapi.testclient import TestClient

from app.core.security import AuthUser, get_current_user
from app.main import app
from tests.conftest import OTHER_USER_ID, mock_auth_dependency


def make_feed_row() -> dict:
    """Return a minimal feed row."""
    return {
        "user_id": OTHER_USER_ID,
        "username": "friend",
        "avatar_url": None,
        "activity_type": "country_visited",
        "created_at": "2024-01-01T00:00:00Z",
        "country_id": "country-1",
        "country_name": "Japan",
        "country_code": "JP",
        "entry_id": None,
        "entry_name": None,
        "entry_type": None,
        "location_name": None,
        "entry_image_url": None,
    }


def test_social_home_success(
    client: TestClient,
    mock_supabase_client: AsyncMock,
    mock_user: AuthUser,
    auth_headers: dict[str, str],
) -> None:
    """Ensure /social/home aggregates feed, stats, rankings, and pending counts."""
    mock_supabase_client.rpc = AsyncMock(
        side_effect=[
            [make_feed_row()],  # Feed rows
            [
                {
                    "rank": 2,
                    "total_friends": 5,
                    "my_countries": 12,
                    "leader_username": "worldtraveler",
                    "leader_countries": 55,
                }
            ],
        ]
    )
    mock_supabase_client.count = AsyncMock(side_effect=[3, 4, 2])

    app.dependency_overrides[get_current_user] = mock_auth_dependency(mock_user)
    try:
        with patch(
            "app.api.social.get_supabase_client", return_value=mock_supabase_client
        ):
            response = client.get("/social/home", headers=auth_headers)
        assert response.status_code == 200
        data = response.json()
        assert data["feed"]["items"]
        assert data["follow_stats"]["follower_count"] == 3
        assert data["follow_stats"]["following_count"] == 4
        assert data["friends_ranking"]["rank"] == 2
        assert data["pending_tag_count"] == 2
    finally:
        app.dependency_overrides.clear()


def test_social_home_defaults_when_no_data(
    client: TestClient,
    mock_supabase_client: AsyncMock,
    mock_user: AuthUser,
    auth_headers: dict[str, str],
) -> None:
    """Verify endpoint returns safe defaults when Supabase returns no rows."""
    mock_supabase_client.rpc = AsyncMock(side_effect=[[], []])
    mock_supabase_client.count = AsyncMock(side_effect=[0, 0, 0])

    app.dependency_overrides[get_current_user] = mock_auth_dependency(mock_user)
    try:
        with patch(
            "app.api.social.get_supabase_client", return_value=mock_supabase_client
        ):
            response = client.get("/social/home", headers=auth_headers)
        assert response.status_code == 200
        data = response.json()
        assert data["feed"]["items"] == []
        assert data["friends_ranking"]["rank"] == 1
        assert data["friends_ranking"]["total_friends"] == 0
        assert data["pending_tag_count"] == 0
    finally:
        app.dependency_overrides.clear()
