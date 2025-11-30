"""Common schemas shared across the application."""

from typing import Any

from pydantic import BaseModel


class ErrorResponse(BaseModel):
    """Standard error response format."""

    error: str
    message: str
    details: dict[str, Any] | None = None


class SuccessResponse(BaseModel):
    """Generic success response."""

    status: str = "ok"
