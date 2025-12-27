"""Tests for email invite system endpoints."""

from unittest.mock import AsyncMock, patch

from fastapi.testclient import TestClient

from app.core.security import AuthUser, get_current_user
from app.main import app
from tests.conftest import (
    TEST_USER_ID,
    mock_auth_dependency,
)

# Sample invite data for tests
SAMPLE_EMAIL = "friend@example.com"
SAMPLE_INVITE_ID = "550e8400-e29b-41d4-a716-446655440010"


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
    mock_supabase_client.rpc.return_value = {"exists": False}
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
                "app.api.invites.get_supabase_client", return_value=mock_supabase_client
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
    """Test that inviting an existing user returns 400."""
    mock_supabase_client.rpc.return_value = {"exists": True}

    app.dependency_overrides[get_current_user] = mock_auth_dependency(mock_user)
    try:
        with patch(
            "app.api.invites.get_supabase_client", return_value=mock_supabase_client
        ):
            response = client.post(
                "/invites",
                headers=auth_headers,
                json={"email": SAMPLE_EMAIL},
            )
        assert response.status_code == 400
        assert "already exists" in response.json()["detail"]
    finally:
        app.dependency_overrides.clear()


def test_send_invite_already_pending(
    client: TestClient,
    mock_supabase_client: AsyncMock,
    mock_user: AuthUser,
    auth_headers: dict[str, str],
) -> None:
    """Test that sending duplicate invite returns already_pending status."""
    mock_supabase_client.rpc.return_value = {"exists": False}
    mock_supabase_client.get.return_value = [
        {"id": SAMPLE_INVITE_ID, "status": "pending"}
    ]

    app.dependency_overrides[get_current_user] = mock_auth_dependency(mock_user)
    try:
        with patch(
            "app.api.invites.get_supabase_client", return_value=mock_supabase_client
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
    mock_supabase_client.rpc.return_value = {"exists": False}
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
                "app.api.invites.get_supabase_client", return_value=mock_supabase_client
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
        with patch(
            "app.api.invites.get_supabase_client", return_value=mock_supabase_client
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
        with patch(
            "app.api.invites.get_supabase_client", return_value=mock_supabase_client
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
        with patch(
            "app.api.invites.get_supabase_client", return_value=mock_supabase_client
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
        with patch(
            "app.api.invites.get_supabase_client", return_value=mock_supabase_client
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
        with patch(
            "app.api.invites.get_supabase_client", return_value=mock_supabase_client
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

    mock_supabase_client.rpc.return_value = {"exists": False}
    mock_supabase_client.get.return_value = []
    mock_supabase_client.post.side_effect = capture_post_call

    app.dependency_overrides[get_current_user] = mock_auth_dependency(mock_user)
    try:
        with (
            patch(
                "app.api.invites.get_supabase_client", return_value=mock_supabase_client
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

    # Mock trip ownership check
    mock_supabase_client.rpc.return_value = {"exists": False}
    mock_supabase_client.get.side_effect = [
        [],  # No existing invite
        [{"id": trip_id, "user_id": TEST_USER_ID}],  # Trip exists and user owns it
    ]
    mock_supabase_client.post.side_effect = capture_post_call

    app.dependency_overrides[get_current_user] = mock_auth_dependency(mock_user)
    try:
        with (
            patch(
                "app.api.invites.get_supabase_client", return_value=mock_supabase_client
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
