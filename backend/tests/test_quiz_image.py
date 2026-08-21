"""Tests for the quiz unfurl challenge-card image (GET /q/{slug}/card.png).

The unfurl preview is a photo-rich 1200x630 poster: the LAST question's photo
full-bleed under a midnight-navy scrim, with the challenge framing set on top.
Carrying a real user photo here is a deliberate product decision (2026-08-17)
that REVERSED the earlier KTD11 rule ("share assets never carry user photos");
the accepted tradeoff is that messaging-app unfurl CDNs cache images
indefinitely, so a card photo can outlive revocation. Do not reinstate the
photo-free rule. The non-negotiables under test:

- Fixed 1200x630 PNG; query parameters never influence the output.
- The composited photo is the LAST question's, never photo 1 (the web intro
  blurs photo 1 as a mystery; a crisp photo 1 in previews would spoil it).
- The photo fetch is best-effort in the ROUTE (the render stays pure): any
  failure -- network error, timeout, undecodable bytes, a quiz with no
  questions -- falls back to the fully synthetic type-only card, and the
  route NEVER 500s.
- The photo is size-capped: bytes over ~10MB (declared OR actual, so a
  missing Content-Length cannot bypass the cap) and images over a 40M-pixel
  budget degrade to the fallback instead of being buffered/Pillow-decoded --
  uploads are not content-validated and the route is unauthenticated.
- A DEGRADED fallback (the quiz HAS a photo but this request could not
  fetch/decode it) is uncacheable: no ETag, Cache-Control: no-cache. It must
  never ship under the photo card's validator, or revalidating caches would
  304 the type-only card into freshness forever without retrying the fetch.
  The no-photo type-only card (no questions) keeps full caching -- it IS the
  correct stable render there.
- ETag is keyed on the rendered tuple (quiz id, owner name, score-to-beat,
  question count, chosen photo storage path) at render version 3; matching
  If-None-Match returns 304.
- The slug resolves UNCACHED on every request: a revoked slug 404s BEFORE any
  conditional/ETag short-circuit, so a cached validator cannot resurrect a
  revoked card.
- Hostile display names (400 chars, RTL, control characters) render clipped
  without raising.
- Every response is noindex; healthy 200s cache modestly (<=60s), 404s are
  no-store.
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

from app.api.public import _CARD_PHOTO_MAX_BYTES
from app.core.quiz_image import _RENDER_VERSION, card_etag, render_challenge_card
from app.main import limiter
from tests.conftest import TEST_USER_ID, supabase_tables


@pytest.fixture(autouse=True)
def reset_rate_limiter() -> None:
    """Keep the 30/minute route limit from tripping across this file's tests."""
    limiter.reset()


QUIZ_ID = "770e8400-e29b-41d4-a716-446655440000"
QUIZ_SLUG = "0123456789abcdef0123456789abcdef"

CARD_PATH = f"/q/{QUIZ_SLUG}/card.png"
PNG_MAGIC = b"\x89PNG\r\n\x1a\n"

PHOTO_GREEN = (20, 160, 90)


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


def _question(position: int, storage_path: str | None = None) -> dict[str, Any]:
    return {
        "position": position,
        "storage_path": storage_path or f"quiz/{QUIZ_ID}/{position}.jpg",
        "options": ["France", "Japan", "Peru", "Ghana"],
    }


def _photo_png(color: tuple[int, int, int] = PHOTO_GREEN) -> bytes:
    buffer = io.BytesIO()
    Image.new("RGB", (32, 32), color).save(buffer, format="PNG")
    return buffer.getvalue()


def _http_mock(get: Any = None) -> AsyncMock:
    """A stand-in for the shared pooled HTTP client.

    `get` may be an httpx.Response (returned), an Exception (raised), or None
    for the default: any fetch attempt raises AssertionError, which the route
    is expected to swallow into the type-only fallback -- tests that must
    prove NO fetch happened assert on `mock.get.await_count` instead.
    """
    mock = AsyncMock()
    if get is None:
        mock.get = AsyncMock(side_effect=AssertionError("unexpected photo fetch"))
    elif isinstance(get, Exception):
        mock.get = AsyncMock(side_effect=get)
    else:
        mock.get = AsyncMock(return_value=get)
    return mock


def _get_card(
    client: TestClient,
    mock_supabase_client: AsyncMock,
    *,
    quiz: list[dict[str, Any]] | None = None,
    profile: list[dict[str, Any]] | None = None,
    questions: list[dict[str, Any]] | None = None,
    http: AsyncMock | None = None,
    slug: str = QUIZ_SLUG,
    query: str = "",
    headers: dict[str, str] | None = None,
) -> Any:
    http = http if http is not None else _http_mock()
    mock_supabase_client.get.side_effect = supabase_tables(
        quiz=quiz if quiz is not None else [_quiz_row()],
        user_profile=profile if profile is not None else _profile(),
        quiz_question=questions if questions is not None else [],
    )
    with (
        patch("app.api.public.get_supabase_client", return_value=mock_supabase_client),
        # The ONLY sanctioned outbound call is the photo fetch through the
        # shared pooled client, which is mocked here.
        patch("app.api.public.get_http_client", return_value=http),
    ):
        return client.get(f"/q/{slug}/card.png{query}", headers=headers or {})


