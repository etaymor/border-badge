"""Public web page endpoints (HTML rendering)."""

import asyncio
import datetime
import html
import logging
import re
from typing import Any
from uuid import UUID

from fastapi import APIRouter, Form, HTTPException, Path, Request, status
from fastapi.responses import (
    HTMLResponse,
    PlainTextResponse,
    RedirectResponse,
    Response,
)

from app.api.utils import get_flag_emoji
from app.core.analytics import log_landing_viewed, log_list_viewed, log_trip_viewed
from app.core.blog import get_registry
from app.core.config import get_settings
from app.core.kml import KML_MEDIA_TYPE, Placemark, build_kml
from app.core.media import (
    AVATAR_WIDTH,
    ENTRY_IMAGE_WIDTH,
    HERO_COVER_WIDTH,
    build_media_url,
    extract_media_urls,
    media_url,
    resize_stored_url,
)
from app.core.seo import (
    LANDING_FAQS,
    build_landing_seo,
    build_landing_structured_data,
    build_list_seo,
    build_share_structured_data,
    build_static_page_seo,
    build_trip_seo,
    seo_context,
)
from app.core.share_view import CATEGORY_STYLES, build_share_view_model, category_style
from app.core.urls import (
    google_maps_place_url,
    safe_external_url,
    safe_google_photo_url,
)
from app.db.session import SupabaseClient, get_supabase_client
from app.main import limiter, templates
from app.schemas.lists import PublicListEntry, PublicListView
from app.schemas.public import PublicTripEntry, PublicTripView
from app.schemas.share import ShareAuthor
from app.services.affiliate_links import (
    build_redirect_url,
    get_or_create_link_for_entry,
)
from app.services.email import cancel_scheduled_emails, send_contact_email
from app.services.turnstile import verify_turnstile_token

logger = logging.getLogger(__name__)


def get_current_year() -> int:
    """Get current year for template footer."""
    return datetime.datetime.now(datetime.UTC).year


router = APIRouter(tags=["public"])

# How many entries a public list surfaces. Shared by the page and the KML export
# so the download can never be a silent subset of what the visitor just saw --
# the two are separate queries against separate caches, and only a shared
# constant keeps them honest. Public *trips* are capped on neither surface.
PUBLIC_LIST_ENTRY_LIMIT = 50


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


def _entry_place(entry: dict[str, Any]) -> dict[str, Any]:
    """Read an entry row's embedded `place` as a dict.

    PostgREST returns an embedded relationship as an object or as a
    single-element array depending on how it resolves the foreign key, and both
    shapes reach us. Missing, null and empty-array all mean "no place", which
    callers handle by `.get()`ing their way to `None` -- so an empty dict is the
    right answer rather than `None`.
    """
    place = entry.get("place")
    if isinstance(place, list):
        return place[0] if place else {}
    return place or {}


def _extract_place_photo_url(place: dict[str, Any] | list | None) -> str | None:
    """Pull google_photo_url out of place.extra_data if present and validate it.

    Uses safe_google_photo_url() to validate URLs against a whitelist of
    known Google photo-serving domains for SSRF protection.
    """
    if not place:
        return None
    # PostgREST may return place as array or dict depending on relationship type
    if isinstance(place, list):
        place = place[0] if place else None
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


def _avatar_url(stored: str | None) -> str | None:
    """Resolve `user_profile.avatar_url` to something an `<img src>` can use.

    The column holds whatever `handle_new_user()` copied out of the OAuth
    metadata -- in practice an absolute, Google-hosted URL
    (`lh3.googleusercontent.com/...`), which is already avatar-sized and is
    *not* an object in our storage bucket. Pushing that through the storage
    render endpoint would yield a 404, so absolute URLs pass through unchanged.

    The column is a bare TEXT, though, and an in-app avatar upload would write a
    bucket-relative path instead. That form is resized to `AVATAR_WIDTH` (R13:
    never serve an image bigger than it is displayed at).

    Anything that is neither -- a `javascript:` payload, say -- yields None, and
    the byline falls back to the name alone.
    """
    if not stored:
        return None

    candidate = stored.strip()
    if not candidate:
        return None

    # Anything carrying a scheme is treated as absolute and must survive
    # `safe_external_url` (http/https only). Checking for *any* ":" -- not just
    # "://" -- is what keeps `javascript:alert(1)` out of the storage-path
    # branch, where it would otherwise be pasted into a render URL.
    if ":" in candidate:
        return safe_external_url(candidate)

    return media_url(candidate.lstrip("/"), width=AVATAR_WIDTH)


