"""Tests for the photo_vision classifier service."""

import asyncio
import json
import logging
from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock, patch

import httpx
import pytest

from app.core import http_client as http_client_module
from app.core.config import Settings, get_settings
from app.core.http_client import (
    VISION_MAX_CONNECTIONS,
    VISION_MAX_KEEPALIVE_CONNECTIONS,
    VISION_POOL_TIMEOUT_SECONDS,
    get_http_client,
    get_vision_client,
)
from app.services.photo_vision import PhotoClassifier, VisionResult
from app.services.photo_vision import classifier as classifier_module
from app.services.photo_vision.classifier import (
    MAX_CONCURRENT_VISION_REQUESTS,
    classify_cluster_photos,
)
from app.services.photo_vision.constants import (
    VISION_NULL_TIMEOUT,
    VISION_NULL_UNKNOWN,
)
from app.services.place_matcher import PlaceMatcher
from app.services.place_matcher.instrumentation import request_metrics

# ============================================================================
# VisionResult.has_business_name Tests
# ============================================================================


class TestVisionResultHasBusinessName:
    """Tests for VisionResult.has_business_name property."""

    def test_returns_true_for_multi_word_non_generic_text(self) -> None:
        """Multi-word text that isn't generic should indicate a business name."""
        result = VisionResult(
            category="food",
            detected_text=["Sushi Dai"],
            confidence="high",
        )
        assert result.has_business_name is True

    def test_returns_true_for_single_word_proper_names(self) -> None:
        """One-word venue names (Noma, Nobu) count as business names."""
        for name in ["Noma", "Septime", "Starbucks"]:
            result = VisionResult(
                category="food",
                detected_text=[name],
                confidence="high",
            )
            assert result.has_business_name is True, f"'{name}' should qualify"

    def test_returns_false_for_single_generic_venue_words(self) -> None:
        """Standalone venue-category nouns (RESTAURANT, CAFE) are not names."""
        for word in ["Restaurant", "CAFE", "Hotel", "BAR", "Pizza"]:
            result = VisionResult(
                category="food",
                detected_text=[word],
                confidence="high",
            )
            assert result.has_business_name is False, f"'{word}' should not qualify"

    def test_returns_false_for_short_single_words(self) -> None:
        """Single words under 4 characters are treated as OCR noise."""
        result = VisionResult(
            category="food",
            detected_text=["Tea", "123456"],
            confidence="high",
        )
        assert result.has_business_name is False

    def test_returns_false_for_generic_words(self) -> None:
        """Generic words like EXIT, OPEN should not count as business names."""
        for word in ["EXIT", "OPEN", "Welcome", "menu", "CLOSED"]:
            result = VisionResult(
                category="unknown",
                detected_text=[word],
                confidence="low",
            )
            assert result.has_business_name is False, (
                f"'{word}' should not be a business name"
            )

    def test_returns_false_for_empty_detected_text(self) -> None:
        """Empty detected text should return False."""
        result = VisionResult(category="food", detected_text=[], confidence="high")
        assert result.has_business_name is False

    def test_returns_false_when_all_words_are_generic(self) -> None:
        """Multi-word text where every word is generic should return False."""
        result = VisionResult(
            category="food",
            detected_text=["open menu"],
            confidence="high",
        )
        assert result.has_business_name is False

    def test_returns_true_with_mixed_detected_text(self) -> None:
        """If any detected_text entry is a valid business name, return True."""
        result = VisionResult(
            category="food",
            detected_text=["EXIT", "Tonkatsu Maisen", "OPEN"],
            confidence="high",
        )
        assert result.has_business_name is True


# ============================================================================
# VisionResult.business_name_candidates Tests
# ============================================================================


