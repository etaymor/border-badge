"""Extraction orchestrator for multi-source place extraction.

Coordinates the cascading extraction pipeline:
1. Check cache first
2. Try caption extraction (LLM + regex fallback)
3. If caption fails or signals skip_to_video, try video frame extraction
4. Cache results for future requests

Key optimization: Starts video download speculatively with a 500ms delay while
caption runs, then cancels if caption succeeds. The delay reduces bandwidth waste
since ~70% of caption extractions complete in <500ms. Total timeout is 15s.
"""

import asyncio
import logging
import tempfile
import time
from dataclasses import dataclass
from pathlib import Path
from typing import Literal

from app.schemas.social_ingest import DetectedPlace, OEmbedResponse
from app.services.extraction_cache import (
    ExtractionSource,
    cache_extraction,
    get_cached_extraction,
)
from app.services.multimodal_extractor import (
    ExtractedPlace,
    MultimodalExtractor,
)
from app.services.place_extractor import (
    extract_location_hints,
    extract_place_with_method,
    try_candidate,
    try_llm_multi_place_extraction,
)
from app.services.tiktok_slideshow import (
    DEFAULT_TIMEOUT_SECONDS,
    fetch_tiktok_slideshow,
)
from app.services.video_extractor import (
    VideoDownloadError,
    download_video,
    extract_frames,
)
from app.services.video_extractor.frame_extractor import get_video_duration

logger = logging.getLogger(__name__)

# Type alias for extraction method
ExtractionMethod = Literal["llm", "regex", "video", "none"]


@dataclass
class ExtractionResult:
    """Result from extraction orchestrator."""

    places: list[DetectedPlace]
    method: ExtractionMethod
    source: ExtractionSource
    skip_to_video: bool
    context_location: str | None
    latency_ms: int
    from_cache: bool