async def _fetch_share_author(db: SupabaseClient, owner_id: str) -> ShareAuthor | None:
    """Byline data for the owner of a shared list or trip.

    R7: "Shared by Maya - 31 countries visited". Two cheap indexed lookups --
    the profile row, and the owner's visited countries (which
    `idx_user_countries_user_status` covers) -- issued concurrently, so the
    byline costs one round-trip of latency rather than two.

    The byline is social proof, not content: a page whose owner has no profile
    row, or whose author fetch fails outright, renders *without* a byline rather
    than 500-ing. The share pages are the app's primary growth surface, and a
    missing name is survivable in a way a missing page is not. Returns None in
    both cases.
    """
    if not owner_id:
        return None

    try:
        profiles, visited = await asyncio.gather(
            db.get(
                "user_profile",
                {
                    "user_id": f"eq.{owner_id}",
                    "select": "display_name, avatar_url",
                    "limit": 1,
                },
            ),
            db.get(
                "user_countries",
                {
                    "user_id": f"eq.{owner_id}",
                    "status": "eq.visited",
                    "select": "id",
                },
            ),
        )
    except Exception as e:
        # Degrade to no byline rather than taking the whole page down.
        logger.warning("Failed to fetch share byline for owner %s: %s", owner_id, e)
        return None

    if not profiles:
        return None

    profile = profiles[0]
    display_name = (profile.get("display_name") or "").strip()
    if not display_name:
        return None

    return ShareAuthor(
        display_name=display_name,
        avatar_url=_avatar_url(profile.get("avatar_url")),
        # 0 is a legitimate value (a brand-new owner); the template omits the
        # clause rather than rendering "0 countries visited".
        country_count=len(visited),
    )


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
            "og_image": seo.og_image,
            "og_url": seo.canonical_url,
            "canonical_url": seo.canonical_url,
            "has_hero": True,
            "current_year": get_current_year(),
            "faqs": LANDING_FAQS,
            "structured_data": build_landing_structured_data(
                settings.base_url, settings.app_store_url
            ),
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
            "limit": PUBLIC_LIST_ENTRY_LIMIT,
        },
    )

    # Get trip_id for redirect URLs (if list is associated with a trip)
    trip_id = lst.get("trip_id")

    entries: list[PublicListEntry] = []
    for row in entry_rows:
        entry = row.get("entry", {})
        if entry:
            place = _entry_place(entry)
            entry_id = entry.get("id")

            # Build destination URL: the entry's own link wins, else Google Maps.
            entry_link = entry.get("link")
            lat = place.get("lat")
            lng = place.get("lng")
            google_place_id = place.get("google_place_id")

            destination_url = entry_link or google_maps_place_url(
                lat, lng, google_place_id
            )

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
                    media_urls=extract_media_urls(
                        entry.get("media_files"), width=ENTRY_IMAGE_WIDTH
                    ),
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
        # The OG image keeps the full-size original: social scrapers want the
        # source, and only the on-page hero is bound by the display size.
        cover_image_url=list_view.cover_image_url,
    )

    author = await _fetch_share_author(db, lst.get("owner_id"))
    share = build_share_view_model(list_view, author=author)
    share.cover_image_url = resize_stored_url(
        share.cover_image_url, width=HERO_COVER_WIDTH
    )

    response = templates.TemplateResponse(
        request=request,
        name="list_public.html",
        context={
            "list": list_view,
            "share": share,
            "author": author,
            "structured_data": build_share_structured_data(
                share, seo.canonical_url, settings.base_url
            ),
            "google_maps_browser_api_key": settings.google_maps_browser_api_key,
            "google_maps_map_id": settings.google_maps_map_id,
            "map_download_url": request.url_for(
                "download_list_kml", slug=list_view.slug
            ),
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
        place = _entry_place(entry)
        entry_id = entry.get("id")

        # Build destination URL: the entry's own link wins, else Google Maps.
        entry_link = entry.get("link")
        lat = place.get("lat")
        lng = place.get("lng")
        google_place_id = place.get("google_place_id")

        destination_url = entry_link or google_maps_place_url(lat, lng, google_place_id)

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
                google_place_id=google_place_id,
                latitude=lat,
                longitude=lng,
                media_urls=extract_media_urls(
                    entry.get("media_files"), width=ENTRY_IMAGE_WIDTH
                ),
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

    author = await _fetch_share_author(db, trip.get("user_id"))
    share = build_share_view_model(trip_view, author=author)
    share.cover_image_url = resize_stored_url(
        share.cover_image_url, width=HERO_COVER_WIDTH
    )

    response = templates.TemplateResponse(
        request=request,
        name="trip_public.html",
        context={
            "trip": trip_view,
            "share": share,
            "author": author,
            "structured_data": build_share_structured_data(
                share, seo.canonical_url, settings.base_url
            ),
            "google_maps_browser_api_key": settings.google_maps_browser_api_key,
            "google_maps_map_id": settings.google_maps_map_id,
            "map_download_url": request.url_for(
                "download_trip_kml", slug=trip_view.share_slug
            ),
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


# ============================================================================
# KML export
#
# The honest ceiling on "put this collection in my Google Maps": no API can
# write to a visitor's saved places, but Google My Maps imports KML, so we hand
# them a file. Deliberately much cheaper than the page it hangs off -- a lean
# select, no media, no author lookup, and crucially no affiliate redirect rows,
# which the pages create one serial insert at a time.
# ============================================================================

KML_ENTRY_SELECT = (
    "title, type, notes, place:place(place_name, address, google_place_id, lat, lng)"
)


def _kml_placemarks(entry_rows: list[dict[str, Any]]) -> list[Placemark]:
    """Turn entry rows into placemarks, grouped in canonical category order.

    Entries with no coordinates are dropped: a KML placemark without a point is
    meaningless to My Maps. Ordinals follow the feed's numbering *before* that
    drop, so a downloaded pin's number matches the page it came from.
    """
    placemarks: list[Placemark] = []

    for ordinal, row in enumerate(entry_rows, start=1):
        place = _entry_place(row)

        lat = place.get("lat")
        lng = place.get("lng")
        if lat is None or lng is None:
            continue

        style = category_style(row.get("type"))
        maps_url = google_maps_place_url(lat, lng, place.get("google_place_id"))

        placemarks.append(
            Placemark(
                name=f"{ordinal:02d}. {row.get('title') or 'Untitled'}",
                latitude=lat,
                longitude=lng,
                category=style.label,
                description_lines=[
                    place.get("place_name") or "",
                    place.get("address") or "",
                    row.get("notes") or "",
                    maps_url or "",
                ],
            )
        )

    # Canonical category order, then feed order within a category, so My Maps'
    # layer list reads the same way the legend does.
    order = {style.label: index for index, style in enumerate(CATEGORY_STYLES.values())}
    placemarks.sort(key=lambda mark: order.get(mark.category, len(order)))
    return placemarks


def _kml_response(
    *,
    document_name: str,
    description: str | None,
    slug: str,
    placemarks: list[Placemark],
) -> Response:
    """Serve a KML document as a download."""
    body = build_kml(
        document_name=document_name,
        document_description=description,
        placemarks=placemarks,
    )
    return Response(
        content=body,
        media_type=KML_MEDIA_TYPE,
        headers={
            # The slug is already constrained to [a-z0-9-], so it is safe to
            # interpolate into the header without quoting games.
            "Content-Disposition": f'attachment; filename="{slug}.kml"',
            "Cache-Control": "public, max-age=300",
        },
    )


@router.get("/l/{slug}/map.kml", name="download_list_kml")
@limiter.limit("60/minute")
async def download_list_kml(
    request: Request,
    slug: str = Path(..., min_length=1, max_length=100, pattern=r"^[a-z0-9-]+$"),
) -> Response:
    """Export a public list's places as KML for Google My Maps."""
    db = get_supabase_client()

    lists = await db.get(
        "list",
        {
            "slug": f"eq.{slug}",
            "deleted_at": "is.null",
            "select": "id, name, description",
        },
    )
    if not lists:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="List not found",
        )

    lst = lists[0]
    entry_rows = await db.get(
        "list_entries",
        {
            "list_id": f"eq.{lst['id']}",
            "select": f"entry:entry_id({KML_ENTRY_SELECT})",
            "order": "position.asc",
            # Same limit the list page applies, so the file and the page agree.
            "limit": PUBLIC_LIST_ENTRY_LIMIT,
        },
    )

    entries = [row["entry"] for row in entry_rows if row.get("entry")]
    return _kml_response(
        document_name=lst["name"],
        description=lst.get("description"),
        slug=slug,
        placemarks=_kml_placemarks(entries),
    )


@router.get("/t/{slug}/map.kml", name="download_trip_kml")
@limiter.limit("60/minute")
async def download_trip_kml(
    request: Request,
    slug: str = Path(..., min_length=1, max_length=100, pattern=r"^[a-z0-9-]+$"),
) -> Response:
    """Export a public trip's places as KML for Google My Maps."""
    db = get_supabase_client()

    trips = await db.get(
        "trip",
        {
            "share_slug": f"eq.{slug}",
            "deleted_at": "is.null",
            "select": "id, name",
        },
    )
    if not trips:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Trip not found",
        )

    trip = trips[0]
    entry_rows = await db.get(
        "entry",
        {
            "trip_id": f"eq.{trip['id']}",
            "deleted_at": "is.null",
            "select": KML_ENTRY_SELECT,
            "order": "created_at.desc",
            # Deliberately unlimited, mirroring the trip page's own query. The
            # page renders every entry under a heading that reads "All N places,
            # mapped"; a capped export sitting under that claim would hand a
            # visitor a silent subset of what they were just promised.
        },
    )

    return _kml_response(
        document_name=trip["name"],
        description=None,
        slug=slug,
        placemarks=_kml_placemarks(entry_rows),
    )


# ============================================================================
# Playable quiz page (U7: R9/R10/R12/R13)
#
# The anonymous play surface for a shared travel photo quiz. Three invariants:
#
# * The slug resolves UNCACHED on every request -- revocation must gate serving
#   the moment it commits, so there is no in-process slug cache and 200s carry
#   at most a 60s shared-cache TTL (KTD5: quiz photos have a 60s object TTL;
#   the page must never outlive its own images).
# * Ground truth (correct_index, capture_year, year_options) never reaches the
#   page. The JSON island carries only what the player may see: image URLs and
#   the four options per question. Grading happens server-side (U8 routes).
# * Every /q/ response -- 200, 404, and the revoked "gone" page -- is noindex
#   via BOTH the meta robots tag and the X-Robots-Tag header, and /q/ URLs are
#   never emitted into sitemap.xml. robots.txt deliberately does NOT Disallow
#   /q/: a Disallow line would advertise the URL space while also blocking
#   crawlers from ever *seeing* the noindex.
# ============================================================================


def _quiz_unavailable_response(request: Request, status_code: int) -> HTMLResponse:
    """The content-free unavailable/gone page (AE5).

    Served for unknown slugs, pre-share states, and revoked quizzes -- all
    404, so a revoked slug is indistinguishable from one that never existed.
    Renders no photos, no names, no scores -- just the message and the
    install CTA -- and is never cached: a revocation must not live on in any
    shared cache.
    """
    settings = get_settings()
    response = templates.TemplateResponse(
        request=request,
        name="quiz.html",
        context={
            "mode": "gone",
            "app_store_url": settings.app_store_url,
            "google_analytics_id": settings.google_analytics_id,
            "current_year": get_current_year(),
            "page_title": "Quiz unavailable - Atlasi",
            "og_title": "This quiz is no longer available",
            "og_description": "The link may have been revoked by its owner.",
        },
        status_code=status_code,
    )
    response.headers["Cache-Control"] = "no-store"
    response.headers["X-Robots-Tag"] = "noindex"
    return response


async def _fetch_quiz_owner_name(db: SupabaseClient, owner_id: str) -> str | None:
    """The quiz owner's display name, or None.

    Like the share byline, this is framing rather than content: a missing
    profile (or a failed lookup) degrades to an anonymous challenge instead of
    taking the page down.
    """
    if not owner_id:
        return None
    try:
        profiles = await db.get(
            "user_profile",
            {
                "user_id": f"eq.{owner_id}",
                "select": "display_name",
                "limit": 1,
            },
        )
    except Exception as e:
        logger.warning("Failed to fetch quiz owner name for %s: %s", owner_id, e)
        return None
    if not profiles:
        return None
    return (profiles[0].get("display_name") or "").strip() or None


@router.get("/q/{slug}", response_class=HTMLResponse)
@limiter.limit("60/minute")
async def view_quiz_page(
    request: Request,
    slug: str = Path(..., min_length=1, max_length=100, pattern=r"^[a-z0-9-]+$"),
) -> HTMLResponse:
    """Render the playable quiz page for a shared quiz slug (R9, R10)."""
    settings = get_settings()
    db = get_supabase_client()  # service role: quiz tables are backend-only

    quizzes = await db.get(
        "quiz",
        {
            "slug": f"eq.{slug}",
            "select": "id,owner_id,state,slug,score_to_beat_correct,score_to_beat_total",
        },
    )
    quiz = quizzes[0] if quizzes else None

    # Only 'shared' serves. Unknown slugs, pre-share states (which cannot hold
    # a slug today, but the check is deliberately positive), and revoked
    # quizzes are indistinguishable 404s -- a revoked slug must not confirm
    # that a quiz ever existed.
    if quiz is None or quiz.get("state") != "shared":
        return _quiz_unavailable_response(request, status.HTTP_404_NOT_FOUND)

    question_rows = await db.get(
        "quiz_question",
        {
            "quiz_id": f"eq.{quiz['id']}",
            "select": "id,position,storage_path,options",
            "order": "position.asc",
        },
    )
    owner_name = await _fetch_quiz_owner_name(db, quiz.get("owner_id"))

    # Everything the game JS needs, and NOTHING it must not have. The
    # score-to-beat pair is exposed as {score, total} -- deliberately not
    # {correct, total} -- so no key named "correct" ever appears in the page.
    questions = [
        {
            "id": str(q["id"]),
            "position": q["position"],
            "image_url": build_media_url(q["storage_path"]),
            "options": list(q["options"]),
        }
        for q in sorted(question_rows, key=lambda r: r["position"])
    ]
    score_to_beat = None
    if quiz.get("score_to_beat_correct") is not None:
        score_to_beat = {
            "score": quiz["score_to_beat_correct"],
            "total": quiz["score_to_beat_total"],
        }
    quiz_payload = {
        "slug": slug,
        "owner_name": owner_name,
        "score_to_beat": score_to_beat,
        "question_count": len(questions),
        "questions": questions,
    }

    challenger = owner_name or "A friend"
    og_title = f"Can you beat {challenger}'s travel photo quiz?"
    og_description = f"Guess the country in {len(questions)} photos."
    if score_to_beat:
        og_description += (
            f" The score to beat: {score_to_beat['score']}/{score_to_beat['total']}."
        )

    response = templates.TemplateResponse(
        request=request,
        name="quiz.html",
        context={
            "mode": "play",
            "owner_name": owner_name,
            "score_to_beat": score_to_beat,
            "question_count": len(questions),
            "quiz_payload": quiz_payload,
            "app_store_url": settings.app_store_url,
            "google_analytics_id": settings.google_analytics_id,
            "current_year": get_current_year(),
            "page_title": f"{challenger}'s travel photo quiz - Atlasi",
            "og_title": og_title,
            "og_description": og_description,
            # R13: the unfurl card image route ships in a later unit; the meta
            # tags point at its stable URL now.
            "og_image": f"{settings.base_url}/q/{slug}/card.png",
            "og_url": f"{settings.base_url}/q/{slug}",
        },
    )
    # KTD5: never cache the page longer than its photos' 60s object TTL.
    response.headers["Cache-Control"] = "public, max-age=60"
    response.headers["X-Robots-Tag"] = "noindex"
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
            "current_year": get_current_year(),
            **seo_context(build_static_page_seo("privacy", settings.base_url)),
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
            "current_year": get_current_year(),
            **seo_context(build_static_page_seo("terms", settings.base_url)),
        },
    )
    response.headers["Cache-Control"] = "public, max-age=86400"
    return response


