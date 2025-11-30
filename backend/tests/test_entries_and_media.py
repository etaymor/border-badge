"""Tests for entry and media endpoints."""

from typing import Any
from unittest.mock import AsyncMock, patch

from fastapi.testclient import TestClient

from app.core.security import AuthUser, get_current_user
from app.main import app
from tests.conftest import mock_auth_dependency


def test_list_entries_requires_auth(client: TestClient) -> None:
    """Test that listing entries requires authentication."""
    trip_id = "550e8400-e29b-41d4-a716-446655440002"
    response = client.get(f"/trips/{trip_id}/entries")
    assert response.status_code == 403


def test_list_entries_returns_empty(
    client: TestClient,
    mock_supabase_client: AsyncMock,
    mock_user: AuthUser,
    auth_headers: dict[str, str],
) -> None:
    """Test listing entries returns empty list when none exist."""
    trip_id = "550e8400-e29b-41d4-a716-446655440002"
    mock_supabase_client.get.return_value = []

    app.dependency_overrides[get_current_user] = mock_auth_dependency(mock_user)
    try:
        with patch(
            "app.api.entries.get_supabase_client", return_value=mock_supabase_client
        ):
            response = client.get(f"/trips/{trip_id}/entries", headers=auth_headers)
        assert response.status_code == 200
        assert response.json() == []
    finally:
        app.dependency_overrides.clear()


def test_create_entry(
    client: TestClient,
    mock_supabase_client: AsyncMock,
    mock_user: AuthUser,
    auth_headers: dict[str, str],
    sample_entry: dict[str, Any],
) -> None:
    """Test creating a new entry."""
    trip_id = "550e8400-e29b-41d4-a716-446655440002"
    mock_supabase_client.post.return_value = [sample_entry]

    app.dependency_overrides[get_current_user] = mock_auth_dependency(mock_user)
    try:
        with patch(
            "app.api.entries.get_supabase_client", return_value=mock_supabase_client
        ):
            response = client.post(
                f"/trips/{trip_id}/entries",
                headers=auth_headers,
                json={
                    "type": "place",
                    "title": "Central Park",
                    "notes": "Beautiful park!",
                },
            )
        assert response.status_code == 201
        data = response.json()
        assert data["title"] == "Central Park"
        assert data["type"] == "place"
    finally:
        app.dependency_overrides.clear()


def test_create_entry_with_place(
    client: TestClient,
    mock_supabase_client: AsyncMock,
    mock_user: AuthUser,
    auth_headers: dict[str, str],
    sample_entry: dict[str, Any],
    sample_place: dict[str, Any],
) -> None:
    """Test creating an entry with place data."""
    from tests.conftest import TEST_TRIP_ID

    mock_supabase_client.post.side_effect = [[sample_entry], [sample_place]]

    app.dependency_overrides[get_current_user] = mock_auth_dependency(mock_user)
    try:
        with patch(
            "app.api.entries.get_supabase_client", return_value=mock_supabase_client
        ):
            response = client.post(
                f"/trips/{TEST_TRIP_ID}/entries",
                headers=auth_headers,
                json={
                    "type": "place",
                    "title": "Central Park",
                    "place": {
                        "google_place_id": "ChIJN1t_tDeuEmsRUsoyG83frY4",
                        "place_name": "Central Park",
                        "lat": 40.7829,
                        "lng": -73.9654,
                    },
                },
            )
        assert response.status_code == 201
        data = response.json()
        assert data["place"] is not None
        assert data["place"]["place_name"] == "Central Park"
    finally:
        app.dependency_overrides.clear()


def test_get_entry(
    client: TestClient,
    mock_supabase_client: AsyncMock,
    mock_user: AuthUser,
    auth_headers: dict[str, str],
    sample_entry: dict[str, Any],
) -> None:
    """Test getting a single entry."""
    mock_supabase_client.get.side_effect = [[sample_entry], []]  # entry, then place

    app.dependency_overrides[get_current_user] = mock_auth_dependency(mock_user)
    try:
        with patch(
            "app.api.entries.get_supabase_client", return_value=mock_supabase_client
        ):
            response = client.get(
                f"/entries/{sample_entry['id']}",
                headers=auth_headers,
            )
        assert response.status_code == 200
        data = response.json()
        assert data["title"] == "Central Park"
    finally:
        app.dependency_overrides.clear()


def test_update_entry(
    client: TestClient,
    mock_supabase_client: AsyncMock,
    mock_user: AuthUser,
    auth_headers: dict[str, str],
    sample_entry: dict[str, Any],
) -> None:
    """Test updating an entry."""
    updated_entry = {**sample_entry, "title": "Updated Title"}
    mock_supabase_client.patch.return_value = [updated_entry]

    app.dependency_overrides[get_current_user] = mock_auth_dependency(mock_user)
    try:
        with patch(
            "app.api.entries.get_supabase_client", return_value=mock_supabase_client
        ):
            response = client.patch(
                f"/entries/{sample_entry['id']}",
                headers=auth_headers,
                json={"title": "Updated Title"},
            )
        assert response.status_code == 200
        data = response.json()
        assert data["title"] == "Updated Title"
    finally:
        app.dependency_overrides.clear()


