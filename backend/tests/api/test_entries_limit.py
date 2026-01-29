"""Tests for entry limit enforcement in entry creation."""

from typing import Any
from unittest.mock import AsyncMock, patch

from fastapi.testclient import TestClient

from app.core.security import AuthUser, get_current_user
from app.main import app
from tests.conftest import TEST_TRIP_ID, TEST_USER_ID, mock_auth_dependency


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
        # Profile with premium status
        mock_supabase_client.get.return_value = [sample_premium_profile]
        mock_supabase_client.post.return_value = [sample_entry]

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
        mock_supabase_client.post.return_value = [sample_entry]

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
        # First call: profile, Second call: existing entries (5 < 10)
        mock_supabase_client.get.side_effect = [
            [sample_free_profile],
            [{"id": f"entry-{i}"} for i in range(5)],
        ]
        mock_supabase_client.post.return_value = [sample_entry]

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
        # First call: profile, Second call: existing entries (10 = limit)
        mock_supabase_client.get.side_effect = [
            [sample_free_profile],
            [{"id": f"entry-{i}"} for i in range(10)],
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
        # 12 existing entries - already over limit
        mock_supabase_client.get.side_effect = [
            [sample_free_profile],
            [{"id": f"entry-{i}"} for i in range(12)],
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
        mock_supabase_client.get.side_effect = [
            [profile_with_null],
            [{"id": f"entry-{i}"} for i in range(10)],
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
                    json={"type": "place", "title": "New Place"},
                )
            assert response.status_code == 403
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
        mock_supabase_client.get.side_effect = [
            [],  # No profile found
            [{"id": f"entry-{i}"} for i in range(10)],
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
                    json={"type": "place", "title": "New Place"},
                )
            assert response.status_code == 403
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

        The query filters with deleted_at=is.null, so only 8 non-deleted
        entries should be counted, allowing the new entry.
        """
        # Only 8 non-deleted entries returned from DB query
        mock_supabase_client.get.side_effect = [
            [sample_free_profile],
            [{"id": f"entry-{i}"} for i in range(8)],
        ]
        mock_supabase_client.post.return_value = [sample_entry]

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
            # 8 < 10, should succeed
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
        """
        trip_b_id = "550e8400-e29b-41d4-a716-446655440099"

        # Trip B has 0 entries
        mock_supabase_client.get.side_effect = [
            [sample_free_profile],
            [],  # No entries in Trip B
        ]
        mock_supabase_client.post.return_value = [sample_entry]

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
        mock_supabase_client.get.side_effect = [
            [sample_free_profile],
            [{"id": f"entry-{i}"} for i in range(10)],
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