# Valid error codes for unsubscribe page (whitelist for security)
UNSUBSCRIBE_ERROR_CODES = {"invalid_token", "server_error"}


@router.get("/unsubscribe/{token}", response_class=HTMLResponse)
@limiter.limit("30/minute")
async def unsubscribe_email(
    request: Request,
    token: UUID = Path(..., description="Unsubscribe token (UUID format)"),
) -> HTMLResponse:
    """Handle email unsubscribe via token.

    This is a single-click unsubscribe per CAN-SPAM requirements.
    No confirmation needed - visiting the URL unsubscribes the user.
    """
    settings = get_settings()
    db = get_supabase_client()  # Service role for profile lookup

    # Look up user by unsubscribe_token
    try:
        profiles = await db.get(
            "user_profile",
            params={
                "unsubscribe_token": f"eq.{token}",
                "select": "user_id, email_unsubscribed_at",
            },
        )
    except Exception as e:
        logger.error(f"Failed to lookup unsubscribe token: {e}")
        return templates.TemplateResponse(
            request=request,
            name="unsubscribe.html",
            context={
                "success": False,
                "error": "server_error",
                "app_store_url": settings.app_store_url,
                "google_analytics_id": settings.google_analytics_id,
                "current_year": get_current_year(),
            },
        )

    if not profiles:
        # Invalid token - show error page
        return templates.TemplateResponse(
            request=request,
            name="unsubscribe.html",
            context={
                "success": False,
                "error": "invalid_token",
                "app_store_url": settings.app_store_url,
                "google_analytics_id": settings.google_analytics_id,
                "current_year": get_current_year(),
            },
        )

    profile = profiles[0]
    user_id = profile["user_id"]

    # Check if already unsubscribed
    if profile.get("email_unsubscribed_at"):
        return templates.TemplateResponse(
            request=request,
            name="unsubscribe.html",
            context={
                "success": True,
                "already_unsubscribed": True,
                "cancelled_count": 0,
                "app_store_url": settings.app_store_url,
                "google_analytics_id": settings.google_analytics_id,
                "current_year": get_current_year(),
            },
        )

    # Mark as unsubscribed
    try:
        await db.patch(
            "user_profile",
            data={
                "email_unsubscribed_at": datetime.datetime.now(datetime.UTC).isoformat()
            },
            params={"user_id": f"eq.{user_id}"},
        )
    except Exception as e:
        logger.error(f"Failed to mark user as unsubscribed: {e}")
        return templates.TemplateResponse(
            request=request,
            name="unsubscribe.html",
            context={
                "success": False,
                "error": "server_error",
                "app_store_url": settings.app_store_url,
                "google_analytics_id": settings.google_analytics_id,
                "current_year": get_current_year(),
            },
        )

    # Cancel pending scheduled emails
    cancelled_count = await cancel_scheduled_emails(user_id)

    logger.info(
        "User unsubscribed from emails",
        extra={
            "user_id": user_id,
            "cancelled_emails": cancelled_count,
        },
    )

    # Show success page
    return templates.TemplateResponse(
        request=request,
        name="unsubscribe.html",
        context={
            "success": True,
            "already_unsubscribed": False,
            "cancelled_count": cancelled_count,
            "app_store_url": settings.app_store_url,
            "google_analytics_id": settings.google_analytics_id,
            "current_year": get_current_year(),
        },
    )


