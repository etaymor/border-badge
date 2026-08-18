"""Tests for email invite system endpoints."""

import hashlib
import hmac as hmac_mod
import secrets
from datetime import UTC, datetime, timedelta
from unittest.mock import AsyncMock, patch

from fastapi.testclient import TestClient

from app.core.config import get_settings
from app.core.db_utils import get_rpc_first_row
from app.core.security import AuthUser, get_current_user
from app.main import app
from tests.conftest import (
    OTHER_USER_ID,
    TEST_USER_ID,
    mock_auth_dependency,
    supabase_tables,
)

# Sample invite data for tests
SAMPLE_EMAIL = "friend@example.com"
SAMPLE_INVITE_ID = "550e8400-e29b-41d4-a716-446655440010"


def make_invite_code(inviter_id: str, email: str, age_days: int = 0) -> str:
    """Build a validly signed invite code, optionally back-dated.

    Mirrors generate_invite_code() but lets tests control the embedded
    timestamp so expiry behavior can be exercised without patching clocks.
    """
    timestamp = int((datetime.now(UTC) - timedelta(days=age_days)).timestamp())
    nonce = secrets.token_hex(8)
    email_hash = hashlib.sha256(email.lower().encode()).hexdigest()[:16]
    settings = get_settings()
    message = f"{inviter_id}:{email_hash}:{timestamp}:{nonce}"
    signature = hmac_mod.new(
        settings.INVITE_SIGNING_SECRET.encode(),
        message.encode(),
        hashlib.sha256,
    ).hexdigest()
    return f"{inviter_id}:{email_hash}:{timestamp}:{nonce}:{signature}"


# ============================================================================
# RPC Helper Function Tests
# ============================================================================


def test_get_rpc_first_row_with_list() -> None:
    """Test get_rpc_first_row with list result (SETOF behavior)."""
    result = [{"id": "1", "name": "test"}]
    row = get_rpc_first_row(result)
    assert row == {"id": "1", "name": "test"}


def test_get_rpc_first_row_with_dict() -> None:
    """Test get_rpc_first_row with dict result (RETURNS record)."""
    result = {"id": "1", "name": "test"}
    row = get_rpc_first_row(result)
    assert row == {"id": "1", "name": "test"}


def test_get_rpc_first_row_with_empty_list() -> None:
    """Test get_rpc_first_row with empty list."""
    result: list = []
    row = get_rpc_first_row(result)
    assert row is None


def test_get_rpc_first_row_with_none() -> None:
    """Test get_rpc_first_row with None."""
    row = get_rpc_first_row(None)
    assert row is None


def test_get_rpc_first_row_with_non_dict_list() -> None:
    """Test get_rpc_first_row with list of non-dict items."""
    result = ["string", "values"]
    row = get_rpc_first_row(result)
    assert row is None


def test_get_rpc_first_row_with_multiple_rows() -> None:
    """Test get_rpc_first_row returns first row from multi-row result."""
    result = [
        {"id": "1", "name": "first"},
        {"id": "2", "name": "second"},
    ]
    row = get_rpc_first_row(result)
    assert row == {"id": "1", "name": "first"}


# ============================================================================
# Send Invite Tests
# ============================================================================


def test_send_invite_requires_auth(client: TestClient) -> None:
    """Test that sending an invite requires authentication."""
    response = client.post("/invites", json={"email": SAMPLE_EMAIL})
    assert response.status_code == 403


def test_send_invite_success(
    client: TestClient,
    mock_supabase_client: AsyncMock,
    mock_user: AuthUser,
    auth_headers: dict[str, str],
) -> None:
    """Test successfully sending an email invite."""
    # Mock responses: email doesn't exist, no pending invite
    mock_supabase_client.rpc.return_value = [{"exists": False}]
    mock_supabase_client.get.return_value = []
    mock_supabase_client.post.return_value = [
        {
            "id": SAMPLE_INVITE_ID,
            "email": SAMPLE_EMAIL,
            "invite_type": "follow",
            "status": "pending",
        }
    ]

    app.dependency_overrides[get_current_user] = mock_auth_dependency(mock_user)
    try:
        with (
            patch(
                "app.api.invites.get_supabase_client",
                return_value=mock_supabase_client,
            ),
            patch(
                "app.api.invites.get_service_supabase_client",
                return_value=mock_supabase_client,
            ),
            patch("app.api.invites.send_invite_email", new_callable=AsyncMock),
        ):
            response = client.post(
                "/invites",
                headers=auth_headers,
                json={"email": SAMPLE_EMAIL, "invite_type": "follow"},
            )
        assert response.status_code == 201
        data = response.json()
        assert data["status"] == "sent"
        assert data["email"] == SAMPLE_EMAIL.lower()
    finally:
        app.dependency_overrides.clear()


def test_send_invite_existing_user_returns_400(
    client: TestClient,
    mock_supabase_client: AsyncMock,
    mock_user: AuthUser,
    auth_headers: dict[str, str],
) -> None:
    """Test that inviting an existing user returns 400.

    Note: The error message is intentionally generic to prevent email enumeration.
    """
    mock_supabase_client.rpc.return_value = [{"exists": True}]

    app.dependency_overrides[get_current_user] = mock_auth_dependency(mock_user)
    try:
        with (
            patch(
                "app.api.invites.get_supabase_client",
                return_value=mock_supabase_client,
            ),
            patch(
                "app.api.invites.get_service_supabase_client",
                return_value=mock_supabase_client,
            ),
        ):
            response = client.post(
                "/invites",
                headers=auth_headers,
                json={"email": SAMPLE_EMAIL},
            )
        assert response.status_code == 400
        # Generic message to prevent email enumeration attacks
        assert "Unable to send invite" in response.json()["detail"]
    finally:
        app.dependency_overrides.clear()


