"""Tests for welcome email API endpoints."""

from unittest.mock import AsyncMock, MagicMock, patch

import pytest
from fastapi.testclient import TestClient

from app.core.security import AuthUser, get_current_user
from app.main import app, limiter

from ..conftest import TEST_USER_ID


def _mock_email_result(
    email_ids: list[str], total_attempted: int = 5, skipped: bool = False
):
    """Create a mock WelcomeEmailResult for testing."""
    mock = MagicMock()
    mock.email_ids = email_ids
    mock.total_attempted = total_attempted
    mock.skipped = skipped
    mock.success_count = len(email_ids)
    mock.failed_count = total_attempted - len(email_ids)
    mock.all_failed = total_attempted > 0 and len(email_ids) == 0
    return mock


@pytest.fixture
def mock_user() -> AuthUser:
    """Create a mock authenticated user."""
    return AuthUser(
        user_id=TEST_USER_ID,
        email="test@example.com",
    )


@pytest.fixture
def mock_supabase_client():
    """Create a mock Supabase client that returns no existing profile."""
    mock_client = AsyncMock()

    # get() is called twice: first for user_profile, then for scheduled_email
    async def mock_get(table, params=None):
        if table == "user_profile":
            return []  # No existing profile (first-time user)
        if table == "scheduled_email":
            return []  # No existing scheduled emails
        return []

    mock_client.get.side_effect = mock_get
    mock_client.patch.return_value = []
    return mock_client


@pytest.fixture
def mock_supabase_client_with_scheduled():
    """Create a mock Supabase client that returns an already-scheduled profile."""
    mock_client = AsyncMock()

    # Profile flag is set, so the endpoint short-circuits before scheduled_email check
    async def mock_get(table, params=None):
        if table == "user_profile":
            return [{"welcome_emails_scheduled": True}]
        return []

    mock_client.get.side_effect = mock_get
    return mock_client


@pytest.fixture
def authenticated_client(mock_user: AuthUser, mock_supabase_client) -> TestClient:
    """Create a test client with mocked authentication."""
    # Reset rate limiter storage before each test
    limiter.reset()

    async def mock_get_current_user():
        return mock_user

    app.dependency_overrides[get_current_user] = mock_get_current_user

    with patch(
        "app.api.welcome.get_supabase_client", return_value=mock_supabase_client
    ):
        client = TestClient(app)
        yield client
        app.dependency_overrides.clear()