@router.get("/robots.txt", response_class=PlainTextResponse)
async def robots_txt() -> PlainTextResponse:
    """Return robots.txt for search engines."""
    settings = get_settings()
    # `Allow: /` already permits everything, so the Allow lines are
    # documentation. The Disallow lines are the substantive part: /o/ is the
    # affiliate redirect endpoint (a crawlable redirect chain off every list and
    # blog page), and /unsubscribe/ exposes single-use tokenised URLs.
    content = f"""User-agent: *
Allow: /
Allow: /blog
Allow: /l/
Allow: /t/
Disallow: /o/
Disallow: /unsubscribe/

Sitemap: {settings.base_url}/sitemap.xml
"""
    return PlainTextResponse(content=content, media_type="text/plain")


def _sitemap_entry(
    loc: str,
    lastmod: datetime.date | None = None,
    changefreq: str | None = None,
    priority: str | None = None,
) -> str:
    """One <url> element. Optional fields are omitted rather than faked."""
    parts = [f"<loc>{html.escape(loc)}</loc>"]
    if lastmod:
        parts.append(f"<lastmod>{lastmod.isoformat()}</lastmod>")
    if changefreq:
        parts.append(f"<changefreq>{changefreq}</changefreq>")
    if priority:
        parts.append(f"<priority>{priority}</priority>")
    return "  <url>" + "".join(parts) + "</url>"


