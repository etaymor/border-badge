"""Country and user_countries endpoints."""

import asyncio
import logging
from datetime import UTC, datetime, timedelta
from typing import Any

from fastapi import APIRouter, HTTPException, Query, Request, status

from app.api.utils import get_token_from_request
from app.core.security import CurrentUser
from app.db.session import get_supabase_client
from app.schemas.countries import (
    VALID_REGIONS,
    VALID_SUBREGIONS,
    Country,
    CountryRecognition,
    UserCountry,
    UserCountryBatchUpdate,
    UserCountryCreate,
)

router = APIRouter()
logger = logging.getLogger(__name__)

# Module-level country code cache to avoid repeated lookups for static reference data.
# Country table is ~200 rows, so unbounded in-memory caching is acceptable and small.
_country_code_cache: dict[str, tuple[str, datetime]] = {}
_country_code_lock = asyncio.Lock()
CACHE_TTL = timedelta(hours=24)


async def get_country_id_by_code(country_code: str) -> str | None:
    """Resolve a country code to its UUID using an in-memory cache."""
    code = country_code.upper()

    cached = _country_code_cache.get(code)
    if cached:
        country_id, expiry = cached
        if datetime.now(UTC) < expiry:
            return country_id
        # Expired cache entry; remove before refetching
        _country_code_cache.pop(code, None)

    async with _country_code_lock:
        # Re-check inside lock to avoid duplicate fetches.
        cached = _country_code_cache.get(code)
        if cached:
            country_id, expiry = cached
            if datetime.now(UTC) < expiry:
                return country_id
            _country_code_cache.pop(code, None)

        db = get_supabase_client()
        rows = await db.get(
            "country",
            {"code": f"eq.{code}", "select": "id"},
        )
        if not rows:
            return None

        country_id = rows[0]["id"]
        _country_code_cache[code] = (country_id, datetime.now(UTC) + CACHE_TTL)
        return country_id


def clear_country_code_cache() -> None:
    """Clear the country code cache (used after country data changes)."""
    _country_code_cache.clear()
    # No expiry map to clear; entries include their expiry.


def _matches_country_search(row: dict[str, Any], term: str) -> bool:
    """Return True if the country matches the normalized search term."""
    name = (row.get("name") or "").lower()
    code = (row.get("code") or "").lower()
    return term in name or term in code


@router.get("", response_model=list[Country])
async def list_countries(
    search: str | None = Query(
        None, max_length=100, description="Search by name or code"
    ),
    region: str | None = Query(None, description="Filter by region"),
    subregion: str | None = Query(None, description="Filter by subregion"),
    recognition: list[CountryRecognition] | None = Query(
        None, description="Filter by recognition status"
    ),
) -> list[Country]:
    """
    List all countries with optional filtering.

    Countries are public reference data - no auth required.
    """
    # Validate region parameter to prevent injection
    if region and region not in VALID_REGIONS:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Invalid region: '{region}'. Valid regions: {', '.join(sorted(VALID_REGIONS))}",
        )

    # Validate subregion parameter to prevent injection
    if subregion and subregion not in VALID_SUBREGIONS:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Invalid subregion: '{subregion}'",
        )

    db = get_supabase_client()

    normalized_search = search.strip().lower() if search else None

    # Build query params for PostgREST
    params: dict[str, str] = {"select": "*", "order": "name.asc"}

    if region:
        params["region"] = f"eq.{region}"

    if subregion:
        params["subregion"] = f"eq.{subregion}"

    if recognition:
        # Filter by recognition types
        recognition_values = ",".join(r.value for r in recognition)
        params["recognition"] = f"in.({recognition_values})"

    rows = await db.get("country", params)

    if normalized_search:
        rows = [row for row in rows if _matches_country_search(row, normalized_search)]

    return [Country(**row) for row in rows]


@router.get("/regions", response_model=list[str])
async def list_regions() -> list[str]:
    """List all unique regions."""
    db = get_supabase_client()
    params = {"select": "region", "order": "region.asc"}
    rows = await db.get("country", params)
    # Deduplicate
    return list(dict.fromkeys(row["region"] for row in rows))


@router.get("/subregions", response_model=list[str])
async def list_subregions() -> list[str]:
    """List all unique subregions."""
    db = get_supabase_client()
    params = {"select": "subregion", "order": "subregion.asc"}
    rows = await db.get("country", params)
    # Deduplicate and filter out None values
    return list(dict.fromkeys(row["subregion"] for row in rows if row.get("subregion")))


@router.get("/user", response_model=list[UserCountry])
async def get_user_countries(
    request: Request,
    user: CurrentUser,
) -> list[UserCountry]:
    """Get the current user's visited/wishlist countries."""
    token = get_token_from_request(request)
    db = get_supabase_client(user_token=token)
    params = {
        "select": "*, country:country_id(code)",  # Join to get country code
        "user_id": f"eq.{user.id}",
        "order": "created_at.desc",
    }
    rows = await db.get("user_countries", params)
    # Transform to include country_code at top level for frontend
    result = []
    for row in rows:
        country_code = (
            row.get("country", {}).get("code") if row.get("country") else None
        )
        result.append(
            UserCountry(
                id=row["id"],
                user_id=row["user_id"],
                country_id=row["country_id"],
                country_code=country_code or "",
                status=row["status"],
                created_at=row["created_at"],
            )
        )
    return result