class TestVisionResultBusinessNameCandidates:
    """Tests for VisionResult.business_name_candidates property."""

    def test_single_word_proper_names_are_candidates(self) -> None:
        """One-word venue names qualify; generic venue nouns do not."""
        result = VisionResult(
            category="food",
            detected_text=["Starbucks", "Restaurant", "Tsukiji Fish Market"],
            confidence="high",
        )
        candidates = result.business_name_candidates
        assert candidates == ["Starbucks", "Tsukiji Fish Market"]

    def test_filters_generic_words(self) -> None:
        """Generic text should be excluded from candidates."""
        result = VisionResult(
            category="food",
            detected_text=["no smoking", "Ichiran Ramen", "OPEN"],
            confidence="high",
        )
        candidates = result.business_name_candidates
        assert candidates == ["Ichiran Ramen"]

    def test_returns_empty_list_for_no_candidates(self) -> None:
        """When no text qualifies, return empty list."""
        result = VisionResult(
            category="unknown",
            detected_text=["EXIT", "PUSH", "OPEN"],
            confidence="low",
        )
        assert result.business_name_candidates == []

    def test_returns_multiple_candidates(self) -> None:
        """Multiple valid business names should all be returned."""
        result = VisionResult(
            category="food",
            detected_text=["Sushi Dai", "Tsukiji Fish Market"],
            confidence="high",
        )
        candidates = result.business_name_candidates
        assert len(candidates) == 2
        assert "Sushi Dai" in candidates
        assert "Tsukiji Fish Market" in candidates

    def test_strips_whitespace_from_candidates(self) -> None:
        """Candidates should have leading/trailing whitespace stripped."""
        result = VisionResult(
            category="food",
            detected_text=["  Sushi Dai  "],
            confidence="high",
        )
        candidates = result.business_name_candidates
        assert candidates == ["Sushi Dai"]


# ============================================================================
# PhotoClassifier._parse_response Tests
# ============================================================================


