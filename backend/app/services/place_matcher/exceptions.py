"""Exceptions for place matching operations."""


class PlaceMatcherError(Exception):
    """Base exception for place matching failures."""

    pass


class RateLimitError(PlaceMatcherError):
    """Google Places API rate limit exceeded (temporary, can retry)."""

    pass


class QuotaExhaustedError(PlaceMatcherError):
    """Google Places API quota exhausted (daily limit reached)."""

    pass


class ConfigurationError(PlaceMatcherError):
    """Service not properly configured (e.g., missing API key)."""

    pass
