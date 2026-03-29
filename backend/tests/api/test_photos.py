"""Tests for the photos API endpoint."""

import base64
from typing import Any

import pytest
from fastapi.testclient import TestClient
from pydantic import ValidationError

from app.schemas.photos import PhotoCluster, PlaceSuggestionRequest


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

    def test_oversized_valid_base64_rejected_before_decode(self) -> None:
        """Length must be checked BEFORE base64.b64decode to prevent memory exhaustion."""
        oversized = base64.b64encode(b"\x00" * 200_001).decode()
        assert len(oversized) > 200_000  # valid base64 but too large
        with pytest.raises(ValidationError, match="<= 200000"):
            PhotoCluster(**_make_cluster(vision_images_base64=[oversized]))

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


class TestRequestLevelVisionImageLimit:
    """Request-level limit on total vision images across all clusters."""

    def test_total_vision_images_within_limit(self) -> None:
        """50 total vision images across clusters is accepted."""
        valid_b64 = base64.b64encode(b"img").decode()
        clusters = [
            _make_cluster(
                id=f"c-{i}",
                vision_images_base64=[valid_b64, valid_b64],
            )
            for i in range(25)
        ]
        req = PlaceSuggestionRequest(clusters=clusters)
        assert len(req.clusters) == 25

    def test_total_vision_images_exceeds_limit_truncates(self) -> None:
        """More than 50 total vision images are truncated, not rejected."""
        valid_b64 = base64.b64encode(b"img").decode()
        clusters = [
            _make_cluster(
                id=f"c-{i}",
                vision_images_base64=[valid_b64, valid_b64, valid_b64],
            )
            for i in range(18)  # 18 * 3 = 54 > 50
        ]
        req = PlaceSuggestionRequest(clusters=clusters)
        assert len(req.clusters) == 18
        # Total vision images should be capped at 50
        total_vision = sum(
            len(c.vision_images_base64)
            for c in req.clusters
            if c.vision_images_base64 is not None
        )
        assert total_vision <= 50


class TestRequestLevelVisionPayloadSize:
    """Total base64 payload across all clusters is truncated if over the limit."""

    def test_total_vision_payload_within_limit(self) -> None:
        """Clusters whose combined vision payload is under the limit are accepted."""
        valid_b64 = base64.b64encode(b"\x00" * 75_000).decode()  # ~100k chars
        clusters = [
            _make_cluster(
                id=f"c-{i}",
                vision_images_base64=[valid_b64],
            )
            for i in range(3)
        ]
        req = PlaceSuggestionRequest(clusters=clusters)
        assert len(req.clusters) == 3
        # All vision images preserved
        assert all(c.vision_images_base64 is not None for c in req.clusters)

    def test_typical_chunk_15_clusters_with_vision(self) -> None:
        """Regression: 15 clusters x 3 vision images (~4.5M chars) must not 422.

        The mobile app chunks clusters in groups of 15 and sends up to 3 vision
        images per cluster (~100K chars each). This previously exceeded the 2M
        limit and returned 422 Unprocessable Entity in production.
        """
        # Simulate realistic payload: ~100k chars per image
        img_b64 = base64.b64encode(b"\x00" * 75_000).decode()  # ~100k chars
        clusters = [
            _make_cluster(
                id=f"c-{i}",
                vision_images_base64=[img_b64, img_b64, img_b64],
            )
            for i in range(15)
        ]
        req = PlaceSuggestionRequest(clusters=clusters)
        assert len(req.clusters) == 15

    def test_total_vision_payload_exceeds_limit_truncates(self) -> None:
        """Payload over the limit is truncated, not rejected.

        Vision is optional — clusters still match by GPS without it.
        Earlier clusters keep their vision data; later ones get trimmed.
        """
        big_b64 = base64.b64encode(b"\x00" * 149_000).decode()  # ~199k chars each
        clusters = [
            _make_cluster(
                id=f"c-{i}",
                vision_images_base64=[big_b64, big_b64, big_b64],
            )
            for i in range(50)  # 50 clusters x 3 images x 199k = ~30M chars
        ]
        # Must NOT raise — truncates instead
        req = PlaceSuggestionRequest(clusters=clusters)
        assert len(req.clusters) == 50

        # Early clusters should keep their vision images
        assert req.clusters[0].vision_images_base64 is not None

        # Later clusters should have vision images truncated
        has_vision = sum(1 for c in req.clusters if c.vision_images_base64 is not None)
        assert has_vision < 50  # Some clusters lost their vision data


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
