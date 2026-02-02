"""Tests for social ingest API endpoints."""

from unittest.mock import AsyncMock, MagicMock, patch

import pytest
from fastapi.testclient import TestClient

from app.core.security import AuthUser, get_current_user
from app.main import app
from app.schemas.social_ingest import (
    DetectedPlace,
    OEmbedResponse,
    SocialProvider,
)
from app.services.extraction_orchestrator import ExtractionResult

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

                    with patch(
                        "app.api.ingest.ExtractionOrchestrator"
                    ) as mock_orchestrator_class:
                        # Mock the orchestrator instance and its extract method
                        mock_orchestrator = MagicMock()
                        mock_orchestrator.extract = AsyncMock(
                            return_value=ExtractionResult(
                                places=[mock_place],
                                method="regex",
                                source="caption",
                                skip_to_video=False,
                                context_location=None,
                                latency_ms=100,
                                from_cache=False,
                            )
                        )
                        mock_orchestrator_class.return_value = mock_orchestrator

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
                        assert data["extraction_method_used"] == "regex"
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

                    with patch(
                        "app.api.ingest.ExtractionOrchestrator"
                    ) as mock_orchestrator_class:
                        # Mock the orchestrator instance - no place detected
                        mock_orchestrator = MagicMock()
                        mock_orchestrator.extract = AsyncMock(
                            return_value=ExtractionResult(
                                places=[],
                                method="none",
                                source="caption",
                                skip_to_video=False,
                                context_location=None,
                                latency_ms=50,
                                from_cache=False,
                            )
                        )
                        mock_orchestrator_class.return_value = mock_orchestrator

                        response = client.post(
                            "/ingest/social",
                            json={"url": "https://www.tiktok.com/@dancer99/video/456"},
                            headers={"Authorization": "Bearer test-token"},
                        )

                        assert response.status_code == 200
                        data = response.json()
                        assert data["detected_place"] is None
                        assert data["extraction_method_used"] == "none"
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

                    with patch(
                        "app.api.ingest.ExtractionOrchestrator"
                    ) as mock_orchestrator_class:
                        # Mock the orchestrator instance - no place detected
                        mock_orchestrator = MagicMock()
                        mock_orchestrator.extract = AsyncMock(
                            return_value=ExtractionResult(
                                places=[],
                                method="none",
                                source="caption",
                                skip_to_video=False,
                                context_location=None,
                                latency_ms=50,
                                from_cache=False,
                            )
                        )
                        mock_orchestrator_class.return_value = mock_orchestrator

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
                    # Get the first RPC call (atomic_create_entry_with_place)
                    # The second call is increment_share_extension_usage
                    first_call = mock_client.rpc.call_args_list[0]
                    assert first_call[0][0] == "atomic_create_entry_with_place"
                    payload = first_call[0][1]
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


