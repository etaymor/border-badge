"""TikTok photo slideshow extraction helpers.

Parses page HTML to locate slideshow image URLs and downloads them for
multimodal place extraction.
"""

from __future__ import annotations

import asyncio
import html as html_lib
import json
import logging
import re
import time
from dataclasses import dataclass
from typing import Literal
from urllib.parse import parse_qsl, urlencode, urlparse, urlunparse

import httpx

from app.services.url_resolver import extract_tiktok_video_id

logger = logging.getLogger(__name__)

MAX_SLIDESHOW_IMAGES = 12
MAX_IMAGE_BYTES = 5 * 1024 * 1024
MAX_CONCURRENT_DOWNLOADS = 4
DEFAULT_TIMEOUT_SECONDS = 8.0
TIKTOK_BROWSER_UA = (
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
    "AppleWebKit/537.36 (KHTML, like Gecko) "
    "Chrome/123.0.0.0 Safari/537.36"
)


@dataclass(frozen=True)
class TikTokSlideshowMetadata:
    caption: str | None
    image_urls: list[str]
    source: Literal["sigi_state", "next_data", "universal_data"]


@dataclass(frozen=True)
class TikTokSlideshowData:
    caption: str | None
    images: list[bytes]
    image_urls: list[str]
    source: Literal["sigi_state", "next_data", "universal_data"]


def parse_tiktok_slideshow_html(html: str) -> TikTokSlideshowMetadata | None:
    """Parse TikTok slideshow HTML and extract image URLs."""
    if not html:
        return None

    sigi_state = _parse_json_script(html, "SIGI_STATE")
    if sigi_state:
        metadata = _extract_from_sigi_state(sigi_state)
        if metadata:
            return metadata

    next_data = _parse_json_script(html, "__NEXT_DATA__")
    if next_data:
        metadata = _extract_from_next_data(next_data)
        if metadata:
            return metadata

    universal_data = _parse_json_script(html, "__UNIVERSAL_DATA_FOR_REHYDRATION__")
    if universal_data:
        metadata = _extract_from_universal_data(universal_data)
        if metadata:
            return metadata

    return None


async def fetch_tiktok_slideshow(
    url: str,
    *,
    max_images: int = MAX_SLIDESHOW_IMAGES,
    timeout: float = DEFAULT_TIMEOUT_SECONDS,
) -> TikTokSlideshowData | None:
    """Fetch TikTok slideshow images and return image bytes."""
    if not _is_tiktok_slideshow_url(url):
        logger.debug("tiktok_slideshow_invalid_url", extra={"url": url[:120]})
        return None

    try:
        start_time = time.monotonic()
        candidate_urls = _build_candidate_urls(url)
        async with httpx.AsyncClient(
            timeout=timeout,
            follow_redirects=True,
            max_redirects=3,
        ) as client:
            for candidate_url in candidate_urls:
                remaining = timeout - (time.monotonic() - start_time)
                if remaining <= 0:
                    logger.debug("tiktok_slideshow_timeout")
                    return None

                response = await client.get(
                    candidate_url,
                    headers={
                        "User-Agent": TIKTOK_BROWSER_UA,
                        "Accept": "text/html",
                        "Accept-Language": "en-US,en;q=0.9",
                        "Referer": "https://www.tiktok.com/",
                    },
                    timeout=remaining,
                )
                if response.status_code != 200:
                    logger.debug(
                        "tiktok_slideshow_fetch_failed",
                        extra={
                            "status_code": response.status_code,
                            "url": candidate_url[:120],
                        },
                    )
                    continue

                metadata = parse_tiktok_slideshow_html(response.text)
                if not metadata or not metadata.image_urls:
                    logger.debug(
                        "tiktok_slideshow_no_images",
                        extra={"url": candidate_url[:120]},
                    )
                    continue

                image_urls = metadata.image_urls[:max_images]
                images = await _download_images(client, image_urls)

                if not images:
                    logger.debug(
                        "tiktok_slideshow_download_empty",
                        extra={"url": candidate_url[:120]},
                    )
                    continue

                return TikTokSlideshowData(
                    caption=metadata.caption,
                    images=images,
                    image_urls=image_urls,
                    source=metadata.source,
                )
            logger.debug("tiktok_slideshow_no_images", extra={"url": url[:120]})
            return None
    except httpx.RequestError as e:
        logger.debug("tiktok_slideshow_fetch_error", extra={"error": str(e)[:120]})
        return None


