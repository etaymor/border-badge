"""Public web page endpoints (HTML rendering)."""

import asyncio
import datetime
import html
import logging
from typing import Any

from fastapi import APIRouter, HTTPException, Path, Request, status
from fastapi.responses import HTMLResponse, PlainTextResponse

from app.api.utils import get_flag_emoji
from app.core.analytics import (
    log_landing_viewed,
    log_list_viewed,
    log_profile_viewed,
    log_trip_viewed,
)
from app.core.config import get_settings
from app.core.media import extract_media_urls
from app.core.seo import (
    build_landing_seo,
    build_list_seo,
    build_profile_seo,
    build_trip_seo,
)
from app.core.urls import safe_google_photo_url
from app.db.session import get_supabase_client
from app.main import limiter, templates
from app.schemas.classification import MAX_COUNTRIES
from app.schemas.lists import PublicListEntry, PublicListView
from app.schemas.public import (
    PublicProfileStats,
    PublicProfileView,
    PublicTripEntry,
    PublicTripView,
)
from app.services.affiliate_links import (
    build_redirect_url,
    get_or_create_link_for_entry,
)

logger = logging.getLogger(__name__)


def get_current_year() -> int:
    """Get current year for template footer."""
    return datetime.datetime.now(datetime.UTC).year


router = APIRouter(tags=["public"])


async def _generate_entry_redirect_url(
    entry_id: str,
    destination_url: str | None,
    trip_id: str | None,
    source: str,
) -> str | None:
    """Generate a signed redirect URL for an entry.

    Creates an outbound_link if needed, then builds signed redirect URL.
    Returns None if no valid destination URL.

    Args:
        entry_id: UUID of the entry
        destination_url: The destination URL (entry.link or Google Maps fallback)
        trip_id: Optional trip UUID for analytics context
        source: Click source ("list_share" or "trip_share")

    Returns:
        Signed redirect URL, or None if no destination URL provided
    """
    if not destination_url:
        return None

    try:
        link = await get_or_create_link_for_entry(entry_id, destination_url)
        base_url = get_settings().base_url

        return build_redirect_url(
            base_url=base_url,
            link_id=str(link.id),
            trip_id=trip_id,
            entry_id=entry_id,
            source=source,
        )
    except Exception as e:
        # Log but don't fail - graceful degradation to original URL
        logger.warning(f"Failed to generate redirect URL for entry {entry_id}: {e}")
        return None


def _extract_place_photo_url(place: dict[str, Any] | list | None) -> str | None:
    """Pull google_photo_url out of place.extra_data if present and validate it.

    Uses safe_google_photo_url() to validate URLs against a whitelist of
    known Google photo-serving domains for SSRF protection.
    """
    if not place:
        return None
    # PostgREST may return place as array or dict depending on relationship type
    if isinstance(place, list):
        place = place[0]  # List is guaranteed non-empty by line 101
    if not isinstance(place, dict):
        return None
    extra_data = place.get("extra_data")
    if not isinstance(extra_data, dict):
        return None
    photo_url = extra_data.get("google_photo_url")
    if not isinstance(photo_url, str) or not photo_url:
        return None
    # Validate URL with Google domain whitelist for SSRF protection
    return safe_google_photo_url(photo_url)


@router.get("/", response_class=HTMLResponse)
@limiter.limit("60/minute")
async def landing_page(request: Request) -> HTMLResponse:
    """Render the public landing page."""
    settings = get_settings()
    log_landing_viewed()

    seo = build_landing_seo(settings.base_url)

    response = templates.TemplateResponse(
        request=request,
        name="landing.html",
        context={
            "app_store_url": settings.app_store_url,
            "google_analytics_id": settings.google_analytics_id,
            "og_title": seo.og_title,
            "og_description": seo.og_description,
            "og_url": seo.canonical_url,
            "canonical_url": seo.canonical_url,
            "has_hero": True,
            "current_year": get_current_year(),
        },
    )
    response.headers["Cache-Control"] = "public, max-age=3600"
    return response