@router.get("/sitemap.xml", response_class=PlainTextResponse)
async def sitemap_xml() -> PlainTextResponse:
    """Generate sitemap.xml for search engines."""
    settings = get_settings()
    db = get_supabase_client()

    base = settings.base_url
    urls = [_sitemap_entry(base, changefreq="weekly", priority="1.0")]

    # Blog entries come from the in-memory registry, so this adds no database
    # round-trip. lastmod is real here because posts carry an `updated` date;
    # lists and trips do not select one, and a fabricated lastmod is worse than
    # none -- Google discounts sitemaps whose lastmod is always "today".
    registry = get_registry()
    blog_posts = list(registry.posts)
    if blog_posts:
        urls.append(
            _sitemap_entry(
                f"{base}/blog",
                lastmod=max(p.updated for p in blog_posts),
                changefreq="weekly",
                priority="0.8",
            )
        )
        for blog_category in registry.categories():
            urls.append(
                _sitemap_entry(
                    f"{base}{blog_category.url_path}",
                    lastmod=blog_category.last_modified,
                    changefreq="weekly",
                    priority="0.5",
                )
            )
        for post in blog_posts:
            urls.append(
                _sitemap_entry(
                    f"{base}/blog/{post.slug}",
                    lastmod=post.updated,
                    changefreq="monthly",
                    priority="0.7",
                )
            )

    for page in ("privacy", "terms", "contact"):
        urls.append(
            _sitemap_entry(f"{base}/{page}", changefreq="yearly", priority="0.3")
        )

    # All lists (all lists are public)
    lists = await db.get(
        "list",
        {
            "deleted_at": "is.null",
            "select": "slug",
        },
    )
    for lst in lists:
        urls.append(
            _sitemap_entry(
                f"{base}/l/{lst['slug']}", changefreq="weekly", priority="0.6"
            )
        )

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
        urls.append(
            _sitemap_entry(
                f"{base}/t/{trip['share_slug']}",
                changefreq="weekly",
                priority="0.6",
            )
        )

    content = f"""<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
{chr(10).join(urls)}
</urlset>"""

    response = PlainTextResponse(content=content, media_type="application/xml")
    response.headers["Cache-Control"] = "public, max-age=3600"
    return response


