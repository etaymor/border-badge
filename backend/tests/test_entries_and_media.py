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
    # First get verifies entry exists, then patch updates, then get fetches place
    mock_supabase_client.get.side_effect = [
        [sample_entry],  # Verify entry exists
        [],  # No existing place
    ]
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
    """Test soft-deleting an entry."""
    # Soft delete uses patch, not delete
    mock_supabase_client.patch.return_value = [
        {**sample_entry, "deleted_at": "2024-01-01T00:00:00+00:00"}
    ]

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
        with (
            patch(
                "app.api.media.get_supabase_client", return_value=mock_supabase_client
            ),
            patch("app.api.media.get_settings") as mock_settings,
        ):
            mock_settings.return_value.supabase_url = "https://test.supabase.co"
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
        with (
            patch(
                "app.api.media.get_supabase_client", return_value=mock_supabase_client
            ),
            patch("app.api.media.get_settings") as mock_settings,
        ):
            mock_settings.return_value.supabase_url = "https://test.supabase.co"
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


def test_get_upload_url_photo_limit_exceeded(
    client: TestClient,
    mock_supabase_client: AsyncMock,
    mock_user: AuthUser,
    auth_headers: dict[str, str],
) -> None:
    """Test that upload URL is rejected when photo limit is exceeded."""
    from tests.conftest import TEST_ENTRY_ID

    # Mock 10 existing media files (the limit)
    existing_media = [{"id": f"media-{i}"} for i in range(10)]
    mock_supabase_client.get.return_value = existing_media

    app.dependency_overrides[get_current_user] = mock_auth_dependency(mock_user)
    try:
        with (
            patch(
                "app.api.media.get_supabase_client", return_value=mock_supabase_client
            ),
            patch("app.api.media.get_settings") as mock_settings,
        ):
            mock_settings.return_value.supabase_url = "https://test.supabase.co"
            response = client.post(
                "/media/files/upload-url",
                headers=auth_headers,
                json={
                    "filename": "photo.jpg",
                    "content_type": "image/jpeg",
                    "entry_id": TEST_ENTRY_ID,
                },
            )
        assert response.status_code == 400
        assert "Maximum 10 photos" in response.json()["detail"]
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


# ============================================================================
# Entry Not Found and Restore Tests
# ============================================================================


def test_get_entry_not_found(
    client: TestClient,
    mock_supabase_client: AsyncMock,
    mock_user: AuthUser,
    auth_headers: dict[str, str],
) -> None:
    """Test getting an entry that doesn't exist returns 404."""
    mock_supabase_client.get.return_value = []

    app.dependency_overrides[get_current_user] = mock_auth_dependency(mock_user)
    try:
        with patch(
            "app.api.entries.get_supabase_client", return_value=mock_supabase_client
        ):
            response = client.get(
                "/entries/550e8400-e29b-41d4-a716-446655440999",
                headers=auth_headers,
            )
        assert response.status_code == 404
    finally:
        app.dependency_overrides.clear()


def test_update_entry_not_found(
    client: TestClient,
    mock_supabase_client: AsyncMock,
    mock_user: AuthUser,
    auth_headers: dict[str, str],
) -> None:
    """Test updating an entry that doesn't exist returns 404."""
    # First get verifies entry exists - returns empty for 404
    mock_supabase_client.get.return_value = []

    app.dependency_overrides[get_current_user] = mock_auth_dependency(mock_user)
    try:
        with patch(
            "app.api.entries.get_supabase_client", return_value=mock_supabase_client
        ):
            response = client.patch(
                "/entries/550e8400-e29b-41d4-a716-446655440999",
                headers=auth_headers,
                json={"title": "New Title"},
            )
        assert response.status_code == 404
    finally:
        app.dependency_overrides.clear()


def test_delete_entry_not_found(
    client: TestClient,
    mock_supabase_client: AsyncMock,
    mock_user: AuthUser,
    auth_headers: dict[str, str],
) -> None:
    """Test deleting an entry that doesn't exist returns 404."""
    # RPC soft_delete_entry returns False when entry not found or not authorized
    mock_supabase_client.rpc.return_value = False

    app.dependency_overrides[get_current_user] = mock_auth_dependency(mock_user)
    try:
        with patch(
            "app.api.entries.get_supabase_client", return_value=mock_supabase_client
        ):
            response = client.delete(
                "/entries/550e8400-e29b-41d4-a716-446655440999",
                headers=auth_headers,
            )
        assert response.status_code == 404
    finally:
        app.dependency_overrides.clear()


