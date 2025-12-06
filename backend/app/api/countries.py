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
    UserCountryBatchUpdate,
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
        "select": "*, country:country_id(code)",  # Join to get country code
        "user_id": f"eq.{user.id}",
        "order": "created_at.desc",
    }
    rows = await db.get("user_countries", params)
    # Transform to include country_code at top level for frontend
    result = []
    for row in rows:
        country_code = row.get("country", {}).get("code") if row.get("country") else None
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

    # Look up country by code to get the UUID
    country_rows = await db.get(
        "country",
        {
            "code": f"eq.{data.country_code.upper()}",
            "select": "id",
        },
    )
    if not country_rows:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Country with code '{data.country_code}' not found",
        )
    country_id = country_rows[0]["id"]
    country_code = data.country_code.upper()

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


@router.post("/user/batch", response_model=list[UserCountry], status_code=status.HTTP_201_CREATED)
async def set_user_countries_batch(
    request: Request,
    data: UserCountryBatchUpdate,
    user: CurrentUser,
) -> list[UserCountry]:
    """
    Set multiple country statuses in a single request.

    Creates or updates user-country associations for all provided countries.
    """
    token = get_token_from_request(request)
    db = get_supabase_client(user_token=token)

    results: list[UserCountry] = []

    for country_data in data.countries:
        country_code = country_data.country_code.upper()

        # Look up country UUID
        country_rows = await db.get(
            "country",
            {"code": f"eq.{country_code}", "select": "id"},
        )
        if not country_rows:
            continue  # Skip unknown countries

        country_id = country_rows[0]["id"]

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
                {"status": country_data.status.value},
                {"id": f"eq.{existing[0]['id']}"},
            )
        else:
            # Create new
            rows = await db.post(
                "user_countries",
                {
                    "user_id": user.id,
                    "country_id": str(country_id),
                    "status": country_data.status.value,
                },
            )

        if rows:
            row = rows[0]
            results.append(
                UserCountry(
                    id=row["id"],
                    user_id=row["user_id"],
                    country_id=row["country_id"],
                    country_code=country_code,
                    status=row["status"],
                    created_at=row["created_at"],
                )
            )

    return results


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
