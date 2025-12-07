"""Media file utilities."""

from typing import Any

from app.core.config import get_settings


def build_media_url(file_path: str) -> str:
    """Build a public URL for a media file in Supabase storage."""
    settings = get_settings()
    if not settings.supabase_url:
        return ""
    return f"{settings.supabase_url}/storage/v1/object/public/media/{file_path}"


def extract_media_urls(media_files: list[dict[str, Any]] | None) -> list[str]:
    """Extract public URLs from media file records.

    Filters for uploaded status and prefers thumbnails over full images.
    Skips files without thumbnails if the original is not web-compatible (e.g., HEIC).
    """
    WEB_COMPATIBLE_EXTENSIONS = {".jpg", ".jpeg", ".png", ".gif", ".webp"}

    urls: list[str] = []
    for media in media_files or []:
        if media.get("status") != "uploaded":
            continue

        thumbnail_path = media.get("thumbnail_path")
        file_path = media.get("file_path")

        # Prefer thumbnail if available
        if thumbnail_path:
            urls.append(build_media_url(thumbnail_path))
        elif file_path:
            # Only use original file if it's web-compatible
            ext = file_path.lower().rsplit(".", 1)[-1] if "." in file_path else ""
            if f".{ext}" in WEB_COMPATIBLE_EXTENSIONS:
                urls.append(build_media_url(file_path))
        # Skip HEIC/HEIF and other non-web formats without thumbnails

    return urls
