"""Schemas for affiliate outbound redirect service."""

from datetime import datetime
from enum import Enum
from uuid import UUID

from pydantic import BaseModel, Field, field_validator

from app.core.validators import validate_link


class OutboundLinkStatus(str, Enum):
    """Status of an outbound link."""

    ACTIVE = "active"
    PAUSED = "paused"
    ARCHIVED = "archived"


class ResolutionPath(str, Enum):
    """How the destination URL was resolved."""

    DIRECT_PARTNER = "direct_partner"
    SKIMLINKS = "skimlinks"
    ORIGINAL = "original"


class OutboundLinkCreate(BaseModel):
    """Request to create an outbound link."""

    entry_id: UUID
    destination_url: str = Field(..., max_length=2048)
    partner_slug: str | None = Field(None, max_length=50)
    affiliate_url: str | None = Field(None, max_length=2048)

    @field_validator("destination_url", "affiliate_url")
    @classmethod
    def validate_urls(cls, v: str | None) -> str | None:
        """Validate URL format."""
        return validate_link(v)


class OutboundLinkUpdate(BaseModel):
    """Request to update an outbound link."""

    destination_url: str | None = Field(None, max_length=2048)
    partner_slug: str | None = Field(None, max_length=50)
    affiliate_url: str | None = Field(None, max_length=2048)
    status: OutboundLinkStatus | None = None

    @field_validator("destination_url", "affiliate_url")
    @classmethod
    def validate_urls(cls, v: str | None) -> str | None:
        """Validate URL format."""
        return validate_link(v)


class OutboundLink(BaseModel):
    """Outbound link definition."""

    id: UUID
    entry_id: UUID | None = None
    destination_url: str
    partner_slug: str | None = None
    affiliate_url: str | None = None
    status: OutboundLinkStatus
    created_at: datetime
    updated_at: datetime


class OutboundClickCreate(BaseModel):
    """Data for logging a click."""

    link_id: UUID
    trip_id: UUID | None = None
    entry_id: UUID | None = None
    source: str = Field(..., max_length=50)
    resolution: ResolutionPath
    destination_url: str
    user_agent: str | None = Field(None, max_length=512)
    ip_country: str | None = Field(None, max_length=2)
    referer: str | None = Field(None, max_length=2048)


class OutboundClick(BaseModel):
    """Outbound click log entry."""

    id: UUID
    link_id: UUID
    trip_id: UUID | None = None
    entry_id: UUID | None = None
    source: str
    resolution: ResolutionPath
    destination_url: str
    user_agent: str | None = None
    ip_country: str | None = None
    referer: str | None = None
    clicked_at: datetime


class PartnerMappingCreate(BaseModel):
    """Request to create a partner mapping."""

    entry_id: UUID | None = None
    google_place_id: str | None = Field(None, max_length=255)
    partner_slug: str = Field(..., max_length=50)
    partner_property_id: str = Field(..., max_length=255)
    confidence: float = Field(0.0, ge=0.0, le=1.0)
    is_verified: bool = False


class PartnerMappingUpdate(BaseModel):
    """Request to update a partner mapping."""

    partner_property_id: str | None = Field(None, max_length=255)
    confidence: float | None = Field(None, ge=0.0, le=1.0)
    is_verified: bool | None = None


class PartnerMapping(BaseModel):
    """Partner mapping for direct affiliate links."""

    id: UUID
    entry_id: UUID | None = None
    google_place_id: str | None = None
    partner_slug: str
    partner_property_id: str
    confidence: float
    is_verified: bool
    created_at: datetime
    updated_at: datetime


class SkimlinksCacheEntry(BaseModel):
    """Cached Skimlinks-wrapped URL."""

    id: UUID
    original_url: str
    wrapped_url: str
    created_at: datetime
    expires_at: datetime


class RedirectContext(BaseModel):
    """Validated context for a redirect request."""

    link_id: UUID
    trip_id: UUID | None = None
    entry_id: UUID | None = None
    source: str = Field(..., max_length=50)
    signature: str = Field(..., min_length=1)

    @field_validator("source")
    @classmethod
    def validate_source(cls, v: str) -> str:
        """Validate source is a known value."""
        allowed = {"trip_share", "list_share", "in_app"}
        if v not in allowed:
            raise ValueError(f"source must be one of: {', '.join(allowed)}")
        return v


class RedirectResponse(BaseModel):
    """Response data for a successful redirect (used for logging/testing)."""

    destination_url: str
    resolution: ResolutionPath
    partner_slug: str | None = None
