"""Video frame extraction service using ffmpeg.

Extracts frames from video files at regular intervals for multimodal analysis.
Optimized for single-pass extraction using ffmpeg's video filter chain.

Usage:
    frames = await extract_frames(video_path, max_frames=30)
    # frames is list of JPEG bytes, each resized to 640x360
"""

import asyncio
import logging
import tempfile
from pathlib import Path

logger = logging.getLogger(__name__)


class FrameExtractionError(Exception):
    """Raised when frame extraction fails."""

    pass


# Frame extraction parameters
DEFAULT_FPS = 1.0  # 1 frame per second
DEFAULT_MAX_FRAMES = 30
FRAME_WIDTH = 640
FRAME_HEIGHT = 360
JPEG_QUALITY = 2  # ffmpeg quality scale (2 = high quality, lower file size)


async def extract_frames(
    video_path: Path,
    *,
    max_frames: int = DEFAULT_MAX_FRAMES,
    fps: float = DEFAULT_FPS,
    timeout: float = 30.0,
) -> list[bytes]:
    """Extract frames from video file using ffmpeg.

    Uses single-pass extraction with video filters for efficiency:
    - fps filter: Extract frames at specified rate
    - scale filter: Resize to 640x360 for multimodal API
    - format filter: Output as JPEG

    Args:
        video_path: Path to input video file
        max_frames: Maximum number of frames to extract
        fps: Frames per second to extract (0.5 = 1 frame every 2 seconds)
        timeout: Maximum extraction time in seconds

    Returns:
        List of JPEG image bytes, each frame is 640x360 pixels

    Raises:
        FrameExtractionError: If extraction fails
        asyncio.TimeoutError: If extraction exceeds timeout
    """
    if not video_path.exists():
        raise FrameExtractionError(f"Video file not found: {video_path}")

    # Create temp directory for frames
    with tempfile.TemporaryDirectory(prefix="frames_") as tmpdir:
        output_pattern = f"{tmpdir}/frame_%04d.jpg"

        # Build ffmpeg command
        # Single-pass extraction: fps, scale, limit frames in one command
        # -vf: Video filter chain
        # -vframes: Limit total frames output
        # -q:v 2: JPEG quality (2 = high quality)
        cmd = [
            "ffmpeg",
            "-y",  # Overwrite output files
            "-i",
            str(video_path),
            "-vf",
            f"fps={fps},scale={FRAME_WIDTH}:{FRAME_HEIGHT}:force_original_aspect_ratio=decrease,"
            f"pad={FRAME_WIDTH}:{FRAME_HEIGHT}:(ow-iw)/2:(oh-ih)/2:black",
            "-vframes",
            str(max_frames),
            "-q:v",
            str(JPEG_QUALITY),
            output_pattern,
        ]

        logger.debug("ffmpeg_extract_start", extra={"video": str(video_path)})

        try:
            proc = await asyncio.create_subprocess_exec(
                *cmd,
                stdout=asyncio.subprocess.PIPE,
                stderr=asyncio.subprocess.PIPE,
            )
        except FileNotFoundError:
            raise FrameExtractionError(
                "ffmpeg not found - install ffmpeg to enable video frame extraction"
            ) from None

        try:
            _stdout, stderr = await asyncio.wait_for(
                proc.communicate(), timeout=timeout
            )
        except TimeoutError:
            proc.kill()
            await proc.wait()
            logger.warning("ffmpeg_extract_timeout", extra={"video": str(video_path)})
            raise FrameExtractionError("Frame extraction timed out") from None

        if proc.returncode != 0:
            error_msg = stderr.decode()[:200] if stderr else "Unknown error"
            logger.warning(
                "ffmpeg_extract_failed",
                extra={"returncode": proc.returncode, "error": error_msg},
            )
            raise FrameExtractionError(f"ffmpeg failed: {error_msg}")

        # Read all extracted frames
        frame_files = sorted(Path(tmpdir).glob("frame_*.jpg"))
        if not frame_files:
            raise FrameExtractionError("No frames extracted")

        frames: list[bytes] = []
        for frame_path in frame_files[:max_frames]:
            frames.append(frame_path.read_bytes())

        logger.info(
            "ffmpeg_extract_success",
            extra={"video": str(video_path), "frames_extracted": len(frames)},
        )

        return frames


async def get_video_duration(video_path: Path, timeout: float = 5.0) -> float | None:
    """Get video duration in seconds using ffprobe.

    Args:
        video_path: Path to video file
        timeout: Maximum probe time in seconds

    Returns:
        Duration in seconds, or None if unable to determine
    """
    cmd = [
        "ffprobe",
        "-v",
        "error",
        "-show_entries",
        "format=duration",
        "-of",
        "default=noprint_wrappers=1:nokey=1",
        str(video_path),
    ]

    try:
        proc = await asyncio.create_subprocess_exec(
            *cmd,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE,
        )
        stdout, _stderr = await asyncio.wait_for(proc.communicate(), timeout=timeout)

        if proc.returncode == 0 and stdout:
            duration_str = stdout.decode().strip()
            return float(duration_str)
    except (TimeoutError, ValueError, FileNotFoundError, OSError):
        pass

    return None
