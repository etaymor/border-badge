"""Shared utilities for trip-related endpoints."""

from datetime import date
from typing import Any

from fastapi import HTTPException, status

from app.db.session import SupabaseClient
from app.schemas.trips import Trip


def format_daterange(start: date | None, end: date | None) -> str | None:
    """Format start/end dates as a PostgreSQL daterange literal.

    - Returns ``None`` when both bounds are missing (no date range).
    - Supports open-ended ranges when only one bound is provided.
    - Validates that the start date is not after the end date.
    """
    if start is None and end is None:
        return None

    if start is not None and end is not None:
        if start > end:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="date_start must be on or before date_end",
            )
        return f"[{start.isoformat()},{end.isoformat()}]"

    if start is not None:
        # Open-ended range going forward in time
        return f"[{start.isoformat()},infinity]"

    # Only end is provided: open-ended range going back in time
    return f"[-infinity,{end.isoformat()}]"


def trip_from_row(row: dict[str, Any]) -> Trip:
    """Convert a database row with embedded country to a Trip model.

    Expects the row to have a 'country' key with {'code': ...} from a join.
    """
    country_code = row.get("country", {}).get("code", "") if row.get("country") else ""
    return Trip(
        **{k: v for k, v in row.items() if k != "country"},
        country_code=country_code,
    )


async def verify_trip_ownership(
    db: SupabaseClient,
    trip_id: str,
    user_id: str,
    select: str = "id",
) -> dict[str, Any]:
    """Verify that a user owns a trip and return trip data.

    Raises HTTPException 404 if trip not found or user doesn't own it.
    """
    trips = await db.get(
        "trip",
        {"id": f"eq.{trip_id}", "user_id": f"eq.{user_id}", "select": select},
    )
    if not trips:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Trip not found or not authorized",
        )
    return trips[0]