def _is_tiktok_slideshow_url(url: str) -> bool:
    parsed = urlparse(url)
    if not parsed.netloc.endswith("tiktok.com"):
        return False
    return "/photo/" in parsed.path


def _build_candidate_urls(url: str) -> list[str]:
    parsed = urlparse(url)
    candidates: list[str] = [url]

    candidates.append(
        _with_query_params(parsed, {"is_copy_url": "1", "is_from_webapp": "v1"})
    )

    username = _extract_tiktok_username(parsed.path)
    item_id = extract_tiktok_video_id(url)
    if username and item_id:
        canonical_path = f"/@{username}/photo/{item_id}"
        canonical = parsed._replace(path=canonical_path, query="")
        candidates.append(urlunparse(canonical))
        candidates.append(
            _with_query_params(canonical, {"is_copy_url": "1", "is_from_webapp": "v1"})
        )

    if item_id:
        candidates.append(f"https://www.tiktok.com/embed/v2/{item_id}")
        candidates.append(f"https://www.tiktok.com/embed/v2/{item_id}?lang=en")

    return _dedupe(candidates)


def _with_query_params(parsed, params: dict[str, str]) -> str:
    query_params = dict(parse_qsl(parsed.query, keep_blank_values=True))
    query_params.update(params)
    return urlunparse(parsed._replace(query=urlencode(query_params)))


def _extract_tiktok_username(path: str) -> str | None:
    match = re.search(r"/@([^/]+)/", path)
    if not match:
        return None
    return match.group(1)


def _parse_json_script(html: str, script_id: str) -> dict | None:
    pattern = rf'<script[^>]*id=["\']{re.escape(script_id)}["\'][^>]*>(.*?)</script>'
    match = re.search(pattern, html, re.IGNORECASE | re.DOTALL)
    if not match:
        return None

    raw = match.group(1).strip()
    if not raw:
        return None

    raw = html_lib.unescape(raw)
    raw = _strip_js_assignment(raw)
    try:
        return json.loads(raw)
    except json.JSONDecodeError:
        logger.debug(
            "tiktok_slideshow_json_parse_failed", extra={"script_id": script_id}
        )
        return None


def _strip_js_assignment(raw: str) -> str:
    prefixes = [
        "window['SIGI_STATE'] =",
        "window['SIGI_STATE']=",
        "window.__NEXT_DATA__ =",
        "window.__NEXT_DATA__=",
        "window.__UNIVERSAL_DATA_FOR_REHYDRATION__ =",
        "window.__UNIVERSAL_DATA_FOR_REHYDRATION__=",
    ]
    for prefix in prefixes:
        if raw.startswith(prefix):
            raw = raw[len(prefix) :].strip()
            if raw.endswith(";"):
                raw = raw[:-1]
            break
    return raw


def _extract_from_sigi_state(data: dict) -> TikTokSlideshowMetadata | None:
    item_module = data.get("ItemModule")
    if not isinstance(item_module, dict):
        return None

    for item in item_module.values():
        if not isinstance(item, dict):
            continue
        image_urls = _extract_images(item)
        if image_urls:
            return TikTokSlideshowMetadata(
                caption=item.get("desc") or item.get("description"),
                image_urls=image_urls,
                source="sigi_state",
            )
    return None


def _extract_from_next_data(data: dict) -> TikTokSlideshowMetadata | None:
    item_struct = _dig(data, ["props", "pageProps", "itemInfo", "itemStruct"])
    if not isinstance(item_struct, dict):
        return None

    image_urls = _extract_images(item_struct)
    if not image_urls:
        return None

    return TikTokSlideshowMetadata(
        caption=item_struct.get("desc") or item_struct.get("description"),
        image_urls=image_urls,
        source="next_data",
    )


