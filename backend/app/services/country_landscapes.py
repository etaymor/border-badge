"""Static scenic-biome tags per country, used to rank quiz decoy options.

No database column: the catalog is keyed by ISO code and rebuilt from
subregion defaults plus a small override set for countries whose scenery
spans (or looks like) many biomes. Unknown codes score as empty.
"""

from __future__ import annotations

SUBREGION_DEFAULTS: dict[str, frozenset[str]] = {
    "North Africa": frozenset({"desert", "mediterranean", "coastal", "urban"}),
    "West & Central Africa": frozenset({"tropical", "coastal", "urban"}),
    "East Africa": frozenset({"prairie", "desert", "tropical", "alpine", "urban"}),
    "Southern Africa": frozenset({"desert", "prairie", "coastal", "urban"}),
    "North America": frozenset(
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
    "Central America": frozenset({"tropical", "coastal", "urban"}),
    "Caribbean": frozenset({"tropical", "coastal", "urban"}),
    "South America": frozenset(
        {
            "tropical",
            "alpine",
            "desert",
            "prairie",
            "coastal",
            "temperate_forest",
            "urban",
        }
    ),
    "Middle East": frozenset({"desert", "mediterranean", "coastal", "urban"}),
    "Central Asia": frozenset({"prairie", "desert", "alpine", "urban"}),
    "South Asia": frozenset({"tropical", "alpine", "desert", "coastal", "urban"}),
    "East & Southeast Asia": frozenset(
        {"tropical", "coastal", "temperate_forest", "alpine", "urban"}
    ),
    "Core Europe": frozenset({"temperate_forest", "alpine", "coastal", "urban"}),
    "Nordics": frozenset({"temperate_forest", "alpine", "coastal", "urban"}),
    "British Isles": frozenset({"temperate_forest", "coastal", "urban"}),
    "Eastern Europe": frozenset({"prairie", "temperate_forest", "alpine", "urban"}),
    "Balkans": frozenset({"mediterranean", "prairie", "alpine", "coastal", "urban"}),
    "Southern Europe": frozenset({"mediterranean", "coastal", "alpine", "urban"}),
    "Australia & New Zealand": frozenset(
        {
            "coastal",
            "desert",
            "prairie",
            "temperate_forest",
            "alpine",
            "urban",
        }
    ),
    "Pacific Islands": frozenset({"tropical", "coastal", "urban"}),
    "Antarctica": frozenset({"alpine", "coastal"}),
}

# ISO code -> subregion, aligned with supabase/seed/countries.sql.
_SUBREGION_CODES: dict[str, tuple[str, ...]] = {
    "North Africa": ("DZ", "EG", "LY", "MA", "SD", "TN"),
    "West & Central Africa": (
        "BJ",
        "BF",
        "CV",
        "CI",
        "GM",
        "GH",
        "GN",
        "GW",
        "LR",
        "ML",
        "MR",
        "NE",
        "NG",
        "SN",
        "SL",
        "TG",
        "CM",
        "CF",
        "TD",
        "CG",
        "CD",
        "GQ",
        "GA",
        "ST",
    ),
    "East Africa": (
        "BI",
        "KM",
        "DJ",
        "ER",
        "ET",
        "KE",
        "MG",
        "MW",
        "MU",
        "MZ",
        "RW",
        "SC",
        "SO",
        "SS",
        "TZ",
        "UG",
        "ZM",
        "ZW",
        "ZZ",
    ),
    "Southern Africa": ("AO", "BW", "LS", "NA", "ZA", "SZ"),
    "North America": ("CA", "MX", "US", "BM", "GL"),
    "Central America": ("BZ", "CR", "SV", "GT", "HN", "NI", "PA"),
    "Caribbean": (
        "AG",
        "BS",
        "BB",
        "CU",
        "DM",
        "DO",
        "GD",
        "HT",
        "JM",
        "KN",
        "LC",
        "VC",
        "TT",
        "AI",
        "AW",
        "VG",
        "KY",
        "GP",
        "MQ",
        "PR",
        "BL",
        "MF",
        "TC",
        "VI",
    ),
    "South America": (
        "AR",
        "BO",
        "BR",
        "CL",
        "CO",
        "EC",
        "GY",
        "PY",
        "PE",
        "SR",
        "UY",
        "VE",
        "FK",
        "GF",
    ),
    "Middle East": (
        "BH",
        "CY",
        "IR",
        "IQ",
        "IL",
        "JO",
        "KW",
        "LB",
        "OM",
        "QA",
        "SA",
        "SY",
        "TR",
        "AE",
        "YE",
        "PS",
        "XN",
    ),
    "Central Asia": ("AF", "KZ", "KG", "MN", "TJ", "TM", "UZ", "AM", "AZ", "GE"),
    "South Asia": ("BD", "BT", "IN", "MV", "NP", "PK", "LK"),
    "East & Southeast Asia": (
        "BN",
        "KH",
        "ID",
        "LA",
        "MY",
        "MM",
        "PH",
        "SG",
        "TH",
        "TL",
        "VN",
        "CN",
        "JP",
        "KP",
        "KR",
        "TW",
        "HK",
        "MO",
    ),
    "Core Europe": ("AT", "BE", "FR", "DE", "LI", "LU", "MC", "NL", "CH"),
    "Nordics": ("DK", "FI", "IS", "NO", "SE", "FO"),
    "British Isles": ("GB", "IE", "IM", "XI", "XS", "XW"),
    "Eastern Europe": (
        "BY",
        "BG",
        "CZ",
        "EE",
        "HU",
        "LV",
        "LT",
        "MD",
        "PL",
        "RO",
        "RU",
        "SK",
        "UA",
    ),
    "Balkans": ("AL", "BA", "HR", "ME", "MK", "RS", "SI", "XK"),
    "Southern Europe": ("AD", "GR", "IT", "MT", "PT", "SM", "ES", "VA", "GI"),
    "Australia & New Zealand": ("AU", "NZ"),
    "Pacific Islands": (
        "FJ",
        "PG",
        "SB",
        "VU",
        "KI",
        "MH",
        "FM",
        "NR",
        "PW",
        "GU",
        "WS",
        "TO",
        "TV",
        "AS",
        "CK",
        "PF",
    ),
    "Antarctica": ("AQ",),
}

# Famous scenic identities that the subregion default undersells. The
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
    "CA": frozenset({"coastal", "prairie", "alpine", "temperate_forest", "urban"}),
    "MX": frozenset({"desert", "coastal", "tropical", "alpine", "urban"}),
    "AU": frozenset({"desert", "coastal", "prairie", "temperate_forest", "urban"}),
    "NZ": frozenset({"temperate_forest", "alpine", "coastal", "prairie", "urban"}),
    "AR": frozenset({"prairie", "alpine", "desert", "coastal", "urban"}),
    "CL": frozenset({"desert", "alpine", "coastal", "prairie", "urban"}),
    "KZ": frozenset({"prairie", "desert", "urban"}),
    "TR": frozenset({"mediterranean", "coastal", "alpine", "urban"}),
    "ZA": frozenset({"prairie", "desert", "coastal", "urban"}),
    "IS": frozenset({"alpine", "coastal", "prairie", "urban"}),
}

COUNTRY_LANDSCAPES: dict[str, frozenset[str]] = {}
for _subregion, _codes in _SUBREGION_CODES.items():
    _default = SUBREGION_DEFAULTS[_subregion]
    for _code in _codes:
        COUNTRY_LANDSCAPES[_code] = COUNTRY_OVERRIDES.get(_code, _default)


def landscapes_for(code: str) -> frozenset[str]:
    """Biome tags for an ISO country code; empty for unknowns."""
    return COUNTRY_LANDSCAPES.get(code.upper(), frozenset())
