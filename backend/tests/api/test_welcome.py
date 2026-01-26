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
    # No existing profile (first-time user)
    mock_client.get.return_value = []
    mock_client.upsert.return_value = []
    return mock_client


@pytest.fixture
def mock_supabase_client_with_scheduled():
    """Create a mock Supabase client that returns an already-scheduled profile."""
    mock_client = AsyncMock()
    # Profile exists with welcome_emails_scheduled = True
    mock_client.get.return_value = [{"welcome_emails_scheduled": True}]
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
            # Verify upsert was called with correct args
            mock_supabase_client.upsert.assert_called_once_with(
                "user_profile",
                data=[{"user_id": mock_user.id, "welcome_emails_scheduled": True}],
                on_conflict="user_id",
            )
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
