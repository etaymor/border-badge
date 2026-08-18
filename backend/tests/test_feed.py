"""Tests for activity feed endpoints."""

from datetime import UTC, datetime
from unittest.mock import AsyncMock, patch

import pytest
from fastapi import HTTPException
from fastapi.testclient import TestClient

from app.api.feed import _build_cursor, _parse_cursor
from app.core.security import AuthUser, get_current_user
from app.main import app
from tests.conftest import (
    OTHER_USER_ID,
    TEST_USER_ID,
    mock_auth_dependency,
)

SAMPLE_ACTIVITY_ID = "9f8b7c6d-5e4f-4a3b-9c2d-1e0f9a8b7c6d"


# Sample feed data for tests - must match the expected database row format
def make_feed_row(
    activity_type: str = "country_visited",
    country_code: str = "US",
    country_name: str = "United States",
    country_id: str = "country-id-us",
    entry_id: str | None = None,
    entry_name: str | None = None,
    entry_type: str | None = None,
    location_name: str | None = None,
    entry_image_url: str | None = None,
    activity_id: str = SAMPLE_ACTIVITY_ID,
) -> dict:
    """Create a sample feed row matching the database function output."""
    return {
        "activity_id": activity_id,
        "user_id": OTHER_USER_ID,
        "username": "traveler",
        "avatar_url": None,
        "activity_type": activity_type,
        "created_at": "2024-01-01T12:00:00Z",
        "country_id": country_id,
        "country_code": country_code,
        "country_name": country_name,
        "entry_id": entry_id,
        "entry_name": entry_name,
        "entry_type": entry_type,
        "location_name": location_name,
        "entry_image_url": entry_image_url,
    }


# ============================================================================
# Main Feed Tests
# ============================================================================


def test_get_feed_requires_auth(client: TestClient) -> None:
    """Test that getting the feed requires authentication."""
    response = client.get("/feed")
    assert response.status_code == 403


def test_get_feed_success(
    client: TestClient,
    mock_supabase_client: AsyncMock,
    mock_user: AuthUser,
    auth_headers: dict[str, str],
) -> None:
    """Test successfully getting the activity feed."""
    mock_supabase_client.rpc.return_value = [
        make_feed_row("country_visited"),
        make_feed_row(
            "entry_added",
            entry_id="entry-123",
            entry_name="Central Park",
            entry_type="place",
        ),
    ]

    app.dependency_overrides[get_current_user] = mock_auth_dependency(mock_user)
    try:
        with patch(
            "app.api.feed.get_supabase_client", return_value=mock_supabase_client
        ):
            response = client.get("/feed", headers=auth_headers)
        assert response.status_code == 200
        data = response.json()
        assert "items" in data
        assert "has_more" in data
        assert len(data["items"]) == 2
        assert data["items"][0]["activity_type"] == "country_visited"
    finally:
        app.dependency_overrides.clear()


def test_get_feed_empty(
    client: TestClient,
    mock_supabase_client: AsyncMock,
    mock_user: AuthUser,
    auth_headers: dict[str, str],
) -> None:
    """Test getting feed when no items exist."""
    mock_supabase_client.rpc.return_value = []

    app.dependency_overrides[get_current_user] = mock_auth_dependency(mock_user)
    try:
        with patch(
            "app.api.feed.get_supabase_client", return_value=mock_supabase_client
        ):
            response = client.get("/feed", headers=auth_headers)
        assert response.status_code == 200
        data = response.json()
        assert data["items"] == []
        assert data["has_more"] is False
    finally:
        app.dependency_overrides.clear()


def test_get_feed_with_pagination(
    client: TestClient,
    mock_supabase_client: AsyncMock,
    mock_user: AuthUser,
    auth_headers: dict[str, str],
) -> None:
    """Test getting feed with pagination parameters."""
    # Return one more than limit to indicate has_more
    mock_supabase_client.rpc.return_value = [
        make_feed_row("country_visited"),
        make_feed_row("country_visited"),
        make_feed_row("country_visited"),
    ]

    app.dependency_overrides[get_current_user] = mock_auth_dependency(mock_user)
    try:
        with patch(
            "app.api.feed.get_supabase_client", return_value=mock_supabase_client
        ):
            response = client.get(
                "/feed?limit=2&before=2024-01-01T00:00:00Z", headers=auth_headers
            )
        assert response.status_code == 200
        data = response.json()
        # Should return limit items and set has_more
        assert len(data["items"]) == 2
        assert data["has_more"] is True
    finally:
        app.dependency_overrides.clear()


