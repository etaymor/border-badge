"""Tests for SupabaseClient header configuration."""

import json

import httpx
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


class _DummyRPCClient:
    """Stub HTTP client capturing RPC requests."""

    def __init__(self, response: httpx.Response) -> None:
        self.response = response
        self.calls: list[dict[str, object]] = []

    async def post(self, url: str, headers: dict[str, str], json: dict[str, object]):
        self.calls.append({"url": url, "headers": headers, "json": json})
        return self.response


def _rpc_response(
    status_code: int, *, content: bytes | None = None, payload: object = None
) -> httpx.Response:
    """Build a PostgREST-like response that httpx will accept for raise_for_status."""
    request = httpx.Request("POST", "https://example.supabase.co/rest/v1/rpc/fn")
    if content is not None:
        return httpx.Response(status_code, content=content, request=request)
    return httpx.Response(status_code, json=payload, request=request)


@pytest.mark.asyncio
async def test_rpc_invokes_function_with_payload(monkeypatch) -> None:
    """Ensure RPC helper posts to function endpoint with provided params."""
    dummy_settings = DummySettings()
    monkeypatch.setattr("app.db.session.get_settings", lambda: dummy_settings)

    dummy_client = _DummyRPCClient(_rpc_response(200, payload="slug-123"))
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


@pytest.mark.asyncio
async def test_rpc_treats_empty_2xx_body_as_success(monkeypatch) -> None:
    """PostgREST RETURNS VOID RPCs reply 2xx with an empty body.

    increment_quiz_funnel is one of these. Parsing the body as JSON raises
    ``JSONDecodeError: Expecting value: line 1 column 1 (char 0)`` and the
    quiz funnel logger then records a false failure for a write that already
    committed. Empty 2xx must be success so we do not lose or double-count.
    """
    dummy_settings = DummySettings()
    monkeypatch.setattr("app.db.session.get_settings", lambda: dummy_settings)

    dummy_client = _DummyRPCClient(_rpc_response(204, content=b""))
    monkeypatch.setattr("app.db.session.get_http_client", lambda: dummy_client)

    client = SupabaseClient()
    result = await client.rpc(
        "increment_quiz_funnel",
        {
            "p_quiz_id": "a932ffdc-867f-463e-8d23-579d5a02d2ad",
            "p_event": "page_view",
        },
    )

    assert result is None
    assert dummy_client.calls[0]["url"].endswith("/rpc/increment_quiz_funnel")


@pytest.mark.asyncio
async def test_rpc_treats_whitespace_2xx_body_as_success(monkeypatch) -> None:
    """A 200 with only whitespace is the same void-RPC contract as 204."""
    dummy_settings = DummySettings()
    monkeypatch.setattr("app.db.session.get_settings", lambda: dummy_settings)

    dummy_client = _DummyRPCClient(_rpc_response(200, content=b" \n"))
    monkeypatch.setattr("app.db.session.get_http_client", lambda: dummy_client)

    client = SupabaseClient()
    assert await client.rpc("increment_quiz_funnel") is None


@pytest.mark.asyncio
async def test_rpc_still_raises_on_non_json_2xx_payload(monkeypatch) -> None:
    """Non-empty garbage on 2xx is a real client bug, not a void success."""
    dummy_settings = DummySettings()
    monkeypatch.setattr("app.db.session.get_settings", lambda: dummy_settings)

    dummy_client = _DummyRPCClient(_rpc_response(200, content=b"<html>nope</html>"))
    monkeypatch.setattr("app.db.session.get_http_client", lambda: dummy_client)

    client = SupabaseClient()
    with pytest.raises(json.JSONDecodeError):
        await client.rpc("increment_quiz_funnel")
