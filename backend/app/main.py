"""FastAPI application entry point."""

import logging
import secrets
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager
from contextvars import ContextVar
from pathlib import Path

import jwt
from fastapi import FastAPI
from fastapi.exception_handlers import request_validation_exception_handler
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from fastapi.templating import Jinja2Templates
from slowapi import Limiter
from slowapi.errors import RateLimitExceeded
from slowapi.util import get_remote_address
from starlette.middleware.base import BaseHTTPMiddleware
from starlette.requests import Request
from starlette.responses import FileResponse, Response

from app.core.config import get_settings
from app.core.http_client import close_http_client
from app.core.logging import setup_logging
from app.core.posthog import shutdown_posthog
from app.core.urls import safe_external_url

# ContextVar for accessing request in rate limit functions
_request_ctx_var: ContextVar[Request | None] = ContextVar(
    "request_context", default=None
)


def get_request_context() -> Request | None:
    """Get the current request from context (for use in rate limit functions)."""
    return _request_ctx_var.get()


# CSP nonce key for request state
CSP_NONCE_KEY = "csp_nonce"

# Template and static file paths
APP_DIR = Path(__file__).parent
TEMPLATES_DIR = APP_DIR / "templates"
STATIC_DIR = APP_DIR / "static"

# Get settings first so we can use them in template globals
settings = get_settings()

# Setup logging early
setup_logging(debug=settings.debug)

# Jinja2 templates instance (shared across the application)
templates = Jinja2Templates(directory=str(TEMPLATES_DIR), autoescape=True)
templates.env.filters["safe_external_url"] = safe_external_url
templates.env.globals["is_production"] = settings.is_production
templates.env.globals["apple_app_id"] = settings.apple_app_id


def get_rate_limit_key(request: Request) -> str:
    """Get rate limit key - user ID if authenticated, IP otherwise.

    For authenticated requests, rate limits are tracked per-user.
    For unauthenticated requests, rate limits fall back to IP-based tracking.
    """
    auth_header = request.headers.get("Authorization", "")
    if auth_header.startswith("Bearer "):
        try:
            token = auth_header[7:]
            # Decode without verification to extract subject
            # Full verification happens in the security middleware
            payload = jwt.decode(token, options={"verify_signature": False})
            user_id = payload.get("sub")
            if user_id:
                return f"user:{user_id}"
        except Exception:
            # If token parsing fails, fall back to IP-based limiting
            pass
    return f"ip:{get_remote_address(request)}"


# Rate limiter instance (shared across the application)
limiter = Limiter(key_func=get_rate_limit_key)

# Import API router after limiter is defined so other modules can safely
# import the shared limiter from this module without circular import issues.
from app.api import router as api_router  # noqa: E402, I001


logger = logging.getLogger(__name__)


@asynccontextmanager
async def lifespan(app: FastAPI) -> AsyncIterator[None]:
    """Application lifespan context manager for startup/shutdown events."""
    # Startup validation - warn about auth misconfiguration early
    if settings.supabase_jwt_secret and not settings.supabase_url:
        logger.error(
            "AUTH_MISCONFIGURATION: SUPABASE_JWT_SECRET is set but "
            "SUPABASE_URL is missing. Token validation will fail. "
            "Set SUPABASE_URL to your Supabase project URL."
        )

    # Startup validation - warn if Google Places API key is missing
    if not settings.google_places_api_key:
        logger.warning(
            "PHOTOS_FEATURE_UNAVAILABLE: GOOGLE_PLACES_API_KEY is not set. "
            "Photo import place suggestions will fail. "
            "Set this env var or disable the feature."
        )

    # Startup info - PostHog analytics status
    if settings.posthog_configured:
        logger.info("PostHog analytics enabled")
    else:
        logger.info("PostHog analytics disabled (no POSTHOG_API_KEY)")

    # Startup validation - warn if RevenueCat config is missing in production
    if settings.is_production and not settings.revenuecat_configured:
        missing_fields = ", ".join(settings.revenuecat_missing_fields)
        logger.error(
            "REVENUECAT_MISCONFIGURATION: Missing %s. "
            "Subscription verification and webhooks will fail until set.",
            missing_fields,
        )

    # Startup validation - warn if ad tracking credentials are missing in production
    if settings.is_production and not settings.ad_tracking_configured:
        for platform, fields in settings.ad_tracking_missing_fields.items():
            logger.error(
                "AD_TRACKING_MISCONFIGURATION: %s missing %s. "
                "Server-side ad events will silently fail until set.",
                platform,
                ", ".join(fields),
            )
    yield
    # Shutdown - close shared HTTP client
    await close_http_client()
    # Shutdown - flush and close PostHog client
    shutdown_posthog()


