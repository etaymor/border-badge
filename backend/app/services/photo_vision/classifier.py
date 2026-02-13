"""Photo vision classifier using Gemini Flash Lite via OpenRouter."""

import asyncio
import json
import logging
from dataclasses import dataclass, field

import httpx

from app.core.config import get_settings
from app.core.http_client import get_http_client
from app.core.llm_utils import OPENROUTER_API_URL, extract_content

from .constants import (
    CLASSIFICATION_RESPONSE_FORMAT,
    CLASSIFICATION_SYSTEM_PROMPT,
    CLASSIFICATION_USER_PROMPT,
    GENERIC_TEXT_WORDS,
    VISION_CATEGORIES,
    VISION_CONFIDENCE_LEVELS,
)

logger = logging.getLogger(__name__)


@dataclass
class VisionResult:
    """Result from vision classification."""

    category: (
        str  # food, landmark, stay, shopping, nature, nightlife, transport, unknown
    )
    detected_text: list[str] = field(default_factory=list)
    confidence: str = "low"  # high, medium, low

    @property
    def has_business_name(self) -> bool:
        """Check if detected text contains potential business names.

        Filters out generic words (EXIT, OPEN, WELCOME) and requires
        2+ word phrases that could be business names.
        """
        for text in self.detected_text:
            words = text.strip().split()
            if len(words) < 2:
                continue
            lower = text.lower().strip()
            if lower in GENERIC_TEXT_WORDS:
                continue
            # Not a single generic word
            if not any(w.lower() in GENERIC_TEXT_WORDS for w in words):
                return True
        return False

    @property
    def business_name_candidates(self) -> list[str]:
        """Get non-generic text strings suitable for text search."""
        candidates = []
        for text in self.detected_text:
            words = text.strip().split()
            if len(words) < 2:
                continue
            lower = text.lower().strip()
            if lower in GENERIC_TEXT_WORDS:
                continue
            if not any(w.lower() in GENERIC_TEXT_WORDS for w in words):
                candidates.append(text.strip())
        return candidates