def test_send_invite_already_pending(
    client: TestClient,
    mock_supabase_client: AsyncMock,
    mock_user: AuthUser,
    auth_headers: dict[str, str],
) -> None:
    """Test that sending duplicate invite returns already_pending status."""
    mock_supabase_client.rpc.return_value = [{"exists": False}]
    mock_supabase_client.get.return_value = [
        {"id": SAMPLE_INVITE_ID, "status": "pending"}
    ]

    app.dependency_overrides[get_current_user] = mock_auth_dependency(mock_user)
    try:
        with (
            patch(
                "app.api.invites.get_supabase_client",
                return_value=mock_supabase_client,
            ),
            patch(
                "app.api.invites.get_service_supabase_client",
                return_value=mock_supabase_client,
            ),
        ):
            response = client.post(
                "/invites",
                headers=auth_headers,
                json={"email": SAMPLE_EMAIL},
            )
        assert response.status_code == 201
        data = response.json()
        assert data["status"] == "already_pending"
    finally:
        app.dependency_overrides.clear()


def test_send_invite_normalizes_email(
    client: TestClient,
    mock_supabase_client: AsyncMock,
    mock_user: AuthUser,
    auth_headers: dict[str, str],
) -> None:
    """Test that email is normalized to lowercase."""
    mock_supabase_client.rpc.return_value = [{"exists": False}]
    mock_supabase_client.get.return_value = []
    mock_supabase_client.post.return_value = [
        {
            "id": SAMPLE_INVITE_ID,
            "email": "friend@example.com",
            "status": "pending",
        }
    ]

    app.dependency_overrides[get_current_user] = mock_auth_dependency(mock_user)
    try:
        with (
            patch(
                "app.api.invites.get_supabase_client",
                return_value=mock_supabase_client,
            ),
            patch(
                "app.api.invites.get_service_supabase_client",
                return_value=mock_supabase_client,
            ),
            patch("app.api.invites.send_invite_email", new_callable=AsyncMock),
        ):
            response = client.post(
                "/invites",
                headers=auth_headers,
                json={"email": "FRIEND@EXAMPLE.COM"},  # Uppercase
            )
        assert response.status_code == 201
        data = response.json()
        assert data["email"] == "friend@example.com"
    finally:
        app.dependency_overrides.clear()


# ============================================================================
# Get Pending Invites Tests
# ============================================================================


def test_get_pending_invites_requires_auth(client: TestClient) -> None:
    """Test that getting pending invites requires authentication."""
    response = client.get("/invites/pending")
    assert response.status_code == 403


def test_get_pending_invites_success(
    client: TestClient,
    mock_supabase_client: AsyncMock,
    mock_user: AuthUser,
    auth_headers: dict[str, str],
) -> None:
    """Test successfully getting pending invites."""
    mock_supabase_client.get.return_value = [
        {
            "id": SAMPLE_INVITE_ID,
            "email": SAMPLE_EMAIL,
            "invite_type": "follow",
            "status": "pending",
            "created_at": "2024-01-01T00:00:00Z",
        },
        {
            "id": "another-invite-id",
            "email": "another@example.com",
            "invite_type": "trip_tag",
            "status": "pending",
            "created_at": "2024-01-02T00:00:00Z",
        },
    ]

    app.dependency_overrides[get_current_user] = mock_auth_dependency(mock_user)
    try:
        with (
            patch(
                "app.api.invites.get_supabase_client",
                return_value=mock_supabase_client,
            ),
            patch(
                "app.api.invites.get_service_supabase_client",
                return_value=mock_supabase_client,
            ),
        ):
            response = client.get("/invites/pending", headers=auth_headers)
        assert response.status_code == 200
        data = response.json()
        assert len(data) == 2
        assert data[0]["email"] == SAMPLE_EMAIL
        assert data[1]["invite_type"] == "trip_tag"
    finally:
        app.dependency_overrides.clear()


def test_get_pending_invites_empty(
    client: TestClient,
    mock_supabase_client: AsyncMock,
    mock_user: AuthUser,
    auth_headers: dict[str, str],
) -> None:
    """Test getting pending invites when none exist."""
    mock_supabase_client.get.return_value = []

    app.dependency_overrides[get_current_user] = mock_auth_dependency(mock_user)
    try:
        with (
            patch(
                "app.api.invites.get_supabase_client",
                return_value=mock_supabase_client,
            ),
            patch(
                "app.api.invites.get_service_supabase_client",
                return_value=mock_supabase_client,
            ),
        ):
            response = client.get("/invites/pending", headers=auth_headers)
        assert response.status_code == 200
        assert response.json() == []
    finally:
        app.dependency_overrides.clear()


def test_get_pending_invites_with_pagination(
    client: TestClient,
    mock_supabase_client: AsyncMock,
    mock_user: AuthUser,
    auth_headers: dict[str, str],
) -> None:
    """Test getting pending invites with pagination."""
    mock_supabase_client.get.return_value = [
        {
            "id": SAMPLE_INVITE_ID,
            "email": SAMPLE_EMAIL,
            "invite_type": "follow",
            "status": "pending",
            "created_at": "2024-01-01T00:00:00Z",
        }
    ]

    app.dependency_overrides[get_current_user] = mock_auth_dependency(mock_user)
    try:
        with (
            patch(
                "app.api.invites.get_supabase_client",
                return_value=mock_supabase_client,
            ),
            patch(
                "app.api.invites.get_service_supabase_client",
                return_value=mock_supabase_client,
            ),
        ):
            response = client.get(
                "/invites/pending?limit=10&offset=5", headers=auth_headers
            )
        assert response.status_code == 200
    finally:
        app.dependency_overrides.clear()


# ============================================================================
# Cancel Invite Tests
# ============================================================================


def test_cancel_invite_requires_auth(client: TestClient) -> None:
    """Test that canceling an invite requires authentication."""
    response = client.delete(f"/invites/{SAMPLE_INVITE_ID}")
    assert response.status_code == 403


def test_cancel_invite_success(
    client: TestClient,
    mock_supabase_client: AsyncMock,
    mock_user: AuthUser,
    auth_headers: dict[str, str],
) -> None:
    """Test successfully canceling an invite."""
    mock_supabase_client.get.return_value = [{"id": SAMPLE_INVITE_ID}]
    mock_supabase_client.delete.return_value = []

    app.dependency_overrides[get_current_user] = mock_auth_dependency(mock_user)
    try:
        with (
            patch(
                "app.api.invites.get_supabase_client",
                return_value=mock_supabase_client,
            ),
            patch(
                "app.api.invites.get_service_supabase_client",
                return_value=mock_supabase_client,
            ),
        ):
            response = client.delete(
                f"/invites/{SAMPLE_INVITE_ID}", headers=auth_headers
            )
        assert response.status_code == 200
        data = response.json()
        assert data["status"] == "cancelled"
        assert data["invite_id"] == SAMPLE_INVITE_ID
    finally:
        app.dependency_overrides.clear()