@router.get("/u/{username}", response_class=HTMLResponse)
@limiter.limit("60/minute")
async def view_public_profile(
    request: Request,
    username: str = Path(..., min_length=3, max_length=30, pattern=r"^[a-zA-Z0-9_]+$"),
) -> HTMLResponse:
    """Render a public profile page by username."""
    settings = get_settings()
    db = get_supabase_client()

    # Fetch profile by username (case-insensitive)
    # Note: username is pre-validated by FastAPI Path() with pattern=r"^[a-zA-Z0-9_]+$"
    # before reaching this point. The ilike operator with alphanumeric input is safe.
    profiles = await db.get(
        "user_profile",
        {
            "username": f"ilike.{username}",
            "select": "user_id, username, display_name, avatar_url, home_country_code, created_at",
        },
    )

    if not profiles:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="User not found",
        )

    profile = profiles[0]
    user_id = profile["user_id"]
    log_profile_viewed(profile["username"])

    # Fetch all data in parallel using RPC for stats aggregation
    # The RPC returns country/continent/subregion counts plus follower/following counts
    stats_task = db.rpc("get_public_profile_stats", {"p_user_id": str(user_id)})

    # Get home country name if set
    home_country_task = None
    if profile.get("home_country_code"):
        home_country_task = db.get(
            "country",
            {
                "code": f"eq.{profile['home_country_code']}",
                "select": "name",
            },
        )

    # Execute all queries in parallel
    if home_country_task:
        stats_result, home_country_rows = await asyncio.gather(
            stats_task, home_country_task
        )
        home_country_name = (
            home_country_rows[0].get("name")
            if home_country_rows and len(home_country_rows) > 0
            else None
        )
    else:
        stats_result = await stats_task
        home_country_name = None

    # Extract stats from RPC result (includes follower/following counts)
    if stats_result and len(stats_result) > 0:
        stats_row = stats_result[0]
        country_count = stats_row.get("country_count", 0)
        continent_count = stats_row.get("continent_count", 0)
        subregion_count = stats_row.get("subregion_count", 0)
        follower_count = stats_row.get("follower_count", 0)
        following_count = stats_row.get("following_count", 0)
    else:
        logger.debug(
            "get_public_profile_stats returned empty result for user %s", user_id
        )
        country_count = 0
        continent_count = 0
        subregion_count = 0
        follower_count = 0
        following_count = 0
    world_percentage = (country_count / MAX_COUNTRIES) * 100 if MAX_COUNTRIES > 0 else 0

    stats = PublicProfileStats(
        country_count=country_count,
        continent_count=continent_count,
        subregion_count=subregion_count,
        world_percentage=round(world_percentage, 1),
    )

    profile_view = PublicProfileView(
        username=profile["username"],
        display_name=profile["display_name"],
        avatar_url=profile.get("avatar_url"),
        home_country_code=profile.get("home_country_code"),
        home_country_name=home_country_name,
        stats=stats,
        follower_count=follower_count,
        following_count=following_count,
        created_at=profile["created_at"],
    )

    seo = build_profile_seo(
        username=profile_view.username,
        display_name=profile_view.display_name,
        country_count=stats.country_count,
        world_percentage=stats.world_percentage,
        base_url=settings.base_url,
        avatar_url=profile_view.avatar_url,
    )

    response = templates.TemplateResponse(
        request=request,
        name="profile_public.html",
        context={
            "profile": profile_view,
            "app_store_url": settings.app_store_url,
            "google_analytics_id": settings.google_analytics_id,
            "og_title": seo.og_title,
            "og_description": seo.og_description,
            "og_url": seo.canonical_url,
            "og_image": seo.og_image,
            "canonical_url": seo.canonical_url,
            "has_hero": True,
            "current_year": get_current_year(),
        },
    )
    response.headers["Cache-Control"] = "public, max-age=300, stale-while-revalidate=60"
    return response


