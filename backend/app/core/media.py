"""Media file utilities."""

from typing import Any, Literal
from urllib.parse import urlencode

from app.core.config import get_settings

# Display widths used by the public share pages. Keep these in sync with the
# CSS frames the images are rendered into (R13: never serve an image larger
# than it is displayed at).
HERO_COVER_WIDTH = 1600
ENTRY_IMAGE_WIDTH = 800  # matches THUMBNAIL_MAX_DIMENSION
AVATAR_WIDTH = 96

DEFAULT_IMAGE_QUALITY = 80

# Originals we can hand to a browser directly. Anything else (HEIC/HEIF, and
# other camera formats) is only usable via a generated thumbnail.
WEB_COMPATIBLE_EXTENSIONS = {".jpg", ".jpeg", ".png", ".gif", ".webp"}

ResizeMode = Literal["cover", "contain", "fill"]


def build_media_url(file_path: str) -> str:
    """Build a public URL for the stored original of a media file.

    Serves the raw object, untransformed. Use `media_url` for anything that is
    rendered into a sized frame in a browser.
    """
    settings = get_settings()
    if not settings.supabase_url:
        return ""
    return f"{settings.supabase_url}/storage/v1/object/public/media/{file_path}"


def media_url(
    file_path: str,
    *,
    width: int,
    quality: int = DEFAULT_IMAGE_QUALITY,
    resize: ResizeMode | None = None,
) -> str:
    """Build a display-sized public URL for a media file.

    Uses Supabase Storage's image-transformation endpoint, which resizes the
    image on the fly and content-negotiates WebP off the browser's `Accept`
    header (no code needed on our side). A 464 KB stored original comes back as
    ~102 KB of WebP at `width=800&quality=80`.

    Args:
        file_path: Storage path within the `media` bucket.
        width: Width in pixels to serve at. Should match the widest CSS box the
            image is displayed in. See `HERO_COVER_WIDTH` / `ENTRY_IMAGE_WIDTH`
            / `AVATAR_WIDTH`.
        quality: JPEG/WebP quality, 20-100.
        resize: Supabase `resize` mode. Left unset by default, which means
            Supabase applies its own default (`fill`, i.e. crop-to-fit) — the
            right choice for fixed-aspect-ratio frames. Pass `"contain"` where
            the subject must not be cropped.
    """
    settings = get_settings()
    if not settings.supabase_url:
        return ""

    params: dict[str, Any] = {"width": width, "quality": quality}
    if resize is not None:
        params["resize"] = resize

    query = urlencode(params)
    return (
        f"{settings.supabase_url}/storage/v1/render/image/public/media/"
        f"{file_path}?{query}"
    )


def extract_media_urls(
    media_files: list[dict[str, Any]] | None,
    *,
    width: int | None = None,
    quality: int = DEFAULT_IMAGE_QUALITY,
    resize: ResizeMode | None = None,
) -> list[str]:
    """Extract public URLs from media file records.

    Filters for uploaded status and prefers thumbnails over full images.
    Skips files without thumbnails if the original is not web-compatible (e.g., HEIC).

    When `width` is given, URLs are served through the image-transformation
    endpoint at that width. This applies to thumbnails as well as originals:
    thumbnail coverage is uneven (they are only generated server-side when the
    client didn't supply one), a thumbnail is only capped on its *longest* edge,
    and routing it through the render endpoint is what unlocks the WebP
    transcode. Supabase does not upscale, so an already-small thumbnail is
    unharmed.

    Without `width` the original raw-object URLs are returned unchanged.
    """
    urls: list[str] = []
    for media in media_files or []:
        if media.get("status") != "uploaded":
            continue

        thumbnail_path = media.get("thumbnail_path")
        file_path = media.get("file_path")

        # Prefer thumbnail if available
        if thumbnail_path:
            path = thumbnail_path
        elif file_path:
            # Only use original file if it's web-compatible
            ext = file_path.lower().rsplit(".", 1)[-1] if "." in file_path else ""
            if f".{ext}" not in WEB_COMPATIBLE_EXTENSIONS:
                # Skip HEIC/HEIF and other non-web formats without thumbnails
                continue
            path = file_path
        else:
            continue

        if width is None:
            urls.append(build_media_url(path))
        else:
            urls.append(media_url(path, width=width, quality=quality, resize=resize))

    return urls
