"""Tests for the quiz unfurl challenge-card image (U9: GET /q/{slug}/card.png).

The unfurl preview is a fully generated card -- owner name, score-to-beat,
challenge framing, Atlasi branding -- and NEVER a quiz photo (KTD11: messaging
apps cache unfurls on their own CDNs indefinitely, so a real photo would
outlive revocation). The non-negotiables under test:

- Fixed 1200x630 PNG; query parameters never influence the output.
- Fully synthetic bytes: the render path makes no outbound fetch of any kind.
- ETag is keyed on the rendered tuple (quiz id, owner name, score-to-beat);
  matching If-None-Match returns 304.
- The slug resolves UNCACHED on every request: a revoked slug 404s BEFORE any
  conditional/ETag short-circuit, so a cached validator cannot resurrect a
  revoked card.
- Hostile display names (400 chars, RTL, control characters) render clipped
  without raising.
- Every response is noindex; 200s cache modestly (<=60s), 404s are no-store.
- The route is rate limited more strictly than the page route (60/minute).
"""

import io
import re
from typing import Any
from unittest.mock import AsyncMock, patch

import httpx
import pytest
from fastapi.testclient import TestClient
from PIL import Image

from app.main import limiter
from tests.conftest import TEST_USER_ID, supabase_tables

QUIZ_ID = "770e8400-e29b-41d4-a716-446655440000"
QUIZ_SLUG = "0123456789abcdef0123456789abcdef"

CARD_PATH = f"/q/{QUIZ_SLUG}/card.png"
PNG_MAGIC = b"\x89PNG\r\n\x1a\n"


def _quiz_row(state: str = "shared", **overrides: Any) -> dict[str, Any]:
    row = {
        "id": QUIZ_ID,
        "owner_id": TEST_USER_ID,
        "state": state,
        "slug": QUIZ_SLUG,
        "score_to_beat_correct": 7,
        "score_to_beat_total": 10,
        "created_at": "2026-01-01T00:00:00Z",
        "updated_at": "2026-01-01T00:00:00Z",
        "revoked_at": None,
        "objects_deleted_at": None,
    }
    row.update(overrides)
    return row


def _profile(display_name: str = "Maya") -> list[dict[str, Any]]:
    return [{"display_name": display_name, "avatar_url": None}]


def _no_outbound(*args: Any, **kwargs: Any) -> Any:
    raise AssertionError("card render must not make outbound HTTP requests")


def _get_card(
    client: TestClient,
    mock_supabase_client: AsyncMock,
    *,
    quiz: list[dict[str, Any]] | None = None,
    profile: list[dict[str, Any]] | None = None,
    slug: str = QUIZ_SLUG,
    query: str = "",
    headers: dict[str, str] | None = None,
) -> Any:
    mock_supabase_client.get.side_effect = supabase_tables(
        quiz=quiz if quiz is not None else [_quiz_row()],
        user_profile=profile if profile is not None else _profile(),
    )
    with (
        patch("app.api.public.get_supabase_client", return_value=mock_supabase_client),
        # Prove the render is fully synthetic: any outbound HTTP attempt fails
        # the test outright. The backend is async throughout, so every real
        # outbound call (storage included) goes through httpx.AsyncClient;
        # the sync httpx.Client cannot be patched here because the TestClient
        # itself is built on it.
        patch.object(httpx.AsyncClient, "send", _no_outbound),
        patch.object(httpx.AsyncClient, "request", _no_outbound),
    ):
        return client.get(f"/q/{slug}/card.png{query}", headers=headers or {})


# ============================================================================
# Shared quiz: valid fixed-dimension PNG
# ============================================================================


def test_card_is_valid_png_at_og_dimensions(
    client: TestClient, mock_supabase_client: AsyncMock
) -> None:
    """The card is a real 1200x630 PNG (magic bytes + Pillow open)."""
    response = _get_card(client, mock_supabase_client)

    assert response.status_code == 200
    assert response.headers["content-type"] == "image/png"
    assert response.content.startswith(PNG_MAGIC)
    image = Image.open(io.BytesIO(response.content))
    assert image.size == (1200, 630)


def test_card_renders_the_score_to_beat(
    client: TestClient, mock_supabase_client: AsyncMock
) -> None:
    """The score-to-beat is part of the render: changing it changes the card."""
    with_score = _get_card(client, mock_supabase_client)
    without_score = _get_card(
        client,
        mock_supabase_client,
        quiz=[_quiz_row(score_to_beat_correct=None, score_to_beat_total=None)],
    )
    different_score = _get_card(
        client, mock_supabase_client, quiz=[_quiz_row(score_to_beat_correct=3)]
    )

    assert with_score.status_code == 200
    assert without_score.status_code == 200
    assert different_score.status_code == 200
    assert with_score.content != without_score.content
    assert with_score.content != different_score.content


def test_card_bytes_are_fully_synthetic_no_storage_fetch(
    client: TestClient, mock_supabase_client: AsyncMock
) -> None:
    """KTD11: no quiz photo in the unfurl. The render path never touches
    storage or any HTTP client (the _get_card harness raises on any outbound
    send); the only I/O is the two uncached DB lookups."""
    response = _get_card(client, mock_supabase_client)

    assert response.status_code == 200
    tables = {call.args[0] for call in mock_supabase_client.get.call_args_list}
    assert tables == {"quiz", "user_profile"}