class PhotoClassifier:
    """Classify photos using Gemini Flash Lite via OpenRouter.

    Sends 1 representative photo per cluster for vision analysis.
    Returns category, detected text, and confidence level.

    Cost: ~$0.00008 per photo at 768px (well within $0.25 budget).
    """

    def __init__(self, timeout: float = 5.0) -> None:
        self._timeout = timeout
        self._settings = get_settings()

    async def classify(self, image_base64: str) -> VisionResult | None:
        """Classify a photo using vision AI.

        Args:
            image_base64: Base64-encoded JPEG image (768px max dimension)

        Returns:
            VisionResult if successful, None on failure (silent fallback)
        """
        if not self._settings.openrouter_api_key:
            logger.debug("Vision classification skipped: no OpenRouter API key")
            return None

        try:
            client = get_http_client()
            response = await client.post(
                OPENROUTER_API_URL,
                json={
                    "model": self._settings.multimodal_model,
                    "messages": [
                        {
                            "role": "system",
                            "content": CLASSIFICATION_SYSTEM_PROMPT,
                        },
                        {
                            "role": "user",
                            "content": [
                                {
                                    "type": "image_url",
                                    "image_url": {
                                        "url": f"data:image/jpeg;base64,{image_base64}",
                                    },
                                },
                                {
                                    "type": "text",
                                    "text": CLASSIFICATION_USER_PROMPT,
                                },
                            ],
                        },
                    ],
                    "temperature": 0.1,
                    "max_tokens": 300,
                    "response_format": CLASSIFICATION_RESPONSE_FORMAT,
                },
                headers={
                    "Authorization": f"Bearer {self._settings.openrouter_api_key}",
                    "Content-Type": "application/json",
                    "HTTP-Referer": self._settings.base_url,
                    "X-Title": "Border Badge",
                },
                timeout=self._timeout,
            )

            if response.status_code != 200:
                if response.status_code in (401, 403):
                    logger.error(
                        f"Vision API auth error: status={response.status_code} "
                        f"— check OPENROUTER_API_KEY"
                    )
                else:
                    logger.debug(f"Vision API error: status={response.status_code}")
                return None

            data = response.json()
            content = extract_content(data)
            if not content:
                return None

            return self._parse_response(content)

        except httpx.TimeoutException:
            logger.debug("Vision classification timed out")
            return None
        except (httpx.RequestError, json.JSONDecodeError, KeyError) as e:
            logger.warning(f"Vision classification error: {e}")
            return None

    @staticmethod
    def _parse_response(content: str) -> VisionResult | None:
        """Parse structured JSON response from vision model."""
        try:
            data = json.loads(content)
        except json.JSONDecodeError:
            logger.warning("Vision response is not valid JSON")
            return None

        if not isinstance(data, dict):
            return None

        category = data.get("category", "unknown")
        if category not in VISION_CATEGORIES:
            category = "unknown"

        confidence = data.get("confidence", "low")
        if confidence not in VISION_CONFIDENCE_LEVELS:
            confidence = "low"

        detected_text = data.get("detected_text", [])
        if not isinstance(detected_text, list):
            detected_text = []
        # Ensure all items are strings
        detected_text = [str(t) for t in detected_text if t]

        return VisionResult(
            category=category,
            detected_text=detected_text,
            confidence=confidence,
        )

    @staticmethod
    def aggregate_results(results: list[VisionResult | None]) -> VisionResult | None:
        """Aggregate per-photo classifications into a single cluster-level result."""
        valid_results = [r for r in results if r is not None]
        if not valid_results:
            return None

        confidence_weights = {"high": 3.0, "medium": 2.0, "low": 1.0}
        category_scores: dict[str, float] = {}

        for result in valid_results:
            score = confidence_weights.get(result.confidence, 1.0)
            category_scores[result.category] = (
                category_scores.get(result.category, 0.0) + score
            )

        # Stable tie-breaker by first seen order.
        first_seen: dict[str, int] = {}
        for idx, result in enumerate(valid_results):
            if result.category not in first_seen:
                first_seen[result.category] = idx

        best_category = sorted(
            category_scores.items(),
            key=lambda x: (-x[1], first_seen.get(x[0], 0)),
        )[0][0]

        sorted_scores = sorted(category_scores.values(), reverse=True)
        top_score = sorted_scores[0]
        second_score = sorted_scores[1] if len(sorted_scores) > 1 else 0.0
        margin = top_score - second_score

        if top_score >= 5.0 and margin >= 2.0:
            aggregate_confidence = "high"
        elif top_score >= 2.0 and margin >= 0.5:
            aggregate_confidence = "medium"
        else:
            aggregate_confidence = "low"

        seen_text: set[str] = set()
        detected_text: list[str] = []
        for result in valid_results:
            for text in result.detected_text:
                normalized = text.strip()
                if not normalized:
                    continue
                key = normalized.lower()
                if key in seen_text:
                    continue
                seen_text.add(key)
                detected_text.append(normalized)

        return VisionResult(
            category=best_category,
            detected_text=detected_text,
            confidence=aggregate_confidence,
        )


MAX_CONCURRENT_VISION_REQUESTS = 5


async def classify_cluster_photos(
    clusters: list[dict],
) -> dict[str, VisionResult]:
    """Run vision classification for clusters with vision image payloads.

    Returns a dict mapping cluster_id -> VisionResult.
    Failures are silently ignored (returns empty dict for failed clusters).
    """
    classifier = PhotoClassifier(timeout=5.0)
    vision_clusters = [c for c in clusters if c.get("vision_images_base64")]

    if not vision_clusters:
        return {}

    semaphore = asyncio.Semaphore(MAX_CONCURRENT_VISION_REQUESTS)

    async def classify_one(cluster: dict) -> tuple[str, VisionResult | None]:
        images: list[str] = list(cluster["vision_images_base64"][:3])

        if not images:
            return cluster["id"], None

        async def classify_with_limit(image_base64: str) -> VisionResult | None:
            async with semaphore:
                return await classifier.classify(image_base64)

        single_results = await asyncio.gather(
            *[classify_with_limit(image_base64) for image_base64 in images],
            return_exceptions=True,
        )

        parsed_results: list[VisionResult | None] = []
        for item in single_results:
            if isinstance(item, VisionResult):
                parsed_results.append(item)
            else:
                parsed_results.append(None)

        return cluster["id"], PhotoClassifier.aggregate_results(parsed_results)

    results = await asyncio.gather(
        *[classify_one(c) for c in vision_clusters],
        return_exceptions=True,
    )

    vision_map: dict[str, VisionResult] = {}
    for r in results:
        if isinstance(r, tuple) and r[1] is not None:
            vision_map[r[0]] = r[1]

    if vision_map:
        logger.info(
            f"Vision classification: {len(vision_map)}/{len(vision_clusters)} "
            f"clusters classified successfully"
        )

    return vision_map
