"""Shared LLM utilities for JSON parsing and API constants."""

import re

# OpenRouter API endpoint
OPENROUTER_API_URL = "https://openrouter.ai/api/v1/chat/completions"

# Token budget for the vision classifier call sites.
#
# The verdicts themselves are tiny (~37 completion tokens on the current
# Flash Lite model), so this ceiling is not about the answer -- it is headroom
# that keeps MULTIMODAL_MODEL safe to repoint at a *reasoning* model by env
# var alone, with no code change.
#
# Why that matters: Gemini 3.x Flash reasons on every request and refuses to
# have it disabled -- `reasoning: {enabled: false}`, `reasoning: {max_tokens:
# 0}`, and `reasoning_effort: "none"` all return HTTP 400 "Reasoning is
# mandatory for this endpoint and cannot be disabled." It spends ~85-155
# tokens reasoning before emitting any content, drawn from `max_tokens`.
#
# An undersized budget then fails silently rather than loudly: the response
# comes back 200 with finish_reason="length" and a truncated preamble ("Here
# is the JSON"), which every parser here treats as unusable. For the
# fail-closed quiz gate that reads as "ineligible", so a too-small budget
# would quietly mark *every* photo ineligible instead of erroring.
#
# Callers pay only for tokens actually generated, so the ceiling is free on
# the non-reasoning models we actually run.
VISION_MAX_TOKENS: int = 1024

# Patterns for parsing LLM JSON responses
CODE_FENCE_PATTERN = re.compile(r"^```(?:\w+)?\s*\n?(.*?)\n?```\s*$", re.DOTALL)
TRAILING_COMMA_PATTERN = re.compile(r",\s*([}\]])")


def extract_content(data: dict) -> str:
    """Safely extract message content from an OpenRouter chat completion response.

    Handles missing or empty ``choices`` arrays without raising ``IndexError``.

    Args:
        data: Parsed JSON response from the OpenRouter API.

    Returns:
        The assistant message content string, or ``""`` when unavailable.
    """
    choices = data.get("choices", [])
    if not choices:
        return ""
    return choices[0].get("message", {}).get("content", "")


def strip_code_fence(content: str) -> str:
    """Remove markdown code fence from LLM output.

    Handles code fences like ```json, ```javascript, or plain ```.

    Args:
        content: Raw LLM response content

    Returns:
        Content with code fence stripped, or original content if no fence found
    """
    content = content.strip()
    match = CODE_FENCE_PATTERN.match(content)
    return match.group(1).strip() if match else content


def fix_trailing_commas(json_str: str) -> str:
    """Fix trailing commas in JSON (common LLM mistake).

    Handles cases like {"key": "value",} or ["item",]

    Args:
        json_str: JSON string potentially containing trailing commas

    Returns:
        JSON string with trailing commas removed
    """
    return TRAILING_COMMA_PATTERN.sub(r"\1", json_str)
