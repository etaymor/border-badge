"""Tests for outbound redirect endpoint."""

from datetime import datetime
from unittest.mock import AsyncMock, patch
from uuid import UUID

from fastapi.testclient import TestClient

from app.schemas.affiliate import OutboundLink, OutboundLinkStatus, ResolutionPath
from app.services.affiliate_links import generate_signature

# Test UUIDs
TEST_LINK_ID = "550e8400-e29b-41d4-a716-446655440010"
TEST_TRIP_ID = "550e8400-e29b-41d4-a716-446655440002"
TEST_ENTRY_ID = "550e8400-e29b-41d4-a716-446655440003"


def make_test_link(
    link_id: str = TEST_LINK_ID,
    destination_url: str = "https://example.com/product",
    status: OutboundLinkStatus = OutboundLinkStatus.ACTIVE,
    partner_slug: str | None = None,
    affiliate_url: str | None = None,
) -> OutboundLink:
    """Create a test OutboundLink object."""
    return OutboundLink(
        id=UUID(link_id),
        entry_id=UUID(TEST_ENTRY_ID),
        destination_url=destination_url,
        partner_slug=partner_slug,
        affiliate_url=affiliate_url,
        status=status,
        created_at=datetime.fromisoformat("2024-01-01T00:00:00+00:00"),
        updated_at=datetime.fromisoformat("2024-01-01T00:00:00+00:00"),
    )


# ============================================================================
# Success Cases
# ============================================================================


def test_redirect_success_with_valid_signature(client: TestClient) -> None:
    """Test successful redirect with valid signature."""
    link = make_test_link()
    signature = generate_signature(TEST_LINK_ID, None, None, "list_share")

    with (
        patch(
            "app.api.outbound.verify_signature", return_value=True
        ) as mock_verify,
        patch(
            "app.api.outbound.get_link_by_id", new_callable=AsyncMock, return_value=link
        ),
        patch("app.api.outbound.log_click_async", new_callable=AsyncMock),
    ):
        response = client.get(
            f"/o/{TEST_LINK_ID}?src=list_share&sig={signature}",
            follow_redirects=False,
        )

    assert response.status_code == 302
    assert response.headers["location"] == "https://example.com/product"
    mock_verify.assert_called_once()


def test_redirect_success_with_trip_and_entry_context(client: TestClient) -> None:
    """Test successful redirect with trip_id and entry_id context."""
    link = make_test_link()
    signature = generate_signature(TEST_LINK_ID, TEST_TRIP_ID, TEST_ENTRY_ID, "trip_share")

    with (
        patch("app.api.outbound.verify_signature", return_value=True),
        patch(
            "app.api.outbound.get_link_by_id", new_callable=AsyncMock, return_value=link
        ),
        patch(
            "app.api.outbound.log_click_async", new_callable=AsyncMock
        ) as mock_log,
    ):
        response = client.get(
            f"/o/{TEST_LINK_ID}?src=trip_share&sig={signature}&trip_id={TEST_TRIP_ID}&entry_id={TEST_ENTRY_ID}",
            follow_redirects=False,
        )

    assert response.status_code == 302
    # Verify click was logged with context
    mock_log.assert_called_once()
    click_data = mock_log.call_args[0][0]
    assert str(click_data.trip_id) == TEST_TRIP_ID
    assert str(click_data.entry_id) == TEST_ENTRY_ID


def test_redirect_uses_affiliate_url_when_available(client: TestClient) -> None:
    """Test that affiliate_url is used when available."""
    link = make_test_link(
        affiliate_url="https://partner.com/affiliate?id=123",
        partner_slug="booking",
    )
    signature = generate_signature(TEST_LINK_ID, None, None, "list_share")

    with (
        patch("app.api.outbound.verify_signature", return_value=True),
        patch(
            "app.api.outbound.get_link_by_id", new_callable=AsyncMock, return_value=link
        ),
        patch("app.api.outbound.log_click_async", new_callable=AsyncMock),
    ):
        response = client.get(
            f"/o/{TEST_LINK_ID}?src=list_share&sig={signature}",
            follow_redirects=False,
        )

    assert response.status_code == 302
    assert response.headers["location"] == "https://partner.com/affiliate?id=123"