def test_get_feed_before_cursor_trailing_pipe_does_not_pass_empty_string(
    client: TestClient,
    mock_supabase_client: AsyncMock,
    mock_user: AuthUser,
    auth_headers: dict[str, str],
) -> None:
    """Ensure 'timestamp|' cursor parses correctly without passing empty string.

    The _parse_cursor function should convert trailing pipe to None for before_id,
    not empty string. This test verifies the request succeeds and the timestamp
    is correctly extracted.
    """
    mock_supabase_client.rpc.return_value = [make_feed_row("country_visited")]

    app.dependency_overrides[get_current_user] = mock_auth_dependency(mock_user)
    try:
        with patch(
            "app.api.feed.get_supabase_client", return_value=mock_supabase_client
        ):
            response = client.get(
                "/feed?before=2024-01-01T00:00:00Z|", headers=auth_headers
            )
        assert response.status_code == 200

        # Verify the RPC was called with correct timestamp (p_before)
        call = mock_supabase_client.rpc.await_args
        assert call is not None
        payload = call.args[1]
        assert payload["p_before"] == "2024-01-01T00:00:00+00:00"
        assert payload["p_before_id"] is None
    finally:
        app.dependency_overrides.clear()


def test_get_feed_compound_cursor_forwards_before_id(
    client: TestClient,
    mock_supabase_client: AsyncMock,
    mock_user: AuthUser,
    auth_headers: dict[str, str],
) -> None:
    """A compound 'timestamp|uuid' cursor must forward p_before_id to the RPC."""
    mock_supabase_client.rpc.return_value = [make_feed_row("country_visited")]

    app.dependency_overrides[get_current_user] = mock_auth_dependency(mock_user)
    try:
        with patch(
            "app.api.feed.get_supabase_client", return_value=mock_supabase_client
        ):
            response = client.get(
                f"/feed?before=2024-01-01T00:00:00Z|{SAMPLE_ACTIVITY_ID}",
                headers=auth_headers,
            )
        assert response.status_code == 200

        call = mock_supabase_client.rpc.await_args
        assert call is not None
        payload = call.args[1]
        assert payload["p_before"] == "2024-01-01T00:00:00+00:00"
        assert payload["p_before_id"] == SAMPLE_ACTIVITY_ID
    finally:
        app.dependency_overrides.clear()


def test_get_user_feed_compound_cursor_forwards_before_id(
    client: TestClient,
    mock_supabase_client: AsyncMock,
    mock_user: AuthUser,
    auth_headers: dict[str, str],
) -> None:
    """The profile feed uses the same compound cursor semantics as the home feed."""
    mock_supabase_client.rpc.return_value = [make_feed_row("country_visited")]

    app.dependency_overrides[get_current_user] = mock_auth_dependency(mock_user)
    try:
        with patch(
            "app.api.feed.get_supabase_client", return_value=mock_supabase_client
        ):
            response = client.get(
                f"/feed/user/{OTHER_USER_ID}"
                f"?before=2024-01-01T00:00:00Z|{SAMPLE_ACTIVITY_ID}",
                headers=auth_headers,
            )
        assert response.status_code == 200

        call = mock_supabase_client.rpc.await_args
        assert call is not None
        payload = call.args[1]
        assert payload["p_before"] == "2024-01-01T00:00:00+00:00"
        assert payload["p_before_id"] == SAMPLE_ACTIVITY_ID
    finally:
        app.dependency_overrides.clear()


def test_get_feed_invalid_before_id_returns_400(
    client: TestClient,
    mock_supabase_client: AsyncMock,
    mock_user: AuthUser,
    auth_headers: dict[str, str],
) -> None:
    """A cursor whose id half is not a UUID is rejected before hitting the DB."""
    app.dependency_overrides[get_current_user] = mock_auth_dependency(mock_user)
    try:
        with patch(
            "app.api.feed.get_supabase_client", return_value=mock_supabase_client
        ):
            response = client.get(
                "/feed?before=2024-01-01T00:00:00Z|not-a-uuid", headers=auth_headers
            )
        assert response.status_code == 400
        mock_supabase_client.rpc.assert_not_awaited()
    finally:
        app.dependency_overrides.clear()


