"""Tests for admin affiliate link management endpoints."""

from datetime import UTC, datetime
from unittest.mock import AsyncMock, patch
from uuid import uuid4

import pytest
from fastapi.testclient import TestClient

from app.main import app


@pytest.fixture
def service_role_headers() -> dict[str, str]:
    """Headers with valid service role key."""
    return {"Authorization": "Bearer test-service-role-key"}


@pytest.fixture
def mock_settings():
    """Mock settings with test service role key."""
    with patch("app.core.security.get_settings") as mock:
        mock.return_value.supabase_service_role_key = "test-service-role-key"
        yield mock


class TestAdminAuth:
    """Tests for admin authentication."""

    def test_requires_authorization_header(self) -> None:
        """Test that endpoints require Authorization header."""
        client = TestClient(app)
        response = client.get("/admin/links")
        assert response.status_code == 401
        assert "Authorization required" in response.json()["detail"]

    def test_rejects_invalid_service_role_key(self, mock_settings) -> None:
        """Test that invalid service role key is rejected."""
        client = TestClient(app)
        response = client.get(
            "/admin/links",
            headers={"Authorization": "Bearer wrong-key"},
        )
        assert response.status_code == 403
        assert "Admin access required" in response.json()["detail"]

    def test_accepts_valid_service_role_key(
        self, mock_settings, service_role_headers
    ) -> None:
        """Test that valid service role key is accepted."""
        with patch("app.api.admin.get_supabase_client") as mock_db:
            mock_db.return_value.get = AsyncMock(return_value=[])

            client = TestClient(app)
            response = client.get("/admin/links", headers=service_role_headers)

            # Should not be 401 or 403
            assert response.status_code == 200


class TestListLinks:
    """Tests for GET /admin/links endpoint."""

    def test_returns_empty_list_when_no_links(
        self, mock_settings, service_role_headers
    ) -> None:
        """Test that empty list is returned when no links exist."""
        with patch("app.api.admin.get_supabase_client") as mock_db:
            mock_db.return_value.get = AsyncMock(return_value=[])

            client = TestClient(app)
            response = client.get("/admin/links", headers=service_role_headers)

            assert response.status_code == 200
            data = response.json()
            assert data["links"] == []
            assert data["total"] == 0
            assert data["limit"] == 50
            assert data["offset"] == 0

    def test_returns_links_with_click_counts(
        self, mock_settings, service_role_headers
    ) -> None:
        """Test that links are returned with click counts."""
        link_id = str(uuid4())
        entry_id = str(uuid4())
        now = datetime.now(UTC).isoformat()

        mock_link = {
            "id": link_id,
            "entry_id": entry_id,
            "destination_url": "https://example.com",
            "affiliate_url": None,
            "status": "active",
            "created_at": now,
            "updated_at": now,
        }

        with patch("app.api.admin.get_supabase_client") as mock_db:
            # First call for links, second for count, third+ for click counts
            mock_db.return_value.get = AsyncMock(
                side_effect=[
                    [mock_link],  # links query
                    [mock_link],  # count query
                    [{"id": "click1"}, {"id": "click2"}],  # click count for link
                ]
            )

            client = TestClient(app)
            response = client.get("/admin/links", headers=service_role_headers)

            assert response.status_code == 200
            data = response.json()
            assert len(data["links"]) == 1
            assert data["links"][0]["id"] == link_id
            assert data["links"][0]["click_count"] == 2

    def test_filters_by_status(self, mock_settings, service_role_headers) -> None:
        """Test that links can be filtered by status."""
        with patch("app.api.admin.get_supabase_client") as mock_db:
            mock_db.return_value.get = AsyncMock(return_value=[])

            client = TestClient(app)
            response = client.get(
                "/admin/links?status=paused",
                headers=service_role_headers,
            )

            assert response.status_code == 200

            # Verify filter was applied
            calls = mock_db.return_value.get.call_args_list
            assert any("eq.paused" in str(call) for call in calls)

    def test_respects_pagination(self, mock_settings, service_role_headers) -> None:
        """Test that pagination parameters are respected."""
        with patch("app.api.admin.get_supabase_client") as mock_db:
            mock_db.return_value.get = AsyncMock(return_value=[])

            client = TestClient(app)
            response = client.get(
                "/admin/links?limit=10&offset=20",
                headers=service_role_headers,
            )

            assert response.status_code == 200
            data = response.json()
            assert data["limit"] == 10
            assert data["offset"] == 20