def test_redirect_logs_click_with_metadata(client: TestClient) -> None:
    """Test that click is logged with request metadata."""
    link = make_test_link()
    signature = generate_signature(TEST_LINK_ID, None, None, "in_app")

    with (
        patch("app.api.outbound.verify_signature", return_value=True),
        patch(
            "app.api.outbound.get_link_by_id", new_callable=AsyncMock, return_value=link
        ),
        patch(
            "app.api.outbound.log_click_async", new_callable=AsyncMock
        ) as mock_log,
    ):
        response = client.get(
            f"/o/{TEST_LINK_ID}?src=in_app&sig={signature}",
            headers={
                "User-Agent": "Mozilla/5.0 TestBrowser",
                "Referer": "https://atlasi.app/l/my-list",
                "CF-IPCountry": "US",
            },
            follow_redirects=False,
        )

    assert response.status_code == 302
    mock_log.assert_called_once()
    click_data = mock_log.call_args[0][0]
    assert click_data.user_agent == "Mozilla/5.0 TestBrowser"
    assert click_data.referer == "https://atlasi.app/l/my-list"
    assert click_data.ip_country == "US"
    assert click_data.source == "in_app"


# ============================================================================
# Signature Validation Errors
# ============================================================================


def test_redirect_invalid_signature_returns_400(client: TestClient) -> None:
    """Test that invalid signature returns 400."""
    with patch("app.api.outbound.verify_signature", return_value=False):
        response = client.get(
            f"/o/{TEST_LINK_ID}?src=list_share&sig=invalid_signature",
            follow_redirects=False,
        )

    assert response.status_code == 400
    assert "Invalid or expired signature" in response.json()["detail"]


def test_redirect_missing_signature_returns_422(client: TestClient) -> None:
    """Test that missing signature returns 422 (validation error)."""
    response = client.get(
        f"/o/{TEST_LINK_ID}?src=list_share",
        follow_redirects=False,
    )

    assert response.status_code == 422


def test_redirect_empty_signature_returns_422(client: TestClient) -> None:
    """Test that empty signature returns 422 (validation error)."""
    response = client.get(
        f"/o/{TEST_LINK_ID}?src=list_share&sig=",
        follow_redirects=False,
    )

    assert response.status_code == 422


def test_redirect_missing_source_returns_422(client: TestClient) -> None:
    """Test that missing source parameter returns 422."""
    response = client.get(
        f"/o/{TEST_LINK_ID}?sig=some_signature",
        follow_redirects=False,
    )

    assert response.status_code == 422


# ============================================================================
# Link Not Found
# ============================================================================


def test_redirect_link_not_found_returns_404(client: TestClient) -> None:
    """Test that non-existent link returns 404."""
    with (
        patch("app.api.outbound.verify_signature", return_value=True),
        patch(
            "app.api.outbound.get_link_by_id", new_callable=AsyncMock, return_value=None
        ),
    ):
        response = client.get(
            f"/o/{TEST_LINK_ID}?src=list_share&sig=valid_signature",
            follow_redirects=False,
        )

    assert response.status_code == 404
    assert "Link not found" in response.json()["detail"]


# ============================================================================
# Link Status Errors (Paused/Archived)
# ============================================================================


def test_redirect_paused_link_returns_410(client: TestClient) -> None:
    """Test that paused link returns 410 Gone."""
    link = make_test_link(status=OutboundLinkStatus.PAUSED)

    with (
        patch("app.api.outbound.verify_signature", return_value=True),
        patch(
            "app.api.outbound.get_link_by_id", new_callable=AsyncMock, return_value=link
        ),
    ):
        response = client.get(
            f"/o/{TEST_LINK_ID}?src=list_share&sig=valid_signature",
            follow_redirects=False,
        )

    assert response.status_code == 410
    assert "temporarily unavailable" in response.json()["detail"]


def test_redirect_archived_link_returns_410(client: TestClient) -> None:
    """Test that archived link returns 410 Gone."""
    link = make_test_link(status=OutboundLinkStatus.ARCHIVED)

    with (
        patch("app.api.outbound.verify_signature", return_value=True),
        patch(
            "app.api.outbound.get_link_by_id", new_callable=AsyncMock, return_value=link
        ),
    ):
        response = client.get(
            f"/o/{TEST_LINK_ID}?src=list_share&sig=valid_signature",
            follow_redirects=False,
        )

    assert response.status_code == 410
    assert "no longer available" in response.json()["detail"]


