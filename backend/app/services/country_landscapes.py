"""Scenic-biome tags for quiz decoy ranking.

Subregion defaults cover typical scenery for a grouping. Per-country
overrides capture sprawling identities (United States, Bulgaria, …).
Biomes are resolved at ranking time from ``country.subregion`` plus
overrides — there is no parallel ISO-code map.
"""

from __future__ import annotations

# Distinctive biomes only. urban/coastal are too common to live on every
# default; they belong on overrides where they are actually identity.
SUBREGION_DEFAULTS: dict[str, frozenset[str]] = {
    "North Africa": frozenset({"desert", "mediterranean"}),
    "West & Central Africa": frozenset({"tropical"}),
    "East Africa": frozenset({"prairie", "tropical"}),
    "Southern Africa": frozenset({"desert", "prairie"}),
    "North America": frozenset({"prairie", "temperate_forest"}),
    "Central America": frozenset({"tropical"}),
    "Caribbean": frozenset({"tropical"}),
    "South America": frozenset({"tropical"}),
    "Middle East": frozenset({"desert", "mediterranean"}),
    "Central Asia": frozenset({"prairie", "desert"}),
    "South Asia": frozenset({"tropical", "desert"}),
    "East & Southeast Asia": frozenset({"tropical"}),
    "Core Europe": frozenset({"temperate_forest", "alpine"}),
    "Nordics": frozenset({"temperate_forest", "alpine"}),
    "British Isles": frozenset({"temperate_forest"}),
    "Eastern Europe": frozenset({"prairie", "temperate_forest"}),
    "Balkans": frozenset({"mediterranean", "alpine"}),
    "Southern Europe": frozenset({"mediterranean", "alpine"}),
    "Australia & New Zealand": frozenset({"temperate_forest"}),
    "Pacific Islands": frozenset({"tropical"}),
    "Antarctica": frozenset({"alpine"}),
}

# Famous scenic identities the subregion default undersells. The
# Bulgaria / United States pair is the motivating lookalike: rolling
# grassland and dry hills that read as California or Nebraska.
COUNTRY_OVERRIDES: dict[str, frozenset[str]] = {
    "US": frozenset(
        {
            "coastal",
            "mediterranean",
            "prairie",
            "alpine",
            "desert",
            "temperate_forest",
            "urban",
        }
    ),
    "BG": frozenset(
        {
            "mediterranean",
            "prairie",
            "alpine",
            "temperate_forest",
            "coastal",
            "urban",
        }
    ),
    "CA": frozenset({"prairie", "alpine", "temperate_forest"}),
    "MX": frozenset({"desert", "tropical", "alpine"}),
    "AU": frozenset({"desert", "prairie", "temperate_forest"}),
    "NZ": frozenset({"temperate_forest", "alpine", "prairie"}),
    "AR": frozenset({"prairie", "alpine", "desert"}),
    "CL": frozenset({"desert", "alpine", "prairie"}),
    "BR": frozenset({"tropical"}),
    "KZ": frozenset({"prairie", "desert"}),
    "TR": frozenset({"mediterranean", "alpine"}),
    "ZA": frozenset({"prairie", "desert"}),
    "IS": frozenset({"alpine", "prairie"}),
    "JP": frozenset({"temperate_forest", "alpine"}),
    "KR": frozenset({"temperate_forest", "alpine"}),
    "CN": frozenset({"temperate_forest", "alpine", "desert", "prairie"}),
    "RU": frozenset({"prairie", "temperate_forest", "alpine"}),
}


def landscapes_for(code: str, subregion: str | None = None) -> frozenset[str]:
    """Biome tags for an ISO code: override, else subregion default, else empty."""
    override = COUNTRY_OVERRIDES.get(code.upper())
    if override is not None:
        return override
    if subregion:
        return SUBREGION_DEFAULTS.get(subregion, frozenset())
    return frozenset()
