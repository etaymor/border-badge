"""TikTok slideshow metadata extraction via gallery-dl subprocess.

Uses gallery-dl's --dump-json mode to extract image URLs and captions
from TikTok photo slideshows without downloading files. Images are
downloaded separately by the caller using httpx.

Security measures mirror the yt-dlp downloader pattern:
- Strict URL regex validation (only TikTok /photo/ URLs)
- Arguments passed as array (no shell=True)
- Process timeout with SIGKILL on timeout/cancellation
- Stdout size cap to prevent memory exhaustion
- Image URL validation against TikTok CDN domains (SSRF prevention)
- Output count limit via --range flag
"""

import asyncio
import json
import logging
import re
import time
from dataclasses import dataclass

logger = logging.getLogger(__name__)

# Strict URL pattern - only TikTok photo slideshow URLs
ALLOWED_TIKTOK_PHOTO_PATTERN = re.compile(
    r"^https://(www\.)?tiktok\.com/@[\w.-]+/photo/\d+$"
)

# Validate image URLs from gallery-dl output (SSRF prevention)
ALLOWED_IMAGE_HOST_PATTERN = re.compile(r"^https://[a-z0-9-]+\.tiktokcdn\.com/")

# Audio file extensions to filter out
AUDIO_EXTENSIONS = {".m4a", ".mp3", ".aac", ".ogg", ".wav"}

DEFAULT_TIMEOUT_SECONDS = 8.0
MAX_IMAGES = 20
MAX_STDOUT_BYTES = 512 * 1024  # 512KB cap on subprocess output


@dataclass
class GalleryDLResult:
    """Result from gallery-dl metadata extraction."""

    image_urls: list[str]  # Validated TikTok CDN URLs for slideshow images
    caption: str | None  # Post description/caption


def _is_audio_url(url: str) -> bool:
    """Check if a URL points to an audio file by extension."""
    # Check the path portion before any query params
    path = url.split("?")[0].lower()
    return any(path.endswith(ext) for ext in AUDIO_EXTENSIONS)


def _validate_image_url(url: str) -> bool:
    """Validate an image URL from gallery-dl output.

    Ensures the URL uses HTTPS and points to a TikTok CDN domain.
    """
    if _is_audio_url(url):
        return False
    return bool(ALLOWED_IMAGE_HOST_PATTERN.match(url))


async def fetch_tiktok_slideshow_gallery_dl(
    url: str,
    *,
    proxy_url: str | None = None,
    timeout: float = DEFAULT_TIMEOUT_SECONDS,
) -> GalleryDLResult | None:
    """Extract TikTok slideshow images via gallery-dl subprocess.

    Returns image URLs + metadata, or None on failure.
    Images are NOT downloaded by gallery-dl -- caller handles download.

    Args:
        url: TikTok photo slideshow URL
        proxy_url: Optional proxy URL for gallery-dl
        timeout: Maximum time for subprocess execution

    Returns:
        GalleryDLResult with image URLs and caption, or None on failure
    """
    # 1. Validate URL against allowlist
    if not ALLOWED_TIKTOK_PHOTO_PATTERN.match(url):
        logger.debug("gallery_dl_url_rejected", extra={"url": url[:100]})
        return None

    # 2. Build command (array args, never shell=True)
    cmd = [
        "gallery-dl",
        "--dump-json",  # Metadata only, no file downloads
        "--range",
        f"1-{MAX_IMAGES}",  # Limit output count
    ]
    if proxy_url:
        cmd.extend(["--proxy", proxy_url])
    cmd.append(url)

    start_time = time.monotonic()

    # 3. Run as async subprocess with timeout + kill
    try:
        proc = await asyncio.create_subprocess_exec(
            *cmd,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE,
        )
    except FileNotFoundError:
        logger.warning("gallery_dl_not_installed")
        return None

    try:
        stdout_bytes, stderr_bytes = await asyncio.wait_for(
            _read_subprocess(proc),
            timeout=timeout,
        )
    except asyncio.CancelledError:
        proc.kill()
        await proc.wait()
        logger.warning("gallery_dl_cancelled", extra={"url": url[:100]})
        raise
    except TimeoutError:
        proc.kill()
        await proc.wait()
        duration_ms = int((time.monotonic() - start_time) * 1000)
        logger.warning(
            "gallery_dl_timeout",
            extra={"url": url[:100], "duration_ms": duration_ms},
        )
        return None

    duration_ms = int((time.monotonic() - start_time) * 1000)

    if proc.returncode != 0:
        stderr_snippet = (
            stderr_bytes.decode(errors="replace")[:200] if stderr_bytes else ""
        )
        logger.warning(
            "gallery_dl_failed",
            extra={
                "returncode": proc.returncode,
                "error": stderr_snippet,
                "duration_ms": duration_ms,
            },
        )
        return None

    # 4. Parse JSON lines output
    result = _parse_gallery_dl_output(stdout_bytes)
    if not result:
        logger.warning(
            "gallery_dl_no_images",
            extra={"url": url[:100], "duration_ms": duration_ms},
        )
        return None

    logger.info(
        "gallery_dl_success",
        extra={
            "image_count": len(result.image_urls),
            "duration_ms": duration_ms,
        },
    )
    return result


async def _read_subprocess(
    proc: asyncio.subprocess.Process,
) -> tuple[bytes, bytes]:
    """Read subprocess stdout/stderr with size cap on stdout.

    Caps stdout at MAX_STDOUT_BYTES to prevent memory exhaustion.
    """
    assert proc.stdout is not None
    assert proc.stderr is not None

    stdout_bytes = await proc.stdout.read(MAX_STDOUT_BYTES)
    stderr_bytes = await proc.stderr.read(16 * 1024)  # 16KB for stderr

    # Wait for process to finish
    await proc.wait()
    return stdout_bytes, stderr_bytes


def _parse_gallery_dl_output(stdout_bytes: bytes) -> GalleryDLResult | None:
    """Parse gallery-dl --dump-json output into structured result.

    gallery-dl outputs JSON lines. Each line is [type, url, metadata_dict].
    Type 1 = downloadable URL.
    """
    if not stdout_bytes:
        return None

    stdout_text = stdout_bytes.decode(errors="replace")
    image_urls: list[str] = []
    caption: str | None = None

    for line in stdout_text.splitlines():
        line = line.strip()
        if not line:
            continue

        try:
            parsed = json.loads(line)
        except json.JSONDecodeError:
            # gallery-dl may emit warnings or status messages to stdout
            continue

        if not isinstance(parsed, list) or len(parsed) < 3:
            continue

        entry_type, entry_url, metadata = parsed[0], parsed[1], parsed[2]

        # Type 1 = downloadable URL
        if entry_type != 1:
            continue

        if not isinstance(entry_url, str):
            continue

        # Validate image URL against allowlist
        if _validate_image_url(entry_url):
            image_urls.append(entry_url)

        # Extract caption from first metadata dict
        if caption is None and isinstance(metadata, dict):
            caption = metadata.get("description") or metadata.get("desc")

    if not image_urls:
        return None

    return GalleryDLResult(image_urls=image_urls, caption=caption)
