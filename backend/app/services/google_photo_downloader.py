"""Google Places photo download and storage service."""

import logging

import httpx

from app.core.config import get_settings
from app.core.thumbnails import generate_thumbnail, upload_thumbnail_to_storage
from app.core.urls import safe_google_photo_url
from app.db.session import get_http_client, get_service_supabase_client

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
        logger.warning(f"Invalid Google photo URL rejected: {str(photo_url)[:100]}")
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

        # 2. Generate thumbnail (resize to max 800px, convert to JPEG)
        # generate_thumbnail() uses Pillow which auto-detects input format
        # (JPEG, PNG, WebP, etc.) and converts to JPEG output regardless of source
        thumbnail_data = generate_thumbnail(image_data, ".jpg")
        if thumbnail_data is None:
            logger.warning("Failed to generate thumbnail from Google photo")
            return None

        # 3. Upload to Supabase Storage using shared helper
        thumbnail_path = f"{user_id}/{entry_id}_google_thumb.jpg"
        success = await upload_thumbnail_to_storage(
            thumbnail_data,
            thumbnail_path,
            settings.supabase_url,
            settings.supabase_service_role_key,
        )
        if not success:
            return None

        logger.info(f"Successfully stored Google photo for entry {entry_id}")
        return thumbnail_path

    except httpx.TimeoutException:
        # TimeoutException is a subclass of RequestError, so we catch it first
        # to provide a more specific log message for timeout issues
        logger.warning(f"Timeout downloading Google photo for entry {entry_id}")
        return None
    except httpx.HTTPError as e:
        # HTTPError covers RequestError (network issues) and HTTPStatusError
        logger.error(f"HTTP error downloading Google photo: {e}")
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
        db = get_service_supabase_client()  # Service role for insert

        result = await db.post(
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

        # Verify the insert succeeded - db.post returns a list of created records
        if not result:
            logger.error(
                f"Failed to create media record for Google photo: "
                f"empty response from db.post, entry={entry_id}"
            )
            return False

        logger.info(f"Created media record for Google photo: entry={entry_id}")
        return True

    except Exception as e:
        logger.error(f"Failed to create media record for Google photo: {e}")
        return False