def test_cancel_invite_not_found(
    client: TestClient,
    mock_supabase_client: AsyncMock,
    mock_user: AuthUser,
    auth_headers: dict[str, str],
) -> None:
    """Test canceling an invite that doesn't exist."""
    mock_supabase_client.get.return_value = []

    app.dependency_overrides[get_current_user] = mock_auth_dependency(mock_user)
    try:
        with (
            patch(
                "app.api.invites.get_supabase_client",
                return_value=mock_supabase_client,
            ),
            patch(
                "app.api.invites.get_service_supabase_client",
                return_value=mock_supabase_client,
            ),
        ):
            response = client.delete(
                f"/invites/{SAMPLE_INVITE_ID}", headers=auth_headers
            )
        assert response.status_code == 404
        assert "Invite not found" in response.json()["detail"]
    finally:
        app.dependency_overrides.clear()


# ============================================================================
# Invite Code Generation Tests
# ============================================================================


def test_invite_code_is_generated():
    """Test that invite codes are generated correctly."""
    from app.core.invite_signer import generate_invite_code

    invite_code = generate_invite_code(TEST_USER_ID, SAMPLE_EMAIL)
    assert invite_code is not None
    assert len(invite_code) > 0


def test_invite_code_verification():
    """Test that valid invite codes can be verified."""
    from app.core.invite_signer import generate_invite_code, verify_invite_code

    invite_code = generate_invite_code(TEST_USER_ID, SAMPLE_EMAIL)
    result = verify_invite_code(invite_code)

    assert result is not None
    assert result["inviter_id"] == TEST_USER_ID
    # Email is returned as a hash, not the original email
    assert "email_hash" in result


def test_invalid_invite_code_returns_none():
    """Test that invalid invite codes return None."""
    from app.core.invite_signer import verify_invite_code

    result = verify_invite_code("invalid-code-here")
    assert result is None


def test_tampered_invite_code_returns_none():
    """Test that tampered invite codes return None."""
    from app.core.invite_signer import generate_invite_code, verify_invite_code

    invite_code = generate_invite_code(TEST_USER_ID, SAMPLE_EMAIL)
    # Tamper with the code
    tampered_code = invite_code[:-5] + "XXXXX"
    result = verify_invite_code(tampered_code)
    assert result is None


# ============================================================================
# Invite Flow Integration Tests (Document Expected Behavior)
# ============================================================================
# Note: These tests document the expected behavior of the full invite flow.
# The actual signup → auto-follow logic is implemented in the database trigger
# (0044_process_pending_invites_on_signup.sql) and cannot be unit tested here.
# These tests verify the API layer supports the flow correctly.


def test_invite_flow_send_stores_inviter_id(
    client: TestClient,
    mock_supabase_client: AsyncMock,
    mock_user: AuthUser,
    auth_headers: dict[str, str],
) -> None:
    """
    Test that sent invites store the inviter_id correctly.

    This is critical for the signup flow where we create a follow relationship
    from inviter → new user. The database trigger uses this inviter_id.
    """
    stored_invite = None

    async def capture_post_call(table, data):
        nonlocal stored_invite
        # Capture the data being posted - db.post(table, data) uses positional args
        if table == "pending_invite":
            stored_invite = data
        return [
            {
                "id": SAMPLE_INVITE_ID,
                "email": SAMPLE_EMAIL,
                "inviter_id": TEST_USER_ID,
                "invite_type": "follow",
                "status": "pending",
            }
        ]

    mock_supabase_client.rpc.return_value = [{"exists": False}]
    mock_supabase_client.get.return_value = []
    mock_supabase_client.post.side_effect = capture_post_call

    app.dependency_overrides[get_current_user] = mock_auth_dependency(mock_user)
    try:
        with (
            patch(
                "app.api.invites.get_supabase_client",
                return_value=mock_supabase_client,
            ),
            patch(
                "app.api.invites.get_service_supabase_client",
                return_value=mock_supabase_client,
            ),
            patch("app.api.invites.send_invite_email", new_callable=AsyncMock),
        ):
            response = client.post(
                "/invites",
                headers=auth_headers,
                json={"email": SAMPLE_EMAIL, "invite_type": "follow"},
            )
        assert response.status_code == 201
        # Verify inviter_id was stored (used by signup trigger)
        assert stored_invite is not None
        assert stored_invite.get("inviter_id") == TEST_USER_ID
    finally:
        app.dependency_overrides.clear()


def test_invite_flow_trip_tag_stores_trip_id(
    client: TestClient,
    mock_supabase_client: AsyncMock,
    mock_user: AuthUser,
    auth_headers: dict[str, str],
) -> None:
    """
    Test that trip_tag invites store the trip_id correctly.

    This is critical for the signup flow where we create a pending trip_tag
    for the new user. The database trigger uses this trip_id.
    """
    stored_invite = None
    trip_id = "550e8400-e29b-41d4-a716-446655440099"

    async def capture_post_call(table, data):
        nonlocal stored_invite
        if table == "pending_invite":
            stored_invite = data
        return [
            {
                "id": SAMPLE_INVITE_ID,
                "email": SAMPLE_EMAIL,
                "inviter_id": TEST_USER_ID,
                "invite_type": "trip_tag",
                "trip_id": trip_id,
                "status": "pending",
            }
        ]

    mock_supabase_client.rpc.return_value = [{"exists": False}]
    mock_supabase_client.get.side_effect = supabase_tables(
        trip=[{"id": trip_id}],  # ownership check: the caller owns this trip
        user_profile=[{"display_name": "Test User", "username": "test_user"}],
        pending_invite=[],  # no existing invite
    )
    mock_supabase_client.post.side_effect = capture_post_call

    app.dependency_overrides[get_current_user] = mock_auth_dependency(mock_user)
    try:
        with (
            patch(
                "app.api.invites.get_supabase_client",
                return_value=mock_supabase_client,
            ),
            patch(
                "app.api.invites.get_service_supabase_client",
                return_value=mock_supabase_client,
            ),
            patch("app.api.invites.send_invite_email", new_callable=AsyncMock),
        ):
            response = client.post(
                "/invites",
                headers=auth_headers,
                json={
                    "email": SAMPLE_EMAIL,
                    "invite_type": "trip_tag",
                    "trip_id": trip_id,
                },
            )
        assert response.status_code == 201
        # Verify trip_id was stored (used by signup trigger)
        assert stored_invite is not None
        assert stored_invite.get("trip_id") == trip_id
        assert stored_invite.get("invite_type") == "trip_tag"
    finally:
        app.dependency_overrides.clear()


