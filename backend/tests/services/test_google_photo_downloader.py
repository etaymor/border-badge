"""Tests for Google Places photo download service."""

from unittest.mock import AsyncMock, MagicMock, patch

import httpx
import pytest

from app.services.google_photo_downloader import (
    create_media_record_for_google_photo,
    download_and_store_google_photo,
)

# Test constants
TEST_USER_ID = "550e8400-e29b-41d4-a716-446655440000"
TEST_ENTRY_ID = "550e8400-e29b-41d4-a716-446655440003"
TEST_TRIP_ID = "550e8400-e29b-41d4-a716-446655440002"
VALID_GOOGLE_PHOTO_URL = "https://places.googleapis.com/v1/places/photo.jpg"
VALID_GOOGLE_PHOTO_URL_ALT = "https://maps.googleapis.com/maps/api/place/photo"


class TestDownloadAndStoreGooglePhoto:
    """Tests for download_and_store_google_photo function."""

    @pytest.mark.asyncio
    async def test_rejects_invalid_url_ssrf_protection(self):
        """Invalid URLs should be rejected for SSRF protection."""
        result = await download_and_store_google_photo(
            "https://evil.com/photo.jpg",
            TEST_USER_ID,
            TEST_ENTRY_ID,
        )
        assert result is None

    @pytest.mark.asyncio
    async def test_rejects_non_google_domain(self):
        """URLs from non-Google domains should be rejected."""
        result = await download_and_store_google_photo(
            "https://example.com/photo.jpg",
            TEST_USER_ID,
            TEST_ENTRY_ID,
        )
        assert result is None

    @pytest.mark.asyncio
    async def test_rejects_empty_url(self):
        """Empty URLs should be rejected."""
        result = await download_and_store_google_photo(
            "",
            TEST_USER_ID,
            TEST_ENTRY_ID,
        )
        assert result is None

    @pytest.mark.asyncio
    async def test_rejects_none_url(self):
        """None URLs should be rejected."""
        result = await download_and_store_google_photo(
            None,  # type: ignore
            TEST_USER_ID,
            TEST_ENTRY_ID,
        )
        assert result is None

    @pytest.mark.asyncio
    async def test_returns_none_when_supabase_url_not_configured(self):
        """Should return None when Supabase URL is not configured."""
        with patch(
            "app.services.google_photo_downloader.get_settings"
        ) as mock_settings:
            mock_settings.return_value.supabase_url = None
            result = await download_and_store_google_photo(
                VALID_GOOGLE_PHOTO_URL,
                TEST_USER_ID,
                TEST_ENTRY_ID,
            )
            assert result is None

    @pytest.mark.asyncio
    async def test_handles_download_timeout(self):
        """Should handle download timeout gracefully."""
        with patch(
            "app.services.google_photo_downloader.get_settings"
        ) as mock_settings:
            mock_settings.return_value.supabase_url = "https://test.supabase.co"

            with patch(
                "app.services.google_photo_downloader.get_http_client"
            ) as mock_client:
                client = AsyncMock()
                client.get = AsyncMock(side_effect=httpx.TimeoutException("Timeout"))
                mock_client.return_value = client

                result = await download_and_store_google_photo(
                    VALID_GOOGLE_PHOTO_URL,
                    TEST_USER_ID,
                    TEST_ENTRY_ID,
                )
                assert result is None

    @pytest.mark.asyncio
    async def test_handles_download_network_error(self):
        """Should handle network errors gracefully."""
        with patch(
            "app.services.google_photo_downloader.get_settings"
        ) as mock_settings:
            mock_settings.return_value.supabase_url = "https://test.supabase.co"

            with patch(
                "app.services.google_photo_downloader.get_http_client"
            ) as mock_client:
                client = AsyncMock()
                client.get = AsyncMock(
                    side_effect=httpx.RequestError("Connection refused")
                )
                mock_client.return_value = client

                result = await download_and_store_google_photo(
                    VALID_GOOGLE_PHOTO_URL,
                    TEST_USER_ID,
                    TEST_ENTRY_ID,
                )
                assert result is None

    @pytest.mark.asyncio
    async def test_handles_404_response(self):
        """Should handle 404 response gracefully."""
        with patch(
            "app.services.google_photo_downloader.get_settings"
        ) as mock_settings:
            mock_settings.return_value.supabase_url = "https://test.supabase.co"

            with patch(
                "app.services.google_photo_downloader.get_http_client"
            ) as mock_client:
                client = AsyncMock()
                response = MagicMock()
                response.status_code = 404
                client.get = AsyncMock(return_value=response)
                mock_client.return_value = client

                result = await download_and_store_google_photo(
                    VALID_GOOGLE_PHOTO_URL,
                    TEST_USER_ID,
                    TEST_ENTRY_ID,
                )
                assert result is None

    @pytest.mark.asyncio
    async def test_handles_500_response(self):
        """Should handle 500 server error gracefully."""
        with patch(
            "app.services.google_photo_downloader.get_settings"
        ) as mock_settings:
            mock_settings.return_value.supabase_url = "https://test.supabase.co"

            with patch(
                "app.services.google_photo_downloader.get_http_client"
            ) as mock_client:
                client = AsyncMock()
                response = MagicMock()
                response.status_code = 500
                client.get = AsyncMock(return_value=response)
                mock_client.return_value = client

                result = await download_and_store_google_photo(
                    VALID_GOOGLE_PHOTO_URL,
                    TEST_USER_ID,
                    TEST_ENTRY_ID,
                )
                assert result is None

    @pytest.mark.asyncio
    async def test_handles_empty_response_content(self):
        """Should handle empty response content gracefully."""
        with patch(
            "app.services.google_photo_downloader.get_settings"
        ) as mock_settings:
            mock_settings.return_value.supabase_url = "https://test.supabase.co"

            with patch(
                "app.services.google_photo_downloader.get_http_client"
            ) as mock_client:
                client = AsyncMock()
                response = MagicMock()
                response.status_code = 200
                response.content = b""  # Empty content
                client.get = AsyncMock(return_value=response)
                mock_client.return_value = client

                result = await download_and_store_google_photo(
                    VALID_GOOGLE_PHOTO_URL,
                    TEST_USER_ID,
                    TEST_ENTRY_ID,
                )
                assert result is None

    @pytest.mark.asyncio
    async def test_handles_thumbnail_generation_failure(self):
        """Should handle thumbnail generation failure gracefully."""
        with patch(
            "app.services.google_photo_downloader.get_settings"
        ) as mock_settings:
            mock_settings.return_value.supabase_url = "https://test.supabase.co"

            with patch(
                "app.services.google_photo_downloader.get_http_client"
            ) as mock_client:
                client = AsyncMock()
                response = MagicMock()
                response.status_code = 200
                response.content = b"invalid image data"
                client.get = AsyncMock(return_value=response)
                mock_client.return_value = client

                with patch(
                    "app.services.google_photo_downloader.generate_thumbnail"
                ) as mock_thumb:
                    mock_thumb.return_value = None  # Thumbnail generation failed

                    result = await download_and_store_google_photo(
                        VALID_GOOGLE_PHOTO_URL,
                        TEST_USER_ID,
                        TEST_ENTRY_ID,
                    )
                    assert result is None

    @pytest.mark.asyncio
    async def test_handles_upload_500_error(self):
        """Should handle upload 500 error gracefully."""
        with patch(
            "app.services.google_photo_downloader.get_settings"
        ) as mock_settings:
            mock_settings.return_value.supabase_url = "https://test.supabase.co"
            mock_settings.return_value.supabase_service_role_key = "test-key"

            with patch(
                "app.services.google_photo_downloader.get_http_client"
            ) as mock_client:
                client = AsyncMock()

                # Mock successful download
                download_response = MagicMock()
                download_response.status_code = 200
                download_response.content = b"fake image data"

                # Mock failed upload
                upload_response = MagicMock()
                upload_response.status_code = 500
                upload_response.text = "Internal Server Error"

                client.get = AsyncMock(return_value=download_response)
                client.put = AsyncMock(return_value=upload_response)
                mock_client.return_value = client

                with patch(
                    "app.services.google_photo_downloader.generate_thumbnail"
                ) as mock_thumb:
                    mock_thumb.return_value = b"fake thumbnail data"

                    result = await download_and_store_google_photo(
                        VALID_GOOGLE_PHOTO_URL,
                        TEST_USER_ID,
                        TEST_ENTRY_ID,
                    )
                    assert result is None

    @pytest.mark.asyncio
    async def test_handles_upload_409_conflict_as_success(self):
        """Should treat 409 conflict (file exists) as success."""
        with patch(
            "app.services.google_photo_downloader.get_settings"
        ) as mock_settings:
            mock_settings.return_value.supabase_url = "https://test.supabase.co"
            mock_settings.return_value.supabase_service_role_key = "test-key"

            with patch(
                "app.services.google_photo_downloader.get_http_client"
            ) as mock_client:
                client = AsyncMock()

                # Mock successful download
                download_response = MagicMock()
                download_response.status_code = 200
                download_response.content = b"fake image data"

                # Mock 409 conflict (file already exists)
                upload_response = MagicMock()
                upload_response.status_code = 409

                client.get = AsyncMock(return_value=download_response)
                client.put = AsyncMock(return_value=upload_response)
                mock_client.return_value = client

                with patch(
                    "app.services.google_photo_downloader.generate_thumbnail"
                ) as mock_thumb:
                    mock_thumb.return_value = b"fake thumbnail data"

                    result = await download_and_store_google_photo(
                        VALID_GOOGLE_PHOTO_URL,
                        TEST_USER_ID,
                        TEST_ENTRY_ID,
                    )
                    # 409 should be treated as success (file exists)
                    expected_path = f"{TEST_USER_ID}/{TEST_ENTRY_ID}_google_thumb.jpg"
                    assert result == expected_path

    @pytest.mark.asyncio
    async def test_successful_download_and_upload(self):
        """Should return thumbnail path on successful download and upload."""
        with patch(
            "app.services.google_photo_downloader.get_settings"
        ) as mock_settings:
            mock_settings.return_value.supabase_url = "https://test.supabase.co"
            mock_settings.return_value.supabase_service_role_key = "test-key"

            with patch(
                "app.services.google_photo_downloader.get_http_client"
            ) as mock_client:
                client = AsyncMock()

                # Mock successful download
                download_response = MagicMock()
                download_response.status_code = 200
                download_response.content = b"fake image data"

                # Mock successful upload
                upload_response = MagicMock()
                upload_response.status_code = 201

                client.get = AsyncMock(return_value=download_response)
                client.put = AsyncMock(return_value=upload_response)
                mock_client.return_value = client

                with patch(
                    "app.services.google_photo_downloader.generate_thumbnail"
                ) as mock_thumb:
                    mock_thumb.return_value = b"fake thumbnail data"

                    result = await download_and_store_google_photo(
                        VALID_GOOGLE_PHOTO_URL,
                        TEST_USER_ID,
                        TEST_ENTRY_ID,
                    )
                    expected_path = f"{TEST_USER_ID}/{TEST_ENTRY_ID}_google_thumb.jpg"
                    assert result == expected_path

    @pytest.mark.asyncio
    async def test_handles_unexpected_exception(self):
        """Should handle unexpected exceptions gracefully."""
        with patch(
            "app.services.google_photo_downloader.get_settings"
        ) as mock_settings:
            mock_settings.return_value.supabase_url = "https://test.supabase.co"

            with patch(
                "app.services.google_photo_downloader.get_http_client"
            ) as mock_client:
                mock_client.side_effect = RuntimeError("Unexpected error")

                result = await download_and_store_google_photo(
                    VALID_GOOGLE_PHOTO_URL,
                    TEST_USER_ID,
                    TEST_ENTRY_ID,
                )
                assert result is None


