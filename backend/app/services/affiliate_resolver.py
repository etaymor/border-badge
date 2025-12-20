"""Affiliate resolver service for matching entries to partner properties."""

import logging
import re
import unicodedata
from urllib.parse import quote_plus
from uuid import UUID

from app.schemas.affiliate import PartnerMapping, PartnerMappingCreate
from app.services.affiliate_links import (
    get_mapping_by_google_place_id,
    get_partner_mapping,
    upsert_partner_mapping,
)

logger = logging.getLogger(__name__)

# Supported partner slugs
PARTNER_SLUGS = ["booking", "tripadvisor", "getyourguide"]

# Minimum confidence threshold for accepting a match
CONFIDENCE_THRESHOLD = 0.8

# Partner-specific search URL templates
PARTNER_SEARCH_URLS = {
    "booking": "https://www.booking.com/searchresults.html?ss={query}",
    "tripadvisor": "https://www.tripadvisor.com/Search?q={query}",
    "getyourguide": "https://www.getyourguide.com/s?q={query}",
}


def normalize_name(name: str) -> str:
    """Normalize a place name for comparison.

    Performs:
    - Unicode NFKD normalization (decomposes accented characters)
    - Removes combining diacritical marks
    - Converts to lowercase
    - Removes extra whitespace
    - Removes common suffixes like "Hotel", "Resort", etc.

    Args:
        name: The place name to normalize

    Returns:
        Normalized name string
    """
    if not name:
        return ""

    # NFKD decomposition
    normalized = unicodedata.normalize("NFKD", name)

    # Remove combining diacritical marks (accents)
    normalized = "".join(char for char in normalized if not unicodedata.combining(char))

    # Lowercase
    normalized = normalized.lower()

    # Remove extra whitespace and trim
    normalized = " ".join(normalized.split())

    # Remove common hotel/venue suffixes for better matching
    suffixes_to_remove = [
        r"\s+hotel$",
        r"\s+resort$",
        r"\s+hostel$",
        r"\s+inn$",
        r"\s+suites$",
        r"\s+apartments?$",
        r"\s+lodge$",
        r"\s+motel$",
        r"\s+b&b$",
        r"\s+bed\s*&?\s*breakfast$",
    ]
    for suffix in suffixes_to_remove:
        normalized = re.sub(suffix, "", normalized, flags=re.IGNORECASE)

    return normalized.strip()


def calculate_similarity(name1: str, name2: str) -> float:
    """Calculate string similarity score between two names.

    Uses a combination of:
    1. Exact match (1.0)
    2. Levenshtein-based similarity for fuzzy matching

    Args:
        name1: First name (already normalized)
        name2: Second name (already normalized)

    Returns:
        Similarity score between 0.0 and 1.0
    """
    if not name1 or not name2:
        return 0.0

    # Exact match
    if name1 == name2:
        return 1.0

    # Token-based similarity (handles word order differences)
    tokens1 = set(name1.split())
    tokens2 = set(name2.split())

    if not tokens1 or not tokens2:
        return 0.0

    # Jaccard similarity of tokens
    intersection = tokens1 & tokens2
    union = tokens1 | tokens2
    token_similarity = len(intersection) / len(union)

    # Character-level similarity using Levenshtein ratio
    char_similarity = _levenshtein_ratio(name1, name2)

    # Combine both metrics, weighting token similarity higher
    # (handles cases like "Grand Hotel Paris" vs "Paris Grand Hotel")
    combined = (token_similarity * 0.6) + (char_similarity * 0.4)

    return combined


def _levenshtein_ratio(s1: str, s2: str) -> float:
    """Calculate normalized Levenshtein similarity ratio.

    Args:
        s1: First string
        s2: Second string

    Returns:
        Similarity ratio between 0.0 and 1.0
    """
    if not s1 and not s2:
        return 1.0
    if not s1 or not s2:
        return 0.0

    len1, len2 = len(s1), len(s2)

    # Create distance matrix
    dp = [[0] * (len2 + 1) for _ in range(len1 + 1)]

    for i in range(len1 + 1):
        dp[i][0] = i
    for j in range(len2 + 1):
        dp[0][j] = j

    for i in range(1, len1 + 1):
        for j in range(1, len2 + 1):
            cost = 0 if s1[i - 1] == s2[j - 1] else 1
            dp[i][j] = min(
                dp[i - 1][j] + 1,  # deletion
                dp[i][j - 1] + 1,  # insertion
                dp[i - 1][j - 1] + cost,  # substitution
            )

    distance = dp[len1][len2]
    max_len = max(len1, len2)

    return 1.0 - (distance / max_len)


