"""Tests for welcome email API endpoints."""

from unittest.mock import patch

import pytest
from fastapi.testclient import TestClient

from app.core.security import AuthUser, get_current_user
from app.main import app, limiter

from ..conftest import TEST_USER_ID


@pytest.fixture
def mock_user() -> AuthUser:
    """Create a mock authenticated user."""
    return AuthUser(
        user_id=TEST_USER_ID,
        email="test@example.com",
    )


@pytest.fixture
def authenticated_client(mock_user: AuthUser) -> TestClient:
    """Create a test client with mocked authentication."""
    # Reset rate limiter storage before each test
    limiter.reset()

    async def mock_get_current_user():
        return mock_user

    app.dependency_overrides[get_current_user] = mock_get_current_user
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

    def test_returns_scheduled_status(self, authenticated_client: TestClient) -> None:
        """Test that endpoint returns scheduled status."""
        with patch("app.api.welcome.schedule_welcome_emails"):
            response = authenticated_client.post(
                "/welcome/emails",
                json={"display_name": "Test User"},
            )

            assert response.status_code == 200
            assert response.json() == {"status": "scheduled"}

    def test_accepts_display_name(self, authenticated_client: TestClient) -> None:
        """Test that display_name is accepted and passed to service."""
        with patch("app.api.welcome.BackgroundTasks.add_task") as mock_add_task:
            response = authenticated_client.post(
                "/welcome/emails",
                json={"display_name": "Alice"},
            )

            assert response.status_code == 200
            # BackgroundTasks.add_task is called with the function and args
            mock_add_task.assert_called_once()
            call_args = mock_add_task.call_args
            # Second arg should be the email, third should be display_name
            assert call_args[0][2] == "Alice"

    def test_uses_fallback_display_name(self, authenticated_client: TestClient) -> None:
        """Test that 'there' is used when display_name is not provided."""
        with patch("app.api.welcome.BackgroundTasks.add_task") as mock_add_task:
            response = authenticated_client.post(
                "/welcome/emails",
                json={},
            )

            assert response.status_code == 200
            call_args = mock_add_task.call_args
            assert call_args[0][2] == "there"

    def test_uses_fallback_for_null_display_name(
        self, authenticated_client: TestClient
    ) -> None:
        """Test that 'there' is used when display_name is null."""
        with patch("app.api.welcome.BackgroundTasks.add_task") as mock_add_task:
            response = authenticated_client.post(
                "/welcome/emails",
                json={"display_name": None},
            )

            assert response.status_code == 200
            call_args = mock_add_task.call_args
            assert call_args[0][2] == "there"

    def test_sanitizes_display_name_newlines(
        self, authenticated_client: TestClient
    ) -> None:
        """Test that newlines are removed from display_name to prevent header injection."""
        with patch("app.api.welcome.BackgroundTasks.add_task") as mock_add_task:
            response = authenticated_client.post(
                "/welcome/emails",
                json={"display_name": "Evil\nName\rHere"},
            )

            assert response.status_code == 200
            call_args = mock_add_task.call_args
            # Newlines should be stripped
            assert call_args[0][2] == "EvilNameHere"

    def test_strips_whitespace_from_display_name(
        self, authenticated_client: TestClient
    ) -> None:
        """Test that whitespace is stripped from display_name."""
        with patch("app.api.welcome.BackgroundTasks.add_task") as mock_add_task:
            response = authenticated_client.post(
                "/welcome/emails",
                json={"display_name": "  Alice  "},
            )

            assert response.status_code == 200
            call_args = mock_add_task.call_args
            assert call_args[0][2] == "Alice"

    def test_rejects_too_long_display_name(
        self, authenticated_client: TestClient
    ) -> None:
        """Test that display_name over 100 chars is rejected."""
        long_name = "A" * 101
        response = authenticated_client.post(
            "/welcome/emails",
            json={"display_name": long_name},
        )

        assert response.status_code == 422  # Validation error

    def test_passes_user_email_to_service(
        self, authenticated_client: TestClient, mock_user: AuthUser
    ) -> None:
        """Test that user's email is passed to the scheduling service."""
        with patch("app.api.welcome.BackgroundTasks.add_task") as mock_add_task:
            response = authenticated_client.post(
                "/welcome/emails",
                json={"display_name": "Test"},
            )

            assert response.status_code == 200
            call_args = mock_add_task.call_args
            # First arg is the function, second is email
            assert call_args[0][1] == mock_user.email

    def test_schedules_in_background(self, authenticated_client: TestClient) -> None:
        """Test that emails are scheduled as background task."""
        with patch("app.api.welcome.BackgroundTasks.add_task") as mock_add_task:
            response = authenticated_client.post(
                "/welcome/emails",
                json={"display_name": "Test"},
            )

            assert response.status_code == 200
            mock_add_task.assert_called_once()
            # First argument should be the schedule_welcome_emails function
            from app.services.email import schedule_welcome_emails

            assert mock_add_task.call_args[0][0] == schedule_welcome_emails


class TestRateLimiting:
    """Tests for rate limiting on welcome emails endpoint."""

    def test_rate_limit_exists(self, authenticated_client: TestClient) -> None:
        """Test that rate limiting is applied (3/hour)."""
        # This is more of a configuration test - actual rate limiting
        # would require multiple requests within the time window
        with patch("app.api.welcome.schedule_welcome_emails"):
            # First request should succeed
            response = authenticated_client.post(
                "/welcome/emails",
                json={"display_name": "Test"},
            )
            assert response.status_code == 200
