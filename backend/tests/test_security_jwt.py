"""Tests for JWT issuer handling and authentication behavior."""

import jwt
import pytest
from fastapi import HTTPException
from fastapi.security import HTTPAuthorizationCredentials

from app.core.security import AuthUser, get_current_user
from tests.conftest import generate_test_jwt


class DummySettingsWithUrl:
    """Stub settings with Supabase URL configured."""

    def __init__(self) -> None:
        self.supabase_url = "https://example.supabase.co"
        self.supabase_jwt_secret = "test-secret"


class DummySettingsMissingUrl:
    """Stub settings with JWT secret but missing Supabase URL."""

    def __init__(self) -> None:
        self.supabase_url = ""
        self.supabase_jwt_secret = "test-secret"


@pytest.mark.asyncio
async def test_get_current_user_uses_expected_issuer(monkeypatch) -> None:
    """Ensure issuer is always set when Supabase URL is configured."""
    settings = DummySettingsWithUrl()
    monkeypatch.setattr("app.core.security.get_settings", lambda: settings)

    captured: dict[str, str | None] = {}

    def fake_decode(token, key, algorithms, audience, issuer):  # type: ignore[no-untyped-def]
        captured["issuer"] = issuer
        return {"sub": "user-id-123", "email": "user@example.com"}

    monkeypatch.setattr("app.core.security.jwt.decode", fake_decode)

    credentials = HTTPAuthorizationCredentials(
        scheme="Bearer", credentials="dummy-token"
    )

    user = await get_current_user(credentials)

    assert isinstance(user, AuthUser)
    assert user.id == "user-id-123"
    assert captured["issuer"] == "https://example.supabase.co/auth/v1"


@pytest.mark.asyncio
async def test_get_current_user_errors_when_secret_without_url(monkeypatch) -> None:
    """
    If Supabase JWT secret is configured but Supabase URL is empty,
    authentication should fail as a server misconfiguration rather than
    silently disabling issuer validation.
    """
    settings = DummySettingsMissingUrl()
    monkeypatch.setattr("app.core.security.get_settings", lambda: settings)

    # Use a real decode function to ensure it is never reached.
    decode_spy = jwt.decode
    monkeypatch.setattr("app.core.security.jwt.decode", decode_spy)

    credentials = HTTPAuthorizationCredentials(
        scheme="Bearer", credentials="dummy-token"
    )

    with pytest.raises(HTTPException) as exc_info:
        await get_current_user(credentials)

    exc = exc_info.value
    assert exc.status_code == 500
    assert "Authentication is misconfigured" in exc.detail


# ============================================================================
# Real JWT Token Flow Integration Tests
# ============================================================================


class DummySettingsForIntegration:
    """Settings for integration tests with full JWT validation."""

    def __init__(self, secret: str, supabase_url: str) -> None:
        self.supabase_jwt_secret = secret
        self.supabase_url = supabase_url


class TestRealJWTTokenFlow:
    """Integration tests for JWT token validation with real tokens.

    These tests generate actual JWT tokens and run them through the real
    get_current_user function, testing the full validation pipeline.
    """

    @pytest.mark.asyncio
    async def test_valid_jwt_token_authenticates_successfully(
        self, jwt_test_config: dict[str, str], monkeypatch
    ) -> None:
        """Test that a properly signed JWT token passes authentication."""
        # Configure settings to use our test secret and issuer
        settings = DummySettingsForIntegration(
            secret=jwt_test_config["secret"],
            supabase_url="https://test.supabase.co",
        )
        monkeypatch.setattr("app.core.security.get_settings", lambda: settings)

        # Generate a valid token
        token = generate_test_jwt(jwt_test_config)
        credentials = HTTPAuthorizationCredentials(scheme="Bearer", credentials=token)

        # Call the real get_current_user function
        user = await get_current_user(credentials)

        assert isinstance(user, AuthUser)
        assert user.id == jwt_test_config["user_id"]
        assert user.email == jwt_test_config["email"]

    @pytest.mark.asyncio
    async def test_expired_jwt_token_returns_401(
        self, jwt_test_config: dict[str, str], monkeypatch
    ) -> None:
        """Test that an expired JWT token is rejected with 401."""
        settings = DummySettingsForIntegration(
            secret=jwt_test_config["secret"],
            supabase_url="https://test.supabase.co",
        )
        monkeypatch.setattr("app.core.security.get_settings", lambda: settings)

        # Generate an expired token (exp in the past)
        token = generate_test_jwt(jwt_test_config, exp_offset_seconds=-3600)
        credentials = HTTPAuthorizationCredentials(scheme="Bearer", credentials=token)

        with pytest.raises(HTTPException) as exc_info:
            await get_current_user(credentials)

        assert exc_info.value.status_code == 401
        assert "expired" in exc_info.value.detail.lower()

    @pytest.mark.asyncio
    async def test_wrong_audience_jwt_token_returns_401(
        self, jwt_test_config: dict[str, str], monkeypatch
    ) -> None:
        """Test that JWT with wrong audience is rejected with 401."""
        settings = DummySettingsForIntegration(
            secret=jwt_test_config["secret"],
            supabase_url="https://test.supabase.co",
        )
        monkeypatch.setattr("app.core.security.get_settings", lambda: settings)

        # Generate token with wrong audience
        token = generate_test_jwt(jwt_test_config, aud="wrong-audience")
        credentials = HTTPAuthorizationCredentials(scheme="Bearer", credentials=token)

        with pytest.raises(HTTPException) as exc_info:
            await get_current_user(credentials)

        assert exc_info.value.status_code == 401
        assert "invalid" in exc_info.value.detail.lower()

    @pytest.mark.asyncio
    async def test_wrong_issuer_jwt_token_returns_401(
        self, jwt_test_config: dict[str, str], monkeypatch
    ) -> None:
        """Test that JWT with wrong issuer is rejected with 401."""
        settings = DummySettingsForIntegration(
            secret=jwt_test_config["secret"],
            supabase_url="https://test.supabase.co",
        )
        monkeypatch.setattr("app.core.security.get_settings", lambda: settings)

        # Generate token with wrong issuer
        token = generate_test_jwt(
            jwt_test_config, iss="https://wrong.issuer.com/auth/v1"
        )
        credentials = HTTPAuthorizationCredentials(scheme="Bearer", credentials=token)

        with pytest.raises(HTTPException) as exc_info:
            await get_current_user(credentials)

        assert exc_info.value.status_code == 401
        assert "invalid" in exc_info.value.detail.lower()

    @pytest.mark.asyncio
    async def test_missing_sub_claim_returns_401(
        self, jwt_test_config: dict[str, str], monkeypatch
    ) -> None:
        """Test that JWT without 'sub' claim is rejected with 401."""
        settings = DummySettingsForIntegration(
            secret=jwt_test_config["secret"],
            supabase_url="https://test.supabase.co",
        )
        monkeypatch.setattr("app.core.security.get_settings", lambda: settings)

        # Generate token without sub claim (set to None removes it after update)
        token = generate_test_jwt(jwt_test_config, sub=None)
        credentials = HTTPAuthorizationCredentials(scheme="Bearer", credentials=token)

        with pytest.raises(HTTPException) as exc_info:
            await get_current_user(credentials)

        assert exc_info.value.status_code == 401
        assert "missing user id" in exc_info.value.detail.lower()
