"""JWT verification and authentication utilities."""

import asyncio
import logging
import secrets
import time
from typing import Annotated, Any

import httpx
import jwt
from fastapi import Depends, Header, HTTPException, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer

from app.core.config import Settings, get_settings
from app.core.http_client import get_http_client
from app.core.supabase_keys import admin_api_key

logger = logging.getLogger(__name__)

security = HTTPBearer()

LEGACY_SIGNING_ALG = "HS256"
ASYMMETRIC_SIGNING_ALGS = frozenset({"ES256", "RS256"})


class UnknownSigningKeyError(jwt.InvalidTokenError):
    """Token names a signing key that is not in the cached JWKS."""


class JwksCache:
    """Supabase's published signing keys, cached by key id.

    Asymmetric access tokens are verified against the project's JWKS. Keys are
    refetched after ``ttl`` (so a revoked key stops verifying) and on an
    unknown ``kid`` (so a freshly rotated key verifies without a restart), but
    no more often than ``min_refresh_interval`` so garbage tokens can't make
    us hammer the endpoint.
    """

    def __init__(self, ttl: float = 600.0, min_refresh_interval: float = 5.0):
        self.ttl = ttl
        self.min_refresh_interval = min_refresh_interval
        self._keys: dict[str, jwt.PyJWK] = {}
        self._fetched_at = 0.0
        self._last_attempt = float("-inf")
        self._lock = asyncio.Lock()

    def clear(self) -> None:
        self._keys = {}
        self._fetched_at = 0.0
        self._last_attempt = float("-inf")

    @property
    def is_stale(self) -> bool:
        return time.monotonic() - self._fetched_at > self.ttl

    def get(self, kid: str, *, allow_stale: bool = False) -> jwt.PyJWK | None:
        if self.is_stale and not allow_stale:
            return None
        return self._keys.get(kid)

    async def refresh(self, supabase_url: str) -> None:
        """Refetch the JWKS, keeping the current keys if the fetch fails."""
        async with self._lock:
            now = time.monotonic()
            if now - self._last_attempt < self.min_refresh_interval:
                return
            self._last_attempt = now
            url = f"{supabase_url}/auth/v1/.well-known/jwks.json"
            try:
                response = await get_http_client().get(url, timeout=5.0)
                response.raise_for_status()
                keys: dict[str, jwt.PyJWK] = {}
                for jwk in response.json().get("keys", []):
                    kid = jwk.get("kid")
                    if not kid or jwk.get("alg") not in ASYMMETRIC_SIGNING_ALGS:
                        continue
                    keys[kid] = jwt.PyJWK(jwk)
            except (httpx.HTTPError, ValueError, jwt.PyJWKError) as e:
                logger.error("supabase_jwks_fetch_failed: %s", e)
                return
            self._keys = keys
            self._fetched_at = now


jwks_cache = JwksCache()


def determine_supabase_issuer(settings: Settings) -> str | None:
    """Determine the expected JWT issuer from Supabase configuration.

    Returns:
        The issuer URL if SUPABASE_URL is configured, or None otherwise.

    Side Effects:
        Logs an error if SUPABASE_JWT_SECRET is set but SUPABASE_URL is missing,
        as this indicates a server misconfiguration.
    """
    if settings.supabase_url:
        return f"{settings.supabase_url}/auth/v1"
    elif settings.supabase_jwt_secret:
        logger.error(
            "Supabase JWT secret is configured but SUPABASE_URL is empty; "
            "refusing to validate tokens without a trusted issuer. "
            "Set SUPABASE_URL to your Supabase project URL.",
        )
    return None


def _verification_key(
    token: str, settings: Settings, *, allow_stale: bool
) -> tuple[Any, str]:
    """Pick the key and the single algorithm a token may be verified with.

    The algorithm comes from the key source, never from the token alone: an
    HS256 token is only checked against the legacy secret, and an asymmetric
    token only against the JWKS key with the matching ``kid`` and ``alg``.
    """
    header = jwt.get_unverified_header(token)
    alg = header.get("alg")

    if alg == LEGACY_SIGNING_ALG:
        if not settings.supabase_jwt_secret:
            raise jwt.InvalidTokenError("legacy HS256 tokens are not accepted")
        return settings.supabase_jwt_secret, alg

    if alg in ASYMMETRIC_SIGNING_ALGS:
        kid = header.get("kid")
        jwk = jwks_cache.get(kid, allow_stale=allow_stale) if kid else None
        if jwk is None:
            raise UnknownSigningKeyError(f"unknown signing key {kid!r}")
        if jwk.algorithm_name != alg:
            raise jwt.InvalidTokenError("token alg does not match its key")
        return jwk.key, alg

    raise jwt.InvalidTokenError(f"unsupported token alg {alg!r}")


