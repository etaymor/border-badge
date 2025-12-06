"""Tests for SupabaseClient header configuration."""

import pytest

from app.db.session import SupabaseClient


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


class _DummyResponse:
    """Simple stub response for RPC tests."""

    def __init__(self, payload: object) -> None:
        self._payload = payload

    def raise_for_status(self) -> None:
        return None

    def json(self) -> object:
        return self._payload


class _DummyRPCClient:
    """Stub HTTP client capturing RPC requests."""

    def __init__(self, response: _DummyResponse) -> None:
        self.response = response
        self.calls: list[dict[str, object]] = []

    async def post(self, url: str, headers: dict[str, str], json: dict[str, object]):
        self.calls.append({"url": url, "headers": headers, "json": json})
        return self.response


@pytest.mark.asyncio
async def test_rpc_invokes_function_with_payload(monkeypatch) -> None:
    """Ensure RPC helper posts to function endpoint with provided params."""
    dummy_settings = DummySettings()
    monkeypatch.setattr("app.db.session.get_settings", lambda: dummy_settings)

    response = _DummyResponse("slug-123")
    dummy_client = _DummyRPCClient(response)
    monkeypatch.setattr("app.db.session.get_http_client", lambda: dummy_client)

    client = SupabaseClient()

    result = await client.rpc("generate_trip_share_slug", {"trip_name": "Trip"})

    assert result == "slug-123"
    assert dummy_client.calls[0]["url"] == (
        f"{dummy_settings.supabase_url}/rest/v1/rpc/generate_trip_share_slug"
    )
    assert dummy_client.calls[0]["headers"]["Authorization"] == (
        f"Bearer {dummy_settings.supabase_service_role_key}"
    )
    assert dummy_client.calls[0]["json"] == {"trip_name": "Trip"}
