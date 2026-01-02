"""Feature flag utilities for conditional feature availability.

Current feature gating strategy:

1. ROUTER-LEVEL GATING (preferred for entire feature areas):
   Social routers are conditionally registered at startup in api/__init__.py.
   This is efficient: no runtime overhead, routes don't exist in OpenAPI when disabled.

2. ENDPOINT-LEVEL GATING (for fine-grained control):
   Use require_social_features dependency when you need to disable specific endpoints
   within an otherwise-enabled router. Currently unused but available for future needs.
"""

from fastapi import Depends, HTTPException, status

from app.core.config import Settings, get_settings


def require_social_features(settings: Settings = Depends(get_settings)) -> None:
    """
    Dependency that blocks requests when social features are disabled.

    Returns 404 to make endpoints appear non-existent rather than forbidden.
    This is useful for security through obscurity when features are not yet launched.

    NOTE: Currently unused. Social features are gated at router registration time
    in api/__init__.py. This dependency is available for future fine-grained control
    when you need to disable specific endpoints within an otherwise-enabled router.

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
