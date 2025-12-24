"""Schemas for country and user_countries endpoints."""

import re
from datetime import datetime
from enum import Enum
from uuid import UUID

from pydantic import BaseModel, field_validator

# Valid regions (continents)
VALID_REGIONS = frozenset(
    {"Africa", "Americas", "Asia", "Europe", "Oceania", "Antarctica"}
)

# Valid subregions by continent
VALID_SUBREGIONS = frozenset(
    {
        # Africa
        "Northern Africa",
        "Western Africa",
        "Eastern Africa",
        "Central Africa",
        "Southern Africa",
        # Americas
        "North America",
        "Central America",
        "Caribbean",
        "South America",
        # Asia
        "Middle East",
        "Central Asia",
        "South Asia",
        "Southeast Asia",
        "East Asia",
        # Europe
        "Northern Europe",
        "Western Europe",
        "Eastern Europe",
        "Southern Europe",
        # Oceania
        "Australia/New Zealand",
        "Melanesia",
        "Micronesia",
        "Polynesia",
        # Antarctica
        "Antarctica",
    }
)


class CountryRecognition(str, Enum):
    """Country recognition status."""

    UN_MEMBER = "un_member"
    OBSERVER = "observer"
    DISPUTED = "disputed"
    TERRITORY = "territory"
    DEPENDENT_TERRITORY = "dependent_territory"
    SPECIAL_REGION = "special_region"
    CONSTITUENT_COUNTRY = "constituent_country"


class UserCountryStatus(str, Enum):
    """User-country association status."""

    VISITED = "visited"
    WISHLIST = "wishlist"


class Country(BaseModel):
    """Country response model."""

    id: UUID
    code: str
    name: str
    region: str
    subregion: str | None = None
    flag_url: str | None = None
    recognition: CountryRecognition


class UserCountry(BaseModel):
    """User country association response model."""

    id: UUID
    user_id: UUID
    country_id: UUID
    country_code: str  # 2-letter ISO code for frontend compatibility
    status: UserCountryStatus
    created_at: datetime
    added_during_onboarding: bool = False


class UserCountryWithCountry(BaseModel):
    """User country with nested country details."""

    id: UUID
    user_id: UUID
    country_id: UUID
    status: UserCountryStatus
    created_at: datetime
    added_during_onboarding: bool = False
    country: Country | None = None


class UserCountryCreate(BaseModel):
    """Request to create/update user country association."""

    country_code: str  # 2-letter ISO code, looked up to UUID on backend
    status: UserCountryStatus
    added_during_onboarding: bool = False

    @field_validator("country_code")
    @classmethod
    def validate_country_code(cls, v: str) -> str:
        """Validate and normalize country code to 2 uppercase letters."""
        v = v.upper()
        if not re.match(r"^[A-Z]{2}$", v):
            raise ValueError("Country code must be exactly 2 letters")
        return v


class UserCountryBatchUpdate(BaseModel):
    """Batch update user countries."""

    countries: list[UserCountryCreate]

    @field_validator("countries")
    @classmethod
    def validate_countries_batch(
        cls, v: list[UserCountryCreate]
    ) -> list[UserCountryCreate]:
        """Validate batch size and reject duplicate entries."""
        if len(v) > 100:
            raise ValueError("Cannot update more than 100 countries at once")

        # Check for duplicate country codes
        seen: set[str] = set()
        duplicates: list[str] = []
        for item in v:
            code = item.country_code.upper()
            if code in seen:
                duplicates.append(code)
            seen.add(code)

        if duplicates:
            raise ValueError(
                f"Duplicate country codes: {', '.join(sorted(set(duplicates)))}"
            )

        return v