class TestGetLinkDetail:
    """Tests for GET /admin/links/{link_id} endpoint."""

    def test_returns_404_for_nonexistent_link(
        self, mock_settings, service_role_headers
    ) -> None:
        """Test that 404 is returned for nonexistent link."""
        with patch("app.api.admin.get_supabase_client") as mock_db:
            mock_db.return_value.get = AsyncMock(return_value=[])

            client = TestClient(app)
            response = client.get(
                f"/admin/links/{uuid4()}",
                headers=service_role_headers,
            )

            assert response.status_code == 404

    def test_returns_link_with_recent_clicks(
        self, mock_settings, service_role_headers
    ) -> None:
        """Test that link detail includes recent clicks."""
        link_id = str(uuid4())
        entry_id = str(uuid4())
        now = datetime.now(UTC).isoformat()

        mock_link = {
            "id": link_id,
            "entry_id": entry_id,
            "destination_url": "https://example.com",
            "affiliate_url": "https://affiliate.example.com",
            "status": "active",
            "created_at": now,
            "updated_at": now,
        }

        mock_click = {
            "id": str(uuid4()),
            "source": "list_share",
            "resolution": "skimlinks",
            "ip_country": "US",
            "user_agent": "Mozilla/5.0",
            "created_at": now,
        }

        with patch("app.api.admin.get_supabase_client") as mock_db:
            mock_db.return_value.get = AsyncMock(
                side_effect=[
                    [mock_link],  # link query
                    [{"id": "1"}, {"id": "2"}, {"id": "3"}],  # all clicks for count
                    [mock_click],  # recent clicks
                ]
            )

            client = TestClient(app)
            response = client.get(
                f"/admin/links/{link_id}",
                headers=service_role_headers,
            )

            assert response.status_code == 200
            data = response.json()
            assert data["id"] == link_id
            assert data["click_count"] == 3
            assert len(data["recent_clicks"]) == 1
            assert data["recent_clicks"][0]["source"] == "list_share"


class TestUpdateLink:
    """Tests for PATCH /admin/links/{link_id} endpoint."""

    def test_returns_404_for_nonexistent_link(
        self, mock_settings, service_role_headers
    ) -> None:
        """Test that 404 is returned for nonexistent link."""
        with patch("app.api.admin.get_supabase_client") as mock_db:
            mock_db.return_value.get = AsyncMock(return_value=[])

            client = TestClient(app)
            response = client.patch(
                f"/admin/links/{uuid4()}",
                headers=service_role_headers,
                json={"status": "paused"},
            )

            assert response.status_code == 404

    def test_updates_link_status(self, mock_settings, service_role_headers) -> None:
        """Test that link status can be updated."""
        link_id = str(uuid4())
        entry_id = str(uuid4())
        now = datetime.now(UTC).isoformat()

        mock_link = {
            "id": link_id,
            "entry_id": entry_id,
            "destination_url": "https://example.com",
            "affiliate_url": None,
            "status": "active",
            "created_at": now,
            "updated_at": now,
        }

        updated_link = {**mock_link, "status": "paused"}

        with patch("app.api.admin.get_supabase_client") as mock_db:
            mock_db.return_value.get = AsyncMock(
                side_effect=[
                    [mock_link],  # verify exists
                    [],  # click count
                ]
            )
            mock_db.return_value.update = AsyncMock(return_value=[updated_link])

            client = TestClient(app)
            response = client.patch(
                f"/admin/links/{link_id}",
                headers=service_role_headers,
                json={"status": "paused"},
            )

            assert response.status_code == 200
            data = response.json()
            assert data["status"] == "paused"

    def test_updates_affiliate_url(self, mock_settings, service_role_headers) -> None:
        """Test that affiliate URL can be overridden."""
        link_id = str(uuid4())
        entry_id = str(uuid4())
        now = datetime.now(UTC).isoformat()

        mock_link = {
            "id": link_id,
            "entry_id": entry_id,
            "destination_url": "https://example.com",
            "affiliate_url": None,
            "status": "active",
            "created_at": now,
            "updated_at": now,
        }

        new_affiliate_url = "https://custom-affiliate.example.com"
        updated_link = {**mock_link, "affiliate_url": new_affiliate_url}

        with patch("app.api.admin.get_supabase_client") as mock_db:
            mock_db.return_value.get = AsyncMock(
                side_effect=[
                    [mock_link],  # verify exists
                    [],  # click count
                ]
            )
            mock_db.return_value.update = AsyncMock(return_value=[updated_link])

            client = TestClient(app)
            response = client.patch(
                f"/admin/links/{link_id}",
                headers=service_role_headers,
                json={"affiliate_url": new_affiliate_url},
            )

            assert response.status_code == 200
            data = response.json()
            assert data["affiliate_url"] == new_affiliate_url


