"""Media file utilities."""

from app.core.config import get_settings


def build_media_url(file_path: str) -> str:
    """Build a public URL for a media file in Supabase storage."""
    settings = get_settings()
    if not settings.supabase_url:
        return ""
    return f"{settings.supabase_url}/storage/v1/object/public/media/{file_path}"
