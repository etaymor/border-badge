"""Pydantic schemas for photo import place suggestions.

These schemas handle the request/response types for the /photos/suggest-places
endpoint which matches photo GPS clusters to nearby places.
"""

from datetime import datetime
from typing import Literal

from pydantic import BaseModel, Field, field_validator

# Input validation constants
MAX_CLUSTERS_PER_REQUEST = 50
MAX_PHOTOS_PER_CLUSTER = 100
MAX_PHOTOS_PER_REQUEST = 500

# Entry category type
EntryCategory = Literal["food", "stay", "experience", "place"]


class Coordinate(BaseModel):
    """GPS coordinate with precision limiting for privacy."""

    latitude: float = Field(..., ge=-90.0, le=90.0)
    longitude: float = Field(..., ge=-180.0, le=180.0)

    @field_validator("latitude", "longitude")
    @classmethod
    def truncate_precision(cls, v: float) -> float:
        """Limit precision to 4 decimal places (~11m) for PII protection."""
        return round(v, 4)


class PhotoMetadata(BaseModel):
    """Minimal photo data for place matching."""

    asset_id: str = Field(..., min_length=1, max_length=256)
    latitude: float = Field(..., ge=-90.0, le=90.0)
    longitude: float = Field(..., ge=-180.0, le=180.0)
    timestamp: datetime | None = None

    @field_validator("latitude", "longitude")
    @classmethod
    def truncate_precision(cls, v: float) -> float:
        """Limit precision to 4 decimal places (~11m) for PII protection."""
        return round(v, 4)


class PhotoCluster(BaseModel):
    """Cluster of photos at a location."""

    id: str = Field(..., min_length=1, max_length=64)
    centroid: Coordinate
    photos: list[PhotoMetadata] = Field(
        ..., min_length=1, max_length=MAX_PHOTOS_PER_CLUSTER
    )
    start_time: datetime | None = None
    end_time: datetime | None = None


class PlaceSuggestionRequest(BaseModel):
    """Request for place suggestions from photo clusters."""

    clusters: list[PhotoCluster] = Field(
        ..., min_length=1, max_length=MAX_CLUSTERS_PER_REQUEST
    )

    @field_validator("clusters")
    @classmethod
    def validate_total_photos(cls, v: list[PhotoCluster]) -> list[PhotoCluster]:
        """Enforce maximum photos per request."""
        total = sum(len(c.photos) for c in v)
        if total > MAX_PHOTOS_PER_REQUEST:
            raise ValueError(
                f"Maximum {MAX_PHOTOS_PER_REQUEST} photos per request, got {total}"
            )
        return v


class PlaceSuggestion(BaseModel):
    """Place suggestion ranked by distance (no confidence scores - Yes/No UX)."""

    place_id: str
    name: str
    address: str
    location: Coordinate
    category: EntryCategory
    distance_m: float  # Users see "15m away" and decide Yes/No
    types: list[str] = []


class ClusterSuggestion(BaseModel):
    """Suggestions for a single cluster."""

    cluster_id: str
    photo_ids: list[str]
    places: list[PlaceSuggestion]


class PlaceSuggestionResponse(BaseModel):
    """Response with place suggestions."""

    suggestions: list[ClusterSuggestion]