class ExtractionOrchestrator:
    """Coordinates multi-source place extraction with caching and parallel ops."""

    def __init__(
        self,
        *,
        video_download_timeout: float = 12.0,
        total_timeout: float = 15.0,
        max_video_frames: int = 15,
        enable_video_fallback: bool = True,
    ):
        """Initialize the orchestrator.

        Args:
            video_download_timeout: Timeout for video download in seconds
            total_timeout: Total timeout for entire extraction in seconds
            max_video_frames: Maximum frames to extract from video
            enable_video_fallback: Whether to try video extraction on caption failure
        """
        self.video_download_timeout = video_download_timeout
        self.total_timeout = total_timeout
        self.max_video_frames = max_video_frames
        self.enable_video_fallback = enable_video_fallback
        self.multimodal_extractor = MultimodalExtractor()

    async def extract(
        self,
        canonical_url: str,
        oembed: OEmbedResponse | None,
        caption: str | None,
        *,
        use_cache: bool = True,
        is_video_url: bool = True,
        extraction_method: str = "auto",
        is_photo_slideshow: bool = False,
    ) -> ExtractionResult:
        """Extract places from social media content.

        Implements cascading extraction:
        1. Check cache
        2. Try caption extraction (while speculatively downloading video)
        3. If caption fails/skips, try video frame extraction
        4. Cache results

        Args:
            canonical_url: Canonical URL of the content
            oembed: oEmbed metadata (title, author, etc.)
            caption: User-provided caption text
            use_cache: Whether to use extraction cache
            is_video_url: Whether this is a video URL (enables speculative download)
            extraction_method: Extraction strategy - "auto" (default cascade),
                "llm" (LLM only), or "regex" (regex only)

        Returns:
            ExtractionResult with places and metadata
        """
        start_time = time.monotonic()

        # Extract text fields from oEmbed
        title = oembed.title if oembed else None
        author_handle = oembed.author_name if oembed else None

        # Step 1: Check cache
        if use_cache:
            cached = await get_cached_extraction(canonical_url)
            if cached:
                cached_method: ExtractionMethod
                if not cached.places:
                    cached_method = "none"
                else:
                    cached_method = "llm" if cached.source == "caption" else "video"
                return ExtractionResult(
                    places=cached.places,
                    method=cached_method,
                    source=cached.source,
                    skip_to_video=False,
                    context_location=None,
                    latency_ms=int((time.monotonic() - start_time) * 1000),
                    from_cache=True,
                )

        # Step 2: Start speculative video download (if enabled and is video URL)
        video_task: asyncio.Task | None = None
        temp_dir: Path | None = None

        if self.enable_video_fallback and is_video_url and not is_photo_slideshow:
            temp_dir = Path(tempfile.mkdtemp(prefix="extract_"))

            async def delayed_download():
                """Delay video download to avoid wasting bandwidth.

                Most caption extractions complete in <500ms, so delaying the
                speculative download reduces unnecessary bandwidth usage.
                """
                await asyncio.sleep(0.5)  # 500ms delay
                return await self._download_video_safe(canonical_url, temp_dir)

            video_task = asyncio.create_task(delayed_download())

        try:
            # Step 3: Try caption extraction (fast path)
            caption_result = await self._extract_from_caption(
                title, caption, author_handle, extraction_method
            )

            # Check for country mismatch between location hints and extracted place
            # This catches false positives like "ROMA IS ALWAYS a GOOD IDEA" (Italy)
            # when the caption mentions Tbilisi (Georgia)
            country_mismatch = self._has_country_mismatch(
                caption_result.places,
                caption_result.location_hint_country_codes,
            )

            if country_mismatch:
                logger.info(
                    "caption_country_mismatch_skip_to_video",
                    extra={
                        "place_country": caption_result.places[0].country_code
                        if caption_result.places
                        else None,
                        "hint_countries": caption_result.location_hint_country_codes,
                    },
                )

            # If caption succeeded, didn't signal skip_to_video, and country matches hints
            should_use_caption = (
                caption_result.places
                and not caption_result.skip_to_video
                and not country_mismatch
            )

            if should_use_caption:
                # Cancel speculative download
                if video_task:
                    video_task.cancel()
                    try:
                        await video_task
                    except asyncio.CancelledError:
                        pass

                # Cache the result
                if use_cache:
                    await self._cache_result(
                        canonical_url, caption_result.places, "caption"
                    )

                return ExtractionResult(
                    places=caption_result.places,
                    method=caption_result.method,
                    source="caption",
                    skip_to_video=False,
                    context_location=caption_result.context_location,
                    latency_ms=int((time.monotonic() - start_time) * 1000),
                    from_cache=False,
                )

            # Step 4: Caption failed, signaled skip_to_video, or country mismatch - try carousel for slideshows
            if is_photo_slideshow:
                carousel_result = await self._extract_from_carousel(
                    canonical_url, start_time
                )
                if carousel_result.places:
                    if use_cache:
                        await self._cache_result(
                            canonical_url, carousel_result.places, "carousel"
                        )

                    return ExtractionResult(
                        places=carousel_result.places,
                        method="video",
                        source="carousel",
                        skip_to_video=caption_result.skip_to_video,
                        context_location=caption_result.context_location,
                        latency_ms=int((time.monotonic() - start_time) * 1000),
                        from_cache=False,
                    )

            # Step 5: Caption failed or signaled skip_to_video - try video
            if video_task and self.enable_video_fallback:
                video_result = await self._extract_from_video(video_task, start_time)

                if video_result.places:
                    # Cache the video result
                    if use_cache:
                        await self._cache_result(
                            canonical_url, video_result.places, "video_frames"
                        )

                    return ExtractionResult(
                        places=video_result.places,
                        method="video",
                        source="video_frames",
                        skip_to_video=caption_result.skip_to_video,
                        context_location=caption_result.context_location,
                        latency_ms=int((time.monotonic() - start_time) * 1000),
                        from_cache=False,
                    )

            # Step 6: Both failed - cache negative result and return caption result
            if use_cache:
                if is_photo_slideshow:
                    negative_source: ExtractionSource = "carousel"
                else:
                    negative_source = (
                        "video_frames"
                        if video_task and self.enable_video_fallback
                        else "caption"
                    )
                await self._cache_result(canonical_url, [], negative_source)

            return ExtractionResult(
                places=caption_result.places,
                method=caption_result.method,
                source="caption",
                skip_to_video=caption_result.skip_to_video,
                context_location=caption_result.context_location,
                latency_ms=int((time.monotonic() - start_time) * 1000),
                from_cache=False,
            )

        finally:
            # Cancel and await video task before cleanup to avoid deleting files
            # while the download is still writing to them
            if video_task and not video_task.done():
                video_task.cancel()
                try:
                    await video_task
                except asyncio.CancelledError:
                    pass

            # Cleanup temp directory
            if temp_dir and temp_dir.exists():
                import shutil

                try:
                    shutil.rmtree(temp_dir)
                except Exception as e:
                    logger.debug(f"temp_cleanup_failed: {e}")

    async def extract_from_frames(
        self,
        canonical_url: str,
        oembed: OEmbedResponse | None,
        caption: str | None,
        frames: list[bytes],
        *,
        use_cache: bool = True,
    ) -> ExtractionResult:
        """Extract places from client-provided video frames."""
        start_time = time.monotonic()

        if use_cache:
            cached = await get_cached_extraction(canonical_url)
            if cached:
                cached_method: ExtractionMethod
                if not cached.places:
                    cached_method = "none"
                else:
                    cached_method = "llm" if cached.source == "caption" else "video"
                return ExtractionResult(
                    places=cached.places,
                    method=cached_method,
                    source=cached.source,
                    skip_to_video=False,
                    context_location=None,
                    latency_ms=int((time.monotonic() - start_time) * 1000),
                    from_cache=True,
                )

        if not frames:
            return ExtractionResult(
                places=[],
                method="none",
                source="video_frames",
                skip_to_video=False,
                context_location=None,
                latency_ms=int((time.monotonic() - start_time) * 1000),
                from_cache=False,
            )

        title = oembed.title if oembed else None
        author_handle = oembed.author_name if oembed else None
        combined_text = " ".join(filter(None, [title, caption, author_handle]))
        hints = extract_location_hints(combined_text)
        context_location = hints[0].name if hints else None

        # Calculate remaining time for extraction (same timeout semantics as _extract_from_carousel)
        remaining = self._get_remaining_time(start_time)
        if remaining <= 0:
            logger.debug("extract_from_frames_skipped: no_time_remaining")
            return ExtractionResult(
                places=[],
                method="none",
                source="video_frames",
                skip_to_video=False,
                context_location=context_location,
                latency_ms=int((time.monotonic() - start_time) * 1000),
                from_cache=False,
            )

        try:
            multimodal_result = await asyncio.wait_for(
                self.multimodal_extractor.extract_places(frames, source="video_frames"),
                timeout=remaining,
            )
        except TimeoutError:
            logger.debug("extract_from_frames_skipped: multimodal_timeout")
            return ExtractionResult(
                places=[],
                method="none",
                source="video_frames",
                skip_to_video=False,
                context_location=context_location,
                latency_ms=int((time.monotonic() - start_time) * 1000),
                from_cache=False,
            )

        places = await self._resolve_multimodal_places(
            multimodal_result.places, start_time
        )
        method: ExtractionMethod = "video" if places else "none"

        if use_cache:
            await self._cache_result(canonical_url, places, "video_frames")

        return ExtractionResult(
            places=places,
            method=method,
            source="video_frames",
            skip_to_video=False,
            context_location=context_location,
            latency_ms=int((time.monotonic() - start_time) * 1000),
            from_cache=False,
        )

    async def _download_video_safe(self, url: str, output_dir: Path) -> Path | None:
        """Download video with error handling.

        Returns None on failure instead of raising.
        """
        try:
            return await download_video(
                url,
                timeout=self.video_download_timeout,
                output_dir=output_dir,
            )
        except VideoDownloadError as e:
            logger.debug(f"video_download_failed: {e}")
            return None
        except TimeoutError:
            logger.debug("video_download_timeout")
            return None
        except Exception as e:
            logger.warning(f"video_download_unexpected_error: {e}")
            return None

    @dataclass
    class _CaptionResult:
        """Internal result from caption extraction."""

        places: list[DetectedPlace]
        method: ExtractionMethod
        skip_to_video: bool
        context_location: str | None
        location_hint_country_codes: list[str]  # Country codes from location hints

    async def _extract_from_caption(
        self,
        title: str | None,
        caption: str | None,
        author_handle: str | None,
        extraction_method: str = "auto",
    ) -> _CaptionResult:
        """Extract places from caption text using LLM and/or regex.

        Args:
            title: oEmbed title
            caption: User-provided caption text
            author_handle: Author handle from oEmbed
            extraction_method: Extraction strategy - "auto" (LLM first, regex fallback),
                "llm" (LLM only), or "regex" (regex only)

        Returns:
            _CaptionResult with places and metadata
        """
        context_location: str | None = None

        # Extract location hints early for country mismatch detection
        combined_text = " ".join(filter(None, [title, caption]))
        location_hints = extract_location_hints(combined_text)
        hint_country_codes = list(
            {h.country_code for h in location_hints if h.country_code}
        )

        # Try LLM extraction (unless regex-only mode)
        if extraction_method in ("auto", "llm"):
            multi_result = await try_llm_multi_place_extraction(
                title,
                caption,
                author_handle,
                try_candidate_fn=try_candidate,
                extract_location_hints_fn=extract_location_hints,
            )
            context_location = multi_result.context_location

            if multi_result.places:
                return self._CaptionResult(
                    places=multi_result.places,
                    method="llm",
                    skip_to_video=multi_result.skip_to_video,
                    context_location=context_location,
                    location_hint_country_codes=hint_country_codes,
                )

            if multi_result.skip_to_video:
                # LLM signaled to skip to video extraction
                return self._CaptionResult(
                    places=[],
                    method="none",
                    skip_to_video=True,
                    context_location=context_location,
                    location_hint_country_codes=hint_country_codes,
                )

            # If LLM-only mode, don't fall back to regex
            if extraction_method == "llm":
                return self._CaptionResult(
                    places=[],
                    method="none",
                    skip_to_video=False,
                    context_location=context_location,
                    location_hint_country_codes=hint_country_codes,
                )

        # Try regex extraction (for "auto" fallback or "regex" mode)
        # Create a minimal OEmbedResponse for the regex extractor
        oembed_like = OEmbedResponse(title=title, author_name=author_handle)
        extraction_result = await extract_place_with_method(
            oembed_like,
            caption,
            "regex",  # Force regex since we're in the fallback path
        )

        if extraction_result.place:
            return self._CaptionResult(
                places=[extraction_result.place],
                method="regex",
                skip_to_video=False,
                context_location=context_location,
                location_hint_country_codes=hint_country_codes,
            )

        return self._CaptionResult(
            places=[],
            method="none",
            skip_to_video=False,
            context_location=context_location,
            location_hint_country_codes=hint_country_codes,
        )

    @dataclass
    class _VideoResult:
        """Internal result from video extraction."""

        places: list[DetectedPlace]

    @dataclass
    class _CarouselResult:
        """Internal result from carousel extraction."""

        places: list[DetectedPlace]
        frames_processed: int

    def _has_country_mismatch(
        self,
        places: list[DetectedPlace],
        hint_country_codes: list[str],
    ) -> bool:
        """Check if extracted places don't match the location hint countries.

        This detects false positive matches where the extracted place is in a
        completely different country than what was mentioned in the caption.
        For example: caption mentions "Tbilisi" (Georgia) but regex matched
        "ROMA IS ALWAYS a GOOD IDEA" (Italy).

        Args:
            places: Extracted places from caption
            hint_country_codes: Country codes from location hints

        Returns:
            True if there's a mismatch that warrants video fallback
        """
        # No mismatch if we have no places or no hints to compare against
        if not places or not hint_country_codes:
            return False

        # Check if any place matches any hint country
        for place in places:
            if place.country_code and place.country_code in hint_country_codes:
                return False  # Found a match, no mismatch

        # All places are in countries not mentioned in hints - this is suspicious
        return True

    def _get_remaining_time(self, start_time: float, buffer: float = 1.0) -> float:
        """Calculate remaining time budget from start_time."""
        elapsed = time.monotonic() - start_time
        return max(0, self.total_timeout - elapsed - buffer)

    async def _cancel_video_task(self, video_task: asyncio.Task) -> None:
        """Cancel and await a video task to avoid orphaned tasks."""
        video_task.cancel()
        try:
            await video_task
        except asyncio.CancelledError:
            pass

    async def _extract_from_video(
        self,
        video_task: asyncio.Task,
        start_time: float,
    ) -> _VideoResult:
        """Extract places from video frames."""
        # Calculate remaining time budget
        remaining = self._get_remaining_time(start_time)

        if remaining <= 0:
            logger.debug("video_extraction_skipped: no_time_remaining")
            await self._cancel_video_task(video_task)
            return self._VideoResult(places=[])

        try:
            # Wait for video download to complete (may already be done)
            video_path = await asyncio.wait_for(video_task, timeout=remaining)

            if not video_path:
                return self._VideoResult(places=[])

            # Recalculate remaining time after video download
            remaining = self._get_remaining_time(start_time)
            if remaining <= 0:
                logger.debug("video_extraction_skipped: no_time_after_download")
                return self._VideoResult(places=[])

            # Determine dynamic frame count (1 frame every 2s, cap for short videos)
            duration = await get_video_duration(
                video_path, timeout=min(5.0, max(0.5, remaining))
            )
            max_frames = self._calculate_max_frames(duration)

            # Recalculate remaining time before frame extraction
            remaining = self._get_remaining_time(start_time)
            if remaining <= 0:
                logger.debug("video_extraction_skipped: no_time_for_frames")
                return self._VideoResult(places=[])

            # Extract frames
            frames = await extract_frames(
                video_path,
                max_frames=max_frames,
                timeout=remaining,
            )

            if not frames:
                logger.debug("video_extraction_no_frames")
                return self._VideoResult(places=[])

            # Recalculate remaining time before multimodal extraction
            remaining = self._get_remaining_time(start_time)
            if remaining <= 0:
                logger.debug("video_extraction_skipped: no_time_for_multimodal")
                return self._VideoResult(places=[])

            # Extract places from frames using multimodal LLM
            multimodal_result = await self.multimodal_extractor.extract_places(
                frames, source="video_frames"
            )

            if not multimodal_result.places:
                return self._VideoResult(places=[])

            # Convert ExtractedPlace to DetectedPlace
            # Note: These need Google Places resolution for full data
            places = await self._resolve_multimodal_places(
                multimodal_result.places, start_time
            )

            logger.info(
                "video_extraction_success",
                extra={
                    "frames_processed": multimodal_result.frames_processed,
                    "places_found": len(places),
                },
            )

            return self._VideoResult(places=places)

        except TimeoutError:
            logger.debug("video_extraction_timeout")
            await self._cancel_video_task(video_task)
            return self._VideoResult(places=[])
        except asyncio.CancelledError:
            return self._VideoResult(places=[])
        except Exception as e:
            logger.warning(f"video_extraction_error: {e}")
            return self._VideoResult(places=[])

    async def _extract_from_carousel(
        self,
        canonical_url: str,
        start_time: float,
    ) -> _CarouselResult:
        """Extract places from TikTok photo slideshow images."""
        remaining = self._get_remaining_time(start_time)
        if remaining <= 0:
            logger.debug("carousel_extraction_skipped: no_time_remaining")
            return self._CarouselResult(places=[], frames_processed=0)

        try:
            slideshow = await fetch_tiktok_slideshow(
                canonical_url,
                max_images=self.max_video_frames,
                timeout=min(DEFAULT_TIMEOUT_SECONDS, max(2.0, remaining)),
            )
        except Exception as e:
            logger.warning(f"carousel_extraction_error: {e}")
            return self._CarouselResult(places=[], frames_processed=0)

        if not slideshow or not slideshow.images:
            logger.debug("carousel_extraction_no_images")
            return self._CarouselResult(places=[], frames_processed=0)

        remaining = self._get_remaining_time(start_time)
        if remaining <= 0:
            logger.debug("carousel_extraction_skipped: no_time_for_multimodal")
            return self._CarouselResult(places=[], frames_processed=0)

        try:
            multimodal_result = await asyncio.wait_for(
                self.multimodal_extractor.extract_places(
                    slideshow.images, source="carousel"
                ),
                timeout=remaining,
            )
        except TimeoutError:
            logger.debug("carousel_extraction_skipped: multimodal_timeout")
            return self._CarouselResult(places=[], frames_processed=0)

        if not multimodal_result.places:
            return self._CarouselResult(
                places=[],
                frames_processed=multimodal_result.frames_processed,
            )

        places = await self._resolve_multimodal_places(
            multimodal_result.places, start_time
        )

        logger.info(
            "carousel_extraction_success",
            extra={
                "frames_processed": multimodal_result.frames_processed,
                "places_found": len(places),
            },
        )

        return self._CarouselResult(
            places=places,
            frames_processed=multimodal_result.frames_processed,
        )

    def _calculate_max_frames(self, duration_seconds: float | None) -> int:
        """Calculate max frames based on duration (1 frame every 2s)."""
        if not duration_seconds or duration_seconds <= 0:
            return self.max_video_frames

        max_frames = max(1, int(duration_seconds / 2))

        # Short-video heuristic to avoid oversampling
        if duration_seconds <= 12:
            max_frames = min(max_frames, 6)

        return min(self.max_video_frames, max_frames)

    async def _resolve_multimodal_places(
        self,
        extracted: list[ExtractedPlace],
        start_time: float,
    ) -> list[DetectedPlace]:
        """Resolve multimodal-extracted places via Google Places API.

        Similar to LLM extraction, we need to resolve place names to full
        DetectedPlace objects with Google Place IDs.

        Args:
            extracted: List of places extracted by multimodal LLM
            start_time: Monotonic time when extraction started (for time-budget)

        Returns:
            List of resolved DetectedPlace objects
        """
        if not extracted:
            return []

        # Check remaining time budget before starting resolution
        remaining = self._get_remaining_time(start_time)
        if remaining <= 0:
            logger.debug("resolve_multimodal_places_skipped: no_time_remaining")
            return []

        # Per-call timeout: divide remaining time among places, with min/max bounds
        per_call_max = 3.0  # Max 3s per Google Places call
        per_call_timeout = min(
            per_call_max, max(0.5, remaining / max(1, len(extracted[:10])))
        )

        # Resolve all places in parallel with semaphore (max 5 concurrent)
        semaphore = asyncio.Semaphore(5)

        async def resolve_one(place: ExtractedPlace) -> DetectedPlace | None:
            # Check if time budget is exhausted before starting
            current_remaining = self._get_remaining_time(start_time)
            if current_remaining <= 0:
                return None

            async with semaphore:
                # Build search query with location context
                search_query = place.name
                if place.city or place.country:
                    location_parts = [p for p in [place.city, place.country] if p]
                    search_query = f"{place.name}, {', '.join(location_parts)}"

                # Get location bias from city/country
                location_bias = None
                if place.city:
                    bias_text = (
                        f"{place.city}, {place.country}"
                        if place.country
                        else place.city
                    )
                    hints = extract_location_hints(bias_text)
                    if hints:
                        location_bias = hints[0]

                try:
                    detected = await asyncio.wait_for(
                        try_candidate(search_query, location_bias),
                        timeout=min(
                            per_call_timeout, self._get_remaining_time(start_time)
                        ),
                    )
                    if detected:
                        detected.llm_entry_type = place.entry_type
                    return detected
                except TimeoutError:
                    logger.debug(
                        "resolve_multimodal_place_timeout",
                        extra={"place": place.name},
                    )
                    return None

        tasks = [resolve_one(place) for place in extracted[:10]]  # Max 10 places
        results = await asyncio.gather(*tasks, return_exceptions=True)

        # Filter successful results (isinstance check already excludes None and exceptions)
        return [r for r in results if isinstance(r, DetectedPlace)]

    async def _cache_result(
        self,
        canonical_url: str,
        places: list[DetectedPlace],
        source: ExtractionSource,
    ) -> None:
        """Cache extraction result, handling errors gracefully."""
        try:
            await cache_extraction(canonical_url, places, source)
        except Exception as e:
            # Log but don't fail - caching is best-effort
            logger.warning(f"extraction_cache_error: {e}")
