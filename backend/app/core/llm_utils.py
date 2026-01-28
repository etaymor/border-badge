"""Shared LLM utilities for JSON parsing and API constants."""

import re

# OpenRouter API endpoint
OPENROUTER_API_URL = "https://openrouter.ai/api/v1/chat/completions"

# Patterns for parsing LLM JSON responses
CODE_FENCE_PATTERN = re.compile(r"^```(?:\w+)?\s*\n?(.*?)\n?```\s*$", re.DOTALL)
TRAILING_COMMA_PATTERN = re.compile(r",\s*([}\]])")


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