class TestIngestInstagramProfile:
    """Tests for ingesting Instagram profile URLs."""

    def test_ingests_instagram_profile_url(self, client, auth_override):
        """Test that Instagram profile URLs are processed correctly."""
        app.dependency_overrides[get_current_user] = auth_override

        mock_oembed = OEmbedResponse(
            title="Commander's Palace (@commanderspalace)",
            thumbnail_url="https://instagram.com/profile.jpg",
            raw={
                "og:title": "Commander's Palace (@commanderspalace)",
                "og:description": "Historic New Orleans restaurant since 1893",
                "og:image": "https://instagram.com/profile.jpg",
            },
        )

        mock_place = DetectedPlace(
            google_place_id="ChIJ123",
            name="Commander's Palace",
            address="1403 Washington Ave, New Orleans, LA",
            country="United States",
            country_code="US",
            confidence=0.9,
        )

        try:
            with patch("app.api.ingest.canonicalize_url") as mock_canonicalize:
                mock_canonicalize.return_value = (
                    "https://www.instagram.com/commanderspalace",
                    SocialProvider.INSTAGRAM,
                )

                with patch("app.api.ingest.is_instagram_profile") as mock_is_profile:
                    mock_is_profile.return_value = True

                    with patch("app.api.ingest.fetch_oembed") as mock_fetch:
                        mock_fetch.return_value = mock_oembed

                        with patch(
                            "app.api.ingest.extract_place_from_profile"
                        ) as mock_extract:
                            mock_extract.return_value = mock_place

                            response = client.post(
                                "/ingest/social",
                                json={
                                    "url": "https://www.instagram.com/commanderspalace"
                                },
                                headers={"Authorization": "Bearer test-token"},
                            )

                            assert response.status_code == 200
                            data = response.json()
                            assert data["provider"] == "instagram"
                            assert (
                                data["canonical_url"]
                                == "https://www.instagram.com/commanderspalace"
                            )
                            assert (
                                data["detected_place"]["name"] == "Commander's Palace"
                            )
                            assert data["detected_place"]["country_code"] == "US"

                            # Verify fetch_oembed was called with is_profile=True
                            mock_fetch.assert_called_once()
                            call_kwargs = mock_fetch.call_args
                            assert call_kwargs.kwargs.get("is_profile") is True

                            # Verify extract_place_from_profile was called
                            mock_extract.assert_called_once()
        finally:
            app.dependency_overrides.clear()

    def test_profile_uses_clean_name_for_place_extraction(self, client, auth_override):
        """Test that the profile name is cleaned before place extraction."""
        app.dependency_overrides[get_current_user] = auth_override

        mock_oembed = OEmbedResponse(
            title="Joe's Cafe on Instagram",
            thumbnail_url="https://instagram.com/profile.jpg",
            raw={
                "og:title": "Joe's Cafe on Instagram",
                "og:description": "Best coffee in Vienna",
            },
        )

        try:
            with patch("app.api.ingest.canonicalize_url") as mock_canonicalize:
                mock_canonicalize.return_value = (
                    "https://www.instagram.com/joescafe",
                    SocialProvider.INSTAGRAM,
                )

                with patch("app.api.ingest.is_instagram_profile", return_value=True):
                    with patch("app.api.ingest.fetch_oembed", return_value=mock_oembed):
                        with patch(
                            "app.api.ingest.extract_place_from_profile"
                        ) as mock_extract:
                            mock_extract.return_value = None

                            response = client.post(
                                "/ingest/social",
                                json={"url": "https://www.instagram.com/joescafe"},
                                headers={"Authorization": "Bearer test-token"},
                            )

                            assert response.status_code == 200

                            # Verify the cleaned name was passed
                            # (should be "Joe's Cafe", not "Joe's Cafe on Instagram")
                            mock_extract.assert_called_once()
                            call_args = mock_extract.call_args
                            profile_name = call_args.args[0]
                            assert profile_name == "Joe's Cafe"
        finally:
            app.dependency_overrides.clear()

    def test_profile_passes_bio_for_location_hints(self, client, auth_override):
        """Test that profile bio is passed for location hint extraction."""
        app.dependency_overrides[get_current_user] = auth_override

        mock_oembed = OEmbedResponse(
            title="Trattoria Roma",
            thumbnail_url="https://instagram.com/profile.jpg",
            raw={
                "og:title": "Trattoria Roma",
                "og:description": "Authentic Italian cuisine in Rome, Italy",
            },
        )

        try:
            with patch("app.api.ingest.canonicalize_url") as mock_canonicalize:
                mock_canonicalize.return_value = (
                    "https://www.instagram.com/trattoriaroma",
                    SocialProvider.INSTAGRAM,
                )

                with patch("app.api.ingest.is_instagram_profile", return_value=True):
                    with patch("app.api.ingest.fetch_oembed", return_value=mock_oembed):
                        with patch(
                            "app.api.ingest.extract_place_from_profile"
                        ) as mock_extract:
                            mock_extract.return_value = None

                            response = client.post(
                                "/ingest/social",
                                json={"url": "https://www.instagram.com/trattoriaroma"},
                                headers={"Authorization": "Bearer test-token"},
                            )

                            assert response.status_code == 200

                            # Verify bio was passed as second argument
                            mock_extract.assert_called_once()
                            call_args = mock_extract.call_args
                            bio = call_args.args[1]
                            assert bio == "Authentic Italian cuisine in Rome, Italy"
        finally:
            app.dependency_overrides.clear()