def generate_csp_nonce() -> str:
    """Generate a cryptographically secure nonce for CSP."""
    return secrets.token_urlsafe(16)


# Public share-page route prefixes (/l/{slug} lists, /t/{slug} trips). These are
# the only pages that embed the Google Maps JS API, so they are the only ones
# that get the relaxed Maps-compatible CSP below.
SHARE_ROUTE_PREFIXES = ("/l/", "/t/")


def is_share_route(path: str) -> bool:
    """True for the public list/trip share pages that render a Google Map."""
    return path.startswith(SHARE_ROUTE_PREFIXES)


def _build_default_csp(nonce: str) -> str:
    """Strict policy for every route that is not a share page.

    Google Fonts CSS from fonts.googleapis.com is allowed as an external
    stylesheet. Any inline style/script in a template must carry
    nonce="{{ request.state.csp_nonce }}".
    """
    return (
        "default-src 'self'; "
        "img-src 'self' https://*.supabase.co https://places.googleapis.com https://*.ggpht.com https://lh3.googleusercontent.com data:; "
        f"style-src 'self' 'nonce-{nonce}' https://fonts.googleapis.com; "
        "font-src 'self' https://fonts.gstatic.com; "
        f"script-src 'self' 'nonce-{nonce}' https://www.googletagmanager.com https://challenges.cloudflare.com; "
        "frame-src https://challenges.cloudflare.com; "
        "connect-src 'self' https://www.google-analytics.com https://analytics.google.com"
    )


def _build_maps_csp(nonce: str) -> str:
    """Google-recommended strict (nonce-based) Maps policy for share pages.

    Three non-obvious requirements, each of which fails at runtime rather than
    at build time:

    * ``'unsafe-eval'`` -- the Maps JS API does not initialize without it. This
      is the security give, and confining it to the two share routes (rather
      than relaxing the app-wide policy) is the whole point of the branch.
    * ``blob:`` in script-src/connect-src plus ``worker-src blob:`` -- Maps
      spins up blob-backed workers.
    * ``*.googleapis.com`` in connect-src/img-src -- since Q2 2023 Maps
      *hard-rejects* requests from a page whose CSP omits it (an API-level
      refusal, not merely a browser-blocked resource).

    ``style-src`` deliberately keeps the nonce and stays free of
    ``'unsafe-inline'`` (R10).

    ``'strict-dynamic'`` makes host allowlists in script-src ignored by
    browsers that support it, but ``'self'`` and the GA host are kept so older
    browsers that ignore ``'strict-dynamic'`` still load our bundle and GA.
    """
    return (
        "default-src 'self'; "
        "img-src 'self' https://*.googleapis.com https://*.gstatic.com *.google.com *.googleusercontent.com https://places.googleapis.com https://*.ggpht.com https://lh3.googleusercontent.com https://*.supabase.co data:; "
        f"style-src 'nonce-{nonce}' https://fonts.googleapis.com; "
        "font-src https://fonts.gstatic.com; "
        f"script-src 'nonce-{nonce}' 'strict-dynamic' 'self' https: 'unsafe-eval' blob: https://www.googletagmanager.com; "
        "frame-src *.google.com; "
        "connect-src 'self' https://*.googleapis.com *.google.com https://*.gstatic.com https://www.google-analytics.com https://analytics.google.com data: blob:; "
        "worker-src blob:"
    )