@router.get("/l/{slug}", response_class=HTMLResponse)
@limiter.limit("60/minute")
async def view_public_list(
    request: Request,
    slug: str = Path(..., min_length=1, max_length=100, pattern=r"^[a-z0-9-]+$"),
) -> HTMLResponse:
    """Render a public list page by slug."""
    settings = get_settings()
    db = get_supabase_client()

    # Fetch list by slug (all lists are public)
    lists = await db.get(
        "list",
        {
            "slug": f"eq.{slug}",
            "deleted_at": "is.null",
            "select": "*, trip:trip_id(name, cover_image_url, country:country_id(name, code))",
        },
    )

    if not lists:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="List not found",
        )

    lst = lists[0]
    log_list_viewed(slug)

    # Fetch entries with details including media
    entry_rows = await db.get(
        "list_entries",
        {
            "list_id": f"eq.{lst['id']}",
            "select": "*, entry:entry_id(id, title, type, notes, link, place:place(place_name, address, google_place_id, lat, lng, extra_data), media_files(file_path, thumbnail_path, status))",
            "order": "position.asc",
            "limit": 50,  # Limit entries for public view
        },
    )

    # Get trip_id for redirect URLs (if list is associated with a trip)
    trip_id = lst.get("trip_id")

    entries: list[PublicListEntry] = []
    for row in entry_rows:
        entry = row.get("entry", {})
        if entry:
            place_raw = entry.get("place")
            # PostgREST may return place as array or dict
            if isinstance(place_raw, list):
                place = place_raw[0] if place_raw else {}
            else:
                place = place_raw if place_raw else {}
            entry_id = entry.get("id")

            # Build destination URL: entry.link → Google Maps with coords → Google Maps with place_id
            entry_link = entry.get("link")
            lat = place.get("lat")
            lng = place.get("lng")
            google_place_id = place.get("google_place_id")

            if entry_link:
                destination_url = entry_link
            elif lat and lng:
                destination_url = (
                    f"https://www.google.com/maps/search/?api=1&query={lat},{lng}"
                )
            elif google_place_id:
                destination_url = f"https://www.google.com/maps/search/?api=1&query_place_id={google_place_id}"
            else:
                destination_url = None

            # Generate signed redirect URL for affiliate tracking
            redirect_url = await _generate_entry_redirect_url(
                entry_id=str(entry_id),
                destination_url=destination_url,
                trip_id=str(trip_id) if trip_id else None,
                source="list_share",
            )

            entries.append(
                PublicListEntry(
                    id=entry_id,
                    title=entry.get("title"),
                    type=entry.get("type"),
                    notes=entry.get("notes"),
                    link=entry_link,
                    place_name=place.get("place_name"),
                    address=place.get("address"),
                    google_place_id=google_place_id,
                    latitude=lat,
                    longitude=lng,
                    media_urls=extract_media_urls(entry.get("media_files")),
                    place_photo_url=_extract_place_photo_url(place),
                    redirect_url=redirect_url,
                )
            )

    trip = lst.get("trip", {}) or {}
    country = trip.get("country", {}) or {}

    list_view = PublicListView(
        id=lst["id"],
        name=lst["name"],
        slug=lst["slug"],
        description=lst.get("description"),
        trip_name=trip.get("name"),
        country_name=country.get("name"),
        country_flag=get_flag_emoji(country.get("code")),
        cover_image_url=trip.get("cover_image_url"),
        created_at=lst["created_at"],
        entries=entries,
    )

    seo = build_list_seo(
        list_name=list_view.name,
        list_slug=list_view.slug,
        description=list_view.description,
        country_name=list_view.country_name,
        base_url=settings.base_url,
        cover_image_url=list_view.cover_image_url,
    )

    response = templates.TemplateResponse(
        request=request,
        name="list_public.html",
        context={
            "list": list_view,
            "app_store_url": settings.app_store_url,
            "google_analytics_id": settings.google_analytics_id,
            "og_title": seo.og_title,
            "og_description": seo.og_description,
            "og_url": seo.canonical_url,
            "og_image": seo.og_image,
            "canonical_url": seo.canonical_url,
            "has_hero": True,
            "current_year": get_current_year(),
        },
    )
    response.headers["Cache-Control"] = "public, max-age=300, stale-while-revalidate=60"
    return response