class TestParseResponse:
    """Tests for PhotoClassifier._parse_response static method."""

    def test_valid_json_returns_vision_result(self) -> None:
        """Valid JSON with all fields should return a VisionResult."""
        content = json.dumps(
            {
                "category": "food",
                "detected_text": ["Sushi Dai", "Tsukiji"],
                "confidence": "high",
                "reasoning": "Restaurant interior with sushi counter visible",
            }
        )

        result = PhotoClassifier._parse_response(content)

        assert result is not None
        assert result.category == "food"
        assert result.detected_text == ["Sushi Dai", "Tsukiji"]
        assert result.confidence == "high"

    def test_invalid_json_returns_none(self) -> None:
        """Non-JSON content should return None."""
        result = PhotoClassifier._parse_response("not json at all")
        assert result is None

    def test_non_dict_json_returns_none(self) -> None:
        """JSON that parses to non-dict (e.g. list) should return None."""
        result = PhotoClassifier._parse_response("[1, 2, 3]")
        assert result is None

    def test_unknown_category_defaults_to_unknown(self) -> None:
        """Unrecognized category should default to 'unknown'."""
        content = json.dumps(
            {
                "category": "weather",
                "detected_text": [],
                "confidence": "high",
                "reasoning": "test",
            }
        )

        result = PhotoClassifier._parse_response(content)

        assert result is not None
        assert result.category == "unknown"

    def test_unknown_confidence_defaults_to_low(self) -> None:
        """Unrecognized confidence should default to 'low'."""
        content = json.dumps(
            {
                "category": "food",
                "detected_text": [],
                "confidence": "very_high",
                "reasoning": "test",
            }
        )

        result = PhotoClassifier._parse_response(content)

        assert result is not None
        assert result.confidence == "low"

    def test_missing_fields_use_defaults(self) -> None:
        """Missing fields should use sensible defaults."""
        content = json.dumps({})

        result = PhotoClassifier._parse_response(content)

        assert result is not None
        assert result.category == "unknown"
        assert result.detected_text == []
        assert result.confidence == "low"

    def test_landmark_name_parsed(self) -> None:
        """U5: the model's recognized-landmark name is carried through."""
        content = json.dumps(
            {
                "category": "landmark",
                "detected_text": [],
                "confidence": "high",
                "reasoning": "test",
                "landmark_name": "Eiffel Tower",
            }
        )

        result = PhotoClassifier._parse_response(content)

        assert result is not None
        assert result.landmark_name == "Eiffel Tower"

    def test_landmark_name_absent_or_blank_is_none(self) -> None:
        """Older responses without the field (and blank strings) yield None."""
        assert PhotoClassifier._parse_response(json.dumps({})).landmark_name is None
        blank = json.dumps(
            {
                "category": "landmark",
                "detected_text": [],
                "confidence": "high",
                "reasoning": "test",
                "landmark_name": "   ",
            }
        )
        assert PhotoClassifier._parse_response(blank).landmark_name is None

    def test_landmark_name_in_strict_schema(self) -> None:
        """The strict response schema must declare (and require) the field."""
        from app.services.photo_vision.constants import (
            CLASSIFICATION_RESPONSE_FORMAT,
        )

        schema = CLASSIFICATION_RESPONSE_FORMAT["json_schema"]["schema"]
        assert "landmark_name" in schema["properties"]
        assert "landmark_name" in schema["required"]

    def test_detected_text_non_list_defaults_to_empty(self) -> None:
        """If detected_text is not a list, default to empty list."""
        content = json.dumps(
            {
                "category": "food",
                "detected_text": "just a string",
                "confidence": "high",
                "reasoning": "test",
            }
        )

        result = PhotoClassifier._parse_response(content)

        assert result is not None
        assert result.detected_text == []

    def test_detected_text_filters_falsy_items(self) -> None:
        """Empty strings and None values in detected_text should be filtered."""
        content = json.dumps(
            {
                "category": "food",
                "detected_text": ["Sushi Dai", "", None, "Menu"],
                "confidence": "high",
                "reasoning": "test",
            }
        )

        result = PhotoClassifier._parse_response(content)

        assert result is not None
        assert result.detected_text == ["Sushi Dai", "Menu"]

    def test_all_valid_categories_accepted(self) -> None:
        """Every valid category should be accepted without defaulting."""
        valid_categories = [
            "food",
            "landmark",
            "stay",
            "shopping",
            "nature",
            "nightlife",
            "transport",
            "unknown",
        ]
        for cat in valid_categories:
            content = json.dumps(
                {
                    "category": cat,
                    "detected_text": [],
                    "confidence": "high",
                    "reasoning": "test",
                }
            )
            result = PhotoClassifier._parse_response(content)
            assert result is not None
            assert result.category == cat, f"Category '{cat}' should be accepted"

    def test_all_valid_confidence_levels_accepted(self) -> None:
        """Every valid confidence level should be accepted without defaulting."""
        for level in ["high", "medium", "low"]:
            content = json.dumps(
                {
                    "category": "food",
                    "detected_text": [],
                    "confidence": level,
                    "reasoning": "test",
                }
            )
            result = PhotoClassifier._parse_response(content)
            assert result is not None
            assert result.confidence == level, (
                f"Confidence '{level}' should be accepted"
            )

    def test_invalid_json_logs_warning(self, caplog) -> None:
        """Invalid JSON should log a warning."""
        with caplog.at_level(logging.WARNING):
            PhotoClassifier._parse_response("not json at all")
        assert "not valid JSON" in caplog.text

    def test_valid_json_does_not_log_warning(self, caplog) -> None:
        """Valid JSON should not produce any warnings."""
        with caplog.at_level(logging.WARNING):
            PhotoClassifier._parse_response('{"category": "food"}')
        assert caplog.text == ""


# ============================================================================
# PhotoClassifier.aggregate_results Tests
# ============================================================================