# ============================================================================
# Invalid Input Validation
# ============================================================================


def test_redirect_invalid_link_id_format_returns_422(client: TestClient) -> None:
    """Test that invalid UUID format for link_id returns 422."""
    response = client.get(
        "/o/not-a-valid-uuid?src=list_share&sig=some_signature",
        follow_redirects=False,
    )

    assert response.status_code == 422


def test_redirect_invalid_trip_id_format_returns_422(client: TestClient) -> None:
    """Test that invalid UUID format for trip_id returns 422."""
    response = client.get(
        f"/o/{TEST_LINK_ID}?src=list_share&sig=some_signature&trip_id=not-a-uuid",
        follow_redirects=False,
    )

    assert response.status_code == 422


def test_redirect_invalid_entry_id_format_returns_422(client: TestClient) -> None:
    """Test that invalid UUID format for entry_id returns 422."""
    response = client.get(
        f"/o/{TEST_LINK_ID}?src=list_share&sig=some_signature&entry_id=invalid",
        follow_redirects=False,
    )

    assert response.status_code == 422


# ============================================================================
# Resolution Path Tests
# ============================================================================


def test_redirect_resolution_path_original(client: TestClient) -> None:
    """Test that resolution path is 'original' when no affiliate URL."""
    link = make_test_link()

    with (
        patch("app.api.outbound.verify_signature", return_value=True),
        patch(
            "app.api.outbound.get_link_by_id", new_callable=AsyncMock, return_value=link
        ),
        patch(
            "app.api.outbound.log_click_async", new_callable=AsyncMock
        ) as mock_log,
    ):
        response = client.get(
            f"/o/{TEST_LINK_ID}?src=list_share&sig=valid",
            follow_redirects=False,
        )

    assert response.status_code == 302
    click_data = mock_log.call_args[0][0]
    assert click_data.resolution == ResolutionPath.ORIGINAL


def test_redirect_resolution_path_direct_partner(client: TestClient) -> None:
    """Test that resolution path is 'direct_partner' when using non-Skimlinks affiliate URL."""
    link = make_test_link(
        affiliate_url="https://booking.com/affiliate",
        partner_slug="booking",
    )

    with (
        patch("app.api.outbound.verify_signature", return_value=True),
        patch(
            "app.api.outbound.get_link_by_id", new_callable=AsyncMock, return_value=link
        ),
        patch(
            "app.api.outbound.log_click_async", new_callable=AsyncMock
        ) as mock_log,
    ):
        response = client.get(
            f"/o/{TEST_LINK_ID}?src=list_share&sig=valid",
            follow_redirects=False,
        )

    assert response.status_code == 302
    click_data = mock_log.call_args[0][0]
    assert click_data.resolution == ResolutionPath.DIRECT_PARTNER


def test_redirect_resolution_path_skimlinks(client: TestClient) -> None:
    """Test that resolution path is 'skimlinks' when using Skimlinks affiliate URL."""
    link = make_test_link(
        affiliate_url="https://go.skimresources.com/?id=123",
        partner_slug="skimlinks",
    )

    with (
        patch("app.api.outbound.verify_signature", return_value=True),
        patch(
            "app.api.outbound.get_link_by_id", new_callable=AsyncMock, return_value=link
        ),
        patch(
            "app.api.outbound.log_click_async", new_callable=AsyncMock
        ) as mock_log,
    ):
        response = client.get(
            f"/o/{TEST_LINK_ID}?src=list_share&sig=valid",
            follow_redirects=False,
        )

    assert response.status_code == 302
    click_data = mock_log.call_args[0][0]
    assert click_data.resolution == ResolutionPath.SKIMLINKS


# ============================================================================
# Signature Generation/Verification Tests
# ============================================================================


def test_signature_generation_is_deterministic() -> None:
    """Test that signature generation produces consistent results."""
    sig1 = generate_signature(TEST_LINK_ID, TEST_TRIP_ID, TEST_ENTRY_ID, "list_share")
    sig2 = generate_signature(TEST_LINK_ID, TEST_TRIP_ID, TEST_ENTRY_ID, "list_share")
    assert sig1 == sig2