@router.get("/t/{slug}", response_class=HTMLResponse)
@limiter.limit("60/minute")
async def view_public_trip(
    request: Request,
    slug: str = Path(..., min_length=1, max_length=100, pattern=r"^[a-z0-9-]+$"),
) -> HTMLResponse:
    """Render a public trip page by share slug."""
    settings = get_settings()
    db = get_supabase_client()

    # Fetch trip by share_slug
    trips = await db.get(
        "trip",
        {
            "share_slug": f"eq.{slug}",
            "deleted_at": "is.null",
            "select": "*, country:country_id(name, code)",
        },
    )

    if not trips:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Trip not found",
        )

    trip = trips[0]
    log_trip_viewed(slug)

    # Fetch entries with details including media and link/place data for redirects
    entry_rows = await db.get(
        "entry",
        {
            "trip_id": f"eq.{trip['id']}",
            "deleted_at": "is.null",
            "select": "id, title, type, notes, link, place:place(place_name, address, google_place_id, lat, lng, extra_data), media_files(file_path, thumbnail_path, status)",
            "order": "created_at.desc",
        },
    )

    trip_id = trip["id"]

    entries: list[PublicTripEntry] = []
    for entry in entry_rows:
        place_raw = entry.get("place")
        # PostgREST may return place as array or dict
        if isinstance(place_raw, list):
            place = place_raw[0] if place_raw else {}
        else:
            place = place_raw if place_raw else {}
        entry_id = entry.get("id")

        # Build destination URL: entry.link → Google Maps with coords → Google Maps with place_id
        entry_link = entry.get("link")
        lat = place.get("lat")
        lng = place.get("lng")
        google_place_id = place.get("google_place_id")

        if entry_link:
            destination_url = entry_link
        elif lat and lng:
            destination_url = (
                f"https://www.google.com/maps/search/?api=1&query={lat},{lng}"
            )
        elif google_place_id:
            destination_url = f"https://www.google.com/maps/search/?api=1&query_place_id={google_place_id}"
        else:
            destination_url = None

        # Generate signed redirect URL for affiliate tracking
        redirect_url = await _generate_entry_redirect_url(
            entry_id=str(entry_id),
            destination_url=destination_url,
            trip_id=str(trip_id),
            source="trip_share",
        )

        entries.append(
            PublicTripEntry(
                id=entry_id,
                type=entry.get("type"),
                title=entry.get("title"),
                notes=entry.get("notes"),
                place_name=place.get("place_name"),
                address=place.get("address"),
                media_urls=extract_media_urls(entry.get("media_files")),
                place_photo_url=_extract_place_photo_url(place),
                redirect_url=redirect_url,
            )
        )

    country = trip.get("country", {}) or {}

    trip_view = PublicTripView(
        id=trip["id"],
        name=trip["name"],
        share_slug=trip["share_slug"],
        country_name=country.get("name", ""),
        country_code=country.get("code", ""),
        cover_image_url=trip.get("cover_image_url"),
        date_range=trip.get("date_range"),
        created_at=trip["created_at"],
        entries=entries,
    )

    seo = build_trip_seo(
        trip_name=trip_view.name,
        share_slug=trip_view.share_slug,
        country_name=trip_view.country_name,
        base_url=settings.base_url,
        cover_image_url=trip_view.cover_image_url,
    )

    response = templates.TemplateResponse(
        request=request,
        name="trip_public.html",
        context={
            "trip": trip_view,
            "app_store_url": settings.app_store_url,
            "google_analytics_id": settings.google_analytics_id,
            "og_title": seo.og_title,
            "og_description": seo.og_description,
            "og_url": seo.canonical_url,
            "og_image": seo.og_image,
            "canonical_url": seo.canonical_url,
            "has_hero": True,
            "current_year": get_current_year(),
        },
    )
    response.headers["Cache-Control"] = "public, max-age=300, stale-while-revalidate=60"
    return response