class TestAggregateResults:
    """Tests for PhotoClassifier.aggregate_results static method."""

    def test_returns_none_for_empty_or_none_results(self) -> None:
        assert PhotoClassifier.aggregate_results([]) is None
        assert PhotoClassifier.aggregate_results([None, None]) is None

    def test_picks_weighted_majority_category(self) -> None:
        results = [
            VisionResult(category="food", detected_text=["A"], confidence="high"),
            VisionResult(category="food", detected_text=["B"], confidence="medium"),
            VisionResult(category="landmark", detected_text=["C"], confidence="high"),
        ]

        merged = PhotoClassifier.aggregate_results(results)

        assert merged is not None
        assert merged.category == "food"
        assert merged.confidence in {"high", "medium"}

    def test_deduplicates_detected_text_case_insensitively(self) -> None:
        results = [
            VisionResult(
                category="food",
                detected_text=["Sushi Dai", "Menu"],
                confidence="high",
            ),
            VisionResult(
                category="food",
                detected_text=["sushi dai", "Open"],
                confidence="medium",
            ),
        ]

        merged = PhotoClassifier.aggregate_results(results)

        assert merged is not None
        assert merged.detected_text == ["Sushi Dai", "Menu", "Open"]

    def test_landmark_name_carried_from_highest_confidence(self) -> None:
        """U5: aggregation keeps the most confident photo's landmark name."""
        results = [
            VisionResult(
                category="landmark",
                detected_text=[],
                confidence="low",
                landmark_name="Sacré-Cœur",
            ),
            VisionResult(
                category="landmark",
                detected_text=[],
                confidence="high",
                landmark_name="Eiffel Tower",
            ),
            VisionResult(category="landmark", detected_text=[], confidence="medium"),
        ]

        merged = PhotoClassifier.aggregate_results(results)

        assert merged is not None
        assert merged.landmark_name == "Eiffel Tower"

    def test_landmark_name_none_when_no_photo_has_one(self) -> None:
        results = [
            VisionResult(category="landmark", detected_text=[], confidence="high"),
        ]

        merged = PhotoClassifier.aggregate_results(results)

        assert merged is not None
        assert merged.landmark_name is None


# ============================================================================
# PhotoClassifier.classify — empty choices edge cases
# ============================================================================


class TestClassifyEmptyChoices:
    """Regression: API returning empty choices array must not raise IndexError."""

    @pytest.mark.asyncio
    async def test_empty_choices_array_returns_none(self) -> None:
        """When the API returns {"choices": []}, classify should return None."""
        mock_response = MagicMock()
        mock_response.status_code = 200
        mock_response.json.return_value = {"choices": []}

        mock_client = AsyncMock()
        mock_client.post.return_value = mock_response

        with (
            patch(
                "app.services.photo_vision.classifier.get_vision_client",
                return_value=mock_client,
            ),
            patch(
                "app.services.photo_vision.classifier.get_settings",
            ) as mock_settings,
        ):
            mock_settings.return_value.openrouter_api_key = "test-key"
            mock_settings.return_value.multimodal_model = "test-model"
            mock_settings.return_value.base_url = "http://test"

            classifier = PhotoClassifier(timeout=5.0)
            result = await classifier.classify("base64data")

        assert result is None

    @pytest.mark.asyncio
    async def test_missing_choices_key_returns_none(self) -> None:
        """When the API returns {} (no choices key), classify should return None."""
        mock_response = MagicMock()
        mock_response.status_code = 200
        mock_response.json.return_value = {}

        mock_client = AsyncMock()
        mock_client.post.return_value = mock_response

        with (
            patch(
                "app.services.photo_vision.classifier.get_vision_client",
                return_value=mock_client,
            ),
            patch(
                "app.services.photo_vision.classifier.get_settings",
            ) as mock_settings,
        ):
            mock_settings.return_value.openrouter_api_key = "test-key"
            mock_settings.return_value.multimodal_model = "test-model"
            mock_settings.return_value.base_url = "http://test"

            classifier = PhotoClassifier(timeout=5.0)
            result = await classifier.classify("base64data")

        assert result is None


# ============================================================================
# classify_cluster_photos — exception logging Tests
# ============================================================================


