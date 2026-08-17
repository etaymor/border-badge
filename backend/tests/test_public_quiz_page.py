"""Tests for the public playable quiz page (U7: GET /q/{slug}).

The page is the anonymous play surface for a shared travel photo quiz. The
non-negotiables under test:

- Only quizzes in state 'shared' render (R9). Unknown slugs and pre-share
  states 404; revoked quizzes serve a content-free "gone" page (AE5).
- GROUND TRUTH NEVER REACHES THE PAGE: no correct_index, no capture_year,
  no year_options, and the correct country appears nowhere outside the
  four-option list in the JSON data island.
- Every /q/ response is noindex (meta tag + X-Robots-Tag header) and the
  slug never leaks into sitemap.xml or robots.txt.
- 200s cache for at most 60s (KTD5: quiz photos have a 60s object TTL);
  404/gone responses are no-store.
- The page runs under the strict default CSP: every script is nonce'd,
  no unsafe-eval, no inline handlers.
"""

import json
import re
from typing import Any
from unittest.mock import AsyncMock, patch

import pytest
from fastapi.testclient import TestClient

from app.main import limiter
from tests.conftest import TEST_USER_ID, supabase_tables

QUIZ_ID = "770e8400-e29b-41d4-a716-446655440000"
QUIZ_SLUG = "0123456789abcdef0123456789abcdef"

# Distinctive markers that must never appear outside their sanctioned spot.
CORRECT_COUNTRY = "Kiribati"
CAPTURE_YEAR = 1987


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


def _question_rows(count: int = 10) -> list[dict[str, Any]]:
    rows = []
    for i in range(count):
        rows.append(
            {
                "id": f"880e8400-e29b-41d4-a716-4466554400{i:02d}",
                "quiz_id": QUIZ_ID,
                "position": i,
                "storage_path": f"quiz/{QUIZ_ID}/photo{i}.jpg",
                "options": [CORRECT_COUNTRY, "France", "Japan", "Peru"]
                if i == 0
                else ["Chile", "Kenya", "Norway", "Vietnam"],
                "correct_index": 0,
                "capture_year": CAPTURE_YEAR if i == 0 else None,
                "year_options": [1985, 1986, 1987, 1988] if i == 0 else None,
                "created_at": "2026-01-01T00:00:00Z",
            }
        )
    return rows


def _profile(display_name: str = "Maya") -> list[dict[str, Any]]:
    return [{"display_name": display_name, "avatar_url": None}]


def _get_quiz_page(
    client: TestClient,
    mock_supabase_client: AsyncMock,
    *,
    quiz: list[dict[str, Any]] | None = None,
    questions: list[dict[str, Any]] | None = None,
    profile: list[dict[str, Any]] | None = None,
    slug: str = QUIZ_SLUG,
) -> Any:
    mock_supabase_client.get.side_effect = supabase_tables(
        quiz=quiz if quiz is not None else [_quiz_row()],
        quiz_question=questions if questions is not None else _question_rows(),
        user_profile=profile if profile is not None else _profile(),
    )
    with patch("app.api.public.get_supabase_client", return_value=mock_supabase_client):
        return client.get(f"/q/{slug}")


def _data_island(html_text: str) -> Any:
    match = re.search(
        r'<script type="application/json" id="quiz-data"[^>]*>(.*?)</script>',
        html_text,
        re.DOTALL,
    )
    assert match, "quiz page is missing its #quiz-data JSON island"
    return json.loads(match.group(1))


def _all_keys(node: Any) -> set[str]:
    keys: set[str] = set()
    if isinstance(node, dict):
        for key, value in node.items():
            keys.add(key)
            keys |= _all_keys(value)
    elif isinstance(node, list):
        for value in node:
            keys |= _all_keys(value)
    return keys


# ============================================================================
# Shared quiz: 200 play page
# ============================================================================


def test_shared_quiz_renders_play_page(
    client: TestClient, mock_supabase_client: AsyncMock
) -> None:
    """A shared quiz renders the challenge intro with owner and score-to-beat."""
    response = _get_quiz_page(client, mock_supabase_client)

    assert response.status_code == 200
    assert "text/html" in response.headers["content-type"]
    assert "Maya" in response.text
    assert "7/10" in response.text


def test_shared_quiz_page_data_island_carries_the_game(
    client: TestClient, mock_supabase_client: AsyncMock
) -> None:
    """The island has every question's image URL and four options, in order."""
    response = _get_quiz_page(client, mock_supabase_client)
    data = _data_island(response.text)

    assert data["slug"] == QUIZ_SLUG
    assert data["question_count"] == 10
    assert len(data["questions"]) == 10
    positions = [q["position"] for q in data["questions"]]
    assert positions == sorted(positions)
    for question in data["questions"]:
        assert question["id"]
        assert len(question["options"]) == 4
        assert question["image_url"].startswith("https://test.supabase.co/")


