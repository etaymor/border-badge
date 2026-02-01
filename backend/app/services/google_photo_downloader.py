"""Google Places photo download and storage service."""

import logging

import httpx

from app.core.config import get_settings
from app.core.thumbnails import generate_thumbnail
from app.core.urls import safe_google_photo_url
from app.db.session import get_http_client, get_supabase_client

logger = logging.getLogger(__name__)

# Timeout for downloading Google photo
DOWNLOAD_TIMEOUT_SECONDS = 10.0


async def download_and_store_google_photo(
    photo_url: str,
    user_id: str,
    entry_id: str,
) -> str | None:
    """Download a Google Places photo and store it in Supabase.

    Downloads the photo from Google, generates a thumbnail, and uploads
    it to Supabase Storage. This provides permanent storage for photos
    that would otherwise expire when using Google's temporary URLs.

    Args:
        photo_url: The Google Places photo URL
        user_id: User ID for storage path
        entry_id: Entry ID for unique filename

    Returns:
        Supabase storage file path (thumbnail_path), or None on failure
    """
    # Validate URL (SSRF protection)
    validated_url = safe_google_photo_url(photo_url)
    if not validated_url:
        logger.warning(f"Invalid Google photo URL rejected: {photo_url[:100]}")
        return None

    settings = get_settings()
    if not settings.supabase_url:
        logger.error("Supabase URL not configured")
        return None

    try:
        client = get_http_client()

        # 1. Download image from Google
        response = await client.get(validated_url, timeout=DOWNLOAD_TIMEOUT_SECONDS)

        if response.status_code != 200:
            logger.warning(
                f"Failed to download Google photo: status={response.status_code}"
            )
            return None

        image_data = response.content
        if not image_data:
            logger.warning("Empty response from Google photo URL")
            return None

        # 2. Generate thumbnail (convert to JPEG, resize to max 800px)
        # Use .jpg extension since we're generating a JPEG thumbnail
        thumbnail_data = generate_thumbnail(image_data, ".jpg")
        if thumbnail_data is None:
            logger.warning("Failed to generate thumbnail from Google photo")
            return None

        # 3. Upload to Supabase Storage
        thumbnail_path = f"{user_id}/{entry_id}_google_thumb.jpg"
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
                f"Failed to upload Google photo thumbnail: "
                f"{upload_response.status_code} - {upload_response.text[:200]}"
            )
            return None

        if upload_response.status_code == 409:
            logger.info(f"Google photo thumbnail already exists: {thumbnail_path}")

        logger.info(f"Successfully stored Google photo for entry {entry_id}")
        return thumbnail_path

    except httpx.TimeoutException:
        logger.warning(f"Timeout downloading Google photo for entry {entry_id}")
        return None
    except httpx.RequestError as e:
        logger.error(f"Network error downloading Google photo: {e}")
        return None
    except Exception as e:
        logger.error(f"Unexpected error storing Google photo: {e}", exc_info=True)
        return None


async def create_media_record_for_google_photo(
    user_id: str,
    entry_id: str,
    trip_id: str,
    thumbnail_path: str,
) -> bool:
    """Create a media_files record for a downloaded Google photo.

    Args:
        user_id: Owner ID
        entry_id: Entry ID to link to
        trip_id: Trip ID for the entry
        thumbnail_path: Path in Supabase storage

    Returns:
        True if record created, False on failure
    """
    try:
        db = get_supabase_client()  # Service role for insert

        await db.post(
            "media_files",
            {
                "owner_id": user_id,
                "entry_id": entry_id,
                "trip_id": trip_id,
                "file_path": thumbnail_path,  # Use thumbnail as file_path too
                "thumbnail_path": thumbnail_path,
                "status": "uploaded",
            },
        )

        logger.info(f"Created media record for Google photo: entry={entry_id}")
        return True

    except Exception as e:
        logger.error(f"Failed to create media record for Google photo: {e}")
        return False