def test_restore_entry(
    client: TestClient,
    mock_supabase_client: AsyncMock,
    mock_user: AuthUser,
    auth_headers: dict[str, str],
    sample_entry: dict[str, Any],
) -> None:
    """Test restoring a soft-deleted entry."""
    restored_entry = {**sample_entry, "deleted_at": None}

    # First call is patch (restore), second call is get (for place)
    mock_supabase_client.patch.return_value = [restored_entry]
    mock_supabase_client.get.return_value = []  # No place

    app.dependency_overrides[get_current_user] = mock_auth_dependency(mock_user)
    try:
        with patch(
            "app.api.entries.get_supabase_client", return_value=mock_supabase_client
        ):
            response = client.post(
                f"/entries/{sample_entry['id']}/restore",
                headers=auth_headers,
            )
        assert response.status_code == 200
        data = response.json()
        assert data["id"] == sample_entry["id"]
    finally:
        app.dependency_overrides.clear()


def test_restore_entry_not_found(
    client: TestClient,
    mock_supabase_client: AsyncMock,
    mock_user: AuthUser,
    auth_headers: dict[str, str],
) -> None:
    """Test restoring an entry that doesn't exist returns 404."""
    mock_supabase_client.patch.return_value = []

    app.dependency_overrides[get_current_user] = mock_auth_dependency(mock_user)
    try:
        with patch(
            "app.api.entries.get_supabase_client", return_value=mock_supabase_client
        ):
            response = client.post(
                "/entries/550e8400-e29b-41d4-a716-446655440999/restore",
                headers=auth_headers,
            )
        assert response.status_code == 404
    finally:
        app.dependency_overrides.clear()


# ============================================================================
# Media Get and Delete Tests
# ============================================================================


def test_get_media(
    client: TestClient,
    mock_supabase_client: AsyncMock,
    mock_user: AuthUser,
    auth_headers: dict[str, str],
) -> None:
    """Test getting a single media file."""
    from tests.conftest import TEST_MEDIA_ID, TEST_TRIP_ID

    media_record = {
        "id": TEST_MEDIA_ID,
        "owner_id": mock_user.id,
        "trip_id": TEST_TRIP_ID,
        "entry_id": None,
        "file_path": f"{mock_user.id}/some-uuid.jpg",
        "status": "uploaded",
        "created_at": "2024-01-01T00:00:00Z",
    }
    mock_supabase_client.get.return_value = [media_record]

    app.dependency_overrides[get_current_user] = mock_auth_dependency(mock_user)
    try:
        with patch(
            "app.api.media.get_supabase_client", return_value=mock_supabase_client
        ):
            response = client.get(
                f"/media/files/{TEST_MEDIA_ID}",
                headers=auth_headers,
            )
        assert response.status_code == 200
        data = response.json()
        assert data["id"] == TEST_MEDIA_ID
        assert data["status"] == "uploaded"
    finally:
        app.dependency_overrides.clear()


def test_get_media_not_found(
    client: TestClient,
    mock_supabase_client: AsyncMock,
    mock_user: AuthUser,
    auth_headers: dict[str, str],
) -> None:
    """Test getting a media file that doesn't exist returns 404."""
    mock_supabase_client.get.return_value = []

    app.dependency_overrides[get_current_user] = mock_auth_dependency(mock_user)
    try:
        with patch(
            "app.api.media.get_supabase_client", return_value=mock_supabase_client
        ):
            response = client.get(
                "/media/files/550e8400-e29b-41d4-a716-446655440999",
                headers=auth_headers,
            )
        assert response.status_code == 404
    finally:
        app.dependency_overrides.clear()


def test_delete_media(
    client: TestClient,
    mock_supabase_client: AsyncMock,
    mock_user: AuthUser,
    auth_headers: dict[str, str],
) -> None:
    """Test deleting a media file."""
    from tests.conftest import TEST_MEDIA_ID, TEST_TRIP_ID

    media_record = {
        "id": TEST_MEDIA_ID,
        "owner_id": mock_user.id,
        "trip_id": TEST_TRIP_ID,
        "entry_id": None,
        "file_path": f"{mock_user.id}/some-uuid.jpg",
        "status": "uploaded",
        "created_at": "2024-01-01T00:00:00Z",
    }
    # First call is get (to fetch file paths), then delete
    mock_supabase_client.get.return_value = [media_record]
    mock_supabase_client.delete.return_value = []

    # Mock the HTTP client for storage deletion
    mock_http_client = AsyncMock()
    mock_http_client.delete.return_value = AsyncMock(status_code=204)

    # Mock settings
    mock_settings = AsyncMock()
    mock_settings.supabase_url = "https://test.supabase.co"
    mock_settings.supabase_anon_key = "test-anon-key"
    mock_settings.supabase_service_role_key = "test-service-key"

    app.dependency_overrides[get_current_user] = mock_auth_dependency(mock_user)
    try:
        with (
            patch(
                "app.api.media.get_supabase_client", return_value=mock_supabase_client
            ),
            patch("app.api.media.get_http_client", return_value=mock_http_client),
            patch("app.api.media.get_settings", return_value=mock_settings),
        ):
            response = client.delete(
                f"/media/files/{TEST_MEDIA_ID}",
                headers=auth_headers,
            )
        assert response.status_code == 204
    finally:
        app.dependency_overrides.clear()


