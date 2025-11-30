"""Country and user_countries endpoints."""

from typing import Any

from fastapi import APIRouter, HTTPException, Query, Request, status

from app.api.utils import get_token_from_request
from app.core.security import CurrentUser
from app.db.session import get_supabase_client
from app.schemas.countries import (
    Country,
    CountryRecognition,
    UserCountry,
    UserCountryCreate,
)

router = APIRouter()


def _matches_country_search(row: dict[str, Any], term: str) -> bool:
    """Return True if the country matches the normalized search term."""
    name = (row.get("name") or "").lower()
    code = (row.get("code") or "").lower()
    return term in name or term in code


@router.get("", response_model=list[Country])
async def list_countries(
    search: str | None = Query(None, description="Search by name or code"),
    region: str | None = Query(None, description="Filter by region"),
    recognition: list[CountryRecognition] | None = Query(
        None, description="Filter by recognition status"
    ),
) -> list[Country]:
    """
    List all countries with optional filtering.

    Countries are public reference data - no auth required.
    """
    db = get_supabase_client()

    normalized_search = search.strip().lower() if search else None

    # Build query params for PostgREST
    params: dict[str, str] = {"select": "*", "order": "name.asc"}

    if region:
        params["region"] = f"eq.{region}"

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


@router.get("/user", response_model=list[UserCountry])
async def get_user_countries(
    request: Request,
    user: CurrentUser,
) -> list[UserCountry]:
    """Get the current user's visited/wishlist countries."""
    token = get_token_from_request(request)
    db = get_supabase_client(user_token=token)
    params = {
        "select": "*",
        "user_id": f"eq.{user.id}",
        "order": "created_at.desc",
    }
    rows = await db.get("user_countries", params)
    return [UserCountry(**row) for row in rows]


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

    # Check if association exists
    existing = await db.get(
        "user_countries",
        {
            "user_id": f"eq.{user.id}",
            "country_id": f"eq.{data.country_id}",
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
                "country_id": str(data.country_id),
                "status": data.status.value,
            },
        )

    if not rows:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Failed to update country status",
        )

    return UserCountry(**rows[0])


@router.delete("/user/{country_id}", status_code=status.HTTP_204_NO_CONTENT)
async def remove_user_country(
    request: Request,
    country_id: str,
    user: CurrentUser,
) -> None:
    """Remove a country from the user's visited/wishlist."""
    token = get_token_from_request(request)
    db = get_supabase_client(user_token=token)
    await db.delete(
        "user_countries",
        {"user_id": f"eq.{user.id}", "country_id": f"eq.{country_id}"},
    )
