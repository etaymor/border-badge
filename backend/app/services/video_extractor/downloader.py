"""Video download service using yt-dlp.

Provides secure video download from TikTok and Instagram URLs with strict
URL validation, command injection prevention, and timeout handling.

Security measures:
- Strict URL regex validation (only TikTok/Instagram)
- Arguments passed as array (no shell=True, no string concatenation)
- --no-exec flag to disable post-processing hooks
- Timeout with process cleanup

Usage:
    video_path = await download_video("https://www.tiktok.com/@user/video/123")
"""

import asyncio
import logging
import re
import tempfile
from pathlib import Path

logger = logging.getLogger(__name__)


class VideoDownloadError(Exception):
    """Raised when video download fails."""

    pass


# Strict URL pattern - only allow TikTok/Instagram URLs
# Prevents command injection and downloading from arbitrary sources
ALLOWED_URL_PATTERN = re.compile(
    r"^https://(www\.)?"
    r"(tiktok\.com|vm\.tiktok\.com|instagram\.com|instagr\.am)"
    r"/[a-zA-Z0-9/_\-@.?=&%]+$"
)

# Maximum file size to prevent disk space attacks (100MB)
MAX_VIDEO_SIZE_BYTES = 100 * 1024 * 1024


def _validate_url(url: str) -> None:
    """Validate URL matches allowed patterns.

    Args:
        url: URL to validate

    Raises:
        VideoDownloadError: If URL doesn't match allowed patterns
    """
    if not ALLOWED_URL_PATTERN.match(url):
        raise VideoDownloadError(
            "URL does not match allowed patterns (TikTok/Instagram only)"
        )


async def download_video(
    url: str,
    *,
    timeout: float = 15.0,
    output_dir: Path | None = None,
) -> Path:
    """Download video from TikTok or Instagram URL using yt-dlp.

    Downloads video to a temporary directory (or specified output_dir).
    Caller is responsible for cleaning up the file/directory.

    Args:
        url: TikTok or Instagram video URL
        timeout: Maximum download time in seconds
        output_dir: Optional output directory (uses tempdir if not specified)

    Returns:
        Path to downloaded video file

    Raises:
        VideoDownloadError: If download fails or URL is invalid
        asyncio.TimeoutError: If download exceeds timeout
    """
    # Validate URL strictly BEFORE subprocess
    _validate_url(url)

    # Create output directory if not specified
    if output_dir is None:
        output_dir = Path(tempfile.mkdtemp(prefix="video_dl_"))

    output_template = str(output_dir / "video.%(ext)s")

    # SAFE: Each argument is a separate element, never string concatenation
    # This prevents command injection even if URL contains shell metacharacters
    cmd = [
        "yt-dlp",
        "--no-exec",  # CRITICAL: Disable post-processing hooks
        "--no-playlist",  # Prevent batch downloads
        "--socket-timeout",
        "10",
        "--retries",
        "2",
        "--max-filesize",
        str(MAX_VIDEO_SIZE_BYTES),
        "--format",
        "mp4/best[ext=mp4]/best",  # Prefer mp4, fallback to best
        "--output",
        output_template,
        url,  # Already validated above
    ]

    logger.debug("yt-dlp_download_start", extra={"url": url[:100]})

    proc = await asyncio.create_subprocess_exec(
        *cmd,
        stdout=asyncio.subprocess.PIPE,
        stderr=asyncio.subprocess.PIPE,
    )

    try:
        _stdout, stderr = await asyncio.wait_for(proc.communicate(), timeout=timeout)
    except asyncio.CancelledError:
        proc.kill()
        await proc.wait()
        logger.warning("yt-dlp_download_cancelled", extra={"url": url[:100]})
        raise
    except TimeoutError:
        proc.kill()
        await proc.wait()  # Wait for process to be reaped
        logger.warning("yt-dlp_download_timeout", extra={"url": url[:100]})
        raise VideoDownloadError("Download timed out") from None

    if proc.returncode != 0:
        error_msg = stderr.decode()[:200] if stderr else "Unknown error"
        logger.warning(
            "yt-dlp_download_failed",
            extra={"returncode": proc.returncode, "error": error_msg},
        )
        raise VideoDownloadError(f"yt-dlp failed: {error_msg}")

    # Find the downloaded file (may have different extension)
    video_files = list(output_dir.glob("video.*"))
    if not video_files:
        raise VideoDownloadError("Output file not created")

    video_path = video_files[0]

    # Verify file size
    file_size = video_path.stat().st_size
    if file_size > MAX_VIDEO_SIZE_BYTES:
        video_path.unlink()
        raise VideoDownloadError(f"Video exceeds size limit: {file_size} bytes")

    if file_size == 0:
        video_path.unlink()
        raise VideoDownloadError("Downloaded file is empty")

    logger.info(
        "yt-dlp_download_success",
        extra={"url": url[:100], "size_bytes": file_size, "path": str(video_path)},
    )

    return video_path


async def cleanup_video(video_path: Path) -> None:
    """Clean up downloaded video and its parent temp directory.

    Args:
        video_path: Path to video file (will also remove parent if it's a temp dir)
    """
    try:
        if video_path.exists():
            video_path.unlink()

        # Remove parent if it's a temp directory we created
        parent = video_path.parent
        if parent.name.startswith("video_dl_") and parent.exists():
            import shutil

            shutil.rmtree(parent, ignore_errors=True)
    except Exception as e:
        logger.warning("video_cleanup_failed", extra={"error": str(e)})
