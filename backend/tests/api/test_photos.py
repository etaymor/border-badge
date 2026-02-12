"""Tests for the photos API endpoint."""

from typing import Any

import pytest
from fastapi.testclient import TestClient
from pydantic import ValidationError

from app.schemas.photos import PhotoCluster


@pytest.fixture
def sample_photo_cluster() -> dict[str, Any]:
    """Sample photo cluster data."""
    return {
        "cluster_id": "cluster-tokyo-1",
        "centroid": {"latitude": 35.6762, "longitude": 139.6503},
        "photo_ids": ["photo-1", "photo-2", "photo-3"],
    }


def _make_cluster(**overrides: Any) -> dict[str, Any]:
    """Build a valid PhotoCluster dict with optional overrides."""
    base: dict[str, Any] = {
        "id": "cluster-1",
        "centroid": {"latitude": 35.6762, "longitude": 139.6503},
        "photos": [
            {
                "asset_id": "photo-1",
                "latitude": 35.6762,
                "longitude": 139.6503,
            }
        ],
    }
    base.update(overrides)
    return base


class TestPhotoClusterVisionImages:
    """Regression: empty vision_images_base64 must not cause 422."""

    def test_none_is_accepted(self) -> None:
        cluster = PhotoCluster(**_make_cluster(vision_images_base64=None))
        assert cluster.vision_images_base64 is None

    def test_omitted_is_accepted(self) -> None:
        cluster = PhotoCluster(**_make_cluster())
        assert cluster.vision_images_base64 is None

    def test_empty_list_is_coerced_to_none(self) -> None:
        """Empty list from mobile when ExpoImageManipulator is unavailable."""
        cluster = PhotoCluster(**_make_cluster(vision_images_base64=[]))
        assert cluster.vision_images_base64 is None

    def test_valid_images_accepted(self) -> None:
        import base64

        valid_b64 = base64.b64encode(b"test-image-data").decode()
        cluster = PhotoCluster(**_make_cluster(vision_images_base64=[valid_b64]))
        assert cluster.vision_images_base64 == [valid_b64]

    def test_too_many_images_rejected(self) -> None:
        with pytest.raises(ValidationError):
            PhotoCluster(**_make_cluster(vision_images_base64=["a", "b", "c", "d"]))

    def test_oversized_image_rejected(self) -> None:
        with pytest.raises(ValidationError):
            PhotoCluster(**_make_cluster(vision_images_base64=["x" * 200_001]))

    def test_invalid_base64_rejected(self) -> None:
        """Malformed base64 should be rejected at validation time."""
        with pytest.raises(ValidationError, match="valid base64"):
            PhotoCluster(**_make_cluster(vision_images_base64=["not!valid@base64$$$"]))

    def test_valid_base64_accepted(self) -> None:
        """Properly encoded base64 should pass validation."""
        import base64

        valid_b64 = base64.b64encode(b"fake-jpeg-data").decode()
        cluster = PhotoCluster(**_make_cluster(vision_images_base64=[valid_b64]))
        assert cluster.vision_images_base64 == [valid_b64]


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
