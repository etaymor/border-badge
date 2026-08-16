"""Long-lived HTTP clients with connection pooling.

Three singletons live here, and they are deliberately *not* the same client:

* ``get_http_client()`` — the shared app client. It backs every Supabase REST
  call in the application.
* ``get_places_client()`` — a private client for the Google Places fan-out on
  the photo-import path.
* ``get_vision_client()`` — a private client for the OpenRouter vision fan-out
  on the same path.

All three avoid the cost of establishing a new TCP/TLS connection per request
(50-150ms), and all three are closed during application shutdown via the
lifespan handler in main.py.

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


# ---------------------------------------------------------------------------
# Private vision client (photo import)
# ---------------------------------------------------------------------------
#
# Vision needs the same separation the Places fan-out was given, and for the
# same reason. `PhotoClassifier.classify` used to run on the shared app client,
# whose keepalive budget is 20 — below a single import's steady-state vision
# usage, and shared with every Supabase REST call. Two concurrent importers at
# the documented single-wave per-request bound (15 images) would evict every
# Supabase keepalive connection for the duration of the import, so the app's
# database path would pay a fresh TLS handshake per query while photos import.
#
# Sizing: the process-wide vision ceiling is
# `photo_vision.classifier.MAX_CONCURRENT_VISION_REQUESTS_PROCESS` (30). The
# pool sits above it in the same ratio the Places pool sits above its ceiling
# (20 over 15), so slot starvation — which fails fast and is counted — stays
# the binding constraint rather than pool exhaustion, which surfaces as a
# header-less transport error. The keepalive budget matches the connection
# ceiling so every connection survives between chunks of an import.
VISION_MAX_CONNECTIONS = 40
VISION_MAX_KEEPALIVE_CONNECTIONS = 40

# Same reasoning as the Places pool: chunks of an import arrive seconds apart,
# and httpx's 5s default would redial (and re-handshake) on every chunk.
VISION_KEEPALIVE_EXPIRY_SECONDS = 60.0

# Waiting for a free connection is a different failure from a slow model, so it
# gets its own short budget. Matches PLACES_POOL_TIMEOUT_SECONDS: both bound a
# purely LOCAL saturation wait.
VISION_POOL_TIMEOUT_SECONDS = 2.0

# Connect/read/write default. Every classify call passes its own (shorter)
# per-request timeout, so this is only the floor for a caller that does not.
VISION_REQUEST_TIMEOUT_SECONDS = 15.0

_vision_client: httpx.AsyncClient | None = None


def get_vision_client() -> httpx.AsyncClient:
    """Get or create the private vision (OpenRouter) client.

    Separate from the shared app client on purpose (see the note above).
    """
    global _vision_client
    if _vision_client is None or _vision_client.is_closed:
        _vision_client = httpx.AsyncClient(
            timeout=httpx.Timeout(
                VISION_REQUEST_TIMEOUT_SECONDS,
                pool=VISION_POOL_TIMEOUT_SECONDS,
            ),
            limits=httpx.Limits(
                max_connections=VISION_MAX_CONNECTIONS,
                max_keepalive_connections=VISION_MAX_KEEPALIVE_CONNECTIONS,
                keepalive_expiry=VISION_KEEPALIVE_EXPIRY_SECONDS,
            ),
        )
    return _vision_client


async def close_vision_client() -> None:
    """Close the private vision client on shutdown.

    Belongs in the lifespan handler in main.py alongside
    :func:`close_places_client` (and `get_vision_client()` alongside the
    warm-up call to `get_places_client()`), so the pool is built once at
    startup rather than on the first import request.
    """
    global _vision_client
    if _vision_client is not None:
        await _vision_client.aclose()
        _vision_client = None
