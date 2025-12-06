"""Schemas for country and user_countries endpoints."""

import re
from datetime import datetime
from enum import Enum
from uuid import UUID

from pydantic import BaseModel, field_validator


class CountryRecognition(str, Enum):
    """Country recognition status."""

    UN_MEMBER = "un_member"
    OBSERVER = "observer"
    DISPUTED = "disputed"
    TERRITORY = "territory"


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


class UserCountryWithCountry(BaseModel):
    """User country with nested country details."""

    id: UUID
    user_id: UUID
    country_id: UUID
    status: UserCountryStatus
    created_at: datetime
    country: Country | None = None


class UserCountryCreate(BaseModel):
    """Request to create/update user country association."""

    country_code: str  # 2-letter ISO code, looked up to UUID on backend
    status: UserCountryStatus

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