def generate_search_url(
    partner_slug: str,
    place_name: str,
    address: str | None = None,
    lat: float | None = None,
    lng: float | None = None,
) -> str:
    """Generate a partner-specific search URL for fallback.

    When we can't find a direct match, generate a search URL that will
    help users find the property on the partner site.

    Args:
        partner_slug: Partner identifier
        place_name: Name of the place to search for
        address: Optional address for context
        lat: Optional latitude (unused in basic search)
        lng: Optional longitude (unused in basic search)

    Returns:
        Search URL for the specified partner
    """
    if partner_slug not in PARTNER_SEARCH_URLS:
        # Unknown partner, return a generic Google search
        query = quote_plus(f"{place_name} {address or ''}")
        return f"https://www.google.com/search?q={query}"

    # Build search query
    query_parts = [place_name]
    if address:
        # Extract city/region from address for better search results
        # Take last 2-3 parts of address (typically city, region, country)
        address_parts = [p.strip() for p in address.split(",")]
        if len(address_parts) >= 2:
            query_parts.append(address_parts[-2])  # Usually the city

    query = quote_plus(" ".join(query_parts))
    return PARTNER_SEARCH_URLS[partner_slug].format(query=query)


async def resolve_entry(
    entry_id: UUID,
    place_name: str,
    partner_slug: str,
    address: str | None = None,
    lat: float | None = None,
    lng: float | None = None,
    google_place_id: str | None = None,
) -> PartnerMapping | None:
    """Attempt to resolve an entry to a partner property.

    Resolution pipeline:
    1. Check existing mapping in DB (if confidence >= threshold, return it)
    2. Try exact match via Google Place ID
    3. Try fuzzy match via normalized name
    4. Return None if no match found (caller should use search URL fallback)

    Args:
        entry_id: UUID of the entry
        place_name: Name of the place
        partner_slug: Partner identifier
        address: Optional address
        lat: Optional latitude
        lng: Optional longitude
        google_place_id: Optional Google Places ID

    Returns:
        PartnerMapping if a match is found, None otherwise
    """
    if partner_slug not in PARTNER_SLUGS:
        logger.warning(f"Unknown partner slug: {partner_slug}")
        return None

    # 1. Check existing mapping
    existing = await get_partner_mapping(entry_id, partner_slug)
    if existing and existing.confidence >= CONFIDENCE_THRESHOLD:
        logger.debug(
            f"Using existing mapping: entry_id={entry_id} partner={partner_slug} "
            f"confidence={existing.confidence}"
        )
        return existing

    # 2. Try Google Place ID lookup (if available)
    if google_place_id:
        place_mapping = await get_mapping_by_google_place_id(
            google_place_id, partner_slug
        )
        if place_mapping:
            # Store mapping for this entry too
            mapping = await upsert_partner_mapping(
                PartnerMappingCreate(
                    entry_id=entry_id,
                    google_place_id=google_place_id,
                    partner_slug=partner_slug,
                    partner_property_id=place_mapping.partner_property_id,
                    confidence=place_mapping.confidence,
                    is_verified=place_mapping.is_verified,
                )
            )
            logger.info(
                f"Matched via Google Place ID: entry_id={entry_id} "
                f"partner={partner_slug} property_id={mapping.partner_property_id}"
            )
            return mapping

    # 3. Try fuzzy matching
    # Note: In Phase 2, we don't have partner databases to search against.
    # This would require partner API integration (Booking.com Affiliate API, etc.)
    # For now, we'll return None and rely on search URL fallback.
    #
    # Future enhancement: Call partner APIs to search and match properties
    # based on normalized name similarity.

    logger.debug(
        f"No match found: entry_id={entry_id} partner={partner_slug} "
        f"place_name={place_name}"
    )
    return None


