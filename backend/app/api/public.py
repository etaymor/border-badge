"""Public web page endpoints (HTML rendering)."""

import html
import logging
from typing import Any

from fastapi import APIRouter, HTTPException, Path, Request, status
from fastapi.responses import HTMLResponse, PlainTextResponse

from app.api.utils import get_flag_emoji
from app.core.analytics import log_landing_viewed, log_list_viewed, log_trip_viewed
from app.core.config import get_settings
from app.core.media import extract_media_urls
from app.core.seo import build_landing_seo, build_list_seo, build_trip_seo
from app.core.urls import safe_google_photo_url
from app.db.session import get_supabase_client
from app.main import limiter, templates
from app.schemas.lists import PublicListEntry, PublicListView
from app.schemas.public import PublicTripEntry, PublicTripView

logger = logging.getLogger(__name__)

router = APIRouter(tags=["public"])


def _extract_place_photo_url(place: dict[str, Any] | None) -> str | None:
    """Pull google_photo_url out of place.extra_data if present and validate it.

    Uses safe_google_photo_url() to validate URLs against a whitelist of
    known Google photo-serving domains for SSRF protection.
    """
    if not place:
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
        },
    )
    response.headers["Cache-Control"] = "public, max-age=3600"
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

    entries: list[PublicListEntry] = []
    for row in entry_rows:
        entry = row.get("entry", {})
        if entry:
            place = entry.get("place", {}) if entry.get("place") else {}
            entries.append(
                PublicListEntry(
                    id=entry.get("id"),
                    title=entry.get("title"),
                    type=entry.get("type"),
                    notes=entry.get("notes"),
                    link=entry.get("link"),
                    place_name=place.get("place_name"),
                    address=place.get("address"),
                    google_place_id=place.get("google_place_id"),
                    latitude=place.get("lat"),
                    longitude=place.get("lng"),
                    media_urls=extract_media_urls(entry.get("media_files")),
                    place_photo_url=_extract_place_photo_url(place),
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

    # Fetch entries with details including media
    entry_rows = await db.get(
        "entry",
        {
            "trip_id": f"eq.{trip['id']}",
            "deleted_at": "is.null",
            "select": "id, title, type, notes, place:place(place_name, address, extra_data), media_files(file_path, thumbnail_path, status)",
            "order": "created_at.desc",
        },
    )

    entries: list[PublicTripEntry] = []
    for entry in entry_rows:
        place = entry.get("place", {}) if entry.get("place") else {}
        entries.append(
            PublicTripEntry(
                id=entry.get("id"),
                type=entry.get("type"),
                title=entry.get("title"),
                notes=entry.get("notes"),
                place_name=place.get("place_name"),
                address=place.get("address"),
                media_urls=extract_media_urls(entry.get("media_files")),
                place_photo_url=_extract_place_photo_url(place),
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
        },
    )
    response.headers["Cache-Control"] = "public, max-age=300, stale-while-revalidate=60"
    return response


@router.get("/robots.txt", response_class=PlainTextResponse)
async def robots_txt() -> PlainTextResponse:
    """Return robots.txt for search engines."""
    settings = get_settings()
    content = f"""User-agent: *
Allow: /
Allow: /l/
Allow: /t/

Sitemap: {settings.base_url}/sitemap.xml
"""
    return PlainTextResponse(content=content, media_type="text/plain")


@router.get("/sitemap.xml", response_class=PlainTextResponse)
async def sitemap_xml() -> PlainTextResponse:
    """Generate sitemap.xml for search engines."""
    settings = get_settings()
    db = get_supabase_client()

    urls = [f"  <url><loc>{settings.base_url}</loc></url>"]

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
