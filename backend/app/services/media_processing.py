"""Media processing service for thumbnail generation."""

import logging

import httpx

from app.core.config import get_settings
from app.core.thumbnails import (
    SUPPORTED_EXTENSIONS,
    generate_thumbnail,
    get_thumbnail_path,
)
from app.db.session import get_http_client, get_supabase_client

logger = logging.getLogger(__name__)


async def process_media_thumbnail(media_id: str, file_path: str) -> None:
    """Background task to generate and upload a thumbnail.

    This function is designed to be called via FastAPI BackgroundTasks.
    It handles all errors internally and logs failures rather than raising.

    Args:
        media_id: UUID of the media_files record
        file_path: Storage path of the original file
    """
    settings = get_settings()

    # Check if file type supports thumbnails
    ext = f".{file_path.rsplit('.', 1)[-1]}" if "." in file_path else ""
    if ext.lower() not in SUPPORTED_EXTENSIONS:
        logger.debug(f"Skipping thumbnail for unsupported format: {file_path}")
        return

    try:
        client = get_http_client()

        # 1. Download original file from Supabase Storage
        download_url = f"{settings.supabase_url}/storage/v1/object/media/{file_path}"
        headers = {
            "apikey": settings.supabase_service_role_key,
            "Authorization": f"Bearer {settings.supabase_service_role_key}",
        }

        response = await client.get(download_url, headers=headers)
        if response.status_code != 200:
            logger.error(
                f"Failed to download original file {file_path}: {response.status_code}"
            )
            return

        original_data = response.content

        # 2. Generate thumbnail
        thumbnail_data = generate_thumbnail(original_data, ext)
        if thumbnail_data is None:
            logger.warning(f"Thumbnail generation returned None for {file_path}")
            return

        # 3. Upload thumbnail to Supabase Storage
        thumbnail_path = get_thumbnail_path(file_path)
        upload_url = f"{settings.supabase_url}/storage/v1/object/media/{thumbnail_path}"
        upload_headers = {
            "apikey": settings.supabase_service_role_key,
            "Authorization": f"Bearer {settings.supabase_service_role_key}",
            "Content-Type": "image/jpeg",
        }

        upload_response = await client.put(
            upload_url,
            headers=upload_headers,
            content=thumbnail_data,
        )

        if upload_response.status_code not in (200, 201, 409):
            logger.error(
                f"Failed to upload thumbnail {thumbnail_path}: "
                f"{upload_response.status_code} - {upload_response.text[:200]}"
            )
            return

        if upload_response.status_code == 409:
            logger.info(f"Thumbnail already exists: {thumbnail_path}")

        # 4. Update media_files record with thumbnail_path
        db = get_supabase_client()  # Use service role (no user token)
        await db.patch(
            "media_files",
            {"thumbnail_path": thumbnail_path},
            {"id": f"eq.{media_id}"},
        )

        logger.info(
            f"Successfully generated thumbnail for media {media_id}: {thumbnail_path}"
        )

    except httpx.RequestError as e:
        logger.error(f"Network error during thumbnail processing for {media_id}: {e}")
    except Exception as e:
        logger.error(
            f"Unexpected error during thumbnail processing for {media_id}: {e}",
            exc_info=True,
        )