async def resolve_or_fallback(
    entry_id: UUID,
    place_name: str,
    partner_slug: str,
    address: str | None = None,
    lat: float | None = None,
    lng: float | None = None,
    google_place_id: str | None = None,
) -> tuple[str | None, float]:
    """Resolve an entry to a partner URL, with search URL fallback.

    Args:
        entry_id: UUID of the entry
        place_name: Name of the place
        partner_slug: Partner identifier
        address: Optional address
        lat: Optional latitude
        lng: Optional longitude
        google_place_id: Optional Google Places ID

    Returns:
        Tuple of (url, confidence):
        - If matched: (partner_property_url, confidence)
        - If no match: (search_url, 0.0)
    """
    mapping = await resolve_entry(
        entry_id=entry_id,
        place_name=place_name,
        partner_slug=partner_slug,
        address=address,
        lat=lat,
        lng=lng,
        google_place_id=google_place_id,
    )

    if mapping:
        # Build the partner property URL
        property_url = build_partner_property_url(
            partner_slug, mapping.partner_property_id
        )
        return property_url, mapping.confidence

    # Fallback to search URL
    search_url = generate_search_url(
        partner_slug=partner_slug,
        place_name=place_name,
        address=address,
        lat=lat,
        lng=lng,
    )
    return search_url, 0.0


def build_partner_property_url(partner_slug: str, property_id: str) -> str:
    """Build a direct URL to a partner property page.

    Args:
        partner_slug: Partner identifier
        property_id: Partner-specific property ID

    Returns:
        Direct URL to the property on the partner site
    """
    # Partner-specific URL patterns
    url_patterns = {
        "booking": f"https://www.booking.com/hotel/{property_id}.html",
        "tripadvisor": f"https://www.tripadvisor.com/{property_id}",
        "getyourguide": f"https://www.getyourguide.com/activity/{property_id}",
    }

    if partner_slug in url_patterns:
        return url_patterns[partner_slug]

    # Unknown partner, return property ID as-is (might be a full URL)
    return property_id


# =============================================================================
# Lazy Refresh Hook
# =============================================================================


async def refresh_entry_mappings(
    entry_id: UUID,
    place_name: str,
    address: str | None = None,
    lat: float | None = None,
    lng: float | None = None,
    google_place_id: str | None = None,
    partner_slugs: list[str] | None = None,
) -> list[PartnerMapping]:
    """Refresh partner mappings for an entry.

    This is called on-demand when generating outbound links for an entry.
    It attempts to resolve mappings for all specified partners (or all
    supported partners if none specified).

    Args:
        entry_id: UUID of the entry
        place_name: Name of the place
        address: Optional address
        lat: Optional latitude
        lng: Optional longitude
        google_place_id: Optional Google Places ID
        partner_slugs: Optional list of partners to refresh (defaults to all)

    Returns:
        List of PartnerMapping objects that were created/updated
    """
    slugs = partner_slugs or PARTNER_SLUGS
    mappings = []

    for slug in slugs:
        if slug not in PARTNER_SLUGS:
            logger.warning(f"Skipping unknown partner: {slug}")
            continue

        mapping = await resolve_entry(
            entry_id=entry_id,
            place_name=place_name,
            partner_slug=slug,
            address=address,
            lat=lat,
            lng=lng,
            google_place_id=google_place_id,
        )

        if mapping:
            mappings.append(mapping)

    logger.info(
        f"Refreshed mappings for entry_id={entry_id}: "
        f"{len(mappings)}/{len(slugs)} partners matched"
    )

    return mappings


async def get_best_partner_for_entry(
    entry_id: UUID,
    place_name: str,
    address: str | None = None,
    lat: float | None = None,
    lng: float | None = None,
    google_place_id: str | None = None,
) -> tuple[PartnerMapping | None, str | None]:
    """Get the best partner mapping for an entry, with fallback.

    Tries all partners and returns the one with highest confidence,
    or a search URL if no match is found.

    Args:
        entry_id: UUID of the entry
        place_name: Name of the place
        address: Optional address
        lat: Optional latitude
        lng: Optional longitude
        google_place_id: Optional Google Places ID

    Returns:
        Tuple of (best_mapping, fallback_url):
        - If match found: (PartnerMapping, None)
        - If no match: (None, search_url_for_best_partner)
    """
    mappings = await refresh_entry_mappings(
        entry_id=entry_id,
        place_name=place_name,
        address=address,
        lat=lat,
        lng=lng,
        google_place_id=google_place_id,
    )

    if mappings:
        # Return the mapping with highest confidence
        best = max(mappings, key=lambda m: m.confidence)
        return best, None

    # No matches, generate fallback search URL
    # Default to Booking.com for stays, GetYourGuide for experiences
    fallback_partner = "booking"
    fallback_url = generate_search_url(
        partner_slug=fallback_partner,
        place_name=place_name,
        address=address,
        lat=lat,
        lng=lng,
    )

    return None, fallback_url
