"""Feature flag utilities for conditional feature availability."""

from fastapi import Depends, HTTPException, status

from app.core.config import Settings, get_settings


def require_social_features(settings: Settings = Depends(get_settings)) -> None:
    """
    Dependency that blocks requests when social features are disabled.

    Returns 404 to make endpoints appear non-existent rather than forbidden.
    This is useful for security through obscurity when features are not yet launched.

    Usage:
        @router.get("/endpoint", dependencies=[Depends(require_social_features)])
        async def endpoint():
            ...
    """
    if not settings.enable_social_features:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Not found",
        )