def test_delete_media_not_found(
    client: TestClient,
    mock_supabase_client: AsyncMock,
    mock_user: AuthUser,
    auth_headers: dict[str, str],
) -> None:
    """Test deleting a media file that doesn't exist returns 404."""
    mock_supabase_client.delete.return_value = []

    app.dependency_overrides[get_current_user] = mock_auth_dependency(mock_user)
    try:
        with patch(
            "app.api.media.get_supabase_client", return_value=mock_supabase_client
        ):
            response = client.delete(
                "/media/files/550e8400-e29b-41d4-a716-446655440999",
                headers=auth_headers,
            )
        assert response.status_code == 404
    finally:
        app.dependency_overrides.clear()


# ============================================================================
# Entry Update with Place Upsert Tests
# ============================================================================


def test_update_entry_with_place_create(
    client: TestClient,
    mock_supabase_client: AsyncMock,
    mock_user: AuthUser,
    auth_headers: dict[str, str],
    sample_entry: dict[str, Any],
    sample_place: dict[str, Any],
) -> None:
    """Test updating entry with new place data (place creation)."""
    updated_entry = {**sample_entry, "title": "Updated Title"}

    # get verifies entry exists, patch updates entry, get checks for existing place, post creates
    mock_supabase_client.patch.return_value = [updated_entry]
    mock_supabase_client.get.side_effect = [
        [sample_entry],  # Verify entry exists
        [],  # No existing place
    ]
    mock_supabase_client.post.return_value = [sample_place]

    app.dependency_overrides[get_current_user] = mock_auth_dependency(mock_user)
    try:
        with patch(
            "app.api.entries.get_supabase_client", return_value=mock_supabase_client
        ):
            response = client.patch(
                f"/entries/{sample_entry['id']}",
                headers=auth_headers,
                json={
                    "title": "Updated Title",
                    "place": {
                        "google_place_id": "ChIJN1t_tDeuEmsRUsoyG83frY4",
                        "place_name": "Central Park",
                        "lat": 40.7829,
                        "lng": -73.9654,
                    },
                },
            )
        assert response.status_code == 200
        data = response.json()
        assert data["title"] == "Updated Title"
        assert data["place"] is not None
        assert data["place"]["place_name"] == "Central Park"
    finally:
        app.dependency_overrides.clear()


def test_update_entry_with_place_update(
    client: TestClient,
    mock_supabase_client: AsyncMock,
    mock_user: AuthUser,
    auth_headers: dict[str, str],
    sample_entry: dict[str, Any],
    sample_place: dict[str, Any],
) -> None:
    """Test updating entry with existing place data (place update)."""
    updated_entry = {**sample_entry, "notes": "Updated notes"}
    updated_place = {**sample_place, "place_name": "Updated Park Name"}

    # get verifies entry exists then returns existing place, patch updates entry then place
    mock_supabase_client.patch.side_effect = [
        [updated_entry],  # Entry update
        [updated_place],  # Place update
    ]
    mock_supabase_client.get.side_effect = [
        [sample_entry],  # Verify entry exists
        [sample_place],  # Existing place check
    ]

    app.dependency_overrides[get_current_user] = mock_auth_dependency(mock_user)
    try:
        with patch(
            "app.api.entries.get_supabase_client", return_value=mock_supabase_client
        ):
            response = client.patch(
                f"/entries/{sample_entry['id']}",
                headers=auth_headers,
                json={
                    "notes": "Updated notes",
                    "place": {
                        "google_place_id": "ChIJN1t_tDeuEmsRUsoyG83frY4",
                        "place_name": "Updated Park Name",
                        "lat": 40.7829,
                        "lng": -73.9654,
                    },
                },
            )
        assert response.status_code == 200
        data = response.json()
        assert data["notes"] == "Updated notes"
        assert data["place"] is not None
        assert data["place"]["place_name"] == "Updated Park Name"
    finally:
        app.dependency_overrides.clear()