def _extract_from_universal_data(data: dict) -> TikTokSlideshowMetadata | None:
    scope = data.get("__DEFAULT_SCOPE__", data)
    item_struct = _dig(scope, ["webapp.video-detail", "itemInfo", "itemStruct"])
    if isinstance(item_struct, dict):
        image_urls = _extract_images(item_struct)
        if image_urls:
            return TikTokSlideshowMetadata(
                caption=item_struct.get("desc") or item_struct.get("description"),
                image_urls=image_urls,
                source="universal_data",
            )

    item_with_images = _search_for_image_post(scope)
    if not item_with_images:
        return None

    image_urls = _extract_images(item_with_images)
    if not image_urls:
        return None

    return TikTokSlideshowMetadata(
        caption=item_with_images.get("desc") or item_with_images.get("description"),
        image_urls=image_urls,
        source="universal_data",
    )


def _extract_images(item: dict) -> list[str]:
    image_post = item.get("imagePost")
    if not isinstance(image_post, dict):
        return []

    images = image_post.get("images") or []
    if not isinstance(images, list):
        return []

    urls: list[str] = []
    for image in images:
        if not isinstance(image, dict):
            continue
        url_list = _extract_url_list(image)
        best_url = _select_best_url(url_list)
        if best_url:
            urls.append(best_url)

    return _dedupe(urls)


def _extract_url_list(image: dict) -> list[str]:
    if isinstance(image.get("imageURL"), dict):
        url_list = image["imageURL"].get("urlList") or image["imageURL"].get("url_list")
    elif isinstance(image.get("imageURL"), list):
        url_list = image.get("imageURL")
    else:
        url_list = image.get("urlList") or image.get("url_list")

    if isinstance(url_list, list):
        return [url for url in url_list if isinstance(url, str)]
    if isinstance(url_list, str):
        return [url_list]
    return []


def _select_best_url(urls: list[str]) -> str | None:
    """Select best URL from list, preferring longer URLs.

    TikTok typically orders image URLs from lowest to highest quality,
    so when lengths are equal we prefer the last URL in the list.
    """
    if not urls:
        return None
    candidates = [url for url in urls if url.startswith("http")]
    if not candidates:
        return None
    # Use negative index as tiebreaker to prefer later URLs (higher quality)
    return max(enumerate(candidates), key=lambda x: (len(x[1]), x[0]))[1]


def _dedupe(urls: list[str]) -> list[str]:
    seen: set[str] = set()
    deduped: list[str] = []
    for url in urls:
        if url in seen:
            continue
        seen.add(url)
        deduped.append(url)
    return deduped


def _dig(data: dict, path: list[str]) -> object | None:
    current: object = data
    for key in path:
        if not isinstance(current, dict):
            return None
        current = current.get(key)
    return current


def _search_for_image_post(data: object) -> dict | None:
    stack: list[object] = [data]
    visited = 0
    while stack and visited < 2500:
        current = stack.pop()
        visited += 1
        if isinstance(current, dict):
            if "imagePost" in current and isinstance(current.get("imagePost"), dict):
                images = current["imagePost"].get("images")
                if isinstance(images, list) and images:
                    return current
            stack.extend(current.values())
        elif isinstance(current, list):
            stack.extend(current)
    return None


async def _download_images(
    client: httpx.AsyncClient,
    urls: list[str],
) -> list[bytes]:
    if not urls:
        return []

    semaphore = asyncio.Semaphore(MAX_CONCURRENT_DOWNLOADS)

    async def fetch_one(url: str) -> bytes | None:
        async with semaphore:
            try:
                response = await client.get(
                    url,
                    headers={
                        "User-Agent": TIKTOK_BROWSER_UA,
                        "Accept": "image/avif,image/webp,image/apng,image/*,*/*;q=0.8",
                        "Referer": "https://www.tiktok.com/",
                    },
                )
                if response.status_code != 200:
                    return None
                content_type = response.headers.get("Content-Type", "")
                if content_type and "image" not in content_type:
                    return None
                content = response.content
                if not content or len(content) > MAX_IMAGE_BYTES:
                    return None
                return content
            except httpx.RequestError:
                return None

    results = await asyncio.gather(*(fetch_one(url) for url in urls))
    return [result for result in results if result]
