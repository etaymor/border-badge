"""SEO metadata helpers for public pages."""

from dataclasses import dataclass


@dataclass
class SEOContext:
    """SEO metadata for a page."""

    title: str
    description: str
    canonical_url: str
    og_title: str
    og_description: str
    og_image: str | None = None
    og_type: str = "website"


def build_landing_seo(base_url: str) -> SEOContext:
    """Build SEO context for the landing page."""
    return SEOContext(
        title="Border Badge - Track Your Travels",
        description="Mark countries visited, build your wishlist, and share your travel experiences with friends. Download Border Badge today.",
        canonical_url=base_url,
        og_title="Border Badge - Track Your Travels",
        og_description="Mark countries visited, build your wishlist, and share your travel experiences with friends.",
        og_type="website",
    )


def build_list_seo(
    list_name: str,
    list_slug: str,
    description: str | None,
    country_name: str | None,
    base_url: str,
) -> SEOContext:
    """Build SEO context for a public list page."""
    title = f"{list_name} - Border Badge"
    meta_description = description or f"A curated travel list shared on Border Badge"
    if country_name:
        meta_description = f"{list_name} in {country_name} - {meta_description}"

    return SEOContext(
        title=title,
        description=meta_description[:160],  # Truncate for meta description
        canonical_url=f"{base_url}/l/{list_slug}",
        og_title=list_name,
        og_description=meta_description[:200],
        og_type="article",
    )


def build_trip_seo(
    trip_name: str,
    share_slug: str,
    country_name: str,
    base_url: str,
    cover_image_url: str | None = None,
) -> SEOContext:
    """Build SEO context for a public trip page."""
    if country_name:
        title = f"{trip_name} in {country_name} - Border Badge"
        description = f"Explore {trip_name} in {country_name} - A trip shared on Border Badge"
        og_title = f"{trip_name} in {country_name}"
    else:
        title = f"{trip_name} - Border Badge"
        description = f"Explore {trip_name} - A trip shared on Border Badge"
        og_title = trip_name

    return SEOContext(
        title=title,
        description=description,
        canonical_url=f"{base_url}/t/{share_slug}",
        og_title=og_title,
        og_description=description,
        og_image=cover_image_url,
        og_type="article",
    )
