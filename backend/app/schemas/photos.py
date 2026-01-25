"""Pydantic schemas for photo import place suggestions.

These schemas handle the request/response types for the /photos/suggest-places
endpoint which matches photo GPS clusters to nearby places.

Coordinates are normalized server-side to 5 decimal places (~1.1m precision)
for accurate place matching. Since photos are from past trips (not real-time
tracking), this provides better accuracy without significant privacy concerns.
"""

from datetime import datetime

from pydantic import BaseModel, Field, field_validator, model_validator

from app.schemas.entries import EntryType

# Input validation constants
MAX_CLUSTERS_PER_REQUEST = 100
MAX_PHOTOS_PER_CLUSTER = 100
MAX_PHOTOS_PER_REQUEST = 500


def _normalize_coordinate_precision(value: float) -> float:
    """Normalize coordinate to 5 decimal places (~1.1m) for place matching.

    Uses 5 decimal places for better accuracy in dense urban areas.
    Since photos are from the past (not real-time tracking), PII concerns are minimal.
    """
    return round(value, 5)


class Coordinate(BaseModel):
    """GPS coordinate for place matching."""

    latitude: float = Field(..., ge=-90.0, le=90.0)
    longitude: float = Field(..., ge=-180.0, le=180.0)

    @field_validator("latitude")
    @classmethod
    def normalize_latitude_precision(cls, v: float) -> float:
        return _normalize_coordinate_precision(v)

    @field_validator("longitude")
    @classmethod
    def normalize_longitude_precision(cls, v: float) -> float:
        return _normalize_coordinate_precision(v)


class PhotoMetadata(BaseModel):
    """Minimal photo data for place matching."""

    asset_id: str = Field(..., min_length=1, max_length=256)
    latitude: float = Field(..., ge=-90.0, le=90.0)
    longitude: float = Field(..., ge=-180.0, le=180.0)
    timestamp: datetime | None = None

    @field_validator("latitude")
    @classmethod
    def normalize_latitude_precision(cls, v: float) -> float:
        return _normalize_coordinate_precision(v)

    @field_validator("longitude")
    @classmethod
    def normalize_longitude_precision(cls, v: float) -> float:
        return _normalize_coordinate_precision(v)


class PhotoCluster(BaseModel):
    """Cluster of photos at a location."""

    id: str = Field(..., min_length=1, max_length=64)
    centroid: Coordinate
    photos: list[PhotoMetadata] = Field(
        ..., min_length=1, max_length=MAX_PHOTOS_PER_CLUSTER
    )
    start_time: datetime | None = None
    end_time: datetime | None = None

    @model_validator(mode="after")
    def validate_time_range(self) -> "PhotoCluster":
        """Ensure start_time is not after end_time."""
        if self.start_time and self.end_time and self.start_time > self.end_time:
            raise ValueError("start_time must be before or equal to end_time")
        return self


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
    category: EntryType
    distance_m: float  # Users see "15m away" and decide Yes/No
    types: list[str] = Field(default_factory=list)


class ClusterSuggestion(BaseModel):
    """Suggestions for a single cluster."""

    cluster_id: str
    photo_ids: list[str]
    places: list[PlaceSuggestion]


class PlaceSuggestionResponse(BaseModel):
    """Response with place suggestions."""

    suggestions: list[ClusterSuggestion]
    failed_cluster_count: int = 0  # Clusters that timed out or failed to process