def test_signature_differs_with_different_params() -> None:
    """Test that signatures differ with different parameters."""
    sig1 = generate_signature(TEST_LINK_ID, TEST_TRIP_ID, None, "list_share")
    sig2 = generate_signature(TEST_LINK_ID, None, TEST_ENTRY_ID, "list_share")
    sig3 = generate_signature(TEST_LINK_ID, TEST_TRIP_ID, TEST_ENTRY_ID, "in_app")
    assert sig1 != sig2
    assert sig2 != sig3
    assert sig1 != sig3


def test_signature_with_none_values() -> None:
    """Test that signatures work with None values."""
    sig = generate_signature(TEST_LINK_ID, None, None, "list_share")
    assert sig is not None
    assert len(sig) == 64  # SHA256 hex digest length


# ============================================================================
# Edge Cases
# ============================================================================


def test_redirect_truncates_long_user_agent(client: TestClient) -> None:
    """Test that very long user agents are truncated."""
    link = make_test_link()
    long_ua = "A" * 1000

    with (
        patch("app.api.outbound.verify_signature", return_value=True),
        patch(
            "app.api.outbound.get_link_by_id", new_callable=AsyncMock, return_value=link
        ),
        patch(
            "app.api.outbound.log_click_async", new_callable=AsyncMock
        ) as mock_log,
    ):
        response = client.get(
            f"/o/{TEST_LINK_ID}?src=list_share&sig=valid",
            headers={"User-Agent": long_ua},
            follow_redirects=False,
        )

    assert response.status_code == 302
    click_data = mock_log.call_args[0][0]
    assert len(click_data.user_agent) == 500


def test_redirect_truncates_long_referer(client: TestClient) -> None:
    """Test that very long referer headers are truncated."""
    link = make_test_link()
    long_referer = "https://example.com/" + "a" * 3000

    with (
        patch("app.api.outbound.verify_signature", return_value=True),
        patch(
            "app.api.outbound.get_link_by_id", new_callable=AsyncMock, return_value=link
        ),
        patch(
            "app.api.outbound.log_click_async", new_callable=AsyncMock
        ) as mock_log,
    ):
        response = client.get(
            f"/o/{TEST_LINK_ID}?src=list_share&sig=valid",
            headers={"Referer": long_referer},
            follow_redirects=False,
        )

    assert response.status_code == 302
    click_data = mock_log.call_args[0][0]
    assert len(click_data.referer) == 2048


def test_redirect_handles_vercel_ip_country_header(client: TestClient) -> None:
    """Test that X-Vercel-IP-Country header is used when CF-IPCountry is not present."""
    link = make_test_link()

    with (
        patch("app.api.outbound.verify_signature", return_value=True),
        patch(
            "app.api.outbound.get_link_by_id", new_callable=AsyncMock, return_value=link
        ),
        patch(
            "app.api.outbound.log_click_async", new_callable=AsyncMock
        ) as mock_log,
    ):
        response = client.get(
            f"/o/{TEST_LINK_ID}?src=list_share&sig=valid",
            headers={"X-Vercel-IP-Country": "CA"},
            follow_redirects=False,
        )

    assert response.status_code == 302
    click_data = mock_log.call_args[0][0]
    assert click_data.ip_country == "CA"


def test_redirect_prefers_cf_ipcountry_over_vercel(client: TestClient) -> None:
    """Test that CF-IPCountry takes precedence over X-Vercel-IP-Country."""
    link = make_test_link()

    with (
        patch("app.api.outbound.verify_signature", return_value=True),
        patch(
            "app.api.outbound.get_link_by_id", new_callable=AsyncMock, return_value=link
        ),
        patch(
            "app.api.outbound.log_click_async", new_callable=AsyncMock
        ) as mock_log,
    ):
        response = client.get(
            f"/o/{TEST_LINK_ID}?src=list_share&sig=valid",
            headers={
                "CF-IPCountry": "GB",
                "X-Vercel-IP-Country": "CA",
            },
            follow_redirects=False,
        )

    assert response.status_code == 302
    click_data = mock_log.call_args[0][0]
    assert click_data.ip_country == "GB"
