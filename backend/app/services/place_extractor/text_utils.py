"""Text cleaning and processing utilities for place extraction.

This module provides utilities for cleaning social media text,
removing noise patterns, and preparing text for place name extraction.
"""

import concurrent.futures
import logging
import re
from collections.abc import Callable
from typing import TypeVar

logger = logging.getLogger(__name__)

# Input length limits to prevent ReDoS attacks
MAX_TEXT_LENGTH = 5000

# Regex operation timeout (seconds)
REGEX_TIMEOUT_SECONDS = 2.0

T = TypeVar("T")


def run_with_timeout(
    func: Callable[[], T], timeout: float = REGEX_TIMEOUT_SECONDS
) -> T:
    """Run a function with a timeout to prevent ReDoS attacks.

    Args:
        func: Function to execute
        timeout: Maximum execution time in seconds

    Returns:
        Function result

    Raises:
        TimeoutError: If function exceeds timeout
    """
    with concurrent.futures.ThreadPoolExecutor(max_workers=1) as executor:
        future = executor.submit(func)
        try:
            return future.result(timeout=timeout)
        except concurrent.futures.TimeoutError as err:
            logger.warning("regex_timeout: operation exceeded timeout")
            raise TimeoutError("Regex operation timed out") from err


# Words to filter out from potential place names
NOISE_WORDS = {
    "the",
    "a",
    "an",
    "this",
    "that",
    "my",
    "your",
    "best",
    "top",
    "amazing",
    "incredible",
    "beautiful",
    "stunning",
    "delicious",
    "yummy",
    "perfect",
    "must",
    "try",
    "check",
    "out",
    "link",
    "bio",
    "fyp",
    "viral",
    "trending",
    "follow",
    "like",
    "share",
    "comment",
    # Instagram-specific noise
    "instagram",
    "reels",
    "reel",
    "photo",
    "video",
    "see",
    "more",
    "likes",
    "comments",
    "saved",
    "posted",
    "shared",
}

# Patterns to clean from Instagram OpenGraph titles
INSTAGRAM_NOISE_PATTERNS = [
    r"^@[\w.]+\s+on\s+Instagram:\s*",  # "@username on Instagram: "
    r"\s+on\s+Instagram$",  # " on Instagram" suffix
    r"\s+\|\s+Instagram$",  # " | Instagram" suffix
    r"^Instagram\s+photo\s+by\s+@?[\w.]+\s*[:\-]?\s*",  # "Instagram photo by @user: "
    r"^\d+\s+Likes?,\s+\d+\s+Comments?\s*-\s*",  # "123 Likes, 45 Comments - "
    r"^[\w\s]+\s+on\s+Instagram\s+",  # "Username on Instagram ..."
]


def clean_instagram_title(title: str) -> str:
    """Clean Instagram-specific noise from OpenGraph titles.

    Instagram OG titles often contain patterns like:
    - "@username on Instagram: actual content"
    - "123 Likes, 45 Comments - @username on Instagram"
    - "Instagram photo by @username"
    - "Username on Instagram: content here"

    This function strips these patterns to extract the meaningful content.

    Args:
        title: Raw title from Instagram OpenGraph

    Returns:
        Cleaned title with Instagram-specific noise removed
    """
    if not title:
        return title

    cleaned = title

    for pattern in INSTAGRAM_NOISE_PATTERNS:
        cleaned = re.sub(pattern, "", cleaned, flags=re.IGNORECASE)

    # Also remove any remaining @mentions at the start
    cleaned = re.sub(r"^@[\w.]+\s*[:\-]?\s*", "", cleaned)

    # Remove "See more" type suffixes
    cleaned = re.sub(r"\.\.\.\s*see\s+more\s*$", "", cleaned, flags=re.IGNORECASE)

    # Remove trailing "on Instagram" variations
    cleaned = re.sub(r"\s+on\s+instagram\s*$", "", cleaned, flags=re.IGNORECASE)

    return cleaned.strip()


def clean_text_for_search(text: str) -> str:
    """Clean text for use in place search.

    Removes hashtags, mentions, emojis, and other noise.
    Truncates input to prevent ReDoS attacks and uses timeout for regex ops.

    Args:
        text: Raw text to clean

    Returns:
        Cleaned text suitable for search
    """
    # Truncate to prevent ReDoS attacks on regex operations
    if len(text) > MAX_TEXT_LENGTH:
        text = text[:MAX_TEXT_LENGTH]

    def _do_clean() -> str:
        cleaned = text

        # Remove hashtags and mentions
        cleaned = re.sub(r"[#@]\w+", " ", cleaned)

        # Remove URLs
        cleaned = re.sub(r"https?://\S+", " ", cleaned)

        # Remove emojis (basic pattern - character class is efficient)
        cleaned = re.sub(
            r"[\U0001F600-\U0001F64F\U0001F300-\U0001F5FF\U0001F680-\U0001F6FF\U0001F1E0-\U0001F1FF\U00002702-\U000027B0\U0001F900-\U0001F9FF]",
            " ",
            cleaned,
        )

        # Remove special characters except basic punctuation
        cleaned = re.sub(r"[^\w\s\'-]", " ", cleaned)

        # Collapse whitespace
        cleaned = re.sub(r"\s+", " ", cleaned).strip()

        return cleaned

    try:
        cleaned = run_with_timeout(_do_clean)
    except TimeoutError:
        # On timeout, return truncated original without regex processing
        logger.warning("clean_text_timeout: returning truncated original")
        cleaned = text[:200].strip()

    # Remove noise words from beginning
    words = cleaned.split()
    while words and words[0].lower() in NOISE_WORDS:
        words.pop(0)

    return " ".join(words)


def truncate_text(text: str | None, max_length: int = MAX_TEXT_LENGTH) -> str | None:
    """Safely truncate text to prevent ReDoS attacks.

    Args:
        text: Text to truncate
        max_length: Maximum allowed length

    Returns:
        Truncated text or None if input was None
    """
    if text is None:
        return None
    if len(text) > max_length:
        return text[:max_length]
    return text