def _type_only_card(owner_name: str | None = "Maya") -> bytes:
    """The synthetic fallback card the route must serve when no photo lands."""
    return render_challenge_card(owner_name, 7, 10)


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


# ============================================================================
# Photo-rich card (KTD11 reversed 2026-08-17)
# ============================================================================


def test_card_composites_the_challenge_photo(
    client: TestClient, mock_supabase_client: AsyncMock
) -> None:
    """With questions seeded and the fetch succeeding, the served card carries
    the photo: its bytes differ from the type-only fallback and the photo's
    hue shows through the scrim."""
    http = _http_mock(httpx.Response(200, content=_photo_png()))
    response = _get_card(
        client,
        mock_supabase_client,
        questions=[_question(1), _question(2), _question(3)],
        http=http,
    )

    assert response.status_code == 200
    assert http.get.await_count == 1
    assert response.content != _type_only_card()
    image = Image.open(io.BytesIO(response.content)).convert("RGB")
    assert image.size == (1200, 630)
    # Top of the card is lightly scrimmed: the solid-green photo dominates.
    r, g, b = image.getpixel((1100, 60))
    assert g > r + 40
    assert g > b


def test_render_fn_accepts_photo_bytes_and_composites_them() -> None:
    """The pure render path: photo bytes in, a different (photo) card out."""
    with_photo = render_challenge_card(
        "Maya", 7, 10, question_count=10, choice_count=4, photo=_photo_png()
    )
    type_only = render_challenge_card("Maya", 7, 10)

    assert with_photo != type_only
    assert Image.open(io.BytesIO(with_photo)).size == (1200, 630)
    assert Image.open(io.BytesIO(type_only)).size == (1200, 630)


def test_last_question_photo_chosen_never_the_first(
    client: TestClient, mock_supabase_client: AsyncMock
) -> None:
    """The web intro blurs photo 1 as a mystery, so the unfurl must never show
    it crisp: the LAST question's photo is the one fetched -- regardless of
    row order coming back from the database."""
    http = _http_mock(httpx.Response(200, content=_photo_png()))
    response = _get_card(
        client,
        mock_supabase_client,
        questions=[_question(3, "quiz/last.jpg"), _question(1, "quiz/first.jpg")],
        http=http,
    )

    assert response.status_code == 200
    assert http.get.await_count == 1
    fetched_url = http.get.await_args.args[0]
    assert fetched_url.endswith("/quiz/last.jpg")


# ============================================================================
# Never 500: every photo failure falls back to the type-only card
# ============================================================================


def test_photo_fetch_timeout_falls_back_to_type_only(
    client: TestClient, mock_supabase_client: AsyncMock
) -> None:
    response = _get_card(
        client,
        mock_supabase_client,
        questions=[_question(1)],
        http=_http_mock(httpx.TimeoutException("storage too slow")),
    )

    assert response.status_code == 200
    assert response.content == _type_only_card()


def test_photo_fetch_error_status_falls_back_to_type_only(
    client: TestClient, mock_supabase_client: AsyncMock
) -> None:
    response = _get_card(
        client,
        mock_supabase_client,
        questions=[_question(1)],
        http=_http_mock(httpx.Response(404, content=b"gone")),
    )

    assert response.status_code == 200
    assert response.content == _type_only_card()


def test_undecodable_photo_bytes_fall_back_to_type_only(
    client: TestClient, mock_supabase_client: AsyncMock
) -> None:
    response = _get_card(
        client,
        mock_supabase_client,
        questions=[_question(1)],
        http=_http_mock(httpx.Response(200, content=b"not an image at all")),
    )

    assert response.status_code == 200
    assert response.content == _type_only_card()


def test_no_questions_falls_back_and_never_fetches(
    client: TestClient, mock_supabase_client: AsyncMock
) -> None:
    http = _http_mock()
    response = _get_card(client, mock_supabase_client, questions=[], http=http)

    assert response.status_code == 200
    assert http.get.await_count == 0
    assert response.content == _type_only_card()


