"""Tests for entry limit enforcement in entry creation."""

from typing import Any
from unittest.mock import AsyncMock, patch

from fastapi.testclient import TestClient

from app.core.security import AuthUser, get_current_user
from app.main import app
from tests.conftest import (
    TEST_ENTRY_ID,
    TEST_TRIP_ID,
    TEST_USER_ID,
    mock_auth_dependency,
)


def _make_rpc_success_result(entry_data: dict[str, Any]) -> list[dict[str, Any]]:
    """Create a successful RPC result with entry data."""
    return [
        {
            "entry_row": entry_data,
            "place_row": None,
            "error_code": None,
            "current_count": None,
        }
    ]


def _make_rpc_limit_exceeded_result(current_count: int) -> list[dict[str, Any]]:
    """Create a limit exceeded RPC result."""
    return [
        {
            "entry_row": None,
            "place_row": None,
            "error_code": "LIMIT_EXCEEDED",
            "current_count": current_count,
        }
    ]


class TestEntryLimitEnforcement:
    """Tests for free tier entry limit enforcement in entry creation."""

    def test_premium_user_can_exceed_limit(
        self,
        client: TestClient,
        mock_supabase_client: AsyncMock,
        mock_user: AuthUser,
        auth_headers: dict[str, str],
        sample_entry: dict[str, Any],
        sample_premium_profile: dict[str, Any],
    ) -> None:
        """Premium users can add entries beyond the free limit."""
        # Profile returns premium status
        mock_supabase_client.get.return_value = [sample_premium_profile]
        # RPC creates entry successfully (no limit passed for premium users)
        mock_supabase_client.rpc.return_value = _make_rpc_success_result(sample_entry)

        app.dependency_overrides[get_current_user] = mock_auth_dependency(mock_user)
        try:
            with patch(
                "app.api.entries.get_supabase_client",
                return_value=mock_supabase_client,
            ):
                response = client.post(
                    f"/trips/{TEST_TRIP_ID}/entries",
                    headers=auth_headers,
                    json={"type": "place", "title": "New Place"},
                )
            # Should succeed - premium users are not limited
            assert response.status_code == 201

            # Verify RPC was called with no limit (None)
            rpc_call = mock_supabase_client.rpc.call_args
            assert rpc_call[0][0] == "atomic_create_entry_with_place"
            assert rpc_call[0][1]["p_entries_limit"] is None
        finally:
            app.dependency_overrides.clear()

    def test_trial_user_can_exceed_limit(
        self,
        client: TestClient,
        mock_supabase_client: AsyncMock,
        mock_user: AuthUser,
        auth_headers: dict[str, str],
        sample_entry: dict[str, Any],
        sample_trial_profile: dict[str, Any],
    ) -> None:
        """Trial users have the same access as premium."""
        mock_supabase_client.get.return_value = [sample_trial_profile]
        mock_supabase_client.rpc.return_value = _make_rpc_success_result(sample_entry)

        app.dependency_overrides[get_current_user] = mock_auth_dependency(mock_user)
        try:
            with patch(
                "app.api.entries.get_supabase_client",
                return_value=mock_supabase_client,
            ):
                response = client.post(
                    f"/trips/{TEST_TRIP_ID}/entries",
                    headers=auth_headers,
                    json={"type": "place", "title": "New Place"},
                )
            assert response.status_code == 201

            # Verify RPC was called with no limit (None)
            rpc_call = mock_supabase_client.rpc.call_args
            assert rpc_call[0][1]["p_entries_limit"] is None
        finally:
            app.dependency_overrides.clear()

    def test_free_user_allowed_under_limit(
        self,
        client: TestClient,
        mock_supabase_client: AsyncMock,
        mock_user: AuthUser,
        auth_headers: dict[str, str],
        sample_entry: dict[str, Any],
        sample_free_profile: dict[str, Any],
    ) -> None:
        """Free users can add entries when under the limit."""
        # Profile returns free status
        mock_supabase_client.get.return_value = [sample_free_profile]
        # RPC creates entry successfully (limit check passed in DB)
        mock_supabase_client.rpc.return_value = _make_rpc_success_result(sample_entry)

        app.dependency_overrides[get_current_user] = mock_auth_dependency(mock_user)
        try:
            with patch(
                "app.api.entries.get_supabase_client",
                return_value=mock_supabase_client,
            ):
                response = client.post(
                    f"/trips/{TEST_TRIP_ID}/entries",
                    headers=auth_headers,
                    json={"type": "place", "title": "New Place"},
                )
            assert response.status_code == 201

            # Verify RPC was called with the limit
            rpc_call = mock_supabase_client.rpc.call_args
            assert rpc_call[0][1]["p_entries_limit"] == 10
        finally:
            app.dependency_overrides.clear()

    def test_free_user_blocked_at_limit(
        self,
        client: TestClient,
        mock_supabase_client: AsyncMock,
        mock_user: AuthUser,
        auth_headers: dict[str, str],
        sample_free_profile: dict[str, Any],
    ) -> None:
        """Free users are blocked when at the entry limit."""
        # Profile returns free status
        mock_supabase_client.get.return_value = [sample_free_profile]
        # RPC returns limit exceeded (10 entries = limit)
        mock_supabase_client.rpc.return_value = _make_rpc_limit_exceeded_result(10)

        app.dependency_overrides[get_current_user] = mock_auth_dependency(mock_user)
        try:
            with patch(
                "app.api.entries.get_supabase_client",
                return_value=mock_supabase_client,
            ):
                response = client.post(
                    f"/trips/{TEST_TRIP_ID}/entries",
                    headers=auth_headers,
                    json={"type": "place", "title": "New Place"},
                )
            assert response.status_code == 403
            detail = response.json()["detail"]
            assert detail["code"] == "LIMIT_EXCEEDED"
            assert detail["limit"] == 10
            assert detail["current_count"] == 10
        finally:
            app.dependency_overrides.clear()

    def test_free_user_blocked_over_limit(
        self,
        client: TestClient,
        mock_supabase_client: AsyncMock,
        mock_user: AuthUser,
        auth_headers: dict[str, str],
        sample_free_profile: dict[str, Any],
    ) -> None:
        """Free users are blocked when over the limit (edge case)."""
        # Profile returns free status
        mock_supabase_client.get.return_value = [sample_free_profile]
        # RPC returns limit exceeded (12 entries > limit)
        mock_supabase_client.rpc.return_value = _make_rpc_limit_exceeded_result(12)

        app.dependency_overrides[get_current_user] = mock_auth_dependency(mock_user)
        try:
            with patch(
                "app.api.entries.get_supabase_client",
                return_value=mock_supabase_client,
            ):
                response = client.post(
                    f"/trips/{TEST_TRIP_ID}/entries",
                    headers=auth_headers,
                    json={"type": "place", "title": "New Place"},
                )
            assert response.status_code == 403
            detail = response.json()["detail"]
            assert detail["current_count"] == 12
        finally:
            app.dependency_overrides.clear()

    def test_null_status_treated_as_free(
        self,
        client: TestClient,
        mock_supabase_client: AsyncMock,
        mock_user: AuthUser,
        auth_headers: dict[str, str],
    ) -> None:
        """Null subscription_status defaults to free tier limits."""
        profile_with_null = {
            "id": TEST_USER_ID,
            "subscription_status": None,
        }
        mock_supabase_client.get.return_value = [profile_with_null]
        mock_supabase_client.rpc.return_value = _make_rpc_limit_exceeded_result(10)

        app.dependency_overrides[get_current_user] = mock_auth_dependency(mock_user)
        try:
            with patch(
                "app.api.entries.get_supabase_client",
                return_value=mock_supabase_client,
            ):
                response = client.post(
                    f"/trips/{TEST_TRIP_ID}/entries",
                    headers=auth_headers,
                    json={"type": "place", "title": "New Place"},
                )
            assert response.status_code == 403

            # Verify RPC was called with the limit (treated as free)
            rpc_call = mock_supabase_client.rpc.call_args
            assert rpc_call[0][1]["p_entries_limit"] == 10
        finally:
            app.dependency_overrides.clear()

    def test_missing_profile_treated_as_free(
        self,
        client: TestClient,
        mock_supabase_client: AsyncMock,
        mock_user: AuthUser,
        auth_headers: dict[str, str],
    ) -> None:
        """Missing profile defaults to free tier limits."""
        # No profile found
        mock_supabase_client.get.return_value = []
        mock_supabase_client.rpc.return_value = _make_rpc_limit_exceeded_result(10)

        app.dependency_overrides[get_current_user] = mock_auth_dependency(mock_user)
        try:
            with patch(
                "app.api.entries.get_supabase_client",
                return_value=mock_supabase_client,
            ):
                response = client.post(
                    f"/trips/{TEST_TRIP_ID}/entries",
                    headers=auth_headers,
                    json={"type": "place", "title": "New Place"},
                )
            assert response.status_code == 403

            # Verify RPC was called with the limit (treated as free)
            rpc_call = mock_supabase_client.rpc.call_args
            assert rpc_call[0][1]["p_entries_limit"] == 10
        finally:
            app.dependency_overrides.clear()

    def test_only_counts_non_deleted_entries(
        self,
        client: TestClient,
        mock_supabase_client: AsyncMock,
        mock_user: AuthUser,
        auth_headers: dict[str, str],
        sample_entry: dict[str, Any],
        sample_free_profile: dict[str, Any],
    ) -> None:
        """Soft-deleted entries don't count toward the limit.

        This is now enforced in the database function which filters
        with deleted_at IS NULL when counting entries.
        """
        mock_supabase_client.get.return_value = [sample_free_profile]
        # RPC succeeds because DB only counted 8 non-deleted entries
        mock_supabase_client.rpc.return_value = _make_rpc_success_result(sample_entry)

        app.dependency_overrides[get_current_user] = mock_auth_dependency(mock_user)
        try:
            with patch(
                "app.api.entries.get_supabase_client",
                return_value=mock_supabase_client,
            ):
                response = client.post(
                    f"/trips/{TEST_TRIP_ID}/entries",
                    headers=auth_headers,
                    json={"type": "place", "title": "New Place"},
                )
            # Should succeed - soft-deleted entries not counted in DB
            assert response.status_code == 201
        finally:
            app.dependency_overrides.clear()

    def test_limit_is_per_trip(
        self,
        client: TestClient,
        mock_supabase_client: AsyncMock,
        mock_user: AuthUser,
        auth_headers: dict[str, str],
        sample_entry: dict[str, Any],
        sample_free_profile: dict[str, Any],
    ) -> None:
        """Entry limit is enforced per trip, not globally.

        Creating an entry in Trip B should succeed even if Trip A has 10 entries.
        The limit parameter is passed to the RPC which checks the specific trip.
        """
        trip_b_id = "550e8400-e29b-41d4-a716-446655440099"

        mock_supabase_client.get.return_value = [sample_free_profile]
        # RPC succeeds because Trip B has 0 entries
        mock_supabase_client.rpc.return_value = _make_rpc_success_result(sample_entry)

        app.dependency_overrides[get_current_user] = mock_auth_dependency(mock_user)
        try:
            with patch(
                "app.api.entries.get_supabase_client",
                return_value=mock_supabase_client,
            ):
                response = client.post(
                    f"/trips/{trip_b_id}/entries",
                    headers=auth_headers,
                    json={"type": "place", "title": "New Place"},
                )
            assert response.status_code == 201

            # Verify RPC was called with the correct trip_id
            rpc_call = mock_supabase_client.rpc.call_args
            assert rpc_call[0][1]["p_trip_id"] == trip_b_id
        finally:
            app.dependency_overrides.clear()

    def test_error_response_format(
        self,
        client: TestClient,
        mock_supabase_client: AsyncMock,
        mock_user: AuthUser,
        auth_headers: dict[str, str],
        sample_free_profile: dict[str, Any],
    ) -> None:
        """Verify the error response includes all required fields."""
        mock_supabase_client.get.return_value = [sample_free_profile]
        mock_supabase_client.rpc.return_value = _make_rpc_limit_exceeded_result(10)

        app.dependency_overrides[get_current_user] = mock_auth_dependency(mock_user)
        try:
            with patch(
                "app.api.entries.get_supabase_client",
                return_value=mock_supabase_client,
            ):
                response = client.post(
                    f"/trips/{TEST_TRIP_ID}/entries",
                    headers=auth_headers,
                    json={"type": "place", "title": "New Place"},
                )
            assert response.status_code == 403
            detail = response.json()["detail"]

            # Verify all required fields are present
            assert "code" in detail
            assert "message" in detail
            assert "limit" in detail
            assert "current_count" in detail

            # Verify specific values
            assert detail["code"] == "LIMIT_EXCEEDED"
            assert "Upgrade to premium" in detail["message"]
            assert detail["limit"] == 10
        finally:
            app.dependency_overrides.clear()

    def test_trip_not_found_returns_404(
        self,
        client: TestClient,
        mock_supabase_client: AsyncMock,
        mock_user: AuthUser,
        auth_headers: dict[str, str],
        sample_free_profile: dict[str, Any],
    ) -> None:
        """Trip not found or user not authorized returns 404."""
        mock_supabase_client.get.return_value = [sample_free_profile]
        # RPC returns empty result (trip not found or not authorized)
        mock_supabase_client.rpc.return_value = []

        app.dependency_overrides[get_current_user] = mock_auth_dependency(mock_user)
        try:
            with patch(
                "app.api.entries.get_supabase_client",
                return_value=mock_supabase_client,
            ):
                response = client.post(
                    f"/trips/{TEST_TRIP_ID}/entries",
                    headers=auth_headers,
                    json={"type": "place", "title": "New Place"},
                )
            assert response.status_code == 404
            assert "not found or not authorized" in response.json()["detail"]
        finally:
            app.dependency_overrides.clear()

    def test_entry_with_place_created_atomically(
        self,
        client: TestClient,
        mock_supabase_client: AsyncMock,
        mock_user: AuthUser,
        auth_headers: dict[str, str],
        sample_entry: dict[str, Any],
        sample_place: dict[str, Any],
        sample_free_profile: dict[str, Any],
    ) -> None:
        """Entry and place are created atomically via RPC."""
        mock_supabase_client.get.return_value = [sample_free_profile]
        mock_supabase_client.rpc.return_value = [
            {
                "entry_row": sample_entry,
                "place_row": sample_place,
                "error_code": None,
                "current_count": None,
            }
        ]

        app.dependency_overrides[get_current_user] = mock_auth_dependency(mock_user)
        try:
            with patch(
                "app.api.entries.get_supabase_client",
                return_value=mock_supabase_client,
            ):
                response = client.post(
                    f"/trips/{TEST_TRIP_ID}/entries",
                    headers=auth_headers,
                    json={
                        "type": "place",
                        "title": "Central Park",
                        "place": {
                            "google_place_id": "ChIJN1t_tDeuEmsRUsoyG83frY4",
                            "place_name": "Central Park",
                            "lat": 40.7829,
                            "lng": -73.9654,
                        },
                    },
                )
            assert response.status_code == 201
            data = response.json()
            assert data["id"] == TEST_ENTRY_ID
            assert data["place"]["place_name"] == "Central Park"

            # Verify RPC was called with place data
            rpc_call = mock_supabase_client.rpc.call_args
            assert rpc_call[0][1]["p_place_data"]["place_name"] == "Central Park"
        finally:
            app.dependency_overrides.clear()
