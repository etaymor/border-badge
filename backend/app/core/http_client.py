"""Shared HTTP client with connection pooling.

This module provides a singleton HTTP client instance that is reused across
all outbound HTTP requests. This avoids the overhead of establishing new
TCP/TLS connections for each request (50-150ms per connection).

Usage:
    from app.core.http_client import get_http_client

    client = get_http_client()
    response = await client.get("https://example.com")

The client is automatically closed during application shutdown via the
lifespan handler in main.py.
"""

import httpx

_http_client: httpx.AsyncClient | None = None


def get_http_client() -> httpx.AsyncClient:
    """Get or create the shared HTTP client with connection pooling.

    Returns:
        The shared AsyncClient instance configured with reasonable defaults:
        - 30 second timeout
        - Max 100 concurrent connections
        - Max 20 keep-alive connections
    """
    global _http_client
    if _http_client is None or _http_client.is_closed:
        _http_client = httpx.AsyncClient(
            timeout=30.0,
            limits=httpx.Limits(max_connections=100, max_keepalive_connections=20),
        )
    return _http_client


async def close_http_client() -> None:
    """Close the HTTP client on shutdown.

    This should be called during application shutdown to properly close
    all connections. Called automatically by the lifespan handler in main.py.
    """
    global _http_client
    if _http_client is not None:
        await _http_client.aclose()
        _http_client = None