class TestCreateMediaRecordForGooglePhoto:
    """Tests for create_media_record_for_google_photo function."""

    @pytest.mark.asyncio
    async def test_creates_media_record_successfully(self):
        """Should create media record successfully."""
        with patch(
            "app.services.google_photo_downloader.get_supabase_client"
        ) as mock_db:
            mock_client = AsyncMock()
            mock_client.post = AsyncMock(return_value=[{"id": "new-media-id"}])
            mock_db.return_value = mock_client

            thumbnail_path = f"{TEST_USER_ID}/{TEST_ENTRY_ID}_google_thumb.jpg"
            result = await create_media_record_for_google_photo(
                TEST_USER_ID,
                TEST_ENTRY_ID,
                TEST_TRIP_ID,
                thumbnail_path,
            )

            assert result is True
            mock_client.post.assert_called_once_with(
                "media_files",
                {
                    "owner_id": TEST_USER_ID,
                    "entry_id": TEST_ENTRY_ID,
                    "trip_id": TEST_TRIP_ID,
                    "file_path": thumbnail_path,
                    "thumbnail_path": thumbnail_path,
                    "status": "uploaded",
                },
            )

    @pytest.mark.asyncio
    async def test_handles_database_error(self):
        """Should handle database errors gracefully."""
        with patch(
            "app.services.google_photo_downloader.get_supabase_client"
        ) as mock_db:
            mock_client = AsyncMock()
            mock_client.post = AsyncMock(side_effect=Exception("Database error"))
            mock_db.return_value = mock_client

            thumbnail_path = f"{TEST_USER_ID}/{TEST_ENTRY_ID}_google_thumb.jpg"
            result = await create_media_record_for_google_photo(
                TEST_USER_ID,
                TEST_ENTRY_ID,
                TEST_TRIP_ID,
                thumbnail_path,
            )

            assert result is False

    @pytest.mark.asyncio
    async def test_handles_constraint_violation(self):
        """Should handle constraint violations gracefully."""
        with patch(
            "app.services.google_photo_downloader.get_supabase_client"
        ) as mock_db:
            mock_client = AsyncMock()
            mock_client.post = AsyncMock(
                side_effect=Exception("duplicate key value violates unique constraint")
            )
            mock_db.return_value = mock_client

            thumbnail_path = f"{TEST_USER_ID}/{TEST_ENTRY_ID}_google_thumb.jpg"
            result = await create_media_record_for_google_photo(
                TEST_USER_ID,
                TEST_ENTRY_ID,
                TEST_TRIP_ID,
                thumbnail_path,
            )

            assert result is False
