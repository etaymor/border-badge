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


class SlotUnavailableError(PlaceMatcherError):
    """No process-wide outbound slot became free within the wait ceiling (U7).

    A purely LOCAL saturation signal, like ``httpx.PoolTimeout`` and unlike a
    Google 429: it is never retried in-place (retrying would re-join the same
    queue) and never counted as an upstream rate limit, so it can neither feed
    the circuit breaker nor inflate the upstream-latency metrics. The work it
    aborts is retryable by the caller.
    """

    pass


class ConfigurationError(PlaceMatcherError):
    """Service not properly configured (e.g., missing API key)."""

    pass
