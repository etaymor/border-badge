"""Quiz funnel writes must not treat a committed VOID RPC as failure."""

import logging
from uuid import UUID

import httpx
import pytest

from app.db.session import SupabaseClient
from app.services.quiz_funnel import record_quiz_funnel_event

QUIZ_ID = UUID("a932ffdc-867f-463e-8d23-579d5a02d2ad")
SLUG = "guest-play-abc123"


class _Settings:
    supabase_url = "https://example.supabase.co"
    supabase_anon_key = "anon-key"
    supabase_service_role_key = "service-role-key"
    supabase_jwt_secret = "jwt-secret"


class _Http:
    def __init__(self, response: httpx.Response) -> None:
        self.response = response
        self.calls: list[dict[str, object]] = []

    async def post(self, url: str, headers: dict[str, str], json: dict[str, object]):
        self.calls.append({"url": url, "headers": headers, "json": json})
        return self.response


def _void_response() -> httpx.Response:
    request = httpx.Request("POST", "https://example.supabase.co/rest/v1/rpc/fn")
    return httpx.Response(204, content=b"", request=request)


@pytest.mark.asyncio
async def test_page_view_void_rpc_is_not_a_failed_write(
    monkeypatch: pytest.MonkeyPatch, caplog: pytest.LogCaptureFixture
) -> None:
    """Empty PostgREST body is success: log the step, do not warn as lost."""
    monkeypatch.setattr("app.db.session.get_settings", lambda: _Settings())
    http = _Http(_void_response())
    monkeypatch.setattr("app.db.session.get_http_client", lambda: http)

    with caplog.at_level(logging.INFO):
        await record_quiz_funnel_event(SupabaseClient(), QUIZ_ID, "page_view", SLUG)

    assert "Failed to record quiz funnel event" not in caplog.text
    assert f"quiz_funnel: page_view slug={SLUG}" in caplog.text
    assert http.calls[0]["json"] == {
        "p_quiz_id": str(QUIZ_ID),
        "p_event": "page_view",
    }


@pytest.mark.asyncio
async def test_rpc_errors_still_warn_without_raising(
    caplog: pytest.LogCaptureFixture,
) -> None:
    """Real increment failures stay visible; they must never take down play."""

    class _Broken:
        async def rpc(self, function: str, params: dict[str, object] | None = None):
            raise RuntimeError("connection reset")

    with caplog.at_level(logging.WARNING, logger="app.services.quiz_funnel"):
        await record_quiz_funnel_event(_Broken(), QUIZ_ID, "page_view", SLUG)

    assert "Failed to record quiz funnel event page_view" in caplog.text