class TestClassifyClusterPhotosLogging:
    """Exceptions from vision classification must be logged, not silently swallowed."""

    @pytest.mark.asyncio
    async def test_logs_per_image_exceptions(self, caplog) -> None:
        """When an individual image classification raises, it should be logged."""
        clusters = [
            {
                "id": "cluster-1",
                "vision_images_base64": ["img1"],
            }
        ]

        with (
            patch.object(
                PhotoClassifier,
                "classify",
                side_effect=RuntimeError("API exploded"),
            ),
            caplog.at_level(logging.WARNING),
        ):
            result = await classify_cluster_photos(clusters)

        assert "cluster-1" not in result
        assert "Vision classification exception" in caplog.text
        assert "API exploded" in caplog.text

    @pytest.mark.asyncio
    async def test_logs_cluster_level_exceptions(self, caplog) -> None:
        """When an entire cluster task raises, it should be logged."""
        clusters = [
            {
                "id": "cluster-1",
                "vision_images_base64": ["img1"],
            }
        ]

        async def exploding_classify(_self, _img):
            raise RuntimeError("cluster boom")

        with (
            patch.object(PhotoClassifier, "classify", exploding_classify),
            caplog.at_level(logging.WARNING),
        ):
            result = await classify_cluster_photos(clusters)

        assert "cluster-1" not in result
        assert "boom" in caplog.text


# ============================================================================
# VisionResult dataclass field safety
# ============================================================================


class TestVisionResultFieldSafety:
    """VisionResult must reject unexpected keyword arguments."""

    def test_rejects_unknown_reasoning_field(self) -> None:
        """Passing reasoning= to VisionResult must raise TypeError."""
        with pytest.raises(TypeError, match="reasoning"):
            VisionResult(
                category="food",
                detected_text=["test"],
                confidence="high",
                reasoning="should not exist",  # type: ignore[call-arg]
            )


# ============================================================================
# U12 — vision concurrency bounds and null-outcome recording
# ============================================================================