def test_get_feed_includes_user_info(
    client: TestClient,
    mock_supabase_client: AsyncMock,
    mock_user: AuthUser,
    auth_headers: dict[str, str],
) -> None:
    """Test that feed items include user profile information."""
    mock_supabase_client.rpc.return_value = [make_feed_row()]

    app.dependency_overrides[get_current_user] = mock_auth_dependency(mock_user)
    try:
        with patch(
            "app.api.feed.get_supabase_client", return_value=mock_supabase_client
        ):
            response = client.get("/feed", headers=auth_headers)
        assert response.status_code == 200
        data = response.json()
        item = data["items"][0]
        assert "user" in item
        assert item["user"]["username"] == "traveler"
        assert item["user"]["user_id"] == OTHER_USER_ID
    finally:
        app.dependency_overrides.clear()


def test_get_feed_includes_country_info(
    client: TestClient,
    mock_supabase_client: AsyncMock,
    mock_user: AuthUser,
    auth_headers: dict[str, str],
) -> None:
    """Test that feed items include country information."""
    mock_supabase_client.rpc.return_value = [make_feed_row()]

    app.dependency_overrides[get_current_user] = mock_auth_dependency(mock_user)
    try:
        with patch(
            "app.api.feed.get_supabase_client", return_value=mock_supabase_client
        ):
            response = client.get("/feed", headers=auth_headers)
        assert response.status_code == 200
        data = response.json()
        item = data["items"][0]
        assert "country" in item
        assert item["country"]["country_code"] == "US"
        assert item["country"]["country_name"] == "United States"
    finally:
        app.dependency_overrides.clear()


# ============================================================================
# User Feed Tests
# ============================================================================


def test_get_user_feed_requires_auth(client: TestClient) -> None:
    """Test that getting a user's feed requires authentication."""
    response = client.get(f"/feed/user/{OTHER_USER_ID}")
    assert response.status_code == 403


def test_get_user_feed_success(
    client: TestClient,
    mock_supabase_client: AsyncMock,
    mock_user: AuthUser,
    auth_headers: dict[str, str],
) -> None:
    """Test successfully getting a specific user's activity feed."""
    mock_supabase_client.rpc.return_value = [
        make_feed_row("country_visited"),
        make_feed_row(
            "entry_added",
            entry_id="entry-123",
            entry_name="Louvre",
            entry_type="place",
        ),
    ]

    app.dependency_overrides[get_current_user] = mock_auth_dependency(mock_user)
    try:
        with patch(
            "app.api.feed.get_supabase_client", return_value=mock_supabase_client
        ):
            response = client.get(f"/feed/user/{OTHER_USER_ID}", headers=auth_headers)
        assert response.status_code == 200
        data = response.json()
        assert "items" in data
        assert len(data["items"]) == 2
    finally:
        app.dependency_overrides.clear()


def test_get_user_feed_empty(
    client: TestClient,
    mock_supabase_client: AsyncMock,
    mock_user: AuthUser,
    auth_headers: dict[str, str],
) -> None:
    """Test getting a user's feed when they have no activity."""
    mock_supabase_client.rpc.return_value = []

    app.dependency_overrides[get_current_user] = mock_auth_dependency(mock_user)
    try:
        with patch(
            "app.api.feed.get_supabase_client", return_value=mock_supabase_client
        ):
            response = client.get(f"/feed/user/{OTHER_USER_ID}", headers=auth_headers)
        assert response.status_code == 200
        data = response.json()
        assert data["items"] == []
        assert data["has_more"] is False
    finally:
        app.dependency_overrides.clear()


def test_get_own_user_feed(
    client: TestClient,
    mock_supabase_client: AsyncMock,
    mock_user: AuthUser,
    auth_headers: dict[str, str],
) -> None:
    """Test getting your own activity feed."""
    # Replace user_id in the feed row with the current user's ID
    row = make_feed_row("country_visited")
    row["user_id"] = TEST_USER_ID

    mock_supabase_client.rpc.return_value = [row]

    app.dependency_overrides[get_current_user] = mock_auth_dependency(mock_user)
    try:
        with patch(
            "app.api.feed.get_supabase_client", return_value=mock_supabase_client
        ):
            response = client.get(f"/feed/user/{TEST_USER_ID}", headers=auth_headers)
        assert response.status_code == 200
        data = response.json()
        assert len(data["items"]) == 1
    finally:
        app.dependency_overrides.clear()


