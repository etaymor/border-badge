"""Schemas for media_files endpoints."""

from datetime import datetime
from enum import Enum
from typing import Any
from uuid import UUID

from pydantic import BaseModel


class MediaStatus(str, Enum):
    """Media file processing status."""

    PROCESSING = "processing"
    UPLOADED = "uploaded"
    FAILED = "failed"


class MediaFile(BaseModel):
    """Media file response model."""

    id: UUID
    owner_id: UUID
    entry_id: UUID | None = None
    trip_id: UUID | None = None
    file_path: str
    thumbnail_path: str | None = None
    exif: dict[str, Any] | None = None
    status: MediaStatus
    created_at: datetime


class SignedUrlRequest(BaseModel):
    """Request for a signed upload URL."""

    filename: str
    content_type: str
    trip_id: UUID | None = None
    entry_id: UUID | None = None


class SignedUrlResponse(BaseModel):
    """Response with signed upload URL."""

    media_id: UUID
    upload_url: str
    file_path: str


class MediaStatusUpdate(BaseModel):
    """Request to update media status after upload."""

    status: MediaStatus
    thumbnail_path: str | None = None
    exif: dict[str, Any] | None = None
