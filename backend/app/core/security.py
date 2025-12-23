"""JWT verification and authentication utilities."""

import logging
import secrets
from typing import Annotated

import jwt
from fastapi import Depends, Header, HTTPException, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer

from app.core.config import get_settings

logger = logging.getLogger(__name__)

security = HTTPBearer()


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

    # Determine expected issuer. If Supabase is configured (JWT secret set) but
    # the URL is missing, treat this as a hard server misconfiguration rather
    # than silently disabling issuer validation.
    issuer: str | None = None
    if settings.supabase_url:
        issuer = f"{settings.supabase_url}/auth/v1"
    elif settings.supabase_jwt_secret:
        logger.error(
            "Supabase JWT secret is configured but SUPABASE_URL is empty; "
            "refusing to validate tokens without a trusted issuer. "
            "Set SUPABASE_URL to your Supabase project URL.",
        )
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Authentication is misconfigured on the server.",
        )

    try:
        payload = jwt.decode(
            token,
            settings.supabase_jwt_secret,
            algorithms=["HS256"],
            audience="authenticated",
            issuer=issuer,
        )
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

    # Determine expected issuer
    issuer: str | None = None
    if settings.supabase_url:
        issuer = f"{settings.supabase_url}/auth/v1"
    elif settings.supabase_jwt_secret:
        # Server misconfiguration - but for optional auth, just return None
        logger.warning("Supabase JWT secret configured but URL missing")
        return None

    try:
        payload = jwt.decode(
            token,
            settings.supabase_jwt_secret,
            algorithms=["HS256"],
            audience="authenticated",
            issuer=issuer,
        )
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
    """Verify request uses service role key (for admin endpoints).

    This dependency checks that the Authorization header contains the
    Supabase service role key, which should only be used by admin tools
    and internal services.

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
    expected = f"Bearer {settings.supabase_service_role_key}"

    # Use secrets.compare_digest to prevent timing attacks
    if not secrets.compare_digest(authorization, expected):
        logger.warning("admin_auth_failed: invalid service role key")
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Admin access required",
        )
