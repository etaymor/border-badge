"""Tests for JWT issuer handling and authentication behavior."""

import jwt
import pytest
from fastapi import HTTPException
from fastapi.security import HTTPAuthorizationCredentials

from app.core.security import AuthUser, get_current_user


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
