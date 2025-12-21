"""FastAPI application entry point."""

import asyncio
import logging
import secrets
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from fastapi.templating import Jinja2Templates
from slowapi import Limiter, _rate_limit_exceeded_handler
from slowapi.errors import RateLimitExceeded
from slowapi.util import get_remote_address
from starlette.middleware.base import BaseHTTPMiddleware
from starlette.requests import Request
from starlette.responses import Response

from app.core.config import get_settings
from app.core.logging import setup_logging
from app.core.urls import safe_external_url
from app.db.session import close_http_client
from app.services.oembed_adapters import cleanup_expired_cache

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

# Rate limiter instance (shared across the application)
limiter = Limiter(key_func=get_remote_address)

# Import API router after limiter is defined so other modules can safely
# import the shared limiter from this module without circular import issues.
from app.api import router as api_router  # noqa: E402, I001


logger = logging.getLogger(__name__)


async def _background_cache_cleanup() -> None:
    """Run cache cleanup in background, logging any errors."""
    try:
        await cleanup_expired_cache()
    except Exception as e:
        logger.warning(f"Background cache cleanup failed: {e}")


@asynccontextmanager
async def lifespan(app: FastAPI) -> AsyncIterator[None]:
    """Application lifespan context manager for startup/shutdown events."""
    # Startup - schedule cache cleanup in background (non-blocking)
    asyncio.create_task(_background_cache_cleanup())
    yield
    # Shutdown - close shared HTTP client
    await close_http_client()


def generate_csp_nonce() -> str:
    """Generate a cryptographically secure nonce for CSP."""
    return secrets.token_urlsafe(16)


class SecurityHeadersMiddleware(BaseHTTPMiddleware):
    """Add security headers to all responses.

    Generates a per-request CSP nonce for inline styles/scripts.
    The nonce is stored in request.state and can be accessed in templates.
    """

    async def dispatch(self, request: Request, call_next) -> Response:  # type: ignore[no-untyped-def]
        # Generate nonce for this request
        nonce = generate_csp_nonce()
        request.state.csp_nonce = nonce

        response = await call_next(request)
        response.headers["X-Content-Type-Options"] = "nosniff"
        response.headers["X-Frame-Options"] = "DENY"
        response.headers["X-XSS-Protection"] = "1; mode=block"
        response.headers["Referrer-Policy"] = "strict-origin-when-cross-origin"

        # Build CSP with nonce for styles
        # Note: Google Fonts CSS from fonts.googleapis.com is allowed as external stylesheet
        # Any inline styles in templates must include nonce="{{ request.state.csp_nonce }}"
        response.headers["Content-Security-Policy"] = (
            "default-src 'self'; "
            "img-src 'self' https://*.supabase.co data:; "
            f"style-src 'self' 'nonce-{nonce}' https://fonts.googleapis.com; "
            "font-src 'self' https://fonts.gstatic.com; "
            "script-src 'self'"
        )
        return response


app = FastAPI(
    title="Atlasi API",
    description="Backend API for the Atlasi travel tracking app",
    version="0.1.0",
    docs_url="/docs" if settings.debug else None,
    redoc_url="/redoc" if settings.debug else None,
    lifespan=lifespan,
)

# Add rate limiter to app state and exception handler
app.state.limiter = limiter
app.add_exception_handler(RateLimitExceeded, _rate_limit_exceeded_handler)

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
