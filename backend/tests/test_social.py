"""Tests for aggregated social endpoints."""

from unittest.mock import AsyncMock, patch

from fastapi.testclient import TestClient

from app.core.security import AuthUser, get_current_user
from app.main import app
from tests.conftest import OTHER_USER_ID, mock_auth_dependency

SAMPLE_ACTIVITY_ID = "9f8b7c6d-5e4f-4a3b-9c2d-1e0f9a8b7c6d"


def make_feed_row() -> dict:
    """Return a minimal feed row."""
    return {
        "activity_id": SAMPLE_ACTIVITY_ID,
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
            [make_feed_row()],  # get_activity_feed
            {  # get_social_home_stats (consolidated counts)
                "follower_count": 3,
                "following_count": 4,
                "pending_tag_count": 2,
            },
            [  # get_friends_ranking
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

    app.dependency_overrides[get_current_user] = mock_auth_dependency(mock_user)
    try:
        with patch(
            "app.api.social.get_supabase_client", return_value=mock_supabase_client
        ):
            response = client.get("/social/home", headers=auth_headers)
        assert response.status_code == 200
        data = response.json()
        assert data["feed"]["items"]
        assert data["feed"]["items"][0]["activity_id"] == SAMPLE_ACTIVITY_ID
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
    mock_supabase_client.rpc = AsyncMock(
        side_effect=[
            [],  # get_activity_feed
            {  # get_social_home_stats (consolidated counts)
                "follower_count": 0,
                "following_count": 0,
                "pending_tag_count": 0,
            },
            [],  # get_friends_ranking
        ]
    )

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


def test_social_home_compound_cursor_forwards_before_id(
    client: TestClient,
    mock_supabase_client: AsyncMock,
    mock_user: AuthUser,
    auth_headers: dict[str, str],
) -> None:
    """The home feed passes both cursor halves to get_activity_feed."""
    rpc_mock = AsyncMock(
        side_effect=[
            [make_feed_row()],  # get_activity_feed
            {  # get_social_home_stats
                "follower_count": 0,
                "following_count": 0,
                "pending_tag_count": 0,
            },
            [],  # get_friends_ranking
        ]
    )
    mock_supabase_client.rpc = rpc_mock

    app.dependency_overrides[get_current_user] = mock_auth_dependency(mock_user)
    try:
        with patch(
            "app.api.social.get_supabase_client", return_value=mock_supabase_client
        ):
            response = client.get(
                f"/social/home?before=2024-01-01T00:00:00Z|{SAMPLE_ACTIVITY_ID}",
                headers=auth_headers,
            )
        assert response.status_code == 200

        feed_call = next(
            call
            for call in rpc_mock.await_args_list
            if call.args[0] == "get_activity_feed"
        )
        payload = feed_call.args[1]
        assert payload["p_before"] == "2024-01-01T00:00:00+00:00"
        assert payload["p_before_id"] == SAMPLE_ACTIVITY_ID
    finally:
        app.dependency_overrides.clear()
