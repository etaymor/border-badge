"""Tests for choosing Supabase API keys and request headers."""

from unittest.mock import MagicMock

from app.core.supabase_keys import admin_api_key, admin_headers, client_api_key

LEGACY_SERVICE = "eyJhbGciOiJIUzI1NiJ9.legacy-service-role.sig"
LEGACY_ANON = "eyJhbGciOiJIUzI1NiJ9.legacy-anon.sig"
SECRET = "sb_secret_abc123"
PUBLISHABLE = "sb_publishable_xyz789"


class _Settings:
    def __init__(self, **overrides: str) -> None:
        self.supabase_anon_key = LEGACY_ANON
        self.supabase_service_role_key = LEGACY_SERVICE
        self.supabase_publishable_key = ""
        self.supabase_secret_key = ""
        for name, value in overrides.items():
            setattr(self, name, value)


def test_new_keys_take_precedence_over_legacy() -> None:
    settings = _Settings(
        supabase_secret_key=SECRET, supabase_publishable_key=PUBLISHABLE
    )

    assert admin_api_key(settings) == SECRET
    assert client_api_key(settings) == PUBLISHABLE


def test_legacy_keys_used_when_new_keys_unset() -> None:
    settings = _Settings()

    assert admin_api_key(settings) == LEGACY_SERVICE
    assert client_api_key(settings) == LEGACY_ANON


def test_secret_key_sent_only_on_apikey_header() -> None:
    """sb_secret_ keys are not JWTs; the gateway rejects them as a Bearer."""
    headers = admin_headers(_Settings(supabase_secret_key=SECRET))

    assert headers == {"apikey": SECRET}


def test_legacy_service_role_keeps_bearer_header() -> None:
    headers = admin_headers(_Settings())

    assert headers == {
        "apikey": LEGACY_SERVICE,
        "Authorization": f"Bearer {LEGACY_SERVICE}",
    }


def test_settings_without_new_fields_fall_back_to_legacy() -> None:
    """MagicMock settings in older tests auto-create attributes as mocks."""
    settings = MagicMock()
    settings.supabase_service_role_key = LEGACY_SERVICE
    settings.supabase_anon_key = LEGACY_ANON

    assert admin_api_key(settings) == LEGACY_SERVICE
    assert client_api_key(settings) == LEGACY_ANON
