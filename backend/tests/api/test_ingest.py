"""Tests for social ingest API endpoints."""

from unittest.mock import AsyncMock, patch

import pytest
from fastapi.testclient import TestClient

from app.core.security import AuthUser, get_current_user
from app.main import app
from app.schemas.social_ingest import (
    DetectedPlace,
    OEmbedResponse,
    SocialProvider,
)

# Test constants
TEST_USER_ID = "550e8400-e29b-41d4-a716-446655440000"
TEST_TRIP_ID = "550e8400-e29b-41d4-a716-446655440002"
TEST_ENTRY_ID = "550e8400-e29b-41d4-a716-446655440003"


@pytest.fixture
def client() -> TestClient:
    """Create test client."""
    return TestClient(app)


@pytest.fixture
def mock_user() -> AuthUser:
    """Create mock authenticated user."""
    return AuthUser(user_id=TEST_USER_ID, email="test@example.com")


@pytest.fixture
def auth_override(mock_user):
    """Override auth dependency."""

    async def override():
        return mock_user

    return override


class TestIngestSocialUrl:
    """Tests for POST /ingest/social endpoint."""

    def test_rejects_unauthenticated_request(self, client):
        response = client.post(
            "/ingest/social",
            json={"url": "https://www.tiktok.com/@user/video/123"},
        )
        # FastAPI returns 403 Forbidden when no auth is provided
        assert response.status_code in (401, 403)

    def test_rejects_unsupported_url(self, client, auth_override):
        app.dependency_overrides[get_current_user] = auth_override

        try:
            with patch("app.api.ingest.canonicalize_url") as mock_canonicalize:
                mock_canonicalize.return_value = (
                    "https://youtube.com/watch?v=123",
                    None,
                )

                with patch("app.api.ingest.detect_provider") as mock_detect:
                    mock_detect.return_value = None

                    response = client.post(
                        "/ingest/social",
                        json={"url": "https://youtube.com/watch?v=123"},
                        headers={"Authorization": "Bearer test-token"},
                    )

                    assert response.status_code == 400
                    assert "not from a supported provider" in response.json()["detail"]
        finally:
            app.dependency_overrides.clear()

    def test_ingests_tiktok_url_successfully(self, client, auth_override):
        app.dependency_overrides[get_current_user] = auth_override

        mock_oembed = OEmbedResponse(
            title="Amazing restaurant in Bali",
            author_name="foodie123",
            thumbnail_url="https://p16-sign.tiktokcdn.com/123.jpg",
            raw={"title": "Amazing restaurant in Bali"},
        )

        mock_place = DetectedPlace(
            google_place_id="ChIJ123",
            name="Beach Restaurant",
            address="Bali, Indonesia",
            country="Indonesia",
            country_code="ID",
            confidence=0.85,
        )

        try:
            with patch("app.api.ingest.canonicalize_url") as mock_canonicalize:
                mock_canonicalize.return_value = (
                    "https://www.tiktok.com/@foodie123/video/123",
                    SocialProvider.TIKTOK,
                )

                with patch("app.api.ingest.fetch_oembed") as mock_fetch:
                    mock_fetch.return_value = mock_oembed

                    with patch("app.api.ingest.extract_place") as mock_extract:
                        mock_extract.return_value = mock_place

                        response = client.post(
                            "/ingest/social",
                            json={"url": "https://vm.tiktok.com/short"},
                            headers={"Authorization": "Bearer test-token"},
                        )

                        assert response.status_code == 200
                        data = response.json()
                        assert data["provider"] == "tiktok"
                        assert (
                            data["canonical_url"]
                            == "https://www.tiktok.com/@foodie123/video/123"
                        )
                        assert (
                            data["thumbnail_url"]
                            == "https://p16-sign.tiktokcdn.com/123.jpg"
                        )
                        assert data["detected_place"]["name"] == "Beach Restaurant"
                        assert data["detected_place"]["country_code"] == "ID"
        finally:
            app.dependency_overrides.clear()

    def test_ingests_url_without_place_detection(self, client, auth_override):
        app.dependency_overrides[get_current_user] = auth_override

        mock_oembed = OEmbedResponse(
            title="Random dance video",
            author_name="dancer99",
            thumbnail_url="https://p16-sign.tiktokcdn.com/456.jpg",
            raw={"title": "Random dance video"},
        )

        try:
            with patch("app.api.ingest.canonicalize_url") as mock_canonicalize:
                mock_canonicalize.return_value = (
                    "https://www.tiktok.com/@dancer99/video/456",
                    SocialProvider.TIKTOK,
                )

                with patch("app.api.ingest.fetch_oembed") as mock_fetch:
                    mock_fetch.return_value = mock_oembed

                    with patch("app.api.ingest.extract_place") as mock_extract:
                        mock_extract.return_value = None  # No place detected

                        response = client.post(
                            "/ingest/social",
                            json={"url": "https://www.tiktok.com/@dancer99/video/456"},
                            headers={"Authorization": "Bearer test-token"},
                        )

                        assert response.status_code == 200
                        data = response.json()
                        assert data["detected_place"] is None
        finally:
            app.dependency_overrides.clear()

    def test_ingests_instagram_url(self, client, auth_override):
        app.dependency_overrides[get_current_user] = auth_override

        mock_oembed = OEmbedResponse(
            title="Sunset at the beach",
            author_name="travel_lover",
            thumbnail_url="https://instagram.com/media/789.jpg",
            raw={"title": "Sunset at the beach"},
        )

        try:
            with patch("app.api.ingest.canonicalize_url") as mock_canonicalize:
                mock_canonicalize.return_value = (
                    "https://www.instagram.com/reel/ABC123",
                    SocialProvider.INSTAGRAM,
                )

                with patch("app.api.ingest.fetch_oembed") as mock_fetch:
                    mock_fetch.return_value = mock_oembed

                    with patch("app.api.ingest.extract_place") as mock_extract:
                        mock_extract.return_value = None

                        response = client.post(
                            "/ingest/social",
                            json={
                                "url": "https://www.instagram.com/reel/ABC123",
                                "caption": "Check this out!",
                            },
                            headers={"Authorization": "Bearer test-token"},
                        )

                        assert response.status_code == 200
                        data = response.json()
                        assert data["provider"] == "instagram"
        finally:
            app.dependency_overrides.clear()


