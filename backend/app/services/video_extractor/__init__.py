"""Video extraction services for social media content.

This module provides video download (via yt-dlp) and frame extraction (via ffmpeg)
capabilities for extracting places from video content when caption extraction fails.
"""

from app.services.video_extractor.downloader import (
    VideoDownloadError,
    download_video,
)
from app.services.video_extractor.frame_extractor import (
    FrameExtractionError,
    extract_frames,
)

__all__ = [
    "VideoDownloadError",
    "download_video",
    "FrameExtractionError",
    "extract_frames",
]