class TestSavePlaces:
    """Tests for POST /ingest/save-places endpoint."""

    def test_returns_per_place_results_on_success(self, client, auth_override):
        """Test that the response includes per-place results with status."""
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
                                "title": "Test Place",
                                "notes": None,
                                "link": "https://www.tiktok.com/@user/video/123",
                                "metadata": {},
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
                        "/ingest/save-places",
                        json={
                            "trip_id": TEST_TRIP_ID,
                            "provider": "tiktok",
                            "canonical_url": "https://www.tiktok.com/@user/video/123",
                            "places": [
                                {"name": "Test Place", "entry_type": "place"},
                            ],
                        },
                        headers={"Authorization": "Bearer test-token"},
                    )

                    assert response.status_code == 201
                    data = response.json()
                    assert data["saved_count"] == 1
                    assert data["skipped_count"] == 0
                    assert len(data["results"]) == 1
                    assert data["results"][0]["place_name"] == "Test Place"
                    assert data["results"][0]["status"] == "saved"
                    assert data["results"][0]["entry_id"] == TEST_ENTRY_ID
                    assert data["results"][0]["error_message"] is None
        finally:
            app.dependency_overrides.clear()

    def test_returns_duplicate_status_for_duplicate_places(self, client, auth_override):
        """Test that duplicates are marked with 'duplicate' status."""
        from fastapi import HTTPException

        app.dependency_overrides[get_current_user] = auth_override

        try:
            with patch("app.api.ingest.get_supabase_client") as mock_db:
                mock_client = AsyncMock()
                mock_client.get = AsyncMock(return_value=[{"id": TEST_TRIP_ID}])

                # Simulate duplicate key error
                mock_client.rpc = AsyncMock(
                    side_effect=HTTPException(
                        status_code=409, detail="Unique constraint violated: duplicate"
                    )
                )
                mock_db.return_value = mock_client

                with patch("app.api.ingest.get_token_from_request"):
                    response = client.post(
                        "/ingest/save-places",
                        json={
                            "trip_id": TEST_TRIP_ID,
                            "provider": "tiktok",
                            "canonical_url": "https://www.tiktok.com/@user/video/123",
                            "places": [
                                {"name": "Duplicate Place", "entry_type": "place"},
                            ],
                        },
                        headers={"Authorization": "Bearer test-token"},
                    )

                    assert response.status_code == 201
                    data = response.json()
                    assert data["saved_count"] == 0
                    assert data["skipped_count"] == 1
                    assert len(data["results"]) == 1
                    assert data["results"][0]["place_name"] == "Duplicate Place"
                    assert data["results"][0]["status"] == "duplicate"
                    assert data["results"][0]["entry_id"] is None
                    assert "already exists" in data["results"][0]["error_message"]
        finally:
            app.dependency_overrides.clear()

    def test_returns_error_status_for_failed_places(self, client, auth_override):
        """Test that failures are marked with 'error' status and error message."""
        app.dependency_overrides[get_current_user] = auth_override

        try:
            with patch("app.api.ingest.get_supabase_client") as mock_db:
                mock_client = AsyncMock()
                mock_client.get = AsyncMock(return_value=[{"id": TEST_TRIP_ID}])

                # Simulate a general error
                mock_client.rpc = AsyncMock(
                    side_effect=Exception("Database connection failed")
                )
                mock_db.return_value = mock_client

                with patch("app.api.ingest.get_token_from_request"):
                    response = client.post(
                        "/ingest/save-places",
                        json={
                            "trip_id": TEST_TRIP_ID,
                            "provider": "tiktok",
                            "canonical_url": "https://www.tiktok.com/@user/video/123",
                            "places": [
                                {"name": "Failed Place", "entry_type": "place"},
                            ],
                        },
                        headers={"Authorization": "Bearer test-token"},
                    )

                    assert response.status_code == 201
                    data = response.json()
                    assert data["saved_count"] == 0
                    assert data["skipped_count"] == 1
                    assert len(data["results"]) == 1
                    assert data["results"][0]["place_name"] == "Failed Place"
                    assert data["results"][0]["status"] == "error"
                    assert data["results"][0]["entry_id"] is None
                    assert (
                        "Database connection failed"
                        in data["results"][0]["error_message"]
                    )
        finally:
            app.dependency_overrides.clear()

    def test_handles_mixed_results(self, client, auth_override):
        """Test handling of mixed success/duplicate/error results."""
        from fastapi import HTTPException

        app.dependency_overrides[get_current_user] = auth_override

        entry_id_2 = "550e8400-e29b-41d4-a716-446655440004"

        try:
            with patch("app.api.ingest.get_supabase_client") as mock_db:
                mock_client = AsyncMock()
                mock_client.get = AsyncMock(return_value=[{"id": TEST_TRIP_ID}])

                # Set up side effects for 3 places:
                # 1. Success
                # 2. Duplicate
                # 3. Error
                call_count = 0

                async def mock_rpc(name, params):
                    nonlocal call_count
                    if name == "increment_share_extension_usage":
                        return None
                    call_count += 1
                    if call_count == 1:
                        return [
                            {
                                "entry_row": {
                                    "id": entry_id_2,
                                    "trip_id": TEST_TRIP_ID,
                                    "type": "place",
                                    "title": "Success Place",
                                    "notes": None,
                                    "link": "https://www.tiktok.com/@user/video/123",
                                    "metadata": {},
                                    "date": None,
                                    "created_at": "2024-01-01T00:00:00Z",
                                    "deleted_at": None,
                                },
                                "place_row": None,
                            }
                        ]
                    elif call_count == 2:
                        raise HTTPException(
                            status_code=409, detail="duplicate key constraint"
                        )
                    else:
                        raise Exception("Network error")

                mock_client.rpc = mock_rpc
                mock_db.return_value = mock_client

                with patch("app.api.ingest.get_token_from_request"):
                    response = client.post(
                        "/ingest/save-places",
                        json={
                            "trip_id": TEST_TRIP_ID,
                            "provider": "tiktok",
                            "canonical_url": "https://www.tiktok.com/@user/video/123",
                            "places": [
                                {"name": "Success Place", "entry_type": "place"},
                                {"name": "Duplicate Place", "entry_type": "food"},
                                {"name": "Error Place", "entry_type": "stay"},
                            ],
                        },
                        headers={"Authorization": "Bearer test-token"},
                    )

                    assert response.status_code == 201
                    data = response.json()

                    # Verify counts
                    assert data["saved_count"] == 1
                    assert data["skipped_count"] == 2

                    # Verify per-place results
                    assert len(data["results"]) == 3

                    # First place: success
                    assert data["results"][0]["place_name"] == "Success Place"
                    assert data["results"][0]["status"] == "saved"
                    assert data["results"][0]["entry_id"] == entry_id_2

                    # Second place: duplicate
                    assert data["results"][1]["place_name"] == "Duplicate Place"
                    assert data["results"][1]["status"] == "duplicate"
                    assert data["results"][1]["entry_id"] is None

                    # Third place: error
                    assert data["results"][2]["place_name"] == "Error Place"
                    assert data["results"][2]["status"] == "error"
                    assert data["results"][2]["entry_id"] is None
                    assert "Network error" in data["results"][2]["error_message"]

                    # Verify backward compatibility: skipped_place_names still works
                    assert "Duplicate Place" in data["skipped_place_names"]
                    assert "Error Place" in data["skipped_place_names"]
        finally:
            app.dependency_overrides.clear()