# Contact form category options
CONTACT_CATEGORIES = [
    {"value": "feature_request", "label": "Feature Request"},
    {"value": "data_deletion", "label": "Data Deletion Request"},
    {"value": "bug_report", "label": "Bug Report"},
    {"value": "general_inquiry", "label": "General Inquiry"},
]

VALID_CATEGORY_VALUES = {cat["value"] for cat in CONTACT_CATEGORIES}

# Valid error codes for contact form (whitelist for security)
VALID_ERROR_CODES = {
    "captcha",
    "invalid_category",
    "invalid_name",
    "invalid_message",
    "invalid_email",
    "send_failed",
}

# Simple email regex for validation (RFC 5322 simplified)
EMAIL_REGEX = re.compile(r"^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$")


@router.get("/contact", response_class=HTMLResponse)
@limiter.limit("60/minute")
async def contact_page(
    request: Request,
    success: bool | None = None,
    error: str | None = None,
) -> HTMLResponse:
    """Render the contact form page."""
    settings = get_settings()

    # Sanitize error parameter - only allow whitelisted values
    sanitized_error = error if error in VALID_ERROR_CODES else None

    response = templates.TemplateResponse(
        request=request,
        name="contact.html",
        context={
            "app_store_url": settings.app_store_url,
            "google_analytics_id": settings.google_analytics_id,
            **seo_context(build_static_page_seo("contact", settings.base_url)),
            "turnstile_site_key": settings.turnstile_site_key,
            "categories": CONTACT_CATEGORIES,
            "success": success,
            "error": sanitized_error,
            "current_year": get_current_year(),
        },
    )
    response.headers["Cache-Control"] = "no-cache"
    return response