def test_delete_entry(
    client: TestClient,
    mock_supabase_client: AsyncMock,
    mock_user: AuthUser,
    auth_headers: dict[str, str],
    sample_entry: dict[str, Any],
) -> None:
    """Test deleting an entry."""
    mock_supabase_client.delete.return_value = []

    app.dependency_overrides[get_current_user] = mock_auth_dependency(mock_user)
    try:
        with patch(
            "app.api.entries.get_supabase_client", return_value=mock_supabase_client
        ):
            response = client.delete(
                f"/entries/{sample_entry['id']}",
                headers=auth_headers,
            )
        assert response.status_code == 204
    finally:
        app.dependency_overrides.clear()


# Media tests


def test_get_upload_url_requires_auth(client: TestClient) -> None:
    """Test that getting upload URL requires authentication."""
    response = client.post(
        "/media/files/upload-url",
        json={"filename": "photo.jpg", "content_type": "image/jpeg"},
    )
    assert response.status_code == 403


def test_get_upload_url_requires_parent(
    client: TestClient,
    mock_supabase_client: AsyncMock,
    mock_user: AuthUser,
    auth_headers: dict[str, str],
) -> None:
    """Test that upload URL requires trip_id or entry_id."""
    app.dependency_overrides[get_current_user] = mock_auth_dependency(mock_user)
    try:
        with patch(
            "app.api.media.get_supabase_client", return_value=mock_supabase_client
        ):
            response = client.post(
                "/media/files/upload-url",
                headers=auth_headers,
                json={"filename": "photo.jpg", "content_type": "image/jpeg"},
            )
        assert response.status_code == 400
    finally:
        app.dependency_overrides.clear()


def test_get_upload_url_success(
    client: TestClient,
    mock_supabase_client: AsyncMock,
    mock_user: AuthUser,
    auth_headers: dict[str, str],
) -> None:
    """Test getting an upload URL."""
    from tests.conftest import TEST_MEDIA_ID, TEST_TRIP_ID

    media_record = {
        "id": TEST_MEDIA_ID,
        "owner_id": mock_user.id,
        "trip_id": TEST_TRIP_ID,
        "entry_id": None,
        "file_path": f"{mock_user.id}/some-uuid.jpg",
        "status": "processing",
        "created_at": "2024-01-01T00:00:00Z",
    }
    mock_supabase_client.post.return_value = [media_record]

    app.dependency_overrides[get_current_user] = mock_auth_dependency(mock_user)
    try:
        with patch(
            "app.api.media.get_supabase_client", return_value=mock_supabase_client
        ):
            response = client.post(
                "/media/files/upload-url",
                headers=auth_headers,
                json={
                    "filename": "photo.jpg",
                    "content_type": "image/jpeg",
                    "trip_id": TEST_TRIP_ID,
                },
            )
        assert response.status_code == 200
        data = response.json()
        assert "media_id" in data
        assert "upload_url" in data
        assert "file_path" in data
    finally:
        app.dependency_overrides.clear()


def test_update_media_status(
    client: TestClient,
    mock_supabase_client: AsyncMock,
    mock_user: AuthUser,
    auth_headers: dict[str, str],
) -> None:
    """Test updating media status after upload."""
    from tests.conftest import TEST_MEDIA_ID, TEST_TRIP_ID

    updated_media = {
        "id": TEST_MEDIA_ID,
        "owner_id": mock_user.id,
        "trip_id": TEST_TRIP_ID,
        "entry_id": None,
        "file_path": f"{mock_user.id}/some-uuid.jpg",
        "thumbnail_path": f"{mock_user.id}/some-uuid-thumb.jpg",
        "exif": {"width": 1920, "height": 1080},
        "status": "uploaded",
        "created_at": "2024-01-01T00:00:00Z",
    }
    mock_supabase_client.patch.return_value = [updated_media]

    app.dependency_overrides[get_current_user] = mock_auth_dependency(mock_user)
    try:
        with patch(
            "app.api.media.get_supabase_client", return_value=mock_supabase_client
        ):
            response = client.patch(
                f"/media/files/{TEST_MEDIA_ID}",
                headers=auth_headers,
                json={
                    "status": "uploaded",
                    "thumbnail_path": f"{mock_user.id}/some-uuid-thumb.jpg",
                },
            )
        assert response.status_code == 200
        data = response.json()
        assert data["status"] == "uploaded"
    finally:
        app.dependency_overrides.clear()