class TestSaveToTrip:
    """Tests for POST /ingest/save-to-trip endpoint."""

    def test_rejects_unauthenticated_request(self, client):
        response = client.post(
            "/ingest/save-to-trip",
            json={
                "trip_id": TEST_TRIP_ID,
                "provider": "tiktok",
                "canonical_url": "https://www.tiktok.com/@user/video/123",
            },
        )
        # FastAPI returns 403 Forbidden when no auth is provided
        assert response.status_code in (401, 403)

    def test_returns_404_for_missing_trip(self, client, auth_override):
        app.dependency_overrides[get_current_user] = auth_override

        try:
            with patch("app.api.ingest.get_supabase_client") as mock_db:
                mock_client = AsyncMock()
                mock_client.get = AsyncMock(return_value=[])  # No trip found
                mock_db.return_value = mock_client

                with patch("app.api.ingest.get_token_from_request"):
                    response = client.post(
                        "/ingest/save-to-trip",
                        json={
                            "trip_id": TEST_TRIP_ID,
                            "provider": "tiktok",
                            "canonical_url": "https://www.tiktok.com/@user/video/123",
                        },
                        headers={"Authorization": "Bearer test-token"},
                    )

                    assert response.status_code == 404
                    assert "Trip not found" in response.json()["detail"]
        finally:
            app.dependency_overrides.clear()

    def test_saves_to_trip_with_place(self, client, auth_override):
        app.dependency_overrides[get_current_user] = auth_override

        try:
            with patch("app.api.ingest.get_supabase_client") as mock_db:
                mock_client = AsyncMock()

                # Get trip
                mock_client.get = AsyncMock(return_value=[{"id": TEST_TRIP_ID}])

                # Atomic RPC call returns entry_row and place_row in JSONB format
                mock_client.rpc = AsyncMock(
                    return_value=[
                        {
                            "entry_row": {
                                "id": TEST_ENTRY_ID,
                                "trip_id": TEST_TRIP_ID,
                                "type": "place",
                                "title": "Beach Restaurant",
                                "notes": None,
                                "link": "https://www.tiktok.com/@user/video/123",
                                "metadata": {
                                    "source_type": "social_ingest",
                                    "provider": "tiktok",
                                    "author_handle": "foodie123",
                                    "thumbnail_url": "https://p16-sign.tiktokcdn.com/123.jpg",
                                },
                                "date": None,
                                "created_at": "2024-01-01T00:00:00Z",
                                "deleted_at": None,
                            },
                            "place_row": {
                                "id": "550e8400-e29b-41d4-a716-446655440011",
                                "entry_id": TEST_ENTRY_ID,
                                "google_place_id": "ChIJ123",
                                "place_name": "Beach Restaurant",
                                "lat": -8.409518,
                                "lng": 115.188919,
                                "address": "Bali, Indonesia",
                                "extra_data": {
                                    "google_photo_url": "https://maps.googleapis.com/photo.jpg"
                                },
                            },
                        }
                    ]
                )

                mock_db.return_value = mock_client

                with patch("app.api.ingest.get_token_from_request"):
                    response = client.post(
                        "/ingest/save-to-trip",
                        json={
                            "trip_id": TEST_TRIP_ID,
                            "provider": "tiktok",
                            "canonical_url": "https://www.tiktok.com/@user/video/123",
                            "thumbnail_url": "https://p16-sign.tiktokcdn.com/123.jpg",
                            "author_handle": "foodie123",
                            "title": "Amazing restaurant",
                            "place": {
                                "google_place_id": "ChIJ123",
                                "name": "Beach Restaurant",
                                "address": "Bali, Indonesia",
                                "latitude": -8.409518,
                                "longitude": 115.188919,
                                "country": "Indonesia",
                                "country_code": "ID",
                                "confidence": 0.85,
                                "google_photo_url": "https://maps.googleapis.com/photo.jpg",
                            },
                        },
                        headers={"Authorization": "Bearer test-token"},
                    )

                    assert response.status_code == 201
                    data = response.json()
                    assert data["id"] == TEST_ENTRY_ID
                    assert data["place"]["place_name"] == "Beach Restaurant"
                    assert (
                        data["place"]["extra_data"]["google_photo_url"]
                        == "https://maps.googleapis.com/photo.jpg"
                    )
        finally:
            app.dependency_overrides.clear()

    def test_saves_to_trip_strips_invalid_google_photo_url(self, client, auth_override):
        app.dependency_overrides[get_current_user] = auth_override

        try:
            with patch("app.api.ingest.get_supabase_client") as mock_db:
                mock_client = AsyncMock()
                mock_client.get = AsyncMock(return_value=[{"id": TEST_TRIP_ID}])
                mock_client.rpc = AsyncMock(
                    return_value=[
                        {
                            "entry_row": {
                                "id": TEST_ENTRY_ID,
                                "trip_id": TEST_TRIP_ID,
                                "type": "place",
                                "title": "Beach Restaurant",
                                "notes": None,
                                "link": "https://www.tiktok.com/@user/video/123",
                                "metadata": {},
                                "date": None,
                                "created_at": "2024-01-01T00:00:00Z",
                                "deleted_at": None,
                            },
                            "place_row": {
                                "id": "550e8400-e29b-41d4-a716-446655440011",
                                "entry_id": TEST_ENTRY_ID,
                                "google_place_id": "ChIJ123",
                                "place_name": "Beach Restaurant",
                                "lat": -8.409518,
                                "lng": 115.188919,
                                "address": "Bali, Indonesia",
                                "extra_data": {},
                            },
                        }
                    ]
                )

                mock_db.return_value = mock_client

                with patch("app.api.ingest.get_token_from_request"):
                    response = client.post(
                        "/ingest/save-to-trip",
                        json={
                            "trip_id": TEST_TRIP_ID,
                            "provider": "tiktok",
                            "canonical_url": "https://www.tiktok.com/@user/video/123",
                            "place": {
                                "google_place_id": "ChIJ123",
                                "name": "Beach Restaurant",
                                "address": "Bali, Indonesia",
                                "latitude": -8.409518,
                                "longitude": 115.188919,
                                "country": "Indonesia",
                                "country_code": "ID",
                                "confidence": 0.85,
                                "google_photo_url": "https://evil.com/photo.jpg",
                            },
                        },
                        headers={"Authorization": "Bearer test-token"},
                    )

                    assert response.status_code == 201
                    args, kwargs = mock_client.rpc.await_args
                    payload = args[1]
                    assert (
                        "google_photo_url" not in payload["p_place_data"]["extra_data"]
                    )
        finally:
            app.dependency_overrides.clear()

    def test_saves_to_trip_without_place(self, client, auth_override):
        app.dependency_overrides[get_current_user] = auth_override

        try:
            with patch("app.api.ingest.get_supabase_client") as mock_db:
                mock_client = AsyncMock()
                mock_client.get = AsyncMock(return_value=[{"id": TEST_TRIP_ID}])
                mock_client.rpc = AsyncMock(
                    return_value=[
                        {
                            "entry_row": {
                                "id": TEST_ENTRY_ID,
                                "trip_id": TEST_TRIP_ID,
                                "type": "place",
                                "title": "Amazing restaurant",
                                "notes": "Check this out!",
                                "link": "https://www.tiktok.com/@user/video/123",
                                "metadata": {
                                    "source_type": "social_ingest",
                                    "provider": "tiktok",
                                },
                                "date": None,
                                "created_at": "2024-01-01T00:00:00Z",
                                "deleted_at": None,
                            },
                            "place_row": None,
                        }
                    ]
                )

                mock_db.return_value = mock_client

                with patch("app.api.ingest.get_token_from_request"):
                    response = client.post(
                        "/ingest/save-to-trip",
                        json={
                            "trip_id": TEST_TRIP_ID,
                            "provider": "tiktok",
                            "canonical_url": "https://www.tiktok.com/@user/video/123",
                            "title": "Amazing restaurant",
                            "notes": "Check this out!",
                        },
                        headers={"Authorization": "Bearer test-token"},
                    )

                    assert response.status_code == 201
                    data = response.json()
                    assert data["id"] == TEST_ENTRY_ID
                    assert data["title"] == "Amazing restaurant"
                    assert data["place"] is None
        finally:
            app.dependency_overrides.clear()