@router.post("/user", response_model=UserCountry, status_code=status.HTTP_201_CREATED)
async def set_user_country(
    request: Request,
    data: UserCountryCreate,
    user: CurrentUser,
) -> UserCountry:
    """
    Set a country status for the current user.

    Creates or updates the user-country association.
    """
    token = get_token_from_request(request)
    db = get_supabase_client(user_token=token)

    country_code = data.country_code.upper()
    country_id = await get_country_id_by_code(country_code)

    if not country_id:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Country with code '{data.country_code}' not found",
        )

    # Check if association exists
    existing = await db.get(
        "user_countries",
        {
            "user_id": f"eq.{user.id}",
            "country_id": f"eq.{country_id}",
            "select": "id",
        },
    )

    if existing:
        # Update existing
        rows = await db.patch(
            "user_countries",
            {"status": data.status.value},
            {"id": f"eq.{existing[0]['id']}"},
        )
    else:
        # Create new
        rows = await db.post(
            "user_countries",
            {
                "user_id": user.id,
                "country_id": str(country_id),
                "status": data.status.value,
            },
        )

    if not rows:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Failed to update country status",
        )

    row = rows[0]
    return UserCountry(
        id=row["id"],
        user_id=row["user_id"],
        country_id=row["country_id"],
        country_code=country_code,
        status=row["status"],
        created_at=row["created_at"],
    )


@router.post(
    "/user/batch", response_model=list[UserCountry], status_code=status.HTTP_201_CREATED
)
async def set_user_countries_batch(
    request: Request,
    data: UserCountryBatchUpdate,
    user: CurrentUser,
) -> list[UserCountry]:
    """
    Set multiple country statuses in a single request.

    Creates or updates user-country associations for all provided countries.
    Fails with 400 if any country codes are invalid.
    """
    token = get_token_from_request(request)
    db = get_supabase_client(user_token=token)

    # Validate all country codes upfront
    country_ids: dict[str, str] = {}  # code -> id mapping
    invalid_codes: list[str] = []

    for country_data in data.countries:
        country_code = country_data.country_code.upper()
        if country_code in country_ids:
            continue  # Already validated

        country_id = await get_country_id_by_code(country_code)
        if not country_id:
            invalid_codes.append(country_code)
        else:
            country_ids[country_code] = country_id

    if invalid_codes:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Invalid country codes: {', '.join(invalid_codes)}",
        )

    # Build records for atomic bulk upsert
    records = [
        {
            "user_id": user.id,
            "country_id": str(country_ids[country_data.country_code.upper()]),
            "status": country_data.status.value,
        }
        for country_data in data.countries
    ]

    # Single atomic upsert - all succeed or all fail together
    rows = await db.upsert(
        "user_countries",
        records,
        on_conflict="user_id,country_id",
    )

    if len(rows) != len(records):
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Failed to save all countries",
        )

    # Build response with country codes
    # Create a mapping from country_id to code for efficient lookup
    id_to_code = {v: k for k, v in country_ids.items()}

    results = [
        UserCountry(
            id=row["id"],
            user_id=row["user_id"],
            country_id=row["country_id"],
            country_code=id_to_code.get(row["country_id"], ""),
            status=row["status"],
            created_at=row["created_at"],
        )
        for row in rows
    ]

    return results


@router.delete("/user/by-code/{country_code}", status_code=status.HTTP_204_NO_CONTENT)
async def remove_user_country_by_code(
    request: Request,
    country_code: str,
    user: CurrentUser,
) -> None:
    """Remove a country from the user's visited/wishlist by country code."""
    token = get_token_from_request(request)
    db = get_supabase_client(user_token=token)

    try:
        country_id = await get_country_id_by_code(country_code)
    except TimeoutError as exc:
        logger.warning("Timeout looking up country code %s", country_code, exc_info=exc)
        raise HTTPException(
            status_code=status.HTTP_504_GATEWAY_TIMEOUT,
            detail="Country lookup timed out",
        ) from exc
    except Exception as exc:  # noqa: BLE001
        logger.exception("Error looking up country code %s", country_code)
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail="Country lookup failed",
        ) from exc

    if not country_id:
        # Country not found, but return 204 for idempotency
        return

    await db.delete(
        "user_countries",
        {"user_id": f"eq.{user.id}", "country_id": f"eq.{country_id}"},
    )


@router.delete("/user/{country_id}", status_code=status.HTTP_204_NO_CONTENT)
async def remove_user_country(
    request: Request,
    country_id: str,
    user: CurrentUser,
) -> None:
    """Remove a country from the user's visited/wishlist by country UUID."""
    token = get_token_from_request(request)
    db = get_supabase_client(user_token=token)
    await db.delete(
        "user_countries",
        {"user_id": f"eq.{user.id}", "country_id": f"eq.{country_id}"},
    )