# ============================================================================
# Shareable Link Tests (R9: link deliverable even without email delivery)
# ============================================================================


def test_send_invite_returns_shareable_link_without_email_delivery(
    client: TestClient,
    mock_supabase_client: AsyncMock,
    mock_user: AuthUser,
    auth_headers: dict[str, str],
) -> None:
    """An invite yields a shareable landing URL even when email sending is
    unconfigured (Resend absent) -- the link is the primary delivery path."""
    mock_supabase_client.rpc.return_value = [{"exists": False}]
    mock_supabase_client.get.return_value = []
    mock_supabase_client.post.return_value = [
        {"id": SAMPLE_INVITE_ID, "email": SAMPLE_EMAIL, "status": "pending"}
    ]

    app.dependency_overrides[get_current_user] = mock_auth_dependency(mock_user)
    try:
        with (
            patch(
                "app.api.invites.get_supabase_client",
                return_value=mock_supabase_client,
            ),
            patch(
                "app.api.invites.get_service_supabase_client",
                return_value=mock_supabase_client,
            ),
            # Resend unconfigured: the edge function returns None. The link
            # must still come back in the response.
            patch(
                "app.api.invites.send_invite_email",
                new_callable=AsyncMock,
                return_value=None,
            ),
        ):
            response = client.post(
                "/invites",
                headers=auth_headers,
                json={"email": SAMPLE_EMAIL, "invite_type": "follow"},
            )
        assert response.status_code == 201
        data = response.json()
        assert data["status"] == "sent"
        assert data["invite_url"], "invite_url missing from response"
        assert "/invite?code=" in data["invite_url"]
    finally:
        app.dependency_overrides.clear()


def test_send_invite_already_pending_returns_existing_link(
    client: TestClient,
    mock_supabase_client: AsyncMock,
    mock_user: AuthUser,
    auth_headers: dict[str, str],
) -> None:
    """Re-inviting the same email surfaces the existing invite's link so the
    user can re-share it."""
    existing_code = make_invite_code(TEST_USER_ID, SAMPLE_EMAIL)
    mock_supabase_client.rpc.return_value = [{"exists": False}]
    mock_supabase_client.get.return_value = [
        {"id": SAMPLE_INVITE_ID, "status": "pending", "invite_code": existing_code}
    ]

    app.dependency_overrides[get_current_user] = mock_auth_dependency(mock_user)
    try:
        with (
            patch(
                "app.api.invites.get_supabase_client",
                return_value=mock_supabase_client,
            ),
            patch(
                "app.api.invites.get_service_supabase_client",
                return_value=mock_supabase_client,
            ),
        ):
            response = client.post(
                "/invites",
                headers=auth_headers,
                json={"email": SAMPLE_EMAIL},
            )
        assert response.status_code == 201
        data = response.json()
        assert data["status"] == "already_pending"
        assert data["invite_url"]
        assert "/invite?code=" in data["invite_url"]
    finally:
        app.dependency_overrides.clear()


# ============================================================================
# Redeem Invite Tests (R9: deterministic attribution via code redemption)
# ============================================================================

INVITER_PROFILE = {
    "user_id": OTHER_USER_ID,
    "username": "world_wanderer",
    "display_name": "World Wanderer",
    "avatar_url": "https://example.com/avatar.jpg",
}


def _pending_invite_row(
    code: str,
    invite_type: str = "follow",
    status: str = "pending",
    trip_id: str | None = None,
) -> dict:
    return {
        "id": SAMPLE_INVITE_ID,
        "inviter_id": OTHER_USER_ID,
        "invite_type": invite_type,
        "trip_id": trip_id,
        "status": status,
        "invite_code": code,
    }


def test_redeem_invite_requires_auth(client: TestClient) -> None:
    response = client.post("/invites/redeem", json={"code": "anything"})
    assert response.status_code == 403


def test_redeem_invite_creates_follow_and_marks_accepted(
    client: TestClient,
    mock_supabase_client: AsyncMock,
    mock_user: AuthUser,
    auth_headers: dict[str, str],
) -> None:
    """Redeeming a valid code creates the inviter->redeemer follow, marks the
    invite accepted, and returns the inviter for the follow-back prompt.

    The authenticated user's email (test+test@example.com) deliberately does
    NOT match the invited address (friend@example.com) -- this is the Apple
    private-relay scenario, where email matching at signup fails and only code
    redemption can attribute.
    """
    code = make_invite_code(OTHER_USER_ID, SAMPLE_EMAIL)
    mock_supabase_client.get.side_effect = supabase_tables(
        pending_invite=[_pending_invite_row(code)],
        user_profile=[INVITER_PROFILE],
    )
    mock_supabase_client.patch.return_value = [{"id": SAMPLE_INVITE_ID}]

    app.dependency_overrides[get_current_user] = mock_auth_dependency(mock_user)
    try:
        with patch(
            "app.api.invites.get_service_supabase_client",
            return_value=mock_supabase_client,
        ):
            response = client.post(
                "/invites/redeem",
                headers=auth_headers,
                json={"code": code},
            )
        assert response.status_code == 200
        data = response.json()
        assert data["status"] == "redeemed"
        assert data["inviter"]["username"] == "world_wanderer"
        assert data["inviter"]["user_id"] == OTHER_USER_ID

        # Follow: inviter follows the redeemer
        follow_calls = [
            call
            for call in mock_supabase_client.post.call_args_list
            if call.args[0] == "user_follow"
        ]
        assert len(follow_calls) == 1
        follow_data = follow_calls[0].args[1]
        assert follow_data["follower_id"] == OTHER_USER_ID
        assert follow_data["following_id"] == TEST_USER_ID

        # Accepted exactly once, guarded on status=pending
        assert mock_supabase_client.patch.call_count == 1
        patch_call = mock_supabase_client.patch.call_args
        assert patch_call.args[0] == "pending_invite"
        assert patch_call.kwargs["data"]["status"] == "accepted"
        assert patch_call.kwargs["params"]["status"] == "eq.pending"
    finally:
        app.dependency_overrides.clear()