class TestExtractionMethodParameter:
    """Tests for extraction_method parameter in POST /ingest/social endpoint."""

    def test_extraction_method_llm_only_uses_llm(self, client, auth_override):
        """When extraction_method=llm, only LLM extraction should be used."""
        app.dependency_overrides[get_current_user] = auth_override

        mock_oembed = OEmbedResponse(
            title="Amazing restaurant in Bali",
            author_name="foodie123",
            thumbnail_url="https://p16-sign.tiktokcdn.com/123.jpg",
            raw={"title": "Amazing restaurant in Bali"},
        )

        try:
            with patch("app.api.ingest.canonicalize_url") as mock_canonicalize:
                mock_canonicalize.return_value = (
                    "https://www.tiktok.com/@foodie123/video/123",
                    SocialProvider.TIKTOK,
                )

                with patch("app.api.ingest.fetch_oembed") as mock_fetch:
                    mock_fetch.return_value = mock_oembed

                    with patch(
                        "app.api.ingest.ExtractionOrchestrator"
                    ) as mock_orchestrator_class:
                        mock_orchestrator = MagicMock()
                        mock_orchestrator.extract = AsyncMock(
                            return_value=ExtractionResult(
                                places=[],
                                method="none",
                                source="caption",
                                skip_to_video=False,
                                context_location=None,
                                latency_ms=100,
                                from_cache=False,
                            )
                        )
                        mock_orchestrator_class.return_value = mock_orchestrator

                        response = client.post(
                            "/ingest/social",
                            json={
                                "url": "https://vm.tiktok.com/short",
                                "extraction_method": "llm",
                            },
                            headers={"Authorization": "Bearer test-token"},
                        )

                        assert response.status_code == 200

                        # Verify extraction_method was passed to orchestrator.extract
                        mock_orchestrator.extract.assert_called_once()
                        call_kwargs = mock_orchestrator.extract.call_args.kwargs
                        assert call_kwargs.get("extraction_method") == "llm"
        finally:
            app.dependency_overrides.clear()

    def test_extraction_method_regex_only_uses_regex(self, client, auth_override):
        """When extraction_method=regex, only regex extraction should be used."""
        app.dependency_overrides[get_current_user] = auth_override

        mock_oembed = OEmbedResponse(
            title="Amazing restaurant in Bali",
            author_name="foodie123",
            thumbnail_url="https://p16-sign.tiktokcdn.com/123.jpg",
            raw={"title": "Amazing restaurant in Bali"},
        )

        try:
            with patch("app.api.ingest.canonicalize_url") as mock_canonicalize:
                mock_canonicalize.return_value = (
                    "https://www.tiktok.com/@foodie123/video/123",
                    SocialProvider.TIKTOK,
                )

                with patch("app.api.ingest.fetch_oembed") as mock_fetch:
                    mock_fetch.return_value = mock_oembed

                    with patch(
                        "app.api.ingest.ExtractionOrchestrator"
                    ) as mock_orchestrator_class:
                        mock_orchestrator = MagicMock()
                        mock_orchestrator.extract = AsyncMock(
                            return_value=ExtractionResult(
                                places=[],
                                method="none",
                                source="caption",
                                skip_to_video=False,
                                context_location=None,
                                latency_ms=100,
                                from_cache=False,
                            )
                        )
                        mock_orchestrator_class.return_value = mock_orchestrator

                        response = client.post(
                            "/ingest/social",
                            json={
                                "url": "https://vm.tiktok.com/short",
                                "extraction_method": "regex",
                            },
                            headers={"Authorization": "Bearer test-token"},
                        )

                        assert response.status_code == 200

                        # Verify extraction_method was passed to orchestrator.extract
                        mock_orchestrator.extract.assert_called_once()
                        call_kwargs = mock_orchestrator.extract.call_args.kwargs
                        assert call_kwargs.get("extraction_method") == "regex"
        finally:
            app.dependency_overrides.clear()

    def test_extraction_method_auto_uses_cascade(self, client, auth_override):
        """When extraction_method=auto (default), cascade behavior should be used."""
        app.dependency_overrides[get_current_user] = auth_override

        mock_oembed = OEmbedResponse(
            title="Amazing restaurant in Bali",
            author_name="foodie123",
            thumbnail_url="https://p16-sign.tiktokcdn.com/123.jpg",
            raw={"title": "Amazing restaurant in Bali"},
        )

        try:
            with patch("app.api.ingest.canonicalize_url") as mock_canonicalize:
                mock_canonicalize.return_value = (
                    "https://www.tiktok.com/@foodie123/video/123",
                    SocialProvider.TIKTOK,
                )

                with patch("app.api.ingest.fetch_oembed") as mock_fetch:
                    mock_fetch.return_value = mock_oembed

                    with patch(
                        "app.api.ingest.ExtractionOrchestrator"
                    ) as mock_orchestrator_class:
                        mock_orchestrator = MagicMock()
                        mock_orchestrator.extract = AsyncMock(
                            return_value=ExtractionResult(
                                places=[],
                                method="none",
                                source="caption",
                                skip_to_video=False,
                                context_location=None,
                                latency_ms=100,
                                from_cache=False,
                            )
                        )
                        mock_orchestrator_class.return_value = mock_orchestrator

                        response = client.post(
                            "/ingest/social",
                            json={
                                "url": "https://vm.tiktok.com/short",
                                # extraction_method defaults to "auto"
                            },
                            headers={"Authorization": "Bearer test-token"},
                        )

                        assert response.status_code == 200

                        # Verify extraction_method was passed to orchestrator.extract
                        mock_orchestrator.extract.assert_called_once()
                        call_kwargs = mock_orchestrator.extract.call_args.kwargs
                        assert call_kwargs.get("extraction_method") == "auto"
        finally:
            app.dependency_overrides.clear()