class TestVisionConcurrencyBounds:
    """The vision fan-out is bounded per request AND process-wide (U12/R19)."""

    @staticmethod
    async def _release_after_drain(gate: asyncio.Event) -> None:
        """Set ``gate`` once every startable classification has started.

        Semaphore acquisition does not yield when a slot is free, so letting
        the loop turn a hundred times is enough for every task the bounds
        permit to be in flight — and no real time passes.
        """
        for _ in range(100):
            await asyncio.sleep(0)
        gate.set()

    @staticmethod
    def _batch(clusters: int, images: int, prefix: str = "r0") -> list[dict]:
        return [
            {
                "id": f"{prefix}-c{c}",
                "vision_images_base64": [f"{prefix}-c{c}-i{i}" for i in range(images)],
            }
            for c in range(clusters)
        ]

    def test_default_bound_equals_the_previous_constant(self) -> None:
        """Merging U12 must not change runtime behaviour on its own."""
        field = Settings.model_fields["vision_max_concurrent_requests"]
        assert field.default == MAX_CONCURRENT_VISION_REQUESTS == 5

    def test_bound_reads_from_settings(self, monkeypatch) -> None:
        """The per-request bound comes from the settings field."""
        monkeypatch.setattr(
            classifier_module,
            "get_settings",
            lambda: SimpleNamespace(vision_max_concurrent_requests=15),
        )
        per_request, process_wide = classifier_module.resolve_vision_concurrency()
        assert per_request == 15
        assert process_wide == classifier_module.MAX_CONCURRENT_VISION_REQUESTS_PROCESS

    def test_bound_falls_back_to_previous_constant(self, monkeypatch) -> None:
        """A settings object without the field degrades to today's value."""
        monkeypatch.setattr(
            classifier_module, "get_settings", lambda: SimpleNamespace()
        )
        per_request, _ = classifier_module.resolve_vision_concurrency()
        assert per_request == MAX_CONCURRENT_VISION_REQUESTS

    def test_per_request_bound_never_exceeds_process_bound(self, monkeypatch) -> None:
        """A misconfigured value must not let one request hold every slot."""
        monkeypatch.setattr(
            classifier_module,
            "get_settings",
            lambda: SimpleNamespace(vision_max_concurrent_requests=9999),
        )
        per_request, process_wide = classifier_module.resolve_vision_concurrency()
        assert per_request == process_wide

    @pytest.mark.asyncio
    async def test_full_batch_classifies_in_one_wave(self, monkeypatch) -> None:
        """R19: at the single-wave value, 5 clusters x 3 images run concurrently."""
        monkeypatch.setattr(
            get_settings(),
            "vision_max_concurrent_requests",
            classifier_module.SINGLE_WAVE_VISION_CONCURRENCY,
        )
        clusters = self._batch(clusters=5, images=3)
        total_images = 15
        assert classifier_module.SINGLE_WAVE_VISION_CONCURRENCY == total_images

        gate = asyncio.Event()
        active = 0
        peak = 0

        async def fake_classify(_self, _image_base64: str):
            nonlocal active, peak
            active += 1
            peak = max(peak, active)
            try:
                await gate.wait()
            finally:
                active -= 1
            return VisionResult(category="food", confidence="high")

        monkeypatch.setattr(PhotoClassifier, "classify", fake_classify)

        release = asyncio.create_task(self._release_after_drain(gate))
        result = await classify_cluster_photos(clusters)
        await release

        assert peak == total_images, "batch did not classify in a single wave"
        assert len(result) == 5

    @pytest.mark.asyncio
    async def test_process_bound_holds_across_concurrent_requests(
        self, monkeypatch
    ) -> None:
        """Concurrent requests share one ceiling, and none holds every slot."""
        monkeypatch.setattr(
            classifier_module, "MAX_CONCURRENT_VISION_REQUESTS_PROCESS", 8
        )
        monkeypatch.setattr(get_settings(), "vision_max_concurrent_requests", 5)

        gate = asyncio.Event()
        active_total = 0
        peak_total = 0
        active_by_request: dict[str, int] = {}
        peak_by_request: dict[str, int] = {}

        async def fake_classify(_self, image_base64: str):
            nonlocal active_total, peak_total
            request_id = image_base64.split("-", 1)[0]
            active_total += 1
            peak_total = max(peak_total, active_total)
            active_by_request[request_id] = active_by_request.get(request_id, 0) + 1
            peak_by_request[request_id] = max(
                peak_by_request.get(request_id, 0), active_by_request[request_id]
            )
            try:
                await gate.wait()
            finally:
                active_total -= 1
                active_by_request[request_id] -= 1
            return VisionResult(category="food", confidence="high")

        monkeypatch.setattr(PhotoClassifier, "classify", fake_classify)

        release = asyncio.create_task(self._release_after_drain(gate))
        await asyncio.gather(
            *[
                classify_cluster_photos(
                    self._batch(clusters=5, images=2, prefix=f"r{r}")
                )
                for r in range(3)
            ]
        )
        await release

        assert peak_total == 8, "process-wide ceiling was not saturated"
        assert peak_total <= 8, "process-wide ceiling was exceeded"
        assert peak_by_request, "no per-request activity recorded"
        assert max(peak_by_request.values()) <= 5
        assert max(peak_by_request.values()) < peak_total, (
            "a single request held every process slot"
        )


