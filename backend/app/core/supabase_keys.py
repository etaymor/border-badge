"""Which Supabase API key to send, and how to send it.

Supabase is replacing the JWT-based legacy keys (anon, service_role) with
opaque ``sb_publishable_`` / ``sb_secret_`` keys. During the migration either
may be configured, so every caller goes through these helpers instead of
reading the settings fields directly. Remove the legacy fallbacks once the
legacy keys are disabled in the Supabase dashboard.
"""

from typing import Any

# Legacy keys are JWTs (base64url of '{"alg":...' always starts "eyJ").
_LEGACY_JWT_PREFIX = "eyJ"


def _key(settings: Any, name: str) -> str:
    value = getattr(settings, name, "")
    return value if isinstance(value, str) else ""


def client_api_key(settings: Any) -> str:
    """Key paired with a user's JWT for RLS-scoped requests."""
    return _key(settings, "supabase_publishable_key") or _key(
        settings, "supabase_anon_key"
    )


def admin_api_key(settings: Any) -> str:
    """Key for privileged requests that bypass RLS."""
    return _key(settings, "supabase_secret_key") or _key(
        settings, "supabase_service_role_key"
    )


def headers_for_admin_key(key: str) -> dict[str, str]:
    """Auth headers for a privileged request made with ``key``.

    New secret keys are not JWTs and belong on ``apikey`` only; the Supabase
    gateway swaps them for a short-lived service_role JWT itself. A legacy
    service_role key is a JWT and must also be sent as the Bearer token.
    """
    if key.startswith(_LEGACY_JWT_PREFIX):
        return {"apikey": key, "Authorization": f"Bearer {key}"}
    return {"apikey": key}


def admin_headers(settings: Any) -> dict[str, str]:
    """Auth headers for a privileged request using the configured admin key."""
    return headers_for_admin_key(admin_api_key(settings))