class TestSkipCacheParameter:
    """Tests for skip_cache parameter in POST /ingest/social endpoint."""

    def test_skip_cache_bypasses_cache_lookup(self, client, auth_override):
        """When skip_cache=true, cache should be bypassed for fresh extraction."""
        app.dependency_overrides[get_current_user] = auth_override

        mock_oembed = OEmbedResponse(
            title="Amazing restaurant in Bali",
            author_name="foodie123",
            thumbnail_url="https://p16-sign.tiktokcdn.com/123.jpg",
            raw={"title": "Amazing restaurant in Bali"},
        )

        try:
            with patch("app.api.ingest.canonicalize_url") as mock_canonicalize:
                mock_canonicalize.return_value = (
                    "https://www.tiktok.com/@foodie123/video/123",
                    SocialProvider.TIKTOK,
                )

                with patch("app.api.ingest.fetch_oembed") as mock_fetch:
                    mock_fetch.return_value = mock_oembed

                    with patch(
                        "app.api.ingest.ExtractionOrchestrator"
                    ) as mock_orchestrator_class:
                        mock_orchestrator = MagicMock()
                        mock_orchestrator.extract = AsyncMock(
                            return_value=ExtractionResult(
                                places=[],
                                method="none",
                                source="caption",
                                skip_to_video=False,
                                context_location=None,
                                latency_ms=100,
                                from_cache=False,
                            )
                        )
                        mock_orchestrator_class.return_value = mock_orchestrator

                        response = client.post(
                            "/ingest/social",
                            json={
                                "url": "https://vm.tiktok.com/short",
                                "skip_cache": True,
                            },
                            headers={"Authorization": "Bearer test-token"},
                        )

                        assert response.status_code == 200

                        # Verify use_cache=False was passed to orchestrator.extract
                        mock_orchestrator.extract.assert_called_once()
                        call_kwargs = mock_orchestrator.extract.call_args.kwargs
                        assert call_kwargs.get("use_cache") is False
        finally:
            app.dependency_overrides.clear()

    def test_skip_cache_false_uses_cache(self, client, auth_override):
        """When skip_cache=false (default), cache should be used."""
        app.dependency_overrides[get_current_user] = auth_override

        mock_oembed = OEmbedResponse(
            title="Amazing restaurant in Bali",
            author_name="foodie123",
            thumbnail_url="https://p16-sign.tiktokcdn.com/123.jpg",
            raw={"title": "Amazing restaurant in Bali"},
        )

        try:
            with patch("app.api.ingest.canonicalize_url") as mock_canonicalize:
                mock_canonicalize.return_value = (
                    "https://www.tiktok.com/@foodie123/video/123",
                    SocialProvider.TIKTOK,
                )

                with patch("app.api.ingest.fetch_oembed") as mock_fetch:
                    mock_fetch.return_value = mock_oembed

                    with patch(
                        "app.api.ingest.ExtractionOrchestrator"
                    ) as mock_orchestrator_class:
                        mock_orchestrator = MagicMock()
                        mock_orchestrator.extract = AsyncMock(
                            return_value=ExtractionResult(
                                places=[],
                                method="none",
                                source="caption",
                                skip_to_video=False,
                                context_location=None,
                                latency_ms=100,
                                from_cache=False,
                            )
                        )
                        mock_orchestrator_class.return_value = mock_orchestrator

                        response = client.post(
                            "/ingest/social",
                            json={
                                "url": "https://vm.tiktok.com/short",
                                "skip_cache": False,
                            },
                            headers={"Authorization": "Bearer test-token"},
                        )

                        assert response.status_code == 200

                        # Verify use_cache=True was passed to orchestrator.extract
                        mock_orchestrator.extract.assert_called_once()
                        call_kwargs = mock_orchestrator.extract.call_args.kwargs
                        assert call_kwargs.get("use_cache") is True
        finally:
            app.dependency_overrides.clear()

    def test_skip_cache_defaults_to_false(self, client, auth_override):
        """When skip_cache is not provided, it should default to false (cache enabled)."""
        app.dependency_overrides[get_current_user] = auth_override

        mock_oembed = OEmbedResponse(
            title="Amazing restaurant in Bali",
            author_name="foodie123",
            thumbnail_url="https://p16-sign.tiktokcdn.com/123.jpg",
            raw={"title": "Amazing restaurant in Bali"},
        )

        try:
            with patch("app.api.ingest.canonicalize_url") as mock_canonicalize:
                mock_canonicalize.return_value = (
                    "https://www.tiktok.com/@foodie123/video/123",
                    SocialProvider.TIKTOK,
                )

                with patch("app.api.ingest.fetch_oembed") as mock_fetch:
                    mock_fetch.return_value = mock_oembed

                    with patch(
                        "app.api.ingest.ExtractionOrchestrator"
                    ) as mock_orchestrator_class:
                        mock_orchestrator = MagicMock()
                        mock_orchestrator.extract = AsyncMock(
                            return_value=ExtractionResult(
                                places=[],
                                method="none",
                                source="caption",
                                skip_to_video=False,
                                context_location=None,
                                latency_ms=100,
                                from_cache=False,
                            )
                        )
                        mock_orchestrator_class.return_value = mock_orchestrator

                        response = client.post(
                            "/ingest/social",
                            json={
                                "url": "https://vm.tiktok.com/short",
                                # skip_cache not provided - should default to False
                            },
                            headers={"Authorization": "Bearer test-token"},
                        )

                        assert response.status_code == 200

                        # Verify use_cache=True was passed (default behavior)
                        mock_orchestrator.extract.assert_called_once()
                        call_kwargs = mock_orchestrator.extract.call_args.kwargs
                        assert call_kwargs.get("use_cache") is True
        finally:
            app.dependency_overrides.clear()