def test_question_table_failure_falls_back_not_500(
    client: TestClient, mock_supabase_client: AsyncMock
) -> None:
    """A quiz_question lookup failure degrades to the type-only card."""
    response = _get_card(
        client,
        mock_supabase_client,
        questions=None,
        http=_http_mock(),
    )
    # Re-run with the table raising instead of returning rows.
    mock_supabase_client.get.side_effect = supabase_tables(
        quiz=[_quiz_row()],
        user_profile=_profile(),
        quiz_question=RuntimeError("postgrest down"),
    )
    with (
        patch("app.api.public.get_supabase_client", return_value=mock_supabase_client),
        patch("app.api.public.get_http_client", return_value=_http_mock()),
    ):
        degraded = client.get(CARD_PATH)

    assert response.status_code == 200
    assert degraded.status_code == 200
    assert degraded.content == _type_only_card()


def test_render_fn_falls_back_on_undecodable_photo() -> None:
    assert render_challenge_card("Maya", 7, 10, photo=b"junk") == render_challenge_card(
        "Maya", 7, 10
    )


# ============================================================================
# Degraded fallback caching: a failed photo must never be pinned by caches
# ============================================================================


def test_degraded_fallback_ships_without_the_photo_etag_and_uncacheable(
    client: TestClient, mock_supabase_client: AsyncMock
) -> None:
    """When the quiz HAS a photo but the fetch fails, the type-only fallback
    must not carry the photo card's ETag or any freshness: a revalidating
    cache holding it would otherwise 304 the degraded card into freshness
    forever without the fetch ever being retried. The healthy photo card and
    the degraded render therefore differ in headers, not just bytes."""
    healthy = _get_card(
        client,
        mock_supabase_client,
        questions=[_question(1)],
        http=_http_mock(httpx.Response(200, content=_photo_png())),
    )
    degraded = _get_card(
        client,
        mock_supabase_client,
        questions=[_question(1)],
        http=_http_mock(httpx.TimeoutException("storage too slow")),
    )

    assert healthy.status_code == degraded.status_code == 200
    # The healthy photo card keeps the full caching contract.
    assert healthy.headers.get("ETag")
    assert healthy.headers["Cache-Control"] == "public, max-age=60"
    # The degraded render hands out no validator and no freshness, so no
    # future If-None-Match can ever 304 it back into freshness.
    assert "ETag" not in degraded.headers
    assert degraded.headers["Cache-Control"] == "no-cache"
    assert "noindex" in degraded.headers.get("X-Robots-Tag", "")


def test_undecodable_photo_degraded_render_is_uncacheable(
    client: TestClient, mock_supabase_client: AsyncMock
) -> None:
    """Bytes that fetch fine but do not decode are the same degraded shape:
    fallback body, no validator, no freshness."""
    degraded = _get_card(
        client,
        mock_supabase_client,
        questions=[_question(1)],
        http=_http_mock(httpx.Response(200, content=b"not an image at all")),
    )

    assert degraded.status_code == 200
    assert degraded.content == _type_only_card()
    assert "ETag" not in degraded.headers
    assert degraded.headers["Cache-Control"] == "no-cache"


def test_degraded_render_recovers_on_the_next_request(
    client: TestClient, mock_supabase_client: AsyncMock
) -> None:
    """The degraded exchange leaves a cache with nothing to revalidate with,
    so the next request is unconditional, retries the fetch, and the photo
    card comes back with its full caching contract."""
    degraded = _get_card(
        client,
        mock_supabase_client,
        questions=[_question(1)],
        http=_http_mock(httpx.TimeoutException("storage too slow")),
    )
    assert "ETag" not in degraded.headers

    recovered = _get_card(
        client,
        mock_supabase_client,
        questions=[_question(1)],
        http=_http_mock(httpx.Response(200, content=_photo_png())),
    )

    assert recovered.status_code == 200
    assert recovered.content != _type_only_card()
    assert recovered.headers.get("ETag")
    assert recovered.headers["Cache-Control"] == "public, max-age=60"


def test_no_photo_type_only_card_keeps_full_caching(
    client: TestClient, mock_supabase_client: AsyncMock
) -> None:
    """A quiz with no questions has no photo to degrade from: its type-only
    card IS the correct stable render and keeps the ETag + max-age."""
    response = _get_card(client, mock_supabase_client, questions=[])

    assert response.status_code == 200
    assert response.headers.get("ETag")
    assert response.headers["Cache-Control"] == "public, max-age=60"


# ============================================================================
# Photo size caps: oversized bytes or pixels degrade, never buffer-and-decode
# ============================================================================


def test_oversized_content_length_falls_back_to_type_only(
    client: TestClient, mock_supabase_client: AsyncMock
) -> None:
    """A declared Content-Length over the cap is rejected outright."""
    oversized = httpx.Response(200, content=_photo_png())
    oversized.headers["Content-Length"] = str(_CARD_PHOTO_MAX_BYTES + 1)

    response = _get_card(
        client,
        mock_supabase_client,
        questions=[_question(1)],
        http=_http_mock(oversized),
    )

    assert response.status_code == 200
    assert response.content == _type_only_card()
    assert "ETag" not in response.headers