# ============================================================================
# Feed Item Types Tests
# ============================================================================


def test_feed_country_visited_activity(
    client: TestClient,
    mock_supabase_client: AsyncMock,
    mock_user: AuthUser,
    auth_headers: dict[str, str],
) -> None:
    """Test feed item for country visited activity."""
    mock_supabase_client.rpc.return_value = [make_feed_row("country_visited")]

    app.dependency_overrides[get_current_user] = mock_auth_dependency(mock_user)
    try:
        with patch(
            "app.api.feed.get_supabase_client", return_value=mock_supabase_client
        ):
            response = client.get("/feed", headers=auth_headers)
        assert response.status_code == 200
        item = response.json()["items"][0]
        assert item["activity_type"] == "country_visited"
        assert item["entry"] is None
        assert item["country"] is not None
    finally:
        app.dependency_overrides.clear()


def test_feed_entry_added_activity(
    client: TestClient,
    mock_supabase_client: AsyncMock,
    mock_user: AuthUser,
    auth_headers: dict[str, str],
) -> None:
    """Test feed item for entry added activity."""
    row = make_feed_row(
        "entry_added",
        entry_id="entry-123",
        entry_name="Eiffel Tower",
        entry_type="place",
        location_name="Paris, France",
        entry_image_url="https://example.com/photo.jpg",
    )

    mock_supabase_client.rpc.return_value = [row]

    app.dependency_overrides[get_current_user] = mock_auth_dependency(mock_user)
    try:
        with patch(
            "app.api.feed.get_supabase_client", return_value=mock_supabase_client
        ):
            response = client.get("/feed", headers=auth_headers)
        assert response.status_code == 200
        item = response.json()["items"][0]
        assert item["activity_type"] == "entry_added"
        assert item["entry"] is not None
        assert item["entry"]["entry_type"] == "place"
        assert item["entry"]["entry_name"] == "Eiffel Tower"
        assert item["entry"]["image_url"] == "https://example.com/photo.jpg"
    finally:
        app.dependency_overrides.clear()


def test_get_user_feed_with_pagination(
    client: TestClient,
    mock_supabase_client: AsyncMock,
    mock_user: AuthUser,
    auth_headers: dict[str, str],
) -> None:
    """Test user feed returns next_cursor when has_more is true."""
    # Return one more than limit to indicate has_more
    mock_supabase_client.rpc.return_value = [
        make_feed_row("country_visited"),
        make_feed_row("country_visited"),
        make_feed_row("country_visited"),
    ]

    app.dependency_overrides[get_current_user] = mock_auth_dependency(mock_user)
    try:
        with patch(
            "app.api.feed.get_supabase_client", return_value=mock_supabase_client
        ):
            response = client.get(
                f"/feed/user/{OTHER_USER_ID}?limit=2", headers=auth_headers
            )
        assert response.status_code == 200
        data = response.json()
        assert len(data["items"]) == 2
        assert data["has_more"] is True
        assert data["next_cursor"] is not None
        assert not data["next_cursor"].endswith("|")
    finally:
        app.dependency_overrides.clear()


def test_get_user_feed_garbage_user_id_returns_422(
    client: TestClient,
    mock_supabase_client: AsyncMock,
    mock_user: AuthUser,
    auth_headers: dict[str, str],
) -> None:
    """A non-UUID user_id path param must be a validation error, not a DB 500."""
    app.dependency_overrides[get_current_user] = mock_auth_dependency(mock_user)
    try:
        with patch(
            "app.api.feed.get_supabase_client", return_value=mock_supabase_client
        ):
            response = client.get("/feed/user/not-a-uuid", headers=auth_headers)
        assert response.status_code == 422
        mock_supabase_client.rpc.assert_not_awaited()
    finally:
        app.dependency_overrides.clear()


