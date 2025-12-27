"""Database operations for seeding."""

from datetime import datetime, timedelta
from typing import Any

from app.db.session import SupabaseClient


async def get_country_id(db: SupabaseClient, country_code: str) -> str:
    """Get country UUID from ISO code."""
    result = await db.get("country", {"code": f"eq.{country_code}", "select": "id"})
    if not result:
        raise Exception(f"Country {country_code} not found")
    return result[0]["id"]


async def update_profile(db: SupabaseClient, user_id: str, data: dict[str, Any]) -> None:
    """Update user_profile."""
    await db.patch("user_profile", data, {"user_id": f"eq.{user_id}"})


async def create_trip(
    db: SupabaseClient,
    user_id: str,
    country_id: str,
    name: str,
    date_start: Any,
    date_end: Any,
) -> str:
    """Create trip, return ID."""
    result = await db.post(
        "trip",
        {
            "user_id": user_id,
            "country_id": country_id,
            "name": name,
            "date_range": f"[{date_start.isoformat()},{date_end.isoformat()}]",
        },
    )
    return result[0]["id"]


async def create_entry(
    db: SupabaseClient,
    trip_id: str,
    entry_type: str,
    title: str,
    notes: str,
    entry_date: datetime,
) -> str:
    """Create entry, return ID."""
    result = await db.post(
        "entry",
        {
            "trip_id": trip_id,
            "type": entry_type,
            "title": title,
            "notes": notes,
            "date": entry_date.isoformat(),
        },
    )
    return result[0]["id"]


async def create_user_country(
    db: SupabaseClient, user_id: str, country_id: str, status: str = "visited"
) -> None:
    """Mark country as visited."""
    try:
        await db.post(
            "user_countries",
            {"user_id": user_id, "country_id": country_id, "status": status},
        )
    except Exception as e:
        if "duplicate" not in str(e).lower() and "23505" not in str(e):
            raise


async def create_follow(db: SupabaseClient, follower_id: str, following_id: str) -> None:
    """Create follow relationship."""
    try:
        await db.post(
            "user_follow",
            {"follower_id": follower_id, "following_id": following_id},
        )
    except Exception as e:
        if "duplicate" not in str(e).lower() and "23505" not in str(e):
            raise


async def create_trip_tag(
    db: SupabaseClient,
    trip_id: str,
    tagged_user_id: str,
    status: str = "approved",
    initiated_by: str | None = None,
) -> None:
    """Tag user on trip."""
    try:
        data: dict[str, Any] = {
            "trip_id": trip_id,
            "tagged_user_id": tagged_user_id,
            "status": status,
        }
        if initiated_by:
            data["initiated_by"] = initiated_by
        if status in ("approved", "declined"):
            data["responded_at"] = datetime.now().isoformat()
        await db.post("trip_tags", data)
    except Exception as e:
        if "duplicate" not in str(e).lower() and "23505" not in str(e):
            raise


async def seed_trips_for_user(
    db: SupabaseClient,
    user_id: str,
    trips: list[dict],
) -> list[str]:
    """Create trips and entries for a user. Returns trip IDs."""
    trip_ids = []
    countries_visited = set()

    for trip_config in trips:
        country_id = await get_country_id(db, trip_config["country_code"])
        countries_visited.add(country_id)

        trip_id = await create_trip(
            db,
            user_id=user_id,
            country_id=country_id,
            name=trip_config["name"],
            date_start=trip_config["date_start"],
            date_end=trip_config["date_end"],
        )
        trip_ids.append(trip_id)

        # Create entries
        entry_date = datetime.combine(trip_config["date_start"], datetime.min.time())
        for entry in trip_config.get("entries", []):
            await create_entry(
                db,
                trip_id=trip_id,
                entry_type=entry["type"],
                title=entry["title"],
                notes=entry["notes"],
                entry_date=entry_date,
            )
            entry_date += timedelta(days=1)

    # Mark countries as visited
    for country_id in countries_visited:
        await create_user_country(db, user_id, country_id)

    return trip_ids
