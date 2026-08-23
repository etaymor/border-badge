"""Instagram carousel extraction using instaloader.

Fetches all images from Instagram carousel posts (GraphSidecar)
for multimodal place extraction.
"""

from __future__ import annotations

import asyncio
import logging
import re
import time
from dataclasses import dataclass
from functools import lru_cache
from pathlib import Path
from typing import Literal, cast

import httpx
import instaloader

from app.services.url_resolver import extract_instagram_shortcode

logger = logging.getLogger(__name__)

MAX_CAROUSEL_IMAGES = 10
MAX_IMAGE_BYTES = 5 * 1024 * 1024
MAX_VIDEO_BYTES = 100 * 1024 * 1024
DEFAULT_TIMEOUT_SECONDS = 12.0
MAX_CONCURRENT_DOWNLOADS = 4

BROWSER_USER_AGENT = (
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
    "AppleWebKit/537.36 (KHTML, like Gecko) "
    "Chrome/123.0.0.0 Safari/537.36"
)

# Instaloader returns signed CDN URLs, not page URLs. Reject anything else.
INSTAGRAM_CDN_VIDEO_PATTERN = re.compile(
    r"^https://(?:[a-z0-9-]+\.)+(?:cdninstagram\.com|fbcdn\.net)/",
    re.IGNORECASE,
)


@dataclass(frozen=True)
class InstagramPostLocation:
    """Location/geotag data from Instagram post."""

    id: int
    name: str
    slug: str | None
    lat: float | None
    lng: float | None


@dataclass(frozen=True)
class InstagramCarouselData:
    """Data extracted from an Instagram post/carousel."""

    caption: str | None
    images: list[bytes]
    image_urls: list[str]
    post_type: Literal["GraphSidecar", "GraphImage", "GraphVideo"]
    location: InstagramPostLocation | None
    video_url: str | None = None


def is_instagram_cdn_video_url(url: str) -> bool:
    """Return True if url is an Instagram/Facebook video CDN link."""
    return bool(INSTAGRAM_CDN_VIDEO_PATTERN.match(url))


@lru_cache(maxsize=1)
def _get_instaloader() -> instaloader.Instaloader:
    """Get cached instaloader instance."""
    return instaloader.Instaloader(
        download_pictures=False,
        download_videos=False,
        download_video_thumbnails=False,
        download_geotags=False,
        download_comments=False,
        save_metadata=False,
        compress_json=False,
    )


async def fetch_instagram_carousel(
    url: str,
    *,
    max_images: int = MAX_CAROUSEL_IMAGES,
    timeout: float = DEFAULT_TIMEOUT_SECONDS,
) -> InstagramCarouselData | None:
    """Fetch Instagram post/carousel images using instaloader.

    Works with public Instagram posts without authentication.
    For carousel posts (GraphSidecar), fetches all images.
    For single image posts, fetches the one image.

    Args:
        url: Instagram post URL
        max_images: Maximum images to download from carousel
        timeout: Total timeout for the operation

    Returns:
        InstagramCarouselData with images, or None on failure
    """
    shortcode = extract_instagram_shortcode(url)
    if not shortcode:
        logger.debug("instagram_carousel_no_shortcode", extra={"url": url[:100]})
        return None

    start_time = time.monotonic()

    try:
        # Get post metadata (runs in thread pool to not block event loop)
        loader = _get_instaloader()
        loop = asyncio.get_event_loop()

        def get_post():
            return instaloader.Post.from_shortcode(loader.context, shortcode)

        post = await asyncio.wait_for(
            loop.run_in_executor(None, get_post),
            timeout=timeout / 2,  # Reserve half timeout for image downloads
        )

        # Collect image URLs and, for GraphVideo, the CDN video URL.
        # yt-dlp cannot fetch Instagram without cookies; Instaloader already
        # resolved the signed mp4 URL from the same metadata request.
        image_urls: list[str] = []
        video_url: str | None = None
        if post.typename == "GraphSidecar":
            for node in post.get_sidecar_nodes():
                if not node.is_video:
                    image_urls.append(node.display_url)
                    if len(image_urls) >= max_images:
                        break
        elif post.typename == "GraphImage":
            image_urls.append(post.url)
        elif post.typename == "GraphVideo":
            if post.url:
                image_urls.append(post.url)
            raw_video_url = getattr(post, "video_url", None)
            if raw_video_url and is_instagram_cdn_video_url(raw_video_url):
                video_url = raw_video_url

        if not image_urls and not video_url:
            logger.debug("instagram_carousel_no_images", extra={"shortcode": shortcode})
            return None

        images: list[bytes] = []
        if image_urls:
            remaining_timeout = timeout - (time.monotonic() - start_time)
            if remaining_timeout <= 0 and not video_url:
                logger.debug("instagram_carousel_timeout_before_download")
                return None
            if remaining_timeout > 0:
                images = await _download_images(
                    image_urls,
                    timeout=remaining_timeout,
                    max_concurrent=MAX_CONCURRENT_DOWNLOADS,
                )

        if not images and not video_url:
            logger.debug("instagram_carousel_download_failed")
            return None

        elapsed_ms = (time.monotonic() - start_time) * 1000
        logger.info(
            "instagram_carousel_fetch_success",
            extra={
                "shortcode": shortcode,
                "post_type": post.typename,
                "images_found": len(image_urls),
                "images_downloaded": len(images),
                "has_video_url": video_url is not None,
                "elapsed_ms": round(elapsed_ms, 2),
            },
        )

        # Extract geotag/location if available
        location = None
        if post.location:
            location = InstagramPostLocation(
                id=post.location.id,
                name=post.location.name,
                slug=getattr(post.location, "slug", None),
                lat=getattr(post.location, "lat", None),
                lng=getattr(post.location, "lng", None),
            )
            logger.info(
                "instagram_geotag_found",
                extra={
                    "shortcode": shortcode,
                    "location_name": location.name,
                    "has_coords": location.lat is not None,
                },
            )

        # Cast typename to literal type (instaloader returns str but values are known)
        post_type = cast(
            Literal["GraphSidecar", "GraphImage", "GraphVideo"],
            post.typename,
        )

        return InstagramCarouselData(
            caption=post.caption,
            images=images,
            image_urls=image_urls[: len(images)],
            post_type=post_type,
            location=location,
            video_url=video_url,
        )

    except TimeoutError:
        logger.debug("instagram_carousel_timeout", extra={"shortcode": shortcode})
        return None
    except Exception as e:
        logger.warning(
            "instagram_carousel_error",
            extra={"shortcode": shortcode, "error": str(e)[:200]},
        )
        return None


