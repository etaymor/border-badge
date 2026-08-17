"""PlaceMatcher class for matching photo clusters to nearby places."""

import httpx

from app.core.config import get_settings

from ._matcher_cluster_processing import ClusterProcessingMixin
from ._matcher_ranking import RankingMixin
from ._matcher_search import SearchMixin
from .utils import haversine


class PlaceMatcher(ClusterProcessingMixin, SearchMixin, RankingMixin):
    """
    Matches photo clusters to nearby places using Google Places API.

    Caller owns the httpx.AsyncClient lifecycle - use with `async with` pattern.
    """

    def __init__(
        self,
        http_client: httpx.AsyncClient,
    ) -> None:
        """
        Initialize the place matcher.

        Args:
            http_client: Async HTTP client (caller owns lifecycle)
        """
        self._client = http_client
        self._settings = get_settings()

    # Keep static method for backward compatibility with tests
    @staticmethod
    def _haversine(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
        """Backward-compatible wrapper for haversine function."""
        return haversine(lat1, lon1, lat2, lon2)