def _decode(token: str, settings: Settings, *, allow_stale: bool) -> dict[str, Any]:
    key, alg = _verification_key(token, settings, allow_stale=allow_stale)
    return jwt.decode(
        token,
        key,
        algorithms=[alg],
        audience="authenticated",
        issuer=determine_supabase_issuer(settings),
    )


async def decode_supabase_token(token: str, settings: Settings) -> dict[str, Any]:
    """Verify a Supabase access token and return its claims.

    Raises jwt.InvalidTokenError (or a subclass) if the token is not valid.
    """
    try:
        return _decode(token, settings, allow_stale=False)
    except UnknownSigningKeyError:
        if not settings.supabase_url:
            raise
        await jwks_cache.refresh(settings.supabase_url)
        return _decode(token, settings, allow_stale=True)


def decode_supabase_token_cached(token: str, settings: Settings) -> dict[str, Any]:
    """Like decode_supabase_token, for sync callers: never touches the network.

    A token whose key isn't cached yet is rejected rather than fetched.
    """
    return _decode(token, settings, allow_stale=True)


class AuthUser:
    """Authenticated user from JWT token."""

    def __init__(self, user_id: str, email: str | None = None):
        self.id = user_id
        self.email = email


async def get_current_user(
    credentials: Annotated[HTTPAuthorizationCredentials, Depends(security)],
) -> AuthUser:
    """
    Verify JWT token and extract the current user.

    Raises HTTPException 401 if token is invalid or expired.
    """
    settings = get_settings()
    token = credentials.credentials

    # Determine expected issuer using shared helper
    issuer = determine_supabase_issuer(settings)

    # If JWT secret is configured but issuer could not be determined,
    # treat this as a hard server misconfiguration
    if settings.supabase_jwt_secret and issuer is None:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Authentication is misconfigured on the server.",
        )

    try:
        payload = await decode_supabase_token(token, settings)
        user_id = payload.get("sub")
        if not user_id:
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail="Invalid token: missing user id",
            )
        return AuthUser(
            user_id=user_id,
            email=payload.get("email"),
        )
    except jwt.ExpiredSignatureError:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Token has expired",
        ) from None
    except jwt.InvalidTokenError as e:
        # Log actual error server-side for debugging, but don't expose to client
        logger.warning(f"JWT validation failed: {e}")
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid or malformed token",
        ) from None


# Type alias for dependency injection
CurrentUser = Annotated[AuthUser, Depends(get_current_user)]


async def get_optional_user(
    credentials: Annotated[
        HTTPAuthorizationCredentials | None, Depends(HTTPBearer(auto_error=False))
    ],
) -> AuthUser | None:
    """
    Optionally verify JWT token and extract the current user.

    Returns None if no token is provided or if the token is invalid.
    Use this for endpoints that work both authenticated and anonymously.
    """
    if not credentials:
        return None

    settings = get_settings()
    token = credentials.credentials

    # Determine expected issuer using shared helper
    # For optional auth, just return None on misconfiguration (helper logs the error)
    issuer = determine_supabase_issuer(settings)
    if settings.supabase_jwt_secret and issuer is None:
        return None

    try:
        payload = await decode_supabase_token(token, settings)
        user_id = payload.get("sub")
        if not user_id:
            return None
        return AuthUser(
            user_id=user_id,
            email=payload.get("email"),
        )
    except jwt.InvalidTokenError:
        # For optional auth, just return None on invalid token
        return None


# Type alias for optional user dependency
OptionalUser = Annotated[AuthUser | None, Depends(get_optional_user)]


async def require_service_role(
    authorization: Annotated[str | None, Header()] = None,
) -> None:
    """Verify request uses the Supabase admin key (for admin endpoints).

    This dependency checks that the Authorization header contains the
    Supabase secret key (or the legacy service role key while it is still
    configured), which should only be used by admin tools and internal
    services.

    Raises:
        HTTPException 401: If Authorization header is missing
        HTTPException 403: If the key doesn't match the service role key
    """
    if not authorization:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Authorization required",
        )

    settings = get_settings()
    key = admin_api_key(settings)
    if not key:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Admin access required",
        )
    expected = f"Bearer {key}"

    # Use secrets.compare_digest to prevent timing attacks
    if not secrets.compare_digest(authorization, expected):
        logger.warning("admin_auth_failed: invalid service role key")
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Admin access required",
        )