class TestGooglePhotoDownload:
    """Tests for Google Places photo download functionality in save_to_trip."""

    def test_background_task_triggered_when_google_photo_url_present(
        self, client, auth_override
    ):
        """Background task should be triggered when google_photo_url is present."""
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
                                "title": "Test Place",
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
                                "place_name": "Test Place",
                                "lat": 40.7128,
                                "lng": -74.006,
                                "address": "New York, NY",
                                "extra_data": {
                                    "google_photo_url": "https://places.googleapis.com/v1/places/photo.jpg"
                                },
                            },
                        }
                    ]
                )
                mock_db.return_value = mock_client

                with patch("app.api.ingest.get_token_from_request"):
                    with patch(
                        "app.api.ingest._download_google_photo_background"
                    ) as mock_download:
                        response = client.post(
                            "/ingest/save-to-trip",
                            json={
                                "trip_id": TEST_TRIP_ID,
                                "provider": "tiktok",
                                "canonical_url": "https://www.tiktok.com/@user/video/123",
                                "place": {
                                    "google_place_id": "ChIJ123",
                                    "name": "Test Place",
                                    "address": "New York, NY",
                                    "latitude": 40.7128,
                                    "longitude": -74.006,
                                    "country": "United States",
                                    "country_code": "US",
                                    "confidence": 0.9,
                                    "google_photo_url": "https://places.googleapis.com/v1/places/photo.jpg",
                                },
                            },
                            headers={"Authorization": "Bearer test-token"},
                        )

                        assert response.status_code == 201
                        # Background task should have been called
                        mock_download.assert_called_once_with(
                            "https://places.googleapis.com/v1/places/photo.jpg",
                            TEST_USER_ID,
                            TEST_ENTRY_ID,
                            TEST_TRIP_ID,
                        )
        finally:
            app.dependency_overrides.clear()

    def test_background_task_not_triggered_when_google_photo_url_absent(
        self, client, auth_override
    ):
        """Background task should NOT be triggered when google_photo_url is absent."""
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
                                "title": "Test Place",
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
                                "place_name": "Test Place",
                                "lat": 40.7128,
                                "lng": -74.006,
                                "address": "New York, NY",
                                "extra_data": {},  # No google_photo_url
                            },
                        }
                    ]
                )
                mock_db.return_value = mock_client

                with patch("app.api.ingest.get_token_from_request"):
                    with patch(
                        "app.api.ingest._download_google_photo_background"
                    ) as mock_download:
                        response = client.post(
                            "/ingest/save-to-trip",
                            json={
                                "trip_id": TEST_TRIP_ID,
                                "provider": "tiktok",
                                "canonical_url": "https://www.tiktok.com/@user/video/123",
                                "place": {
                                    "google_place_id": "ChIJ123",
                                    "name": "Test Place",
                                    "address": "New York, NY",
                                    "latitude": 40.7128,
                                    "longitude": -74.006,
                                    "country": "United States",
                                    "country_code": "US",
                                    "confidence": 0.9,
                                    # No google_photo_url provided
                                },
                            },
                            headers={"Authorization": "Bearer test-token"},
                        )

                        assert response.status_code == 201
                        # Background task should NOT have been called
                        mock_download.assert_not_called()
        finally:
            app.dependency_overrides.clear()

    def test_background_task_not_triggered_when_place_row_is_null(
        self, client, auth_override
    ):
        """Background task should NOT be triggered when place_row is null."""
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
                                "title": "Test Entry",
                                "notes": None,
                                "link": "https://www.tiktok.com/@user/video/123",
                                "metadata": {},
                                "date": None,
                                "created_at": "2024-01-01T00:00:00Z",
                                "deleted_at": None,
                            },
                            "place_row": None,  # No place
                        }
                    ]
                )
                mock_db.return_value = mock_client

                with patch("app.api.ingest.get_token_from_request"):
                    with patch(
                        "app.api.ingest._download_google_photo_background"
                    ) as mock_download:
                        response = client.post(
                            "/ingest/save-to-trip",
                            json={
                                "trip_id": TEST_TRIP_ID,
                                "provider": "tiktok",
                                "canonical_url": "https://www.tiktok.com/@user/video/123",
                                # No place data
                            },
                            headers={"Authorization": "Bearer test-token"},
                        )

                        assert response.status_code == 201
                        # Background task should NOT have been called
                        mock_download.assert_not_called()
        finally:
            app.dependency_overrides.clear()

    def test_invalid_google_photo_url_rejected_ssrf_protection(
        self, client, auth_override
    ):
        """Invalid/malicious Google photo URLs should be stripped (SSRF protection)."""
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
                                "title": "Test Place",
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
                                "place_name": "Test Place",
                                "lat": 40.7128,
                                "lng": -74.006,
                                "address": "New York, NY",
                                "extra_data": {},  # URL was stripped
                            },
                        }
                    ]
                )
                mock_db.return_value = mock_client

                with patch("app.api.ingest.get_token_from_request"):
                    with patch(
                        "app.api.ingest._download_google_photo_background"
                    ) as mock_download:
                        response = client.post(
                            "/ingest/save-to-trip",
                            json={
                                "trip_id": TEST_TRIP_ID,
                                "provider": "tiktok",
                                "canonical_url": "https://www.tiktok.com/@user/video/123",
                                "place": {
                                    "google_place_id": "ChIJ123",
                                    "name": "Test Place",
                                    "address": "New York, NY",
                                    "latitude": 40.7128,
                                    "longitude": -74.006,
                                    "country": "United States",
                                    "country_code": "US",
                                    "confidence": 0.9,
                                    # Malicious URL that doesn't match allowed domains
                                    "google_photo_url": "https://evil.com/steal-data.jpg",
                                },
                            },
                            headers={"Authorization": "Bearer test-token"},
                        )

                        assert response.status_code == 201
                        # Background task should NOT be called for invalid URLs
                        mock_download.assert_not_called()

                        # Verify the RPC was called without google_photo_url in extra_data
                        first_call = mock_client.rpc.call_args_list[0]
                        assert first_call[0][0] == "atomic_create_entry_with_place"
                        payload = first_call[0][1]
                        assert (
                            "google_photo_url"
                            not in payload["p_place_data"]["extra_data"]
                        )
        finally:
            app.dependency_overrides.clear()