# ============================================================================
# ETag: keyed on the rendered tuple
# ============================================================================


def test_same_score_different_owner_names_differ(
    client: TestClient, mock_supabase_client: AsyncMock
) -> None:
    """Two quizzes with the same score but different owners must not share
    bytes or a validator."""
    maya = _get_card(client, mock_supabase_client, profile=_profile("Maya"))
    noor = _get_card(client, mock_supabase_client, profile=_profile("Noor"))

    assert maya.status_code == noor.status_code == 200
    assert maya.content != noor.content
    assert maya.headers["ETag"] != noor.headers["ETag"]


def test_matching_if_none_match_returns_304(
    client: TestClient, mock_supabase_client: AsyncMock
) -> None:
    first = _get_card(client, mock_supabase_client)
    etag = first.headers["ETag"]

    revalidated = _get_card(
        client, mock_supabase_client, headers={"If-None-Match": etag}
    )

    assert revalidated.status_code == 304
    assert revalidated.content == b""


def test_revoked_slug_404s_before_any_etag_short_circuit(
    client: TestClient, mock_supabase_client: AsyncMock
) -> None:
    """Revocation gates serving BEFORE conditional handling: a cached
    validator from before the revoke must get 404, never 304."""
    live = _get_card(client, mock_supabase_client)
    pre_revoke_etag = live.headers["ETag"]

    revoked = _get_card(
        client,
        mock_supabase_client,
        quiz=[_quiz_row("revoked", revoked_at="2026-02-01T00:00:00Z")],
        headers={"If-None-Match": pre_revoke_etag},
    )

    assert revoked.status_code == 404
    assert revoked.headers["Cache-Control"] == "no-store"


# ============================================================================
# Hostile display names
# ============================================================================


def test_400_char_display_name_renders_clipped_without_raising(
    client: TestClient, mock_supabase_client: AsyncMock
) -> None:
    response = _get_card(
        client, mock_supabase_client, profile=_profile("Wolfeschlegelstein" * 23)
    )

    assert response.status_code == 200
    assert Image.open(io.BytesIO(response.content)).size == (1200, 630)


def test_rtl_and_control_character_names_render_without_raising(
    client: TestClient, mock_supabase_client: AsyncMock
) -> None:
    hostile = "‮أحمد الطويل\x00\x1b[31m"
    response = _get_card(client, mock_supabase_client, profile=_profile(hostile))

    assert response.status_code == 200
    assert Image.open(io.BytesIO(response.content)).size == (1200, 630)


# ============================================================================
# Query parameters must not influence the output
# ============================================================================


def test_query_params_do_not_alter_output(
    client: TestClient, mock_supabase_client: AsyncMock
) -> None:
    bare = _get_card(client, mock_supabase_client)
    with_params = _get_card(
        client, mock_supabase_client, query="?width=4000&owner=Mallory&v=2"
    )

    assert with_params.status_code == 200
    assert with_params.content == bare.content
    assert with_params.headers["ETag"] == bare.headers["ETag"]


# ============================================================================
# Not shared: 404 no-store
# ============================================================================


@pytest.mark.parametrize("state", ["building", "awaiting_owner_play", "playable"])
def test_pre_share_states_404_no_store(
    client: TestClient, mock_supabase_client: AsyncMock, state: str
) -> None:
    response = _get_card(client, mock_supabase_client, quiz=[_quiz_row(state)])

    assert response.status_code == 404
    assert response.headers["Cache-Control"] == "no-store"


def test_unknown_slug_404_no_store(
    client: TestClient, mock_supabase_client: AsyncMock
) -> None:
    response = _get_card(client, mock_supabase_client, quiz=[])

    assert response.status_code == 404
    assert response.headers["Cache-Control"] == "no-store"


def test_invalid_slug_format_rejected(client: TestClient) -> None:
    response = client.get("/q/NOT_A_SLUG!/card.png")
    assert response.status_code == 422


# ============================================================================
# Headers: noindex everywhere, modest caching on 200
# ============================================================================


def test_noindex_and_modest_cache_on_200(
    client: TestClient, mock_supabase_client: AsyncMock
) -> None:
    response = _get_card(client, mock_supabase_client)

    assert "noindex" in response.headers.get("X-Robots-Tag", "")
    cache_control = response.headers["Cache-Control"]
    match = re.search(r"max-age=(\d+)", cache_control)
    assert match, f"no max-age in {cache_control!r}"
    assert int(match.group(1)) <= 60
    assert "no-store" not in cache_control


def test_noindex_on_404(client: TestClient, mock_supabase_client: AsyncMock) -> None:
    response = _get_card(client, mock_supabase_client, quiz=[])

    assert "noindex" in response.headers.get("X-Robots-Tag", "")


# ============================================================================
# Rate limiting: stricter than the page route
# ============================================================================


def test_card_route_rate_limited_stricter_than_page() -> None:
    """The page route is 60/minute; the image route must be tighter."""
    card_limits = [
        limit
        for key, limits in limiter._route_limits.items()
        if "view_quiz_card" in key
        for limit in limits
    ]
    assert card_limits, "GET /q/{slug}/card.png is not registered with the limiter"
    for limit in card_limits:
        item = limit.limit
        per_minute = item.amount * 60 / item.get_expiry()
        assert per_minute < 60, f"card route limit {item} is not stricter than 60/min"