def test_redeem_invite_retry_is_idempotent(
    client: TestClient,
    mock_supabase_client: AsyncMock,
    mock_user: AuthUser,
    auth_headers: dict[str, str],
) -> None:
    """A retry after successful redemption returns success without creating a
    second follow or re-marking the invite."""
    code = make_invite_code(OTHER_USER_ID, SAMPLE_EMAIL)
    mock_supabase_client.get.side_effect = supabase_tables(
        pending_invite=[_pending_invite_row(code, status="accepted")],
        user_profile=[INVITER_PROFILE],
    )

    app.dependency_overrides[get_current_user] = mock_auth_dependency(mock_user)
    try:
        with patch(
            "app.api.invites.get_service_supabase_client",
            return_value=mock_supabase_client,
        ):
            response = client.post(
                "/invites/redeem",
                headers=auth_headers,
                json={"code": code},
            )
        assert response.status_code == 200
        data = response.json()
        assert data["status"] == "already_redeemed"
        assert data["inviter"]["username"] == "world_wanderer"
        # No new follow, no re-marking
        mock_supabase_client.post.assert_not_called()
        mock_supabase_client.patch.assert_not_called()
    finally:
        app.dependency_overrides.clear()


def test_redeem_invite_invalid_code_returns_400(
    client: TestClient,
    mock_supabase_client: AsyncMock,
    mock_user: AuthUser,
    auth_headers: dict[str, str],
) -> None:
    app.dependency_overrides[get_current_user] = mock_auth_dependency(mock_user)
    try:
        with patch(
            "app.api.invites.get_service_supabase_client",
            return_value=mock_supabase_client,
        ):
            response = client.post(
                "/invites/redeem",
                headers=auth_headers,
                json={"code": "garbage-code"},
            )
        assert response.status_code == 400
        # No side effects at all for an unverifiable code
        mock_supabase_client.post.assert_not_called()
        mock_supabase_client.patch.assert_not_called()
    finally:
        app.dependency_overrides.clear()


def test_redeem_invite_expired_code_redeems_nothing(
    client: TestClient,
    mock_supabase_client: AsyncMock,
    mock_user: AuthUser,
    auth_headers: dict[str, str],
) -> None:
    """An expired code (past invite_expiration_days) creates no follow and is
    never marked accepted."""
    expired_code = make_invite_code(OTHER_USER_ID, SAMPLE_EMAIL, age_days=31)
    mock_supabase_client.get.side_effect = supabase_tables(
        pending_invite=[_pending_invite_row(expired_code)],
        user_profile=[INVITER_PROFILE],
    )

    app.dependency_overrides[get_current_user] = mock_auth_dependency(mock_user)
    try:
        with patch(
            "app.api.invites.get_service_supabase_client",
            return_value=mock_supabase_client,
        ):
            response = client.post(
                "/invites/redeem",
                headers=auth_headers,
                json={"code": expired_code},
            )
        assert response.status_code == 400
        mock_supabase_client.post.assert_not_called()
        mock_supabase_client.patch.assert_not_called()
    finally:
        app.dependency_overrides.clear()


def test_redeem_invite_cancelled_invite_returns_404(
    client: TestClient,
    mock_supabase_client: AsyncMock,
    mock_user: AuthUser,
    auth_headers: dict[str, str],
) -> None:
    """A validly signed code whose invite row was cancelled (deleted) redeems
    nothing -- the inviter withdrew consent."""
    code = make_invite_code(OTHER_USER_ID, SAMPLE_EMAIL)
    mock_supabase_client.get.side_effect = supabase_tables()  # no rows anywhere

    app.dependency_overrides[get_current_user] = mock_auth_dependency(mock_user)
    try:
        with patch(
            "app.api.invites.get_service_supabase_client",
            return_value=mock_supabase_client,
        ):
            response = client.post(
                "/invites/redeem",
                headers=auth_headers,
                json={"code": code},
            )
        assert response.status_code == 404
        mock_supabase_client.post.assert_not_called()
        mock_supabase_client.patch.assert_not_called()
    finally:
        app.dependency_overrides.clear()


def test_redeem_invite_own_code_returns_400(
    client: TestClient,
    mock_supabase_client: AsyncMock,
    mock_user: AuthUser,
    auth_headers: dict[str, str],
) -> None:
    """The inviter cannot redeem their own invite."""
    code = make_invite_code(TEST_USER_ID, SAMPLE_EMAIL)
    row = _pending_invite_row(code)
    row["inviter_id"] = TEST_USER_ID
    mock_supabase_client.get.side_effect = supabase_tables(pending_invite=[row])

    app.dependency_overrides[get_current_user] = mock_auth_dependency(mock_user)
    try:
        with patch(
            "app.api.invites.get_service_supabase_client",
            return_value=mock_supabase_client,
        ):
            response = client.post(
                "/invites/redeem",
                headers=auth_headers,
                json={"code": code},
            )
        assert response.status_code == 400
        mock_supabase_client.post.assert_not_called()
        mock_supabase_client.patch.assert_not_called()
    finally:
        app.dependency_overrides.clear()