class TestVisionNullOutcomeRecording:
    """A null classification is recorded, not silently swallowed (U12)."""

    @pytest.mark.asyncio
    async def test_timeout_is_recorded_as_a_null_outcome(self, monkeypatch) -> None:
        """A vision timeout lands in the metrics as a timeout-attributed null."""
        monkeypatch.setattr(get_settings(), "openrouter_api_key", "test-key")

        class _TimingOutClient:
            async def post(self, *_args, **_kwargs):
                raise httpx.TimeoutException("vision timed out")

        monkeypatch.setattr(
            classifier_module, "get_vision_client", lambda: _TimingOutClient()
        )

        clusters = [{"id": "cluster-1", "vision_images_base64": ["img1"]}]

        with request_metrics() as metrics:
            result = await classify_cluster_photos(clusters)

        assert result == {}
        assert metrics.vision_images_null == 1
        assert metrics.vision_null_reasons[VISION_NULL_TIMEOUT] == 1
        assert metrics.vision_null_reasons[VISION_NULL_UNKNOWN] == 0
        snapshot_vision = metrics.snapshot()["vision"]
        assert snapshot_vision["null_reasons"][VISION_NULL_TIMEOUT] == 1

    @pytest.mark.asyncio
    async def test_null_reasons_sum_to_the_null_image_count(self, monkeypatch) -> None:
        """Unattributable nulls are counted, never dropped."""

        async def fake_classify(_self, _image_base64: str):
            return None

        monkeypatch.setattr(PhotoClassifier, "classify", fake_classify)

        clusters = [{"id": "cluster-1", "vision_images_base64": ["a", "b"]}]

        with request_metrics() as metrics:
            await classify_cluster_photos(clusters)

        assert metrics.vision_images_null == 2
        assert sum(metrics.vision_null_reasons.values()) == 2

    @pytest.mark.asyncio
    async def test_ranking_still_functions_when_vision_returns_nothing(
        self, monkeypatch
    ) -> None:
        """An all-null batch yields no vision signal, and ranking still ranks."""

        async def fake_classify(_self, _image_base64: str):
            return None

        monkeypatch.setattr(PhotoClassifier, "classify", fake_classify)

        cluster = {
            "id": "cluster-1",
            "centroid": {"latitude": 35.6762, "longitude": 139.6503},
            "vision_images_base64": ["img1"],
        }
        vision_map = await classify_cluster_photos([cluster])
        assert vision_map == {}

        places = [
            {
                "id": "far-1",
                "displayName": {"text": "Far Cafe"},
                "location": {"latitude": 35.6800, "longitude": 139.6503},
                "userRatingCount": 200,
                "rating": 4.2,
                "primaryType": "cafe",
                "types": ["cafe"],
            },
            {
                "id": "near-1",
                "displayName": {"text": "Near Sushi"},
                "location": {"latitude": 35.67625, "longitude": 139.6503},
                "userRatingCount": 200,
                "rating": 4.2,
                "primaryType": "restaurant",
                "types": ["restaurant"],
            },
        ]
        matcher = PlaceMatcher(http_client=AsyncMock())
        ranked = matcher._rank_by_distance(
            places, cluster, vision_result=vision_map.get(cluster["id"])
        )

        assert [p["place_id"] for p in ranked] == ["near-1", "far-1"]
        assert all(p["vision_category"] is None for p in ranked)


# ============================================================================
# U8 — the vision fan-out's own pool and its slot-acquisition ceiling
# ============================================================================