async def download_instagram_cdn_video(
    video_url: str,
    *,
    output_dir: Path,
    timeout: float = 15.0,
) -> Path | None:
    """Download a signed Instagram CDN mp4 to output_dir.

    Returns the file path, or None if the URL is rejected or the download fails.
    """
    if not is_instagram_cdn_video_url(video_url):
        logger.warning(
            "instagram_cdn_video_rejected",
            extra={"url": video_url[:80]},
        )
        return None

    output_dir.mkdir(parents=True, exist_ok=True)
    output_path = output_dir / "video.mp4"

    try:
        async with httpx.AsyncClient(
            timeout=timeout,
            follow_redirects=True,
            max_redirects=3,
        ) as client:
            async with client.stream(
                "GET",
                video_url,
                headers={"User-Agent": BROWSER_USER_AGENT},
            ) as response:
                if response.status_code != 200:
                    logger.debug(
                        "instagram_cdn_video_http_error",
                        extra={"status": response.status_code},
                    )
                    return None

                written = 0
                with output_path.open("wb") as handle:
                    async for chunk in response.aiter_bytes(65536):
                        written += len(chunk)
                        if written > MAX_VIDEO_BYTES:
                            logger.warning("instagram_cdn_video_too_large")
                            output_path.unlink(missing_ok=True)
                            return None
                        handle.write(chunk)

        if written == 0:
            output_path.unlink(missing_ok=True)
            return None

        header = output_path.read_bytes()[:12]
        if b"ftyp" not in header:
            logger.warning("instagram_cdn_video_not_mp4")
            output_path.unlink(missing_ok=True)
            return None

        logger.info(
            "instagram_cdn_video_download_success",
            extra={"size_bytes": written},
        )
        return output_path
    except Exception as e:
        logger.warning(
            "instagram_cdn_video_download_error",
            extra={"error": str(e)[:200]},
        )
        output_path.unlink(missing_ok=True)
        return None


async def _download_images(
    urls: list[str],
    *,
    timeout: float,
    max_concurrent: int,
) -> list[bytes]:
    """Download images concurrently with size limit."""
    semaphore = asyncio.Semaphore(max_concurrent)
    per_image_timeout = timeout / max(1, len(urls))

    async def download_one(url: str) -> bytes | None:
        async with semaphore:
            try:
                async with httpx.AsyncClient(
                    timeout=per_image_timeout,
                    follow_redirects=True,
                    max_redirects=3,
                ) as client:
                    response = await client.get(
                        url,
                        headers={
                            "User-Agent": BROWSER_USER_AGENT,
                        },
                    )
                    if response.status_code == 200:
                        content = response.content
                        if len(content) <= MAX_IMAGE_BYTES:
                            return content
            except Exception:
                pass
            return None

    results = await asyncio.gather(*[download_one(url) for url in urls])
    return [img for img in results if img is not None]