@router.get("/privacy", response_class=HTMLResponse)
@limiter.limit("60/minute")
async def privacy_policy(request: Request) -> HTMLResponse:
    """Render the privacy policy page."""
    settings = get_settings()

    response = templates.TemplateResponse(
        request=request,
        name="privacy.html",
        context={
            "app_store_url": settings.app_store_url,
            "google_analytics_id": settings.google_analytics_id,
            "og_title": "Privacy Policy - Atlasi",
            "og_description": "Privacy Policy for the Atlasi travel tracking application",
            "current_year": get_current_year(),
        },
    )
    response.headers["Cache-Control"] = "public, max-age=86400"
    return response


@router.get("/terms", response_class=HTMLResponse)
@limiter.limit("60/minute")
async def terms_conditions(request: Request) -> HTMLResponse:
    """Render the terms and conditions page."""
    settings = get_settings()

    response = templates.TemplateResponse(
        request=request,
        name="terms.html",
        context={
            "app_store_url": settings.app_store_url,
            "google_analytics_id": settings.google_analytics_id,
            "og_title": "Terms & Conditions - Atlasi",
            "og_description": "Terms and Conditions for the Atlasi travel tracking application",
            "current_year": get_current_year(),
        },
    )
    response.headers["Cache-Control"] = "public, max-age=86400"
    return response


@router.get("/robots.txt", response_class=PlainTextResponse)
async def robots_txt() -> PlainTextResponse:
    """Return robots.txt for search engines."""
    settings = get_settings()
    content = f"""User-agent: *
Allow: /
Allow: /l/
Allow: /t/
Allow: /u/

Sitemap: {settings.base_url}/sitemap.xml
"""
    return PlainTextResponse(content=content, media_type="text/plain")


@router.get("/sitemap.xml", response_class=PlainTextResponse)
async def sitemap_xml() -> PlainTextResponse:
    """Generate sitemap.xml for search engines."""
    settings = get_settings()
    db = get_supabase_client()

    urls = [f"  <url><loc>{settings.base_url}</loc></url>"]

    # All user profiles
    profiles = await db.get(
        "user_profile",
        {
            "select": "username",
        },
    )
    for profile in profiles:
        escaped_username = html.escape(profile["username"])
        urls.append(f"  <url><loc>{settings.base_url}/u/{escaped_username}</loc></url>")

    # All lists (all lists are public)
    lists = await db.get(
        "list",
        {
            "deleted_at": "is.null",
            "select": "slug",
        },
    )
    for lst in lists:
        escaped_slug = html.escape(lst["slug"])
        urls.append(f"  <url><loc>{settings.base_url}/l/{escaped_slug}</loc></url>")

    # Public trips
    trips = await db.get(
        "trip",
        {
            "share_slug": "not.is.null",
            "deleted_at": "is.null",
            "select": "share_slug",
        },
    )
    for trip in trips:
        escaped_slug = html.escape(trip["share_slug"])
        urls.append(f"  <url><loc>{settings.base_url}/t/{escaped_slug}</loc></url>")

    content = f"""<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
{chr(10).join(urls)}
</urlset>"""

    response = PlainTextResponse(content=content, media_type="application/xml")
    response.headers["Cache-Control"] = "public, max-age=3600"
    return response
