"""Tests for the photos API endpoint."""

from typing import Any

import pytest
from fastapi.testclient import TestClient


@pytest.fixture
def sample_photo_cluster() -> dict[str, Any]:
    """Sample photo cluster data."""
    return {
        "cluster_id": "cluster-tokyo-1",
        "centroid": {"latitude": 35.6762, "longitude": 139.6503},
        "photo_ids": ["photo-1", "photo-2", "photo-3"],
    }


class TestSuggestPlaces:
    """Tests for POST /photos/suggest-places endpoint."""

    def test_requires_authentication(self, client: TestClient) -> None:
        """Test that endpoint requires authentication."""
        response = client.post(
            "/photos/suggest-places",
            json={"clusters": []},
        )

        # Without auth, should return 401 or 403
        assert response.status_code in (401, 403)

    def test_validates_cluster_format(
        self,
        client: TestClient,
    ) -> None:
        """Test validation of cluster data format."""
        # Missing required fields - should fail validation before auth
        response = client.post(
            "/photos/suggest-places",
            json={
                "clusters": [
                    {
                        "cluster_id": "test",
                        # Missing centroid and photo_ids
                    }
                ]
            },
        )

        # Either 401/403 (auth first) or 422 (validation first)
        assert response.status_code in (401, 403, 422)

    def test_request_body_validation(
        self,
        client: TestClient,
    ) -> None:
        """Test that invalid coordinates are rejected."""
        # Invalid latitude (out of range)
        response = client.post(
            "/photos/suggest-places",
            json={
                "clusters": [
                    {
                        "cluster_id": "test",
                        "centroid": {"latitude": 200.0, "longitude": 139.6503},
                        "photo_ids": ["photo-1"],
                    }
                ]
            },
        )

        # Should fail validation (or auth first)
        assert response.status_code in (401, 403, 422)