def test_shared_quiz_page_contains_no_ground_truth(
    client: TestClient, mock_supabase_client: AsyncMock
) -> None:
    """No correct index, no capture year, no year options -- anywhere."""
    response = _get_quiz_page(client, mock_supabase_client)

    island_keys = _all_keys(_data_island(response.text))
    assert not island_keys & {"correct_index", "capture_year", "year_options"}
    assert "correct" not in island_keys

    assert "correct_index" not in response.text
    assert "year_options" not in response.text
    assert str(CAPTURE_YEAR) not in response.text
    # The correct country may appear ONLY inside the island's options list.
    assert response.text.count(CORRECT_COUNTRY) == 1


def test_shared_quiz_cache_control_capped_at_60s(
    client: TestClient, mock_supabase_client: AsyncMock
) -> None:
    """KTD5: quiz photos carry a 60s TTL; the page must not outlive them."""
    response = _get_quiz_page(client, mock_supabase_client)

    cache_control = response.headers["Cache-Control"]
    match = re.search(r"max-age=(\d+)", cache_control)
    assert match, f"no max-age in {cache_control!r}"
    assert int(match.group(1)) <= 60
    assert "no-store" not in cache_control


def test_shared_quiz_without_profile_still_renders(
    client: TestClient, mock_supabase_client: AsyncMock
) -> None:
    """A missing owner profile degrades to an anonymous challenge, not a 500."""
    response = _get_quiz_page(client, mock_supabase_client, profile=[])

    assert response.status_code == 200
    assert "A friend" in response.text


def test_shared_quiz_og_tags_frame_the_challenge(
    client: TestClient, mock_supabase_client: AsyncMock
) -> None:
    """R13: unfurl meta points at the (later-unit) card image route."""
    response = _get_quiz_page(client, mock_supabase_client)

    assert f"/q/{QUIZ_SLUG}/card.png" in response.text
    assert 'property="og:title"' in response.text
    assert 'name="twitter:card"' in response.text


# ============================================================================
# Not shared: 404, no-store
# ============================================================================


@pytest.mark.parametrize("state", ["building", "awaiting_owner_play", "playable"])
def test_pre_share_states_404_no_store(
    client: TestClient, mock_supabase_client: AsyncMock, state: str
) -> None:
    """Only 'shared' serves. A minted-but-unshared slug must not leak."""
    response = _get_quiz_page(client, mock_supabase_client, quiz=[_quiz_row(state)])

    assert response.status_code == 404
    assert response.headers["Cache-Control"] == "no-store"


def test_unknown_slug_404_no_store(
    client: TestClient, mock_supabase_client: AsyncMock
) -> None:
    response = _get_quiz_page(client, mock_supabase_client, quiz=[])

    assert response.status_code == 404
    assert response.headers["Cache-Control"] == "no-store"


def test_invalid_slug_format_rejected(client: TestClient) -> None:
    """Slugs outside the shared public-slug alphabet never reach the DB."""
    response = client.get("/q/NOT_A_SLUG!")
    assert response.status_code == 422


# ============================================================================
# Revoked: gone page (AE5)
# ============================================================================


def test_revoked_quiz_serves_content_free_gone_page(
    client: TestClient, mock_supabase_client: AsyncMock
) -> None:
    """The gone page carries zero photos, names, or scores, and is no-store."""
    response = _get_quiz_page(
        client,
        mock_supabase_client,
        quiz=[_quiz_row("revoked", revoked_at="2026-02-01T00:00:00Z")],
    )

    assert response.status_code == 404
    assert response.headers["Cache-Control"] == "no-store"
    assert "Maya" not in response.text
    assert "7/10" not in response.text
    assert CORRECT_COUNTRY not in response.text
    assert "supabase.co/storage" not in response.text
    assert QUIZ_ID not in response.text
    assert 'id="quiz-data"' not in response.text


# ============================================================================
# noindex: every /q/ response, meta tag AND header
# ============================================================================


def _assert_noindex(response: Any) -> None:
    assert "noindex" in response.headers.get(
        "X-Robots-Tag", ""
    ), "missing X-Robots-Tag: noindex"
    assert re.search(
        r'<meta\s+name="robots"\s+content="[^"]*noindex', response.text
    ), "missing meta robots noindex tag"


def test_noindex_on_shared_quiz_page(
    client: TestClient, mock_supabase_client: AsyncMock
) -> None:
    _assert_noindex(_get_quiz_page(client, mock_supabase_client))


def test_noindex_on_404_page(
    client: TestClient, mock_supabase_client: AsyncMock
) -> None:
    _assert_noindex(_get_quiz_page(client, mock_supabase_client, quiz=[]))


def test_noindex_on_gone_page(
    client: TestClient, mock_supabase_client: AsyncMock
) -> None:
    _assert_noindex(
        _get_quiz_page(client, mock_supabase_client, quiz=[_quiz_row("revoked")])
    )


