"""Long-lived HTTP clients with connection pooling.

Two singletons live here, and they are deliberately *not* the same client:

* ``get_http_client()`` — the shared app client. It backs every Supabase REST
  call in the application.
* ``get_places_client()`` — a private client for the Google Places fan-out on
  the photo-import path.

Both avoid the cost of establishing a new TCP/TLS connection per request
(50-150ms), and both are closed during application shutdown via the lifespan
handler in main.py.

Usage:
    from app.core.http_client import get_http_client

    client = get_http_client()
    response = await client.get("https://example.com")
"""

import httpx

from app.core.config import get_settings

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


# ---------------------------------------------------------------------------
# Private Google Places client (photo import)
# ---------------------------------------------------------------------------
#
# The places fan-out gets its own pool rather than adopting the shared app
# client above. The shared client backs every Supabase REST call, so moving the
# photo-import fan-out onto it would put the import in contention with the
# app's database path, and its keepalive budget (20) sits below a single
# import's steady-state usage. A private pool also removes two derived
# problems: the endpoint would otherwise inherit the shared 30s timeout and
# silently widen the per-cluster budget, and pool-exhaustion errors raised by a
# pool shared with the database path would surface on the search retry
# predicate as generic timeouts.
#
# Sizing: a single request fans out over MAX_CONCURRENT_PLACES_REQUESTS (5)
# in-flight Google calls, and the semaphores do not nest, so an import running
# three requests concurrently peaks around 15 concurrent outbound calls. 20
# connections leaves headroom above that peak without letting one process open
# an unbounded number of sockets, and the keepalive budget matches the
# connection ceiling so every connection can survive between chunks of an
# import rather than being torn down and redialed.
PLACES_MAX_CONNECTIONS = 20
PLACES_MAX_KEEPALIVE_CONNECTIONS = 20

# Chunks of an import arrive seconds apart; httpx's 5s default would expire
# connections between them and pay the TLS handshake again on every chunk.
PLACES_KEEPALIVE_EXPIRY_SECONDS = 60.0

# Waiting for a free connection is a different failure from a slow upstream, so
# it gets its own (short) budget: if the pool is saturated for this long the
# request should fail fast rather than sit inside the per-cluster budget.
PLACES_POOL_TIMEOUT_SECONDS = 2.0

_places_client: httpx.AsyncClient | None = None


def get_places_client() -> httpx.AsyncClient:
    """Get or create the private Google Places client.

    Separate from the shared app client on purpose (see the note above).
    Connect/read/write use the configured places timeout; the pool wait has its
    own, shorter budget.
    """
    global _places_client
    if _places_client is None or _places_client.is_closed:
        places_timeout = get_settings().places_api_timeout_seconds
        _places_client = httpx.AsyncClient(
            timeout=httpx.Timeout(
                places_timeout,
                pool=PLACES_POOL_TIMEOUT_SECONDS,
            ),
            limits=httpx.Limits(
                max_connections=PLACES_MAX_CONNECTIONS,
                max_keepalive_connections=PLACES_MAX_KEEPALIVE_CONNECTIONS,
                keepalive_expiry=PLACES_KEEPALIVE_EXPIRY_SECONDS,
            ),
        )
    return _places_client


async def close_places_client() -> None:
    """Close the private Places client on shutdown.

    Called automatically by the lifespan handler in main.py.
    """
    global _places_client
    if _places_client is not None:
        await _places_client.aclose()
        _places_client = None