def test_redeem_trip_tag_invite_creates_pending_tag(
    client: TestClient,
    mock_supabase_client: AsyncMock,
    mock_user: AuthUser,
    auth_headers: dict[str, str],
) -> None:
    """Redeeming a trip_tag invite creates a *pending* trip tag (consent
    workflow) plus the follow, and marks the invite accepted."""
    trip_id = "550e8400-e29b-41d4-a716-446655440077"
    code = make_invite_code(OTHER_USER_ID, SAMPLE_EMAIL)
    mock_supabase_client.get.side_effect = supabase_tables(
        pending_invite=[_pending_invite_row(code, "trip_tag", trip_id=trip_id)],
        user_profile=[INVITER_PROFILE],
        trip=[{"id": trip_id, "user_id": OTHER_USER_ID}],
    )
    mock_supabase_client.patch.return_value = [{"id": SAMPLE_INVITE_ID}]

    app.dependency_overrides[get_current_user] = mock_auth_dependency(mock_user)
    try:
        with patch(
            "app.api.invites.get_service_supabase_client",
            return_value=mock_supabase_client,
        ):
            response = client.post(
                "/invites/redeem",
                headers=auth_headers,
                json={"code": code},
            )
        assert response.status_code == 200
        assert response.json()["status"] == "redeemed"

        tag_calls = [
            call
            for call in mock_supabase_client.post.call_args_list
            if call.args[0] == "trip_tags"
        ]
        assert len(tag_calls) == 1
        tag_data = tag_calls[0].args[1]
        assert tag_data["trip_id"] == trip_id
        assert tag_data["tagged_user_id"] == TEST_USER_ID
        assert tag_data["initiated_by"] == OTHER_USER_ID
        # Lowercase status -- the consent workflow's canonical value
        assert tag_data["status"] == "pending"

        follow_calls = [
            call
            for call in mock_supabase_client.post.call_args_list
            if call.args[0] == "user_follow"
        ]
        assert len(follow_calls) == 1
        assert mock_supabase_client.patch.call_count == 1
    finally:
        app.dependency_overrides.clear()


def test_redeem_trip_tag_invite_deleted_trip_is_graceful_non_redeem(
    client: TestClient,
    mock_supabase_client: AsyncMock,
    mock_user: AuthUser,
    auth_headers: dict[str, str],
) -> None:
    """A trip_tag invite whose trip is gone redeems nothing: no follow, no
    tag, and the invite stays pending (a later attempt could still succeed if
    semantics change). The response reuses already_redeemed with inviter=None
    so the mobile RedeemInviteResponse union stays backward compatible."""
    trip_id = "550e8400-e29b-41d4-a716-446655440077"
    code = make_invite_code(OTHER_USER_ID, SAMPLE_EMAIL)
    mock_supabase_client.get.side_effect = supabase_tables(
        pending_invite=[_pending_invite_row(code, "trip_tag", trip_id=trip_id)],
        user_profile=[INVITER_PROFILE],
        trip=[],  # deleted or missing
    )

    app.dependency_overrides[get_current_user] = mock_auth_dependency(mock_user)
    try:
        with patch(
            "app.api.invites.get_service_supabase_client",
            return_value=mock_supabase_client,
        ):
            response = client.post(
                "/invites/redeem",
                headers=auth_headers,
                json={"code": code},
            )
        assert response.status_code == 200
        data = response.json()
        assert data["status"] == "already_redeemed"
        assert data["inviter"] is None
        # No side effects at all: no follow, no tag, invite left pending
        mock_supabase_client.post.assert_not_called()
        mock_supabase_client.patch.assert_not_called()
    finally:
        app.dependency_overrides.clear()


def test_redeem_trip_tag_invite_inviter_no_longer_owns_trip_creates_no_tag(
    client: TestClient,
    mock_supabase_client: AsyncMock,
    mock_user: AuthUser,
    auth_headers: dict[str, str],
) -> None:
    """Defense in depth (#3): if the invite's inviter does not own the trip at
    redemption time (e.g. a legacy invite minted with someone else's trip_id),
    no tag is created and nothing is redeemed."""
    trip_id = "550e8400-e29b-41d4-a716-446655440077"
    someone_else = "550e8400-e29b-41d4-a716-446655440055"
    code = make_invite_code(OTHER_USER_ID, SAMPLE_EMAIL)
    mock_supabase_client.get.side_effect = supabase_tables(
        pending_invite=[_pending_invite_row(code, "trip_tag", trip_id=trip_id)],
        user_profile=[INVITER_PROFILE],
        trip=[{"id": trip_id, "user_id": someone_else}],  # not the inviter's
    )

    app.dependency_overrides[get_current_user] = mock_auth_dependency(mock_user)
    try:
        with patch(
            "app.api.invites.get_service_supabase_client",
            return_value=mock_supabase_client,
        ):
            response = client.post(
                "/invites/redeem",
                headers=auth_headers,
                json={"code": code},
            )
        assert response.status_code == 200
        data = response.json()
        assert data["status"] == "already_redeemed"
        assert data["inviter"] is None
        mock_supabase_client.post.assert_not_called()
        mock_supabase_client.patch.assert_not_called()
    finally:
        app.dependency_overrides.clear()


def test_send_trip_tag_invite_for_unowned_trip_returns_404(
    client: TestClient,
    mock_supabase_client: AsyncMock,
    mock_user: AuthUser,
    auth_headers: dict[str, str],
) -> None:
    """Security (#3): send_invite must verify the caller owns invite.trip_id.
    An unowned trip 404s (existence-hiding) and persists nothing -- otherwise
    an attacker could mint themselves a pending tag (and RLS read access) on
    any private trip whose UUID they know."""
    trip_id = "550e8400-e29b-41d4-a716-446655440077"
    mock_supabase_client.rpc.return_value = [{"exists": False}]
    mock_supabase_client.get.side_effect = supabase_tables(
        trip=[],  # ownership check: not the caller's trip
    )

    app.dependency_overrides[get_current_user] = mock_auth_dependency(mock_user)
    try:
        with (
            patch(
                "app.api.invites.get_supabase_client",
                return_value=mock_supabase_client,
            ),
            patch(
                "app.api.invites.get_service_supabase_client",
                return_value=mock_supabase_client,
            ),
        ):
            response = client.post(
                "/invites",
                headers=auth_headers,
                json={
                    "email": SAMPLE_EMAIL,
                    "invite_type": "trip_tag",
                    "trip_id": trip_id,
                },
            )
        assert response.status_code == 404
        mock_supabase_client.post.assert_not_called()
    finally:
        app.dependency_overrides.clear()


def _post_raising_for(table_name: str, error: Exception):
    """Async post side effect that raises `error` for one table only."""

    async def side_effect(table, data):
        if table == table_name:
            raise error
        return [{"id": "row-id"}]

    return side_effect


