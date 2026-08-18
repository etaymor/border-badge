"""Tests for push token registration and the trip-tag push (plan U10, KTD11).

Push tokens are keyed on the token itself: one user holds many device
tokens, and a device token belongs to at most one user. Registration
upserts ON CONFLICT (token) so re-registering a shared device transfers
ownership in one transaction; unregistering deletes only the given
device's token.
"""

from typing import Any
from unittest.mock import AsyncMock, patch
from uuid import UUID

from fastapi.testclient import TestClient

from app.core.notifications import send_trip_tag_notification
from app.core.security import AuthUser, get_current_user
from app.main import app
from tests.conftest import (
    OTHER_USER_ID,
    TEST_TRIP_ID,
    TEST_USER_ID,
    mock_auth_dependency,
    supabase_tables,
)

# ============================================================================
# Registration (upsert on token, ownership transfer)
# ============================================================================


def test_register_requires_auth(client: TestClient) -> None:
    """Registering a push token requires authentication."""
    response = client.post(
        "/notifications/register",
        json={"token": "ExponentPushToken[abc]", "platform": "ios"},
    )
    assert response.status_code == 403


def test_register_upserts_on_token_key(
    client: TestClient,
    mock_supabase_client: AsyncMock,
    mock_user: AuthUser,
    auth_headers: dict[str, str],
) -> None:
    """Registration upserts ON CONFLICT (token) with the JWT user as owner.

    The token is the conflict key (KTD11): if another user currently holds
    this device token, the upsert's DO UPDATE overwrites user_id -- a
    one-transaction ownership transfer, so the previous owner stops
    receiving pushes on this device.
    """
    app.dependency_overrides[get_current_user] = mock_auth_dependency(mock_user)
    try:
        with patch(
            "app.api.notifications.get_service_supabase_client",
            return_value=mock_supabase_client,
        ):
            response = client.post(
                "/notifications/register",
                headers=auth_headers,
                json={"token": "ExponentPushToken[abc]", "platform": "ios"},
            )
        assert response.status_code == 200
        mock_supabase_client.upsert.assert_awaited_once()
        args = mock_supabase_client.upsert.await_args
        assert args.args[0] == "push_token"
        rows = args.args[1]
        assert len(rows) == 1
        # Owner comes from the verified JWT, never the request body
        assert rows[0]["user_id"] == TEST_USER_ID
        assert rows[0]["token"] == "ExponentPushToken[abc]"
        on_conflict = args.kwargs.get("on_conflict") or args.args[2]
        assert on_conflict == "token"
    finally:
        app.dependency_overrides.clear()


# ============================================================================
# Unregistration (delete by token, other devices unaffected)
# ============================================================================


def test_unregister_deletes_only_given_token(
    client: TestClient,
    mock_supabase_client: AsyncMock,
    mock_user: AuthUser,
    auth_headers: dict[str, str],
) -> None:
    """Unregister with a token deletes only that device's registration."""
    app.dependency_overrides[get_current_user] = mock_auth_dependency(mock_user)
    try:
        with patch(
            "app.api.notifications.get_supabase_client",
            return_value=mock_supabase_client,
        ):
            response = client.delete(
                "/notifications/unregister",
                headers=auth_headers,
                params={"token": "ExponentPushToken[abc]"},
            )
        assert response.status_code == 200
        mock_supabase_client.delete.assert_awaited_once()
        args = mock_supabase_client.delete.await_args
        assert args.args[0] == "push_token"
        params = args.args[1]
        # Scoped to BOTH the caller and the specific device token: the
        # user's other devices keep receiving pushes.
        assert params["user_id"] == f"eq.{TEST_USER_ID}"
        assert params["token"] == "eq.ExponentPushToken[abc]"
    finally:
        app.dependency_overrides.clear()


def test_unregister_without_token_deletes_all_user_tokens(
    client: TestClient,
    mock_supabase_client: AsyncMock,
    mock_user: AuthUser,
    auth_headers: dict[str, str],
) -> None:
    """Legacy clients (no token param) fall back to deleting all tokens."""
    app.dependency_overrides[get_current_user] = mock_auth_dependency(mock_user)
    try:
        with patch(
            "app.api.notifications.get_supabase_client",
            return_value=mock_supabase_client,
        ):
            response = client.delete(
                "/notifications/unregister",
                headers=auth_headers,
            )
        assert response.status_code == 200
        mock_supabase_client.delete.assert_awaited_once()
        args = mock_supabase_client.delete.await_args
        params = args.args[1]
        assert params["user_id"] == f"eq.{TEST_USER_ID}"
        assert "token" not in params
    finally:
        app.dependency_overrides.clear()


# ============================================================================
# "You were tagged" push (core send_trip_tag_notification)
# ============================================================================


def _tag_push_db(tables: dict[str, Any]) -> AsyncMock:
    db = AsyncMock()
    db.get.side_effect = supabase_tables(**tables)
    return db


async def test_trip_tag_push_sends_to_all_devices_exactly_once() -> None:
    """The tagged user's push goes out once, to all their device tokens."""
    db = _tag_push_db(
        {
            "push_token": [
                {"token": "ExponentPushToken[device-a]"},
                {"token": "ExponentPushToken[device-b]"},
            ],
            "user_profile": [{"username": "ana", "display_name": "Ana"}],
        }
    )
    with (
        patch(
            "app.core.notifications.get_service_supabase_client",
            return_value=db,
        ),
        patch(
            "app.core.notifications.send_push_notification",
            new_callable=AsyncMock,
        ) as mock_push,
    ):
        await send_trip_tag_notification(
            trip_id=UUID(TEST_TRIP_ID),
            trip_name="Japan 2026",
            initiator_id=OTHER_USER_ID,
            tagged_user_id=UUID(TEST_USER_ID),
        )

    mock_push.assert_awaited_once()
    kwargs = mock_push.await_args.kwargs
    assert kwargs["tokens"] == [
        "ExponentPushToken[device-a]",
        "ExponentPushToken[device-b]",
    ]
    assert "Ana" in kwargs["body"]
    assert "Japan 2026" in kwargs["body"]


async def test_trip_tag_push_skipped_when_no_tokens() -> None:
    """No registered device: nothing is sent."""
    db = _tag_push_db({"push_token": []})
    with (
        patch(
            "app.core.notifications.get_service_supabase_client",
            return_value=db,
        ),
        patch(
            "app.core.notifications.send_push_notification",
            new_callable=AsyncMock,
        ) as mock_push,
    ):
        await send_trip_tag_notification(
            trip_id=UUID(TEST_TRIP_ID),
            trip_name="Japan 2026",
            initiator_id=OTHER_USER_ID,
            tagged_user_id=UUID(TEST_USER_ID),
        )
    mock_push.assert_not_awaited()


async def test_trip_tag_push_swallows_errors() -> None:
    """A failing push must never raise into the request that scheduled it."""
    db = AsyncMock()
    db.get.side_effect = Exception("db down")
    with (
        patch(
            "app.core.notifications.get_service_supabase_client",
            return_value=db,
        ),
        patch(
            "app.core.notifications.send_push_notification",
            new_callable=AsyncMock,
        ) as mock_push,
    ):
        # Must not raise
        result = await send_trip_tag_notification(
            trip_id=UUID(TEST_TRIP_ID),
            trip_name="Japan 2026",
            initiator_id=OTHER_USER_ID,
            tagged_user_id=UUID(TEST_USER_ID),
        )
    assert result is None
    mock_push.assert_not_awaited()