def test_oversized_body_without_content_length_falls_back(
    client: TestClient, mock_supabase_client: AsyncMock
) -> None:
    """A missing Content-Length must not bypass the cap: the actual body
    length is enforced too."""
    oversized = httpx.Response(200, content=b"\xff" * (_CARD_PHOTO_MAX_BYTES + 1))
    del oversized.headers["Content-Length"]

    response = _get_card(
        client,
        mock_supabase_client,
        questions=[_question(1)],
        http=_http_mock(oversized),
    )

    assert response.status_code == 200
    assert response.content == _type_only_card()
    assert "ETag" not in response.headers


def _over_pixel_budget_png() -> bytes:
    """A small file whose header declares 48M pixels (over the 40M budget)."""
    buffer = io.BytesIO()
    Image.new("1", (8000, 6000)).save(buffer, format="PNG")
    return buffer.getvalue()


def test_over_pixel_budget_photo_falls_back_to_type_only(
    client: TestClient, mock_supabase_client: AsyncMock
) -> None:
    """An image whose dimensions exceed the pixel budget degrades to the
    fallback before any pixel data is decoded."""
    response = _get_card(
        client,
        mock_supabase_client,
        questions=[_question(1)],
        http=_http_mock(httpx.Response(200, content=_over_pixel_budget_png())),
    )

    assert response.status_code == 200
    assert response.content == _type_only_card()
    assert "ETag" not in response.headers


def test_render_fn_falls_back_on_over_pixel_budget_photo() -> None:
    assert render_challenge_card(
        "Maya", 7, 10, photo=_over_pixel_budget_png()
    ) == render_challenge_card("Maya", 7, 10)


# ============================================================================
# ETag: keyed on the rendered tuple, render version 3
# ============================================================================


def test_render_version_is_3() -> None:
    """The photo-rich redesign must invalidate every cached v2 validator."""
    assert _RENDER_VERSION == 3


def test_etag_varies_with_photo_storage_path() -> None:
    base = card_etag(QUIZ_ID, "Maya", 7, 10, 10, "quiz/a.jpg")
    other = card_etag(QUIZ_ID, "Maya", 7, 10, 10, "quiz/b.jpg")
    none = card_etag(QUIZ_ID, "Maya", 7, 10, None, None)

    assert base != other
    assert base != none


def test_etag_varies_with_photo_at_the_route(
    client: TestClient, mock_supabase_client: AsyncMock
) -> None:
    photo = httpx.Response(200, content=_photo_png())
    first = _get_card(
        client,
        mock_supabase_client,
        questions=[_question(1, "quiz/a.jpg")],
        http=_http_mock(photo),
    )
    second = _get_card(
        client,
        mock_supabase_client,
        questions=[_question(1, "quiz/b.jpg")],
        http=_http_mock(httpx.Response(200, content=_photo_png())),
    )

    assert first.status_code == second.status_code == 200
    assert first.headers["ETag"] != second.headers["ETag"]


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


def test_304_short_circuits_before_the_photo_fetch(
    client: TestClient, mock_supabase_client: AsyncMock
) -> None:
    """A revalidation hit must not pay for a storage fetch."""
    photo = _http_mock(httpx.Response(200, content=_photo_png()))
    first = _get_card(
        client, mock_supabase_client, questions=[_question(1)], http=photo
    )
    etag = first.headers["ETag"]

    revalidation_http = _http_mock()
    revalidated = _get_card(
        client,
        mock_supabase_client,
        questions=[_question(1)],
        http=revalidation_http,
        headers={"If-None-Match": etag},
    )

    assert revalidated.status_code == 304
    assert revalidation_http.get.await_count == 0


def test_revoked_slug_404s_before_any_etag_short_circuit(
    client: TestClient, mock_supabase_client: AsyncMock
) -> None:
    """Revocation gates serving BEFORE conditional handling: a cached
    validator from before the revoke must get 404, never 304. (The unfurl
    CDNs' own copies persisting past this 404 is the accepted KTD11-reversal
    tradeoff.)"""
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
        client,
        mock_supabase_client,
        profile=_profile("Wolfeschlegelstein" * 23),
        questions=[_question(1)],
        http=_http_mock(httpx.Response(200, content=_photo_png())),
    )

    assert response.status_code == 200
    assert Image.open(io.BytesIO(response.content)).size == (1200, 630)


def test_rtl_and_control_character_names_render_without_raising(
    client: TestClient, mock_supabase_client: AsyncMock
) -> None:
    hostile = "‮أحمد الطويل\x00\x1b[31m"
    response = _get_card(
        client,
        mock_supabase_client,
        profile=_profile(hostile),
        questions=[_question(1)],
        http=_http_mock(httpx.Response(200, content=_photo_png())),
    )

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