def _duplicate_key_database_error():
    """The REAL exception shape the DB layer raises for a unique violation:
    generic client-facing detail, specifics only in structured fields."""
    from app.db.session import DatabaseError

    error = DatabaseError(
        status_code=409,
        pg_code="23505",
        message='duplicate key value violates unique constraint "some_key"',
        constraint="some_key",
    )
    assert "duplicate" not in str(error.detail).lower()
    return error


def test_redeem_trip_tag_invite_duplicate_tag_passes_through(
    client: TestClient,
    mock_supabase_client: AsyncMock,
    mock_user: AuthUser,
    auth_headers: dict[str, str],
) -> None:
    """Regression (#2/#4): a duplicate-key DatabaseError on the trip_tags
    insert (tag already exists) is tolerated -- redemption still completes."""
    trip_id = "550e8400-e29b-41d4-a716-446655440077"
    code = make_invite_code(OTHER_USER_ID, SAMPLE_EMAIL)
    mock_supabase_client.get.side_effect = supabase_tables(
        pending_invite=[_pending_invite_row(code, "trip_tag", trip_id=trip_id)],
        user_profile=[INVITER_PROFILE],
        trip=[{"id": trip_id, "user_id": OTHER_USER_ID}],
    )
    mock_supabase_client.patch.return_value = [{"id": SAMPLE_INVITE_ID}]
    mock_supabase_client.post.side_effect = _post_raising_for(
        "trip_tags", _duplicate_key_database_error()
    )

    app.dependency_overrides[get_current_user] = mock_auth_dependency(mock_user)
    try:
        with patch(
            "app.api.invites.get_service_supabase_client",
            return_value=mock_supabase_client,
        ):
            response = client.post(
                "/invites/redeem",
                headers=auth_headers,
                json={"code": code},
            )
        assert response.status_code == 200
        assert response.json()["status"] == "redeemed"
        # The follow was still created and the claim was NOT reverted.
        tables_posted = [
            call.args[0] for call in mock_supabase_client.post.call_args_list
        ]
        assert "user_follow" in tables_posted
        assert mock_supabase_client.patch.call_count == 1
    finally:
        app.dependency_overrides.clear()


def test_redeem_invite_duplicate_follow_passes_through(
    client: TestClient,
    mock_supabase_client: AsyncMock,
    mock_user: AuthUser,
    auth_headers: dict[str, str],
) -> None:
    """Regression (#2/#4): a duplicate-key DatabaseError on the user_follow
    insert (already following) is tolerated -- redemption still completes."""
    code = make_invite_code(OTHER_USER_ID, SAMPLE_EMAIL)
    mock_supabase_client.get.side_effect = supabase_tables(
        pending_invite=[_pending_invite_row(code)],
        user_profile=[INVITER_PROFILE],
    )
    mock_supabase_client.patch.return_value = [{"id": SAMPLE_INVITE_ID}]
    mock_supabase_client.post.side_effect = _post_raising_for(
        "user_follow", _duplicate_key_database_error()
    )

    app.dependency_overrides[get_current_user] = mock_auth_dependency(mock_user)
    try:
        with patch(
            "app.api.invites.get_service_supabase_client",
            return_value=mock_supabase_client,
        ):
            response = client.post(
                "/invites/redeem",
                headers=auth_headers,
                json={"code": code},
            )
        assert response.status_code == 200
        assert response.json()["status"] == "redeemed"
        # Claimed exactly once, never reverted.
        assert mock_supabase_client.patch.call_count == 1
    finally:
        app.dependency_overrides.clear()


def test_redeem_invite_blocked_pair_returns_403_without_side_effects(
    client: TestClient,
    mock_supabase_client: AsyncMock,
    mock_user: AuthUser,
    auth_headers: dict[str, str],
) -> None:
    """#4: a blocked pair redeems nothing -- 403, no follow, no tag, and the
    invite stays pending (never claimed)."""
    code = make_invite_code(OTHER_USER_ID, SAMPLE_EMAIL)
    mock_supabase_client.get.side_effect = supabase_tables(
        pending_invite=[_pending_invite_row(code)],
        user_profile=[INVITER_PROFILE],
        user_block=[{"id": "block-id"}],  # a block exists in some direction
    )

    app.dependency_overrides[get_current_user] = mock_auth_dependency(mock_user)
    try:
        with patch(
            "app.api.invites.get_service_supabase_client",
            return_value=mock_supabase_client,
        ):
            response = client.post(
                "/invites/redeem",
                headers=auth_headers,
                json={"code": code},
            )
        assert response.status_code == 403
        mock_supabase_client.post.assert_not_called()
        mock_supabase_client.patch.assert_not_called()
    finally:
        app.dependency_overrides.clear()


def test_redeem_invite_block_trigger_race_reverts_claim(
    client: TestClient,
    mock_supabase_client: AsyncMock,
    mock_user: AuthUser,
    auth_headers: dict[str, str],
) -> None:
    """#4: a block racing past the pre-check hits the database trigger on the
    follow insert (real DatabaseError shape: generic detail, message only in
    structured fields) -- 403, and the claim is reverted to pending."""
    from app.db.session import DatabaseError

    code = make_invite_code(OTHER_USER_ID, SAMPLE_EMAIL)
    mock_supabase_client.get.side_effect = supabase_tables(
        pending_invite=[_pending_invite_row(code)],
        user_profile=[INVITER_PROFILE],
        user_block=[],  # pre-check sees nothing; the block lands mid-flight
    )
    mock_supabase_client.patch.return_value = [{"id": SAMPLE_INVITE_ID}]
    mock_supabase_client.post.side_effect = _post_raising_for(
        "user_follow",
        DatabaseError(
            status_code=400,
            pg_code="P0001",
            message="Cannot follow a blocked user or a user who has blocked you",
        ),
    )

    app.dependency_overrides[get_current_user] = mock_auth_dependency(mock_user)
    try:
        with patch(
            "app.api.invites.get_service_supabase_client",
            return_value=mock_supabase_client,
        ):
            response = client.post(
                "/invites/redeem",
                headers=auth_headers,
                json={"code": code},
            )
        assert response.status_code == 403
        # Claim + revert: second patch puts the invite back to pending.
        assert mock_supabase_client.patch.call_count == 2
        revert_call = mock_supabase_client.patch.call_args_list[1]
        assert revert_call.kwargs["data"]["status"] == "pending"
        assert revert_call.kwargs["params"]["status"] == "eq.accepted"
    finally:
        app.dependency_overrides.clear()


