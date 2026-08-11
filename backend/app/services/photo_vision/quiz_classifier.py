"""Quiz eligibility classifier for the travel photo quiz (U2).

Additive sibling of ``classifier.py``: it reuses the same OpenRouter model,
call shape, per-request concurrency semaphore, timeout, and 768px-thumbnail
convention, but with a quiz-specific prompt and strict JSON schema (KTD3).
The shared photo-import prompt/classifier is intentionally untouched.

Failure semantics (fail-closed, R2):
- Model responded but the content cannot be parsed into a usable verdict
  => that image is INELIGIBLE (never eligible-by-default).
- Transport-level failure (timeout, network error, non-200, missing API key)
  => raised as :class:`QuizClassificationUnavailable`, surfaced to the client
  as a retryable "error" outcome, distinct from a definitive "ineligible".
"""

import asyncio
import json
import logging
from dataclasses import dataclass

import httpx

from app.core.config import get_settings
from app.core.http_client import get_http_client
from app.core.llm_utils import OPENROUTER_API_URL, extract_content

from .classifier import MAX_CONCURRENT_VISION_REQUESTS
from .quiz_constants import (
    QUIZ_CATEGORY_VALUES,
    QUIZ_ELIGIBILITY_RESPONSE_FORMAT,
    QUIZ_ELIGIBILITY_SYSTEM_PROMPT,
    QUIZ_ELIGIBILITY_USER_PROMPT,
    QUIZ_ELIGIBLE_CATEGORIES,
    QUIZ_SETTING_VALUES,
)

logger = logging.getLogger(__name__)


class QuizClassificationUnavailable(Exception):
    """Transport-level classification failure: retryable, NOT 'ineligible'."""


@dataclass
class QuizVisionResult:
    """Parsed quiz-eligibility verdict for one image."""

    has_people: bool
    setting: str  # outdoor | indoor | unclear
    category: str  # scenery | landmark | building_exterior | other

    @property
    def eligible(self) -> bool:
        """R2: no people AND outdoor AND an allowed category."""
        return (
            not self.has_people
            and self.setting == "outdoor"
            and self.category in QUIZ_ELIGIBLE_CATEGORIES
        )


@dataclass
class QuizImageOutcome:
    """Per-image classification outcome.

    ``result is None`` with ``retryable=False`` is the fail-closed path
    (unparseable model output => ineligible). ``retryable=True`` marks a
    transport failure the client may retry.
    """

    result: QuizVisionResult | None
    retryable: bool = False


class QuizEligibilityClassifier:
    """Classify one image for quiz eligibility via OpenRouter.

    Mirrors :class:`PhotoClassifier`'s call path (same model, headers, and
    ~$0.00008/photo cost at 768px) with the quiz prompt and strict schema.
    """

    def __init__(self, timeout: float = 5.0) -> None:
        self._timeout = timeout
        self._settings = get_settings()

    async def classify(self, image_base64: str) -> QuizVisionResult | None:
        """Classify a photo for quiz eligibility.

        Args:
            image_base64: Base64-encoded JPEG image (768px max dimension).

        Returns:
            QuizVisionResult when the model produced a parseable verdict, or
            None when the model responded but the content was unusable
            (fail-closed: caller must treat as ineligible).

        Raises:
            QuizClassificationUnavailable: on timeout, network error, missing
                API key, or a non-200 API response (retryable).
        """
        if not self._settings.openrouter_api_key:
            raise QuizClassificationUnavailable("OpenRouter API key not configured")

        try:
            client = get_http_client()
            response = await client.post(
                OPENROUTER_API_URL,
                json={
                    "model": self._settings.multimodal_model,
                    "messages": [
                        {
                            "role": "system",
                            "content": QUIZ_ELIGIBILITY_SYSTEM_PROMPT,
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
                                    "text": QUIZ_ELIGIBILITY_USER_PROMPT,
                                },
                            ],
                        },
                    ],
                    "temperature": 0.1,
                    "max_tokens": 100,
                    "response_format": QUIZ_ELIGIBILITY_RESPONSE_FORMAT,
                },
                headers={
                    "Authorization": f"Bearer {self._settings.openrouter_api_key}",
                    "Content-Type": "application/json",
                    "HTTP-Referer": self._settings.base_url,
                    "X-Title": "Border Badge",
                },
                timeout=self._timeout,
            )
        except httpx.TimeoutException as e:
            logger.debug("Quiz eligibility classification timed out")
            raise QuizClassificationUnavailable("vision API timeout") from e
        except httpx.RequestError as e:
            logger.warning(f"Quiz eligibility network error: {e}")
            raise QuizClassificationUnavailable("vision API network error") from e

        if response.status_code != 200:
            if response.status_code in (401, 403):
                logger.error(
                    f"Quiz vision API auth error: status={response.status_code} "
                    f"— check OPENROUTER_API_KEY"
                )
            else:
                logger.warning(f"Quiz vision API error: status={response.status_code}")
            raise QuizClassificationUnavailable(
                f"vision API status {response.status_code}"
            )

        try:
            data = response.json()
        except (json.JSONDecodeError, ValueError) as e:
            raise QuizClassificationUnavailable("vision API returned non-JSON") from e

        content = extract_content(data)
        if not content:
            # The API succeeded but produced no verdict: fail-closed.
            return None

        return self._parse_response(content)

    @staticmethod
    def _parse_response(content: str) -> QuizVisionResult | None:
        """Parse the strict-JSON eligibility verdict; None = fail-closed.

        ``has_people`` is the safety-critical field, so a missing or non-bool
        value voids the whole verdict. ``setting``/``category`` degrade to
        their most conservative values ("unclear"/"other"), both of which are
        ineligible.
        """
        try:
            data = json.loads(content)
        except json.JSONDecodeError:
            logger.warning("Quiz eligibility response is not valid JSON")
            return None

        if not isinstance(data, dict):
            return None

        has_people = data.get("has_people")
        if not isinstance(has_people, bool):
            return None

        setting = data.get("setting")
        if setting not in QUIZ_SETTING_VALUES:
            setting = "unclear"

        category = data.get("category")
        if category not in QUIZ_CATEGORY_VALUES:
            category = "other"

        return QuizVisionResult(
            has_people=has_people,
            setting=setting,
            category=category,
        )


async def classify_quiz_images(images: list[str]) -> list[QuizImageOutcome]:
    """Classify a batch of images for quiz eligibility, one outcome per image.

    Concurrency is bounded by the same semaphore size as the photo-import
    classifier. The returned list is positionally aligned with ``images``;
    unexpected exceptions fail closed (ineligible) rather than eligible.
    """
    classifier = QuizEligibilityClassifier(timeout=5.0)
    semaphore = asyncio.Semaphore(MAX_CONCURRENT_VISION_REQUESTS)

    async def classify_one(image_base64: str) -> QuizImageOutcome:
        async with semaphore:
            try:
                return QuizImageOutcome(result=await classifier.classify(image_base64))
            except QuizClassificationUnavailable as e:
                logger.warning(f"Quiz eligibility classification unavailable: {e}")
                return QuizImageOutcome(result=None, retryable=True)

    raw_results = await asyncio.gather(
        *[classify_one(img) for img in images],
        return_exceptions=True,
    )

    outcomes: list[QuizImageOutcome] = []
    for item in raw_results:
        if isinstance(item, QuizImageOutcome):
            outcomes.append(item)
        else:
            logger.error(f"Quiz eligibility classification exception: {item}")
            outcomes.append(QuizImageOutcome(result=None, retryable=False))
    return outcomes