def test_update_entry_patch_empty_returns_404(
    client: TestClient,
    mock_supabase_client: AsyncMock,
    mock_user: AuthUser,
    auth_headers: dict[str, str],
    sample_entry: dict[str, Any],
) -> None:
    """Return 404 when Supabase PATCH touches no rows (e.g. stricter RLS)."""
    mock_supabase_client.get.return_value = [sample_entry]
    mock_supabase_client.patch.return_value = []

    app.dependency_overrides[get_current_user] = mock_auth_dependency(mock_user)
    try:
        with patch(
            "app.api.entries.get_supabase_client", return_value=mock_supabase_client
        ):
            response = client.patch(
                f"/entries/{sample_entry['id']}",
                headers=auth_headers,
                json={"notes": "Updated notes"},
            )
        assert response.status_code == 404
        assert (
            response.json()["detail"]
            == "Entry not found or not authorized to update"
        )
    finally:
        app.dependency_overrides.clear()


def test_update_entry_place_only_no_entry_fields(
    client: TestClient,
    mock_supabase_client: AsyncMock,
    mock_user: AuthUser,
    auth_headers: dict[str, str],
    sample_entry: dict[str, Any],
    sample_place: dict[str, Any],
) -> None:
    """Test updating only place data (no entry fields) - tests the else branch."""
    # When only place data is sent, entry is fetched (not patched)
    mock_supabase_client.get.side_effect = [
        [sample_entry],  # Fetch existing entry
        [],  # No existing place
    ]
    mock_supabase_client.post.return_value = [sample_place]  # Create new place

    app.dependency_overrides[get_current_user] = mock_auth_dependency(mock_user)
    try:
        with patch(
            "app.api.entries.get_supabase_client", return_value=mock_supabase_client
        ):
            response = client.patch(
                f"/entries/{sample_entry['id']}",
                headers=auth_headers,
                json={
                    "place": {
                        "google_place_id": "ChIJN1t_tDeuEmsRUsoyG83frY4",
                        "place_name": "Central Park",
                        "lat": 40.7829,
                        "lng": -73.9654,
                    },
                },
            )
        assert response.status_code == 200
        data = response.json()
        assert data["place"] is not None
        assert data["place"]["place_name"] == "Central Park"
    finally:
        app.dependency_overrides.clear()


def test_update_entry_place_only_not_found(
    client: TestClient,
    mock_supabase_client: AsyncMock,
    mock_user: AuthUser,
    auth_headers: dict[str, str],
) -> None:
    """Test updating only place data for non-existent entry returns 404."""
    # Entry not found when fetching
    mock_supabase_client.get.return_value = []

    app.dependency_overrides[get_current_user] = mock_auth_dependency(mock_user)
    try:
        with patch(
            "app.api.entries.get_supabase_client", return_value=mock_supabase_client
        ):
            response = client.patch(
                "/entries/550e8400-e29b-41d4-a716-446655440999",
                headers=auth_headers,
                json={
                    "place": {
                        "google_place_id": "ChIJtest",
                        "place_name": "Test Place",
                        "lat": 0.0,
                        "lng": 0.0,
                    },
                },
            )
        assert response.status_code == 404
        assert "Entry not found" in response.json()["detail"]
    finally:
        app.dependency_overrides.clear()


def test_update_entry_fetches_existing_place_when_no_place_data(
    client: TestClient,
    mock_supabase_client: AsyncMock,
    mock_user: AuthUser,
    auth_headers: dict[str, str],
    sample_entry: dict[str, Any],
    sample_place: dict[str, Any],
) -> None:
    """Test that existing place is fetched when no place data is provided in update."""
    updated_entry = {**sample_entry, "title": "New Title"}

    mock_supabase_client.patch.return_value = [updated_entry]
    # First get verifies entry exists, second get fetches existing place
    mock_supabase_client.get.side_effect = [
        [sample_entry],  # Verify entry exists
        [sample_place],  # Existing place
    ]

    app.dependency_overrides[get_current_user] = mock_auth_dependency(mock_user)
    try:
        with patch(
            "app.api.entries.get_supabase_client", return_value=mock_supabase_client
        ):
            response = client.patch(
                f"/entries/{sample_entry['id']}",
                headers=auth_headers,
                json={"title": "New Title"},
            )
        assert response.status_code == 200
        data = response.json()
        assert data["title"] == "New Title"
        assert data["place"] is not None
        assert data["place"]["place_name"] == "Central Park"
    finally:
        app.dependency_overrides.clear()
