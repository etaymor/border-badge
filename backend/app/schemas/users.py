"""Schemas for user search and profile endpoints."""

import re
from datetime import datetime
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field, field_validator


class UserProfileDB(BaseModel):
    """User profile from database (raw)."""

    id: UUID
    user_id: UUID
    username: str | None = None
    display_name: str
    avatar_url: str | None = None
    created_at: datetime
    updated_at: datetime | None = None

    model_config = ConfigDict(from_attributes=True)


class UserSummary(BaseModel):
    """User summary for API responses with computed fields."""

    id: UUID
    username: str
    avatar_url: str | None = None
    country_count: int = Field(
        default=0, description="Number of countries visited by this user"
    )
    is_following: bool = Field(
        default=False, description="Whether current user follows this user"
    )
    is_blocked: bool = Field(
        default=False, description="Whether bidirectional block exists"
    )

    model_config = ConfigDict(from_attributes=True)


class UsernameCheckRequest(BaseModel):
    """Request to check username availability."""

    username: str = Field(..., min_length=3, max_length=30)

    @field_validator("username")
    @classmethod
    def validate_username_format(cls, v: str) -> str:
        """Validate username format."""
        if not re.match(r"^[a-zA-Z0-9_]+$", v):
            raise ValueError(
                "Username can only contain letters, numbers, and underscores"
            )
        return v


class UsernameCheckResponse(BaseModel):
    """Response for username availability check."""

    available: bool
    suggestions: list[str] = Field(
        default_factory=list,
        description="Suggested alternatives if username is unavailable",
    )


class UsernameUpdateRequest(BaseModel):
    """Request to update username."""

    username: str = Field(..., min_length=3, max_length=30)

    @field_validator("username")
    @classmethod
    def validate_username_format(cls, v: str) -> str:
        """Validate username format."""
        if not re.match(r"^[a-zA-Z0-9_]+$", v):
            raise ValueError(
                "Username can only contain letters, numbers, and underscores"
            )
        return v


class UsernameUpdateResponse(BaseModel):
    """Response after updating username."""

    username: str
    message: str = "Username updated successfully"
