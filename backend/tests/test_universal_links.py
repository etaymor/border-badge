"""Tests for universal links (AASA) and share attribution (?ref=) logging (U7)."""

import logging
from unittest.mock import AsyncMock, patch

import pytest
from fastapi.testclient import TestClient

from tests.conftest import (
    TEST_TRIP_ID,
    TEST_USER_ID,
    supabase_tables,
)

# ============================================================================
# Apple App Site Association (AASA)
# ============================================================================


def test_aasa_returns_valid_json(client: TestClient) -> None:
    """AASA must be valid JSON served as application/json."""
    response = client.get("/.well-known/apple-app-site-association")
    assert response.status_code == 200
    assert response.headers["content-type"].startswith("application/json")
    data = response.json()
    assert "applinks" in data


def test_aasa_served_without_redirect(client: TestClient) -> None:
    """Apple's CDN refuses redirects; the AASA must be served directly."""
    response = client.get(
        "/.well-known/apple-app-site-association", follow_redirects=False
    )
    assert response.status_code == 200
    assert not response.history


def test_aasa_covers_share_paths(client: TestClient) -> None:
    """AASA claims /u/*, /t/*, /l/*, and /invite for in-app opening."""
    data = client.get("/.well-known/apple-app-site-association").json()
    details = data["applinks"]["details"]
    assert details, "AASA has no app detail entries"
    patterns = {
        component["/"]
        for detail in details
        for component in detail.get("components", [])
        if "/" in component
    }
    for required in ("/u/*", "/t/*", "/l/*", "/invite"):
        assert required in patterns, f"AASA missing path pattern {required}"


def test_aasa_excludes_kml_downloads(client: TestClient) -> None:
    """KML map downloads under /t/* and /l/* must stay in the browser."""
    data = client.get("/.well-known/apple-app-site-association").json()
    excluded = {
        component["/"]
        for detail in data["applinks"]["details"]
        for component in detail.get("components", [])
        if component.get("exclude") is True
    }
    assert "/t/*/map.kml" in excluded
    assert "/l/*/map.kml" in excluded


def test_aasa_app_ids_use_team_and_bundle_id(client: TestClient) -> None:
    """appIDs must be <TeamID>.<bundle id> for the production app."""
    data = client.get("/.well-known/apple-app-site-association").json()
    for detail in data["applinks"]["details"]:
        app_ids = detail.get("appIDs") or [detail.get("appID")]
        assert any(
            app_id and app_id.endswith("com.atlasi.app") for app_id in app_ids
        ), f"unexpected appIDs: {app_ids}"


# ============================================================================
# ?ref= attribution logging on public pages
# ============================================================================

TRIP_ROW = {
    "id": TEST_TRIP_ID,
    "user_id": TEST_USER_ID,
    "name": "Summer Vacation",
    "share_slug": "summer-vacation-abc123",
    "cover_image_url": None,
    "date_range": None,
    "created_at": "2024-01-01T00:00:00Z",
    "deleted_at": None,
    "country": {"name": "United States", "code": "US"},
}


def _get_trip(
    client: TestClient, mock_supabase_client: AsyncMock, query: str = ""
) -> "TestClient.get":
    mock_supabase_client.get.side_effect = supabase_tables(trip=[TRIP_ROW])
    with patch(
        "app.api.public.get_service_supabase_client", return_value=mock_supabase_client
    ):
        return client.get(f"/t/summer-vacation-abc123{query}")


def test_public_trip_with_ref_logs_and_renders(
    client: TestClient,
    mock_supabase_client: AsyncMock,
    caplog: pytest.LogCaptureFixture,
) -> None:
    """A ?ref= visit renders normally and emits the referrer in the view log."""
    with caplog.at_level(logging.INFO, logger="analytics"):
        response = _get_trip(client, mock_supabase_client, "?ref=alex_chen")

    assert response.status_code == 200
    assert "Summer Vacation" in response.text
    ref_lines = [r.message for r in caplog.records if "ref=alex_chen" in r.message]
    assert ref_lines, "expected an analytics log line carrying ref=alex_chen"


def test_public_trip_with_invalid_ref_still_renders(
    client: TestClient,
    mock_supabase_client: AsyncMock,
    caplog: pytest.LogCaptureFixture,
) -> None:
    """A malformed ref never breaks the page and is dropped from the log."""
    with caplog.at_level(logging.INFO, logger="analytics"):
        response = _get_trip(
            client, mock_supabase_client, "?ref=<script>alert(1)</script>"
        )

    assert response.status_code == 200
    assert not any("script" in r.message for r in caplog.records)


def test_public_trip_without_ref_keeps_legacy_log_format(
    client: TestClient,
    mock_supabase_client: AsyncMock,
    caplog: pytest.LogCaptureFixture,
) -> None:
    """No ref param: the existing page_view log line is unchanged."""
    with caplog.at_level(logging.INFO, logger="analytics"):
        response = _get_trip(client, mock_supabase_client)

    assert response.status_code == 200
    assert any(
        r.message == "page_view: trip identifier=summer-vacation-abc123"
        for r in caplog.records
    )


def test_public_profile_with_ref_logs(
    client: TestClient,
    mock_supabase_client: AsyncMock,
    caplog: pytest.LogCaptureFixture,
) -> None:
    """Profile pages log the ref too."""
    profile_row = {
        "user_id": TEST_USER_ID,
        "username": "wanderer",
        "display_name": "Wanderer",
        "avatar_url": None,
        "home_country_code": None,
        "created_at": "2024-01-01T00:00:00Z",
    }
    mock_supabase_client.get.side_effect = supabase_tables(
        user_profile=[profile_row],
    )
    mock_supabase_client.rpc.return_value = []

    with caplog.at_level(logging.INFO, logger="analytics"):
        with patch(
            "app.api.public.get_service_supabase_client",
            return_value=mock_supabase_client,
        ):
            response = client.get("/u/wanderer?ref=sofia_travels")

    assert response.status_code == 200
    assert any("ref=sofia_travels" in r.message for r in caplog.records)


def test_invite_landing_with_ref_logs(
    client: TestClient,
    caplog: pytest.LogCaptureFixture,
) -> None:
    """Invite landing logs a page view with the ref (no code needed)."""
    with caplog.at_level(logging.INFO, logger="analytics"):
        response = client.get("/invite?ref=marcus_j")

    assert response.status_code == 200
    assert any(
        "page_view: invite" in r.message and "ref=marcus_j" in r.message
        for r in caplog.records
    )


# ============================================================================
# Invite URLs carry the inviter's username as ref
# ============================================================================


def test_build_invite_url_appends_ref() -> None:
    from app.api.invites import build_invite_url

    url = build_invite_url("somecode", ref="alex_chen")
    assert url is not None
    assert "/invite?code=somecode" in url
    assert "&ref=alex_chen" in url


def test_build_invite_url_without_ref_unchanged() -> None:
    from app.api.invites import build_invite_url

    url = build_invite_url("somecode")
    assert url is not None
    assert url.endswith("/invite?code=somecode")