@router.post("/contact", response_class=RedirectResponse)
@limiter.limit("5/minute")
async def submit_contact_form(
    request: Request,
    name: str = Form(...),
    email: str = Form(...),
    category: str = Form(...),
    message: str = Form(...),
    cf_turnstile_response: str = Form(..., alias="cf-turnstile-response"),
) -> RedirectResponse:
    """Handle contact form submission."""
    # Get client IP for Turnstile verification
    client_ip = request.client.host if request.client else None

    # Verify Turnstile token
    is_valid = await verify_turnstile_token(cf_turnstile_response, client_ip)
    if not is_valid:
        return RedirectResponse(
            url="/contact?error=captcha",
            status_code=303,
        )

    # Validate email format (prevents header injection and validates format)
    email = email.strip()
    if not EMAIL_REGEX.match(email) or len(email) > 254:
        return RedirectResponse(
            url="/contact?error=invalid_email",
            status_code=303,
        )

    # Validate category
    if category not in VALID_CATEGORY_VALUES:
        return RedirectResponse(
            url="/contact?error=invalid_category",
            status_code=303,
        )

    # Basic validation
    name = name.strip()
    if len(name) < 1 or len(name) > 100:
        return RedirectResponse(
            url="/contact?error=invalid_name",
            status_code=303,
        )

    message = message.strip()
    if len(message) < 10 or len(message) > 5000:
        return RedirectResponse(
            url="/contact?error=invalid_message",
            status_code=303,
        )

    # Send email
    success = await send_contact_email(
        name=name,
        email=email,
        category=category,
        message=message,
    )

    if success:
        return RedirectResponse(
            url="/contact?success=true",
            status_code=303,
        )
    else:
        return RedirectResponse(
            url="/contact?error=send_failed",
            status_code=303,
        )
