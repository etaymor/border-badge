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
    """
    urls: list[str] = []
    for media in media_files or []:
        if media.get("status") == "uploaded":
            path = media.get("thumbnail_path") or media.get("file_path")
            if path:
                urls.append(build_media_url(path))
    return urls