class TestStatsSummary:
    """Tests for GET /admin/links/stats/summary endpoint."""

    def test_returns_empty_stats_when_no_clicks(
        self, mock_settings, service_role_headers
    ) -> None:
        """Test that empty stats are returned when no clicks."""
        with patch("app.api.admin.get_supabase_client") as mock_db:
            mock_db.return_value.get = AsyncMock(return_value=[])

            client = TestClient(app)
            response = client.get(
                "/admin/links/stats/summary",
                headers=service_role_headers,
            )

            assert response.status_code == 200
            data = response.json()
            assert data["total_clicks"] == 0
            assert data["unique_links_clicked"] == 0
            assert data["clicks_by_source"] == {}
            assert data["clicks_by_resolution"] == {}
            assert data["top_destinations"] == []
            assert data["period_days"] == 7

    def test_calculates_stats_correctly(
        self, mock_settings, service_role_headers
    ) -> None:
        """Test that stats are calculated correctly."""
        link_id1 = str(uuid4())
        link_id2 = str(uuid4())

        mock_clicks = [
            {
                "id": str(uuid4()),
                "link_id": link_id1,
                "source": "list_share",
                "resolution": "skimlinks",
                "destination_url": "https://booking.com/hotel1",
            },
            {
                "id": str(uuid4()),
                "link_id": link_id1,
                "source": "list_share",
                "resolution": "skimlinks",
                "destination_url": "https://booking.com/hotel2",
            },
            {
                "id": str(uuid4()),
                "link_id": link_id2,
                "source": "trip_share",
                "resolution": "original",
                "destination_url": "https://tripadvisor.com/place1",
            },
        ]

        with patch("app.api.admin.get_supabase_client") as mock_db:
            mock_db.return_value.get = AsyncMock(return_value=mock_clicks)

            client = TestClient(app)
            response = client.get(
                "/admin/links/stats/summary?days=30",
                headers=service_role_headers,
            )

            assert response.status_code == 200
            data = response.json()
            assert data["total_clicks"] == 3
            assert data["unique_links_clicked"] == 2
            assert data["clicks_by_source"]["list_share"] == 2
            assert data["clicks_by_source"]["trip_share"] == 1
            assert data["clicks_by_resolution"]["skimlinks"] == 2
            assert data["clicks_by_resolution"]["original"] == 1
            assert data["period_days"] == 30
            # Check top destinations
            assert len(data["top_destinations"]) == 2
            domains = [d["domain"] for d in data["top_destinations"]]
            assert "booking.com" in domains
            assert "tripadvisor.com" in domains
