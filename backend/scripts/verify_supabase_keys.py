#!/usr/bin/env python3
"""Read-only smoke check of the backend's Supabase credentials.

Run before and after each step of the key migration (docs/supabase-key-migration.md)
to confirm the configured keys work against every Supabase surface the backend
uses. Never prints key values.

Usage:
    cd backend
    poetry run python scripts/verify_supabase_keys.py
"""

import asyncio
import sys
from pathlib import Path

import httpx

# Add backend root to sys.path so we can import app modules
sys.path.insert(0, str(Path(__file__).parent.parent))

from app.core.config import get_settings  # noqa: E402
from app.core.supabase_keys import (  # noqa: E402
    admin_api_key,
    admin_headers,
    client_api_key,
)


def _kind(key: str) -> str:
    if not key:
        return "MISSING"
    if key.startswith("sb_secret_"):
        return "new secret key"
    if key.startswith("sb_publishable_"):
        return "new publishable key"
    return "LEGACY JWT key"


async def main() -> int:
    settings = get_settings()
    base = settings.supabase_url
    if not base:
        print("SUPABASE_URL is not set")
        return 1

    print(f"Project:      {base}")
    print(f"Admin key:    {_kind(admin_api_key(settings))}")
    print(f"Client key:   {_kind(client_api_key(settings))}")
    print(
        "Legacy HS256: "
        + (
            "ACCEPTED (SUPABASE_JWT_SECRET set)"
            if settings.supabase_jwt_secret
            else "rejected"
        )
    )
    print()

    headers = admin_headers(settings)
    checks = [
        ("JWKS", "GET", "/auth/v1/.well-known/jwks.json", {}, None),
        ("REST (admin)", "GET", "/rest/v1/country?select=id&limit=1", headers, None),
        (
            "Storage (admin)",
            "POST",
            "/storage/v1/object/list/media",
            headers,
            {"prefix": "", "limit": 1},
        ),
        ("Auth admin", "GET", "/auth/v1/admin/users?per_page=1", headers, None),
        (
            "REST (client key)",
            "GET",
            "/rest/v1/country?select=id&limit=1",
            {"apikey": client_api_key(settings)},
            None,
        ),
    ]

    failed = False
    async with httpx.AsyncClient(timeout=10.0) as client:
        for name, method, path, hdrs, body in checks:
            try:
                response = await client.request(
                    method, f"{base}{path}", headers=hdrs, json=body
                )
            except httpx.HTTPError as e:
                print(f"FAIL  {name}: {e}")
                failed = True
                continue
            if response.status_code >= 400:
                print(f"FAIL  {name}: {response.status_code} {response.text[:200]}")
                failed = True
                continue
            detail = ""
            if name == "JWKS":
                keys = response.json().get("keys", [])
                detail = " — " + (
                    ", ".join(f"{k.get('alg')}:{k.get('kid')}" for k in keys)
                    or "no asymmetric keys published yet"
                )
            print(f"ok    {name}{detail}")

    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(asyncio.run(main()))