class TestVisionHasItsOwnConnectionPool:
    """Vision ran on the shared app client, whose budget it does not fit."""

    @pytest.fixture(autouse=True)
    def _reset_clients(self):
        http_client_module._vision_client = None
        http_client_module._http_client = None
        yield
        http_client_module._vision_client = None
        http_client_module._http_client = None

    def test_vision_does_not_share_the_app_wide_client(self) -> None:
        assert get_vision_client() is not get_http_client()

    def test_the_classifier_resolves_the_private_getter(self) -> None:
        """The bug was `classify` calling `get_http_client()` directly."""
        assert classifier_module.get_vision_client is get_vision_client
        assert classifier_module.get_vision_client is not get_http_client
        assert not hasattr(classifier_module, "get_http_client")

    def test_the_pool_is_sized_above_the_process_ceiling(self) -> None:
        with patch.object(http_client_module.httpx, "AsyncClient") as ctor:
            get_vision_client()

        limits = ctor.call_args.kwargs["limits"]
        assert limits.max_connections == VISION_MAX_CONNECTIONS
        assert limits.max_keepalive_connections == VISION_MAX_KEEPALIVE_CONNECTIONS
        # Slot starvation (fast, counted) must be the binding constraint, not
        # pool exhaustion (a header-less transport error).
        assert (
            VISION_MAX_CONNECTIONS
            > classifier_module.MAX_CONCURRENT_VISION_REQUESTS_PROCESS
        )
        # And every one of those connections must survive between chunks.
        assert (
            VISION_MAX_KEEPALIVE_CONNECTIONS
            >= classifier_module.MAX_CONCURRENT_VISION_REQUESTS_PROCESS
        )

    def test_the_shared_client_keepalive_budget_is_no_longer_the_constraint(
        self,
    ) -> None:
        """The bug: a 30-slot ceiling on a 20-keepalive shared pool."""
        with patch.object(http_client_module.httpx, "AsyncClient") as ctor:
            get_http_client()
        shared_keepalive = ctor.call_args.kwargs["limits"].max_keepalive_connections

        assert shared_keepalive == 20
        assert (
            classifier_module.MAX_CONCURRENT_VISION_REQUESTS_PROCESS > shared_keepalive
        ), "the premise changed; re-check the sizing note in http_client.py"
        assert VISION_MAX_KEEPALIVE_CONNECTIONS > shared_keepalive

    @pytest.mark.asyncio
    async def test_classify_uses_the_private_client(self, monkeypatch) -> None:
        monkeypatch.setattr(get_settings(), "openrouter_api_key", "test-key")
        used: list[object] = []

        class _Client:
            async def post(self, *_args, **kwargs):
                used.append(self)
                response = MagicMock()
                response.status_code = 200
                response.json.return_value = {"choices": []}
                return response

        sentinel = _Client()
        monkeypatch.setattr(classifier_module, "get_vision_client", lambda: sentinel)

        await PhotoClassifier(timeout=5.0).classify("image")

        assert used == [sentinel]

    @pytest.mark.asyncio
    async def test_the_pool_wait_keeps_its_own_short_budget(self, monkeypatch) -> None:
        """A slow model must not also be how long we wait for a connection."""
        monkeypatch.setattr(get_settings(), "openrouter_api_key", "test-key")
        seen: dict[str, object] = {}

        class _Client:
            async def post(self, *_args, **kwargs):
                seen["timeout"] = kwargs["timeout"]
                response = MagicMock()
                response.status_code = 200
                response.json.return_value = {"choices": []}
                return response

        monkeypatch.setattr(classifier_module, "get_vision_client", lambda: _Client())

        await PhotoClassifier(timeout=5.0).classify("image")

        timeout = seen["timeout"]
        assert isinstance(timeout, httpx.Timeout)
        assert timeout.read == 5.0
        assert timeout.pool == VISION_POOL_TIMEOUT_SECONDS
        assert timeout.pool != timeout.read


class TestVisionSlotAcquisitionIsBounded:
    """A process ceiling with an unbounded wait is a queue, not a bound."""

    @pytest.mark.asyncio
    async def test_a_starved_image_becomes_a_null_rather_than_waiting_forever(
        self, monkeypatch, caplog
    ) -> None:
        monkeypatch.setattr(
            classifier_module, "MAX_CONCURRENT_VISION_REQUESTS_PROCESS", 1
        )
        monkeypatch.setattr(classifier_module, "VISION_SLOT_WAIT_CEILING_SECONDS", 0.02)
        monkeypatch.setattr(get_settings(), "vision_max_concurrent_requests", 1)

        async def never_called(_self, _image_base64: str):
            raise AssertionError("classified without a process slot")

        monkeypatch.setattr(PhotoClassifier, "classify", never_called)

        # Hold the only process-wide slot for the whole test.
        semaphore = classifier_module._get_process_semaphore(1)
        await semaphore.acquire()
        try:
            clusters = [{"id": "cluster-1", "vision_images_base64": ["img"]}]
            with caplog.at_level(logging.WARNING), request_metrics() as metrics:
                result = await asyncio.wait_for(
                    classify_cluster_photos(clusters), timeout=5.0
                )
        finally:
            semaphore.release()

        assert result == {}
        assert metrics.vision_images_null == 1
        # Attributed, not swallowed: the reason names the local bound.
        assert classifier_module.VISION_NULL_SLOT_UNAVAILABLE in caplog.text
        # And the reasons still account for every null image.
        assert sum(metrics.vision_null_reasons.values()) == 1

    @pytest.mark.asyncio
    async def test_the_ceiling_matches_the_places_slot_ceiling(self) -> None:
        """Both bound a purely LOCAL saturation wait; neither may dominate."""
        from app.services.place_matcher.constants import (
            PLACES_SLOT_WAIT_CEILING_SECONDS,
        )

        assert (
            classifier_module.VISION_SLOT_WAIT_CEILING_SECONDS
            == PLACES_SLOT_WAIT_CEILING_SECONDS
        )
