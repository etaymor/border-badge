"""Tests for Supabase Edge Function helpers (plan U5).

The helper must use the shared pooled httpx client - constructing a fresh
httpx.AsyncClient per call costs a new TCP/TLS handshake on every push
notification and invite email.
"""

from typing import Any

import pytest

from app.core import edge_functions


class DummySettings:
    supabase_url = "https://example.supabase.co"
    supabase_anon_key = "anon-key"


class DummyResponse:
    def __init__(self, payload: dict[str, Any]) -> None:
        self._payload = payload

    def raise_for_status(self) -> None:
        return None

    def json(self) -> dict[str, Any]:
        return self._payload


class DummyPooledClient:
    def __init__(self) -> None:
        self.calls: list[dict[str, Any]] = []

    async def post(
        self,
        url: str,
        json: dict[str, Any] | None = None,
        timeout: float | None = None,
        headers: dict[str, str] | None = None,
    ) -> DummyResponse:
        self.calls.append(
            {"url": url, "json": json, "timeout": timeout, "headers": headers}
        )
        return DummyResponse({"ok": True})


@pytest.mark.asyncio
async def test_call_edge_function_uses_shared_pooled_client(monkeypatch) -> None:
    """The call goes through get_http_client(); no per-request AsyncClient."""
    pooled = DummyPooledClient()
    monkeypatch.setattr(edge_functions, "get_settings", lambda: DummySettings())
    monkeypatch.setattr(edge_functions, "get_http_client", lambda: pooled)

    def _no_new_clients(*args: Any, **kwargs: Any) -> None:
        raise AssertionError(
            "call_edge_function constructed a per-request httpx.AsyncClient; "
            "it must use the shared pooled client from app.db.session"
        )

    monkeypatch.setattr(edge_functions.httpx, "AsyncClient", _no_new_clients)

    result = await edge_functions.call_edge_function(
        "send-push-notification",
        {"tokens": ["tok"], "title": "t", "body": "b"},
        timeout=5.0,
    )

    assert result == {"ok": True}
    assert len(pooled.calls) == 1
    call = pooled.calls[0]
    assert call["url"] == (
        "https://example.supabase.co/functions/v1/send-push-notification"
    )
    # Per-call timeout still applies even though the pooled client has its own
    assert call["timeout"] == 5.0
    assert call["headers"]["Authorization"] == "Bearer anon-key"


@pytest.mark.asyncio
async def test_send_push_notification_sets_social_channel_id(monkeypatch) -> None:
    """Push payloads carry channelId='social' so Android routes them to the
    'social' notification channel the mobile app creates (not the default)."""
    pooled = DummyPooledClient()
    monkeypatch.setattr(edge_functions, "get_settings", lambda: DummySettings())
    monkeypatch.setattr(edge_functions, "get_http_client", lambda: pooled)

    result = await edge_functions.send_push_notification(
        tokens=["ExponentPushToken[abc]"],
        title="You Were Tagged",
        body="Someone tagged you",
        data={"screen": "UserProfile"},
    )

    assert result == {"ok": True}
    assert len(pooled.calls) == 1
    payload = pooled.calls[0]["json"]
    assert payload["channelId"] == "social"
    assert payload["tokens"] == ["ExponentPushToken[abc]"]


@pytest.mark.asyncio
async def test_call_edge_function_returns_none_without_config(monkeypatch) -> None:
    class EmptySettings:
        supabase_url = None
        supabase_anon_key = None

    monkeypatch.setattr(edge_functions, "get_settings", lambda: EmptySettings())

    result = await edge_functions.call_edge_function("anything", {})
    assert result is None


@pytest.mark.asyncio
async def test_call_edge_function_swallows_http_errors(monkeypatch) -> None:
    """Edge functions are best effort: HTTP failures log and return None."""
    import httpx

    class FailingClient:
        async def post(self, *args: Any, **kwargs: Any) -> DummyResponse:
            raise httpx.ConnectError("boom")

    monkeypatch.setattr(edge_functions, "get_settings", lambda: DummySettings())
    monkeypatch.setattr(edge_functions, "get_http_client", lambda: FailingClient())

    result = await edge_functions.call_edge_function("send-push-notification", {})
    assert result is None
