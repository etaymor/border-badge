"""Tests for SupabaseClient header configuration."""

from app.db.session import SupabaseClient, get_settings


class DummySettings:
    """Stub settings object for SupabaseClient tests."""

    def __init__(self) -> None:
        self.supabase_url = "https://example.supabase.co"
        self.supabase_anon_key = "anon-key"
        self.supabase_service_role_key = "service-role-key"
        self.supabase_jwt_secret = "jwt-secret"


def test_service_role_headers_use_service_key(monkeypatch) -> None:
    """Ensure admin operations send matching service role credentials."""
    dummy = DummySettings()
    monkeypatch.setattr("app.db.session.get_settings", lambda: dummy)

    client = SupabaseClient()

    assert client.headers["apikey"] == dummy.supabase_service_role_key
    assert (
        client.headers["Authorization"] == f"Bearer {dummy.supabase_service_role_key}"
    )


def test_user_scoped_headers_use_anon_key_and_user_token(monkeypatch) -> None:
    """Ensure RLS operations keep anon key + user JWT pairing."""
    dummy = DummySettings()
    monkeypatch.setattr("app.db.session.get_settings", lambda: dummy)
    user_token = "user-access-token"

    client = SupabaseClient(user_token=user_token)

    assert client.headers["apikey"] == dummy.supabase_anon_key
    assert client.headers["Authorization"] == f"Bearer {user_token}"
