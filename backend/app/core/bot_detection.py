"""Simple bot detection based on User-Agent patterns.

This module provides basic bot detection for affiliate redirect analytics.
Currently observability-only (logs is_bot flag but doesn't block).
"""

import re

# Common bot patterns - search engines, social media crawlers, and HTTP clients
BOT_PATTERNS = [
    # Search engine bots
    r"Googlebot",
    r"Bingbot",
    r"Baiduspider",
    r"DuckDuckBot",
    r"YandexBot",
    r"Sogou",
    r"Exabot",
    r"ia_archiver",
    # Generic bot patterns
    r"\bbot\b",
    r"crawl",
    r"spider",
    r"slurp",
    # Social media preview crawlers
    r"facebookexternalhit",
    r"Facebot",
    r"Twitterbot",
    r"LinkedInBot",
    r"Pinterest",
    r"Slackbot",
    r"Discordbot",
    r"WhatsApp",
    r"TelegramBot",
    r"Applebot",
    # HTTP clients / tools
    r"curl/",
    r"wget/",
    r"python-requests",
    r"python-urllib",
    r"httpx",
    r"aiohttp",
    r"axios",
    r"node-fetch",
    r"Go-http-client",
    r"Java/",
    r"libwww-perl",
    # Monitoring / SEO tools
    r"Pingdom",
    r"UptimeRobot",
    r"StatusCake",
    r"Site24x7",
    r"GTmetrix",
    r"PageSpeed",
    r"Lighthouse",
    r"SEMrush",
    r"Ahrefs",
    r"MJ12bot",
    r"DotBot",
]

# Compile regex once for performance
_BOT_REGEX = re.compile("|".join(BOT_PATTERNS), re.IGNORECASE)


def is_known_bot(user_agent: str | None) -> bool:
    """Check if User-Agent matches known bot patterns.

    Args:
        user_agent: The User-Agent header value

    Returns:
        True if the User-Agent matches a known bot pattern
    """
    if not user_agent:
        return False
    return bool(_BOT_REGEX.search(user_agent))


def should_block_bot(user_agent: str | None) -> bool:
    """Determine if request should be blocked based on User-Agent.

    Currently returns False for all requests (observability-first approach).
    Future enhancement: block aggressive bots or implement rate limiting per bot.

    Args:
        user_agent: The User-Agent header value

    Returns:
        True if the request should be blocked (currently always False)
    """
    # For now, allow all - just track for analytics
    # Future: block abusive patterns or implement stricter limits for bots
    return False