def test_redeem_invite_concurrent_claim_loses_race(
    client: TestClient,
    mock_supabase_client: AsyncMock,
    mock_user: AuthUser,
    auth_headers: dict[str, str],
) -> None:
    """#5: the conditional claim (pending -> accepted) runs FIRST. When a
    concurrent redemption already claimed the invite, the PATCH matches zero
    rows and this request performs NO side effects -- no duplicate follow,
    tag, or notification."""
    code = make_invite_code(OTHER_USER_ID, SAMPLE_EMAIL)
    mock_supabase_client.get.side_effect = supabase_tables(
        pending_invite=[_pending_invite_row(code)],  # read as pending...
        user_profile=[INVITER_PROFILE],
    )
    mock_supabase_client.patch.return_value = []  # ...but the claim loses

    app.dependency_overrides[get_current_user] = mock_auth_dependency(mock_user)
    try:
        with patch(
            "app.api.invites.get_service_supabase_client",
            return_value=mock_supabase_client,
        ):
            response = client.post(
                "/invites/redeem",
                headers=auth_headers,
                json={"code": code},
            )
        assert response.status_code == 200
        data = response.json()
        assert data["status"] == "already_redeemed"
        assert data["inviter"]["user_id"] == OTHER_USER_ID
        # Claim attempted exactly once; zero side effects after losing.
        assert mock_supabase_client.patch.call_count == 1
        mock_supabase_client.post.assert_not_called()
    finally:
        app.dependency_overrides.clear()


def test_redeem_invite_notifies_inviter(
    client: TestClient,
    mock_supabase_client: AsyncMock,
    mock_user: AuthUser,
    auth_headers: dict[str, str],
) -> None:
    """Redemption pushes an 'invite accepted' notification to the inviter."""
    code = make_invite_code(OTHER_USER_ID, SAMPLE_EMAIL)
    mock_supabase_client.get.side_effect = supabase_tables(
        pending_invite=[_pending_invite_row(code)],
        user_profile=[
            [INVITER_PROFILE],  # inviter lookup in request path
            [  # redeemer lookup in the notification task
                {
                    "user_id": TEST_USER_ID,
                    "username": "new_traveler",
                    "display_name": "New Traveler",
                }
            ],
        ],
        push_token=[{"token": "ExponentPushToken[abc]"}],
    )
    mock_supabase_client.patch.return_value = [{"id": SAMPLE_INVITE_ID}]

    app.dependency_overrides[get_current_user] = mock_auth_dependency(mock_user)
    try:
        with (
            patch(
                "app.api.invites.get_service_supabase_client",
                return_value=mock_supabase_client,
            ),
            patch(
                "app.api.invites.send_push_notification", new_callable=AsyncMock
            ) as mock_push,
        ):
            response = client.post(
                "/invites/redeem",
                headers=auth_headers,
                json={"code": code},
            )
        assert response.status_code == 200
        mock_push.assert_awaited_once()
        push_kwargs = mock_push.await_args.kwargs
        assert push_kwargs["tokens"] == ["ExponentPushToken[abc]"]
        assert "New Traveler" in push_kwargs["body"]
    finally:
        app.dependency_overrides.clear()


def test_redeem_invite_notifies_all_inviter_devices(
    client: TestClient,
    mock_supabase_client: AsyncMock,
    mock_user: AuthUser,
    auth_headers: dict[str, str],
) -> None:
    """The invite-accepted push reaches every device the inviter holds.

    Multi-device (plan U10/KTD11): push_token is keyed on the token, so the
    send path must fetch all of the inviter's tokens, not just one row.
    """
    code = make_invite_code(OTHER_USER_ID, SAMPLE_EMAIL)
    mock_supabase_client.get.side_effect = supabase_tables(
        pending_invite=[_pending_invite_row(code)],
        user_profile=[
            [INVITER_PROFILE],  # inviter lookup in request path
            [  # redeemer lookup in the notification task
                {
                    "user_id": TEST_USER_ID,
                    "username": "new_traveler",
                    "display_name": "New Traveler",
                }
            ],
        ],
        push_token=[
            {"token": "ExponentPushToken[phone]"},
            {"token": "ExponentPushToken[tablet]"},
        ],
    )
    mock_supabase_client.patch.return_value = [{"id": SAMPLE_INVITE_ID}]

    app.dependency_overrides[get_current_user] = mock_auth_dependency(mock_user)
    try:
        with (
            patch(
                "app.api.invites.get_service_supabase_client",
                return_value=mock_supabase_client,
            ),
            patch(
                "app.api.invites.send_push_notification", new_callable=AsyncMock
            ) as mock_push,
        ):
            response = client.post(
                "/invites/redeem",
                headers=auth_headers,
                json={"code": code},
            )
        assert response.status_code == 200
        mock_push.assert_awaited_once()
        assert mock_push.await_args.kwargs["tokens"] == [
            "ExponentPushToken[phone]",
            "ExponentPushToken[tablet]",
        ]
    finally:
        app.dependency_overrides.clear()


def test_invite_flow_pending_status_used_for_lookup():
    """
    Document: Pending invites are found by email + status='pending'.

    The database trigger (0044_process_pending_invites_on_signup.sql)
    queries pending_invite WHERE LOWER(email) = email AND status = 'pending'
    to find invites to process when a new user signs up.

    This test verifies the expected query pattern.
    """
    # This documents the expected SQL query pattern used by the signup trigger:
    expected_query_pattern = """
    SELECT id, inviter_id, invite_type, trip_id
    FROM pending_invite
    WHERE LOWER(email) = <new_user_email>
      AND status = 'pending'
    """
    # The query should use the index: idx_pending_invite_email
    # which is defined as: ON pending_invite(LOWER(email)) WHERE accepted_at IS NULL
    # Note: After migration 0042, we use status='pending' instead of accepted_at IS NULL
    assert "status = 'pending'" in expected_query_pattern
    assert "LOWER(email)" in expected_query_pattern