def test_feed_items_include_activity_id(
    client: TestClient,
    mock_supabase_client: AsyncMock,
    mock_user: AuthUser,
    auth_headers: dict[str, str],
) -> None:
    """Every feed item exposes the stable activity_id from the RPC row set."""
    mock_supabase_client.rpc.return_value = [make_feed_row("country_visited")]

    app.dependency_overrides[get_current_user] = mock_auth_dependency(mock_user)
    try:
        with patch(
            "app.api.feed.get_supabase_client", return_value=mock_supabase_client
        ):
            response = client.get("/feed", headers=auth_headers)
        assert response.status_code == 200
        item = response.json()["items"][0]
        assert item["activity_id"] == SAMPLE_ACTIVITY_ID
    finally:
        app.dependency_overrides.clear()


def test_next_cursor_is_compound_when_rows_have_activity_id(
    client: TestClient,
    mock_supabase_client: AsyncMock,
    mock_user: AuthUser,
    auth_headers: dict[str, str],
) -> None:
    """next_cursor carries 'timestamp|activity_id' built from the last page item."""
    last_activity_id = "0e1d2c3b-4a59-4687-b1c2-d3e4f5a6b7c8"
    mock_supabase_client.rpc.return_value = [
        make_feed_row("country_visited", activity_id=SAMPLE_ACTIVITY_ID),
        make_feed_row("country_visited", activity_id=last_activity_id),
        make_feed_row("country_visited"),
    ]

    app.dependency_overrides[get_current_user] = mock_auth_dependency(mock_user)
    try:
        with patch(
            "app.api.feed.get_supabase_client", return_value=mock_supabase_client
        ):
            response = client.get("/feed?limit=2", headers=auth_headers)
        assert response.status_code == 200
        data = response.json()
        assert data["has_more"] is True
        assert data["next_cursor"] == f"2024-01-01T12:00:00+00:00|{last_activity_id}"

        # Round-trip: the emitted cursor parses back to the same tuple
        before_time, before_id = _parse_cursor(data["next_cursor"])
        assert before_time == datetime(2024, 1, 1, 12, 0, tzinfo=UTC)
        assert before_id == last_activity_id
    finally:
        app.dependency_overrides.clear()


# ============================================================================
# Cursor Helper Tests
# ============================================================================


def test_parse_cursor_timestamp_only_is_backward_compatible() -> None:
    """Cursor without activity_id should parse to (timestamp, None)."""
    before_time, before_id = _parse_cursor("2024-01-01T00:00:00Z")
    assert before_time is not None
    assert before_id is None


def test_parse_cursor_trailing_pipe_treats_empty_id_as_none() -> None:
    """Cursor with trailing pipe should parse to (timestamp, None)."""
    before_time, before_id = _parse_cursor("2024-01-01T00:00:00Z|")
    assert before_time is not None
    assert before_id is None


def test_parse_cursor_rejects_non_uuid_id() -> None:
    """Cursor id halves must be UUIDs; anything else is a 400."""
    with pytest.raises(HTTPException) as exc_info:
        _parse_cursor("2024-01-01T00:00:00Z|garbage")
    assert exc_info.value.status_code == 400


def test_build_cursor_omits_pipe_when_activity_id_missing() -> None:
    """When the row has no activity_id, we emit a timestamp-only cursor."""
    cursor = _build_cursor({"created_at": datetime(2024, 1, 1, 12, 0, tzinfo=UTC)})
    assert cursor == "2024-01-01T12:00:00+00:00"
    assert "|" not in cursor


def test_build_cursor_includes_pipe_when_activity_id_present() -> None:
    """When the row has an activity_id, we emit 'timestamp|activity_id'."""
    cursor = _build_cursor(
        {
            "created_at": datetime(2024, 1, 1, 12, 0, tzinfo=UTC),
            "activity_id": SAMPLE_ACTIVITY_ID,
        }
    )
    assert cursor == f"2024-01-01T12:00:00+00:00|{SAMPLE_ACTIVITY_ID}"


def test_cursor_round_trip_encode_parse() -> None:
    """_parse_cursor(_build_cursor(row)) reproduces the (timestamp, id) tuple."""
    row = {
        "created_at": datetime(2024, 6, 15, 8, 30, 45, tzinfo=UTC),
        "activity_id": SAMPLE_ACTIVITY_ID,
    }
    before_time, before_id = _parse_cursor(_build_cursor(row))
    assert before_time == row["created_at"]
    assert before_id == SAMPLE_ACTIVITY_ID