class SecurityHeadersMiddleware(BaseHTTPMiddleware):
    """Add security headers to all responses.

    Generates a per-request CSP nonce for inline styles/scripts.
    The nonce is stored in request.state and can be accessed in templates.
    Also stores request in ContextVar for rate limit functions to access.

    The CSP itself branches: the public share pages (``/l/``, ``/t/``) render a
    Google Map and get a Maps-compatible policy; everything else keeps the
    stricter default.
    """

    async def dispatch(self, request: Request, call_next) -> Response:  # type: ignore[no-untyped-def]
        # Store request in context var for rate limit functions
        token = _request_ctx_var.set(request)

        # Generate nonce for this request
        nonce = generate_csp_nonce()
        request.state.csp_nonce = nonce

        try:
            response = await call_next(request)
        finally:
            _request_ctx_var.reset(token)
        response.headers["X-Content-Type-Options"] = "nosniff"
        response.headers["X-Frame-Options"] = "DENY"
        response.headers["X-XSS-Protection"] = "1; mode=block"
        response.headers["Referrer-Policy"] = "strict-origin-when-cross-origin"

        if is_share_route(request.url.path):
            response.headers["Content-Security-Policy"] = _build_maps_csp(nonce)
        else:
            response.headers["Content-Security-Policy"] = _build_default_csp(nonce)
        return response


app = FastAPI(
    title="Atlasi API",
    description="Backend API for the Atlasi travel tracking app",
    version="0.1.0",
    docs_url="/docs" if settings.debug else None,
    redoc_url="/redoc" if settings.debug else None,
    lifespan=lifespan,
)


async def rate_limit_exceeded_handler(
    request: Request, exc: RateLimitExceeded
) -> Response:
    """Custom rate limit handler returning JSON response matching our API format."""
    from fastapi.responses import JSONResponse

    # Extract retry-after from the exception if available
    retry_after = getattr(exc, "retry_after", None)
    headers = {"Retry-After": str(retry_after)} if retry_after else {}

    return JSONResponse(
        status_code=429,
        content={
            "detail": "Rate limit exceeded. Please try again later.",
            "retry_after": retry_after,
        },
        headers=headers,
    )


async def photo_suggest_validation_logging_handler(
    request: Request, exc: RequestValidationError
) -> Response:
    """Log Pydantic 422 detail for /photos/suggest-places, then default response.

    Production access logs only show "422" with no field detail, which has burned
    us twice on this route (vision payload size, then per-cluster photo cap).
    Logging exc.errors() here makes the next failure self-diagnosing without a
    second deploy. Scoped to one path to avoid noisy logs elsewhere.

    Body is intentionally not logged: it can contain base64 image data.
    """
    if request.url.path == "/photos/suggest-places":
        errors = exc.errors()
        # Strip 'input' from each error to avoid leaking base64 payloads.
        sanitized = [{k: v for k, v in err.items() if k != "input"} for err in errors]
        logger.warning(
            "Validation 422 on /photos/suggest-places",
            extra={
                "path": request.url.path,
                "error_count": len(errors),
                "errors": sanitized,
            },
        )
    return await request_validation_exception_handler(request, exc)


# Add rate limiter to app state and exception handler
app.state.limiter = limiter
app.add_exception_handler(RateLimitExceeded, rate_limit_exceeded_handler)
app.add_exception_handler(
    RequestValidationError, photo_suggest_validation_logging_handler
)

# Add security headers middleware
app.add_middleware(SecurityHeadersMiddleware)

# Configure CORS
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"] if settings.is_development else settings.allowed_origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Mount static files
app.mount("/static", StaticFiles(directory=str(STATIC_DIR)), name="static")

# Include API routers
app.include_router(api_router)


@app.get("/health", tags=["health"])
async def health_check() -> dict[str, str]:
    """
    Health check endpoint.

    Returns a simple status to verify the API is running.
    """
    return {"status": "ok"}


@app.get("/.well-known/apple-app-site-association", tags=["apple"])
async def apple_app_site_association() -> FileResponse:
    """
    Serve Apple App Site Association file for Universal Links.

    This file tells iOS which app should handle links from atlasi.app domain.
    Must be served with application/json content type.
    """
    aasa_path = STATIC_DIR / ".well-known" / "apple-app-site-association"
    return FileResponse(
        path=str(aasa_path),
        media_type="application/json",
    )


@app.get("/share", tags=["apple"])
async def share_universal_link(request: Request, url: str | None = None) -> Response:
    """
    Universal Link handler for iOS Share Extension.

    When the Atlasi app is installed with Associated Domains, iOS intercepts
    this URL and opens the app directly, passing the url parameter.

    If the app isn't installed, this page is shown as a fallback with
    instructions to download the app.
    """
    # Use template to properly include CSP nonce for inline styles
    return templates.TemplateResponse(
        request=request,
        name="share_fallback.html",
        context={"nonce": request.state.csp_nonce},
    )