# ============================================================================
# CSP: strict default policy, nonce'd scripts
# ============================================================================


def test_quiz_page_gets_strict_default_csp(
    client: TestClient, mock_supabase_client: AsyncMock
) -> None:
    """The quiz page renders no Google Map, so it must keep the strict CSP."""
    response = _get_quiz_page(client, mock_supabase_client)
    csp = response.headers["Content-Security-Policy"]

    assert "'unsafe-eval'" not in csp
    assert "worker-src" not in csp
    style_src = next(
        d.strip() for d in csp.split(";") if d.strip().startswith("style-src")
    )
    assert "'nonce-" in style_src
    assert "'unsafe-inline'" not in style_src


def test_quiz_page_scripts_all_carry_the_nonce(
    client: TestClient, mock_supabase_client: AsyncMock
) -> None:
    """A nonce-less script (island or game JS) would be silently blocked."""
    response = _get_quiz_page(client, mock_supabase_client)

    script_tags = re.findall(r"<script[^>]*>", response.text)
    assert script_tags, "expected script tags on the quiz page"
    assert all("nonce=" in tag for tag in script_tags)


def test_quiz_page_has_no_inline_handlers_or_styles(
    client: TestClient, mock_supabase_client: AsyncMock
) -> None:
    """Strict CSP: per-state styling is classes, not style= or on*= attributes."""
    response = _get_quiz_page(client, mock_supabase_client)

    assert not re.search(r"\son[a-z]+=", response.text)
    assert ' style="' not in response.text


# ============================================================================
# Escaping: display names are user-controlled
# ============================================================================


def test_owner_display_name_with_markup_is_escaped(
    client: TestClient, mock_supabase_client: AsyncMock
) -> None:
    """A hostile display name renders inert in both HTML and JSON island."""
    hostile = '<script>alert("xss")</script>'
    response = _get_quiz_page(
        client, mock_supabase_client, profile=[{"display_name": hostile}]
    )

    assert response.status_code == 200
    assert "<script>alert" not in response.text
    # The island still carries the literal string, safely encoded.
    assert _data_island(response.text)["owner_name"] == hostile


# ============================================================================
# Reveal-first results: post-my-score module + share, no name gate
# ============================================================================


def test_results_view_has_post_my_score_module_and_no_name_gate(
    client: TestClient, mock_supabase_client: AsyncMock
) -> None:
    """Reveal-first (4.1): the score shows without signing; the name became an
    optional post-my-score module on the results card, and the old name-gate
    view ("sign the logbook" -> "Reveal my score") is gone."""
    response = _get_quiz_page(client, mock_supabase_client)
    html = response.text

    # The inline module lives on the results card.
    assert 'id="quiz-postscore"' in html
    assert "Add your name to the leaderboard" in html
    assert "Post My Score" in html
    assert 'id="quiz-name-form"' in html

    # The gate view is gone.
    assert 'id="quiz-name"' not in html
    assert "Reveal my score" not in html


def test_results_view_share_button_precedes_install_cta(
    client: TestClient, mock_supabase_client: AsyncMock
) -> None:
    """Share My Score is the primary friend action after the reveal and must
    come before the Get Atlasi install CTA."""
    response = _get_quiz_page(client, mock_supabase_client)
    html = response.text

    assert 'id="quiz-share"' in html
    assert "Share My Score" in html
    assert html.index('id="quiz-share"') < html.index(
        'data-track-location="quiz_results"'
    )


# ============================================================================
# Discovery surfaces: sitemap and robots
# ============================================================================


def test_sitemap_never_contains_quiz_urls(
    client: TestClient, mock_supabase_client: AsyncMock
) -> None:
    """Quiz slugs are unlisted challenge links; the sitemap must not name them."""
    mock_supabase_client.get.side_effect = supabase_tables(
        list=[{"slug": "some-list-abc123"}],
        trip=[{"share_slug": "some-trip-xyz"}],
        quiz=[_quiz_row()],
    )
    with patch("app.api.public.get_supabase_client", return_value=mock_supabase_client):
        response = client.get("/sitemap.xml")

    assert response.status_code == 200
    assert "/q/" not in response.text
    assert QUIZ_SLUG not in response.text


def test_robots_txt_has_no_quiz_disallow(client: TestClient) -> None:
    """A Disallow: /q/ line would advertise the URL space; rely on noindex."""
    response = client.get("/robots.txt")
    assert response.status_code == 200
    assert "/q" not in response.text


# ============================================================================
# Rate limiting
# ============================================================================


def test_quiz_page_route_is_rate_limited() -> None:
    """The route must be registered with the shared limiter (mirrors /t/)."""
    assert any(
        "view_quiz_page" in key for key in limiter._route_limits
    ), "GET /q/{slug} is not registered with the rate limiter"