class TestTriggerWelcomeEmails:
    """Tests for POST /welcome/emails endpoint."""

    def test_requires_authentication(self) -> None:
        """Test that endpoint requires authentication."""
        client = TestClient(app)
        response = client.post("/welcome/emails", json={"display_name": "Test"})

        assert response.status_code == 403

    def test_returns_scheduled_status(
        self, mock_user: AuthUser, mock_supabase_client
    ) -> None:
        """Test that endpoint returns scheduled status."""
        limiter.reset()

        async def mock_get_current_user():
            return mock_user

        app.dependency_overrides[get_current_user] = mock_get_current_user

        with (
            patch(
                "app.api.welcome.get_supabase_client",
                return_value=mock_supabase_client,
            ),
            patch(
                "app.api.welcome.schedule_welcome_emails",
                new_callable=AsyncMock,
                return_value=_mock_email_result(["id1", "id2"]),
            ),
        ):
            client = TestClient(app)
            response = client.post(
                "/welcome/emails",
                json={"display_name": "Test User"},
            )

            assert response.status_code == 200
            assert response.json()["status"] == "scheduled"
            assert response.json()["email_count"] == 2
            app.dependency_overrides.clear()

    def test_returns_already_scheduled_for_duplicate(
        self, mock_user: AuthUser, mock_supabase_client_with_scheduled
    ) -> None:
        """Test that endpoint returns already_scheduled for duplicate calls."""
        limiter.reset()

        async def mock_get_current_user():
            return mock_user

        app.dependency_overrides[get_current_user] = mock_get_current_user

        with patch(
            "app.api.welcome.get_supabase_client",
            return_value=mock_supabase_client_with_scheduled,
        ):
            client = TestClient(app)
            response = client.post(
                "/welcome/emails",
                json={"display_name": "Test User"},
            )

            assert response.status_code == 200
            assert response.json()["status"] == "already_scheduled"
            assert response.json()["email_count"] == 0
            app.dependency_overrides.clear()

    def test_accepts_display_name(
        self, mock_user: AuthUser, mock_supabase_client
    ) -> None:
        """Test that display_name is accepted and passed to service."""
        limiter.reset()

        async def mock_get_current_user():
            return mock_user

        app.dependency_overrides[get_current_user] = mock_get_current_user

        with (
            patch(
                "app.api.welcome.get_supabase_client",
                return_value=mock_supabase_client,
            ),
            patch(
                "app.api.welcome.schedule_welcome_emails",
                new_callable=AsyncMock,
                return_value=_mock_email_result(["id1"]),
            ) as mock_schedule,
        ):
            client = TestClient(app)
            response = client.post(
                "/welcome/emails",
                json={"display_name": "Alice"},
            )

            assert response.status_code == 200
            mock_schedule.assert_called_once()
            # Check display_name keyword argument
            assert mock_schedule.call_args.kwargs["display_name"] == "Alice"
            app.dependency_overrides.clear()

    def test_uses_fallback_display_name(
        self, mock_user: AuthUser, mock_supabase_client
    ) -> None:
        """Test that 'there' is used when display_name is not provided."""
        limiter.reset()

        async def mock_get_current_user():
            return mock_user

        app.dependency_overrides[get_current_user] = mock_get_current_user

        with (
            patch(
                "app.api.welcome.get_supabase_client",
                return_value=mock_supabase_client,
            ),
            patch(
                "app.api.welcome.schedule_welcome_emails",
                new_callable=AsyncMock,
                return_value=_mock_email_result(["id1"]),
            ) as mock_schedule,
        ):
            client = TestClient(app)
            response = client.post(
                "/welcome/emails",
                json={},
            )

            assert response.status_code == 200
            assert mock_schedule.call_args.kwargs["display_name"] == "there"
            app.dependency_overrides.clear()

    def test_uses_fallback_for_null_display_name(
        self, mock_user: AuthUser, mock_supabase_client
    ) -> None:
        """Test that 'there' is used when display_name is null."""
        limiter.reset()

        async def mock_get_current_user():
            return mock_user

        app.dependency_overrides[get_current_user] = mock_get_current_user

        with (
            patch(
                "app.api.welcome.get_supabase_client",
                return_value=mock_supabase_client,
            ),
            patch(
                "app.api.welcome.schedule_welcome_emails",
                new_callable=AsyncMock,
                return_value=_mock_email_result(["id1"]),
            ) as mock_schedule,
        ):
            client = TestClient(app)
            response = client.post(
                "/welcome/emails",
                json={"display_name": None},
            )

            assert response.status_code == 200
            assert mock_schedule.call_args.kwargs["display_name"] == "there"
            app.dependency_overrides.clear()

    def test_sanitizes_display_name_newlines(
        self, mock_user: AuthUser, mock_supabase_client
    ) -> None:
        """Test that newlines are removed from display_name."""
        limiter.reset()

        async def mock_get_current_user():
            return mock_user

        app.dependency_overrides[get_current_user] = mock_get_current_user

        with (
            patch(
                "app.api.welcome.get_supabase_client",
                return_value=mock_supabase_client,
            ),
            patch(
                "app.api.welcome.schedule_welcome_emails",
                new_callable=AsyncMock,
                return_value=_mock_email_result(["id1"]),
            ) as mock_schedule,
        ):
            client = TestClient(app)
            response = client.post(
                "/welcome/emails",
                json={"display_name": "Evil\nName\rHere"},
            )

            assert response.status_code == 200
            # Newlines should be stripped
            assert mock_schedule.call_args.kwargs["display_name"] == "EvilNameHere"
            app.dependency_overrides.clear()

    def test_strips_whitespace_from_display_name(
        self, mock_user: AuthUser, mock_supabase_client
    ) -> None:
        """Test that whitespace is stripped from display_name."""
        limiter.reset()

        async def mock_get_current_user():
            return mock_user

        app.dependency_overrides[get_current_user] = mock_get_current_user

        with (
            patch(
                "app.api.welcome.get_supabase_client",
                return_value=mock_supabase_client,
            ),
            patch(
                "app.api.welcome.schedule_welcome_emails",
                new_callable=AsyncMock,
                return_value=_mock_email_result(["id1"]),
            ) as mock_schedule,
        ):
            client = TestClient(app)
            response = client.post(
                "/welcome/emails",
                json={"display_name": "  Alice  "},
            )

            assert response.status_code == 200
            assert mock_schedule.call_args.kwargs["display_name"] == "Alice"
            app.dependency_overrides.clear()

    def test_rejects_too_long_display_name(
        self, mock_user: AuthUser, mock_supabase_client
    ) -> None:
        """Test that display_name over 100 chars is rejected."""
        limiter.reset()

        async def mock_get_current_user():
            return mock_user

        app.dependency_overrides[get_current_user] = mock_get_current_user

        with patch(
            "app.api.welcome.get_supabase_client",
            return_value=mock_supabase_client,
        ):
            client = TestClient(app)
            long_name = "A" * 101
            response = client.post(
                "/welcome/emails",
                json={"display_name": long_name},
            )

            assert response.status_code == 422  # Validation error
            app.dependency_overrides.clear()

    def test_passes_user_email_to_service(
        self, mock_user: AuthUser, mock_supabase_client
    ) -> None:
        """Test that user's email is passed to the scheduling service."""
        limiter.reset()

        async def mock_get_current_user():
            return mock_user

        app.dependency_overrides[get_current_user] = mock_get_current_user

        with (
            patch(
                "app.api.welcome.get_supabase_client",
                return_value=mock_supabase_client,
            ),
            patch(
                "app.api.welcome.schedule_welcome_emails",
                new_callable=AsyncMock,
                return_value=_mock_email_result(["id1"]),
            ) as mock_schedule,
        ):
            client = TestClient(app)
            response = client.post(
                "/welcome/emails",
                json={"display_name": "Test"},
            )

            assert response.status_code == 200
            # Check email keyword argument
            assert mock_schedule.call_args.kwargs["email"] == mock_user.email
            app.dependency_overrides.clear()

    def test_marks_profile_as_scheduled(
        self, mock_user: AuthUser, mock_supabase_client
    ) -> None:
        """Test that profile is marked with welcome_emails_scheduled flag."""
        limiter.reset()

        async def mock_get_current_user():
            return mock_user

        app.dependency_overrides[get_current_user] = mock_get_current_user

        with (
            patch(
                "app.api.welcome.get_supabase_client",
                return_value=mock_supabase_client,
            ),
            patch(
                "app.api.welcome.schedule_welcome_emails",
                new_callable=AsyncMock,
                return_value=_mock_email_result(["id1", "id2"]),
            ),
        ):
            client = TestClient(app)
            response = client.post(
                "/welcome/emails",
                json={"display_name": "Test"},
            )

            assert response.status_code == 200
            # Verify patch was called with correct args (not upsert)
            mock_supabase_client.patch.assert_called_once_with(
                "user_profile",
                {"welcome_emails_scheduled": True},
                {"user_id": f"eq.{mock_user.id}"},
            )
            app.dependency_overrides.clear()

    def test_succeeds_when_profile_missing_during_race_condition(
        self, mock_user: AuthUser
    ) -> None:
        """Test that endpoint succeeds even when user_profile doesn't exist yet.

        During signup, there's a race condition where the DB trigger hasn't
        created the user_profile row yet. The patch (UPDATE) call returns an
        empty list when no row exists, and the endpoint gracefully continues.
        """
        limiter.reset()

        async def mock_get_current_user():
            return mock_user

        app.dependency_overrides[get_current_user] = mock_get_current_user

        mock_client = AsyncMock()

        # No existing profile, no scheduled emails (first-time call)
        async def mock_get(table, params=None):
            return []

        mock_client.get.side_effect = mock_get
        # patch returns empty list when no row matches (no error)
        mock_client.patch.return_value = []

        with (
            patch(
                "app.api.welcome.get_supabase_client",
                return_value=mock_client,
            ),
            patch(
                "app.api.welcome.schedule_welcome_emails",
                new_callable=AsyncMock,
                return_value=_mock_email_result(["id1", "id2"]),
            ),
        ):
            client = TestClient(app)
            response = client.post(
                "/welcome/emails",
                json={"display_name": "Test User"},
            )

            # Endpoint returns 200 because patch (UPDATE)
            # gracefully handles missing profile rows
            assert response.status_code == 200
            assert response.json()["status"] == "scheduled"
            # Verify patch was called (not upsert)
            mock_client.patch.assert_called_once()
            mock_client.upsert.assert_not_called()
            app.dependency_overrides.clear()

    def test_no_duplicate_emails_when_profile_missing_on_retry(
        self, mock_user: AuthUser
    ) -> None:
        """Test that retry is blocked by scheduled_email table when profile flag unset.

        When user_profile doesn't exist during signup, patch() updates zero
        rows and the welcome_emails_scheduled flag is never set. The secondary
        idempotency check on the scheduled_email table prevents duplicates.
        """
        limiter.reset()

        async def mock_get_current_user():
            return mock_user

        app.dependency_overrides[get_current_user] = mock_get_current_user

        # Track call count to vary get() responses between first and second request
        get_call_count = 0

        async def mock_get(table, params=None):
            nonlocal get_call_count
            get_call_count += 1
            if table == "user_profile":
                # No profile exists (race condition)
                return []
            if table == "scheduled_email":
                # First request: no records yet. Second request: records exist.
                if get_call_count <= 2:
                    return []
                return [{"id": "existing-record"}]
            return []

        mock_client = AsyncMock()
        mock_client.get.side_effect = mock_get
        # patch updates zero rows — flag never set
        mock_client.patch.return_value = []

        with (
            patch(
                "app.api.welcome.get_supabase_client",
                return_value=mock_client,
            ),
            patch(
                "app.api.welcome.schedule_welcome_emails",
                new_callable=AsyncMock,
                return_value=_mock_email_result(["id1", "id2"]),
            ) as schedule_fn,
        ):
            test_client = TestClient(app)

            # First call — schedules emails
            resp1 = test_client.post("/welcome/emails", json={"display_name": "Test"})
            assert resp1.status_code == 200
            assert resp1.json()["status"] == "scheduled"

            # Second call — blocked by scheduled_email check
            resp2 = test_client.post("/welcome/emails", json={"display_name": "Test"})
            assert resp2.status_code == 200
            assert resp2.json()["status"] == "already_scheduled"

            # schedule_welcome_emails should only be called once
            assert schedule_fn.call_count == 1

        app.dependency_overrides.clear()


class TestRateLimiting:
    """Tests for rate limiting on welcome emails endpoint."""

    def test_rate_limit_exists(self, mock_user: AuthUser, mock_supabase_client) -> None:
        """Test that rate limiting is applied (3/hour)."""
        limiter.reset()

        async def mock_get_current_user():
            return mock_user

        app.dependency_overrides[get_current_user] = mock_get_current_user

        with (
            patch(
                "app.api.welcome.get_supabase_client",
                return_value=mock_supabase_client,
            ),
            patch(
                "app.api.welcome.schedule_welcome_emails",
                new_callable=AsyncMock,
                return_value=_mock_email_result(["id1"]),
            ),
        ):
            client = TestClient(app)
            # First request should succeed
            response = client.post(
                "/welcome/emails",
                json={"display_name": "Test"},
            )
            assert response.status_code == 200
            app.dependency_overrides.clear()
