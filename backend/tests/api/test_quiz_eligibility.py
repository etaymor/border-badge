"""Tests for the travel photo quiz vision eligibility gate (U2).

Covers:
- Draft-creation anchor: POST /quiz creates a 'building' quiz owned by the caller.
- Eligibility gate: only outdoor scenery/landmark/building-exterior photos with
  no people are eligible (R2); everything else fails closed.
- Fail-closed parsing: malformed model JSON or a missing per-image result marks
  that image ineligible without failing the batch.
- Transport failures (timeout/network) surface as a retryable "error" status,
  distinct from "ineligible".
- Server-side budgets: per-draft classification cap (~70) anchored on the quiz
  row's classified_count, and a global daily circuit breaker reserved
  atomically through the reserve_daily_classification RPC (durable counter,
  migration 0060).
- Request caps mirroring the photos endpoint: <=50 images, per-image and total
  payload size limits (rejected, not truncated -- images ARE the payload here).

The OpenRouter transport is mocked (CI has no credentials) at the same seam the
existing photo-vision tests use: quiz_classifier's get_http_client.
"""

import base64
import json
from typing import Any
from unittest.mock import AsyncMock, MagicMock, patch

import httpx
import pytest
from fastapi.testclient import TestClient

from app.core.config import get_settings
from app.core.security import AuthUser, get_current_user
from app.main import app, limiter
from tests.conftest import OTHER_USER_ID, TEST_USER_ID, mock_auth_dependency

TEST_QUIZ_ID = "660e8400-e29b-41d4-a716-446655440000"

# base64.b64encode(b"fake-jpeg-bytes") -- a small valid payload.
VALID_B64 = base64.b64encode(b"fake-jpeg-bytes").decode()


@pytest.fixture(autouse=True)
def reset_rate_limiter():
    """Endpoints are rate-limited at creation scale; keep tests independent."""
    limiter.reset()
    yield


@pytest.fixture(autouse=True)
def quiz_settings(monkeypatch):
    """Pin quiz/vision settings so results never vary by machine or .env."""
    settings = get_settings()
    monkeypatch.setattr(settings, "openrouter_api_key", "test-key")
    monkeypatch.setattr(settings, "multimodal_model", "test-model")
    monkeypatch.setattr(settings, "quiz_classification_budget_per_quiz", 70)
    monkeypatch.setattr(settings, "quiz_classification_daily_cap", 2000)
    yield


def _openrouter_response(payload: dict[str, Any] | str) -> MagicMock:
    """Build a mocked 200 OpenRouter chat-completion response."""
    content = payload if isinstance(payload, str) else json.dumps(payload)
    mock_response = MagicMock()
    mock_response.status_code = 200
    mock_response.json.return_value = {"choices": [{"message": {"content": content}}]}
    return mock_response


def _model_result(
    has_people: bool = False,
    setting: str = "outdoor",
    category: str = "landmark",
) -> dict[str, Any]:
    return {"has_people": has_people, "setting": setting, "category": category}


def _quiz_row(
    classified_count: int = 0,
    state: str = "building",
    owner_id: str = TEST_USER_ID,
) -> dict[str, Any]:
    return {
        "id": TEST_QUIZ_ID,
        "owner_id": owner_id,
        "state": state,
        "classified_count": classified_count,
    }


def _db(draft_row: dict[str, Any] | None = None) -> AsyncMock:
    """Mock Supabase client emulating the endpoint's quiz-table access.

    The draft fetch filters on id/owner_id/state; the mock honors those
    filters so ownership and lifecycle-state gating are actually exercised.
    The daily circuit breaker is the reserve_daily_classification RPC, which
    defaults to a successful (True) reservation; daily-cap tests flip
    db.rpc.return_value to False.
    """
    db = AsyncMock()

    def quiz_get(table: str, params: dict[str, Any] | None = None) -> list[dict]:
        assert table == "quiz"
        params = params or {}
        if "id" in params:
            if draft_row is None:
                return []
            if params["id"] != f"eq.{draft_row['id']}":
                return []
            if params.get("owner_id") != f"eq.{draft_row['owner_id']}":
                return []
            if (
                params.get("state") == "eq.building"
                and draft_row["state"] != "building"
            ):
                return []
            return [draft_row]
        return []

    db.get.side_effect = quiz_get
    db.patch.return_value = [dict(draft_row)] if draft_row else []
    db.post.return_value = [_quiz_row()]
    db.rpc.return_value = True  # PostgREST scalar boolean body
    return db


def _post_eligibility(
    client: TestClient,
    db: AsyncMock,
    model_responses: Any,
    images: list[dict[str, str]] | None = None,
    quiz_id: str = TEST_QUIZ_ID,
) -> tuple[Any, AsyncMock]:
    """POST /quiz/eligibility with mocked auth, DB, and OpenRouter transport."""
    if images is None:
        images = [{"id": "img-1", "image_base64": VALID_B64}]

    mock_http = AsyncMock()
    if isinstance(model_responses, BaseException):
        mock_http.post.side_effect = model_responses
    elif isinstance(model_responses, list):
        mock_http.post.side_effect = model_responses
    else:
        mock_http.post.return_value = model_responses

    app.dependency_overrides[get_current_user] = mock_auth_dependency(
        AuthUser(user_id=TEST_USER_ID)
    )
    try:
        with (
            patch("app.api.quiz.get_supabase_client", return_value=db),
            patch(
                "app.services.photo_vision.quiz_classifier.get_http_client",
                return_value=mock_http,
            ),
        ):
            response = client.post(
                "/quiz/eligibility",
                headers={"Authorization": "Bearer mock-jwt-token"},
                json={"quiz_id": quiz_id, "images": images},
            )
    finally:
        app.dependency_overrides.clear()
    return response, mock_http


# ============================================================================
# Draft creation anchor (minimal POST /quiz; U3 builds the full flow on it)
# ============================================================================


class TestCreateQuizDraft:
    def test_requires_authentication(self, client: TestClient) -> None:
        response = client.post("/quiz")
        assert response.status_code in (401, 403)

    def test_creates_building_draft_owned_by_caller(self, client: TestClient) -> None:
        db = _db()
        app.dependency_overrides[get_current_user] = mock_auth_dependency(
            AuthUser(user_id=TEST_USER_ID)
        )
        try:
            with patch("app.api.quiz.get_supabase_client", return_value=db):
                response = client.post(
                    "/quiz", headers={"Authorization": "Bearer mock-jwt-token"}
                )
        finally:
            app.dependency_overrides.clear()

        assert response.status_code == 201
        data = response.json()
        assert data["id"] == TEST_QUIZ_ID
        assert data["state"] == "building"
        # The insert must claim ownership for the caller and nothing else --
        # state/classified_count come from column defaults.
        db.post.assert_awaited_once_with("quiz", {"owner_id": TEST_USER_ID})


# ============================================================================
# Eligibility rules (R2): no people AND outdoor AND allowed category
# ============================================================================


class TestEligibilityRules:
    def test_requires_authentication(self, client: TestClient) -> None:
        response = client.post(
            "/quiz/eligibility",
            json={
                "quiz_id": TEST_QUIZ_ID,
                "images": [{"id": "img-1", "image_base64": VALID_B64}],
            },
        )
        assert response.status_code in (401, 403)

    def test_people_present_is_ineligible(self, client: TestClient) -> None:
        """AE1: a mocked response marking people-present must be ineligible."""
        response, _ = _post_eligibility(
            client,
            _db(_quiz_row()),
            _openrouter_response(
                _model_result(has_people=True, setting="outdoor", category="landmark")
            ),
        )
        assert response.status_code == 200
        result = response.json()["results"][0]
        assert result["eligible"] is False
        assert result["status"] == "ineligible"
        assert result["reason"] == "people_present"

    def test_indoor_is_ineligible(self, client: TestClient) -> None:
        response, _ = _post_eligibility(
            client,
            _db(_quiz_row()),
            _openrouter_response(
                _model_result(setting="indoor", category="building_exterior")
            ),
        )
        assert response.status_code == 200
        result = response.json()["results"][0]
        assert result["eligible"] is False
        assert result["reason"] == "indoor"

    def test_unclear_setting_fails_closed(self, client: TestClient) -> None:
        """Fail-closed: only a confident 'outdoor' passes the setting gate."""
        response, _ = _post_eligibility(
            client,
            _db(_quiz_row()),
            _openrouter_response(_model_result(setting="unclear", category="scenery")),
        )
        assert response.status_code == 200
        assert response.json()["results"][0]["eligible"] is False

    @pytest.mark.parametrize("category", ["scenery", "landmark", "building_exterior"])
    def test_outdoor_allowed_categories_are_eligible(
        self, client: TestClient, category: str
    ) -> None:
        response, _ = _post_eligibility(
            client,
            _db(_quiz_row()),
            _openrouter_response(_model_result(category=category)),
        )
        assert response.status_code == 200
        result = response.json()["results"][0]
        assert result["eligible"] is True
        assert result["status"] == "eligible"
        assert result["reason"] is None

    def test_other_category_is_ineligible(self, client: TestClient) -> None:
        response, _ = _post_eligibility(
            client,
            _db(_quiz_row()),
            _openrouter_response(_model_result(category="other")),
        )
        assert response.status_code == 200
        result = response.json()["results"][0]
        assert result["eligible"] is False
        assert result["reason"] == "category_not_allowed"

    def test_uses_quiz_prompt_not_import_prompt(self, client: TestClient) -> None:
        """KTD3: the request must carry the quiz prompt/schema, never the tuned
        photo-import classification prompt."""
        from app.services.photo_vision.constants import CLASSIFICATION_SYSTEM_PROMPT
        from app.services.photo_vision.quiz_constants import (
            QUIZ_ELIGIBILITY_RESPONSE_FORMAT,
            QUIZ_ELIGIBILITY_SYSTEM_PROMPT,
        )

        response, mock_http = _post_eligibility(
            client, _db(_quiz_row()), _openrouter_response(_model_result())
        )
        assert response.status_code == 200
        payload = mock_http.post.call_args.kwargs["json"]
        assert payload["model"] == "test-model"
        assert payload["messages"][0]["content"] == QUIZ_ELIGIBILITY_SYSTEM_PROMPT
        assert payload["response_format"] == QUIZ_ELIGIBILITY_RESPONSE_FORMAT
        assert QUIZ_ELIGIBILITY_SYSTEM_PROMPT != CLASSIFICATION_SYSTEM_PROMPT


# ============================================================================
# Fail-closed parsing and transport failures
# ============================================================================


class TestFailureModes:
    def test_malformed_model_json_fails_closed(self, client: TestClient) -> None:
        """Malformed model JSON => that image ineligible, batch still 200."""
        response, _ = _post_eligibility(
            client, _db(_quiz_row()), _openrouter_response("this is {{not json")
        )
        assert response.status_code == 200
        result = response.json()["results"][0]
        assert result["eligible"] is False
        assert result["status"] == "ineligible"
        assert result["reason"] == "unclassifiable"

    def test_missing_per_image_result_fails_closed(self, client: TestClient) -> None:
        """A short outcome list from the classifier must never default to
        eligible: missing entries are padded as ineligible."""
        db = _db(_quiz_row())
        app.dependency_overrides[get_current_user] = mock_auth_dependency(
            AuthUser(user_id=TEST_USER_ID)
        )
        try:
            with (
                patch("app.api.quiz.get_supabase_client", return_value=db),
                patch(
                    "app.api.quiz.classify_quiz_images",
                    new=AsyncMock(return_value=[]),
                ),
            ):
                response = client.post(
                    "/quiz/eligibility",
                    headers={"Authorization": "Bearer mock-jwt-token"},
                    json={
                        "quiz_id": TEST_QUIZ_ID,
                        "images": [{"id": "img-1", "image_base64": VALID_B64}],
                    },
                )
        finally:
            app.dependency_overrides.clear()

        assert response.status_code == 200
        result = response.json()["results"][0]
        assert result["eligible"] is False
        assert result["status"] == "ineligible"

    def test_timeout_is_retryable_error_not_ineligible(
        self, client: TestClient
    ) -> None:
        """An OpenRouter timeout is a service failure the client may retry --
        distinct from a definitive 'ineligible' verdict."""
        response, _ = _post_eligibility(
            client, _db(_quiz_row()), httpx.TimeoutException("timed out")
        )
        assert response.status_code == 200
        result = response.json()["results"][0]
        assert result["eligible"] is False
        assert result["status"] == "error"
        assert result["status"] != "ineligible"
        assert result["reason"] == "classification_unavailable"

    def test_missing_api_key_is_503_and_spends_no_budget(
        self, client: TestClient, monkeypatch
    ) -> None:
        monkeypatch.setattr(get_settings(), "openrouter_api_key", "")
        db = _db(_quiz_row())
        response, mock_http = _post_eligibility(
            client, db, _openrouter_response(_model_result())
        )
        assert response.status_code == 503
        mock_http.post.assert_not_called()
        db.patch.assert_not_called()


# ============================================================================
# Request caps (image count + payload size) -- rejected, not truncated
# ============================================================================


class TestRequestCaps:
    def test_over_image_cap_rejected(self, client: TestClient) -> None:
        images = [{"id": f"img-{i}", "image_base64": VALID_B64} for i in range(51)]
        response, mock_http = _post_eligibility(
            client, _db(_quiz_row()), _openrouter_response(_model_result()), images
        )
        assert response.status_code == 422
        mock_http.post.assert_not_called()

    def test_oversized_single_image_rejected(self, client: TestClient) -> None:
        images = [{"id": "img-1", "image_base64": "x" * 200_001}]
        response, _ = _post_eligibility(
            client, _db(_quiz_row()), _openrouter_response(_model_result()), images
        )
        assert response.status_code == 422

    def test_invalid_base64_rejected(self, client: TestClient) -> None:
        images = [{"id": "img-1", "image_base64": "not!valid@base64$$$"}]
        response, _ = _post_eligibility(
            client, _db(_quiz_row()), _openrouter_response(_model_result()), images
        )
        assert response.status_code == 422

    def test_over_total_payload_cap_rejected(self, client: TestClient) -> None:
        """41 max-size images pass the per-image cap but bust the request-wide
        payload cap (8M chars) -- rejected with a validation error."""
        big_b64 = base64.b64encode(b"\x00" * 150_000).decode()  # exactly 200k chars
        assert len(big_b64) == 200_000
        images = [{"id": f"img-{i}", "image_base64": big_b64} for i in range(41)]
        response, mock_http = _post_eligibility(
            client, _db(_quiz_row()), _openrouter_response(_model_result()), images
        )
        assert response.status_code == 422
        mock_http.post.assert_not_called()


# ============================================================================
# Per-draft budget (server-side, anchored on quiz.classified_count)
# ============================================================================


class TestPerDraftBudget:
    def test_batch_past_budget_rejected_before_any_model_call(
        self, client: TestClient
    ) -> None:
        """60 already classified + 20 more > 70 => rejected, zero spend."""
        db = _db(_quiz_row(classified_count=60))
        images = [{"id": f"img-{i}", "image_base64": VALID_B64} for i in range(20)]
        response, mock_http = _post_eligibility(
            client, db, _openrouter_response(_model_result()), images
        )
        assert response.status_code == 429
        detail = response.json()["detail"]
        assert detail["code"] == "QUIZ_CLASSIFICATION_BUDGET_EXCEEDED"
        assert detail["limit"] == 70
        assert detail["classified_count"] == 60
        mock_http.post.assert_not_called()
        db.patch.assert_not_called()

    def test_fresh_draft_has_fresh_budget(self, client: TestClient) -> None:
        """The same 20-image batch succeeds against a new draft."""
        db = _db(_quiz_row(classified_count=0))
        images = [{"id": f"img-{i}", "image_base64": VALID_B64} for i in range(20)]
        response, _ = _post_eligibility(
            client, db, _openrouter_response(_model_result()), images
        )
        assert response.status_code == 200
        data = response.json()
        assert len(data["results"]) == 20
        assert data["classified_count"] == 20
        assert data["budget_remaining"] == 50

    def test_budget_reserved_with_optimistic_lock(self, client: TestClient) -> None:
        """The reservation PATCH must be conditional on the classified_count it
        read, so two workers cannot double-spend the same budget slice."""
        db = _db(_quiz_row(classified_count=3))
        response, _ = _post_eligibility(
            client, db, _openrouter_response(_model_result())
        )
        assert response.status_code == 200
        patch_call = db.patch.await_args
        assert patch_call.args[0] == "quiz"
        assert patch_call.args[1] == {"classified_count": 4}
        assert patch_call.args[2]["classified_count"] == "eq.3"

    def test_concurrent_reservation_conflict_is_409(self, client: TestClient) -> None:
        db = _db(_quiz_row())
        db.patch.return_value = []  # optimistic lock lost
        response, mock_http = _post_eligibility(
            client, db, _openrouter_response(_model_result())
        )
        assert response.status_code == 409
        mock_http.post.assert_not_called()


# ============================================================================
# Draft ownership / lifecycle gating
# ============================================================================


class TestDraftGating:
    def test_unknown_draft_is_404(self, client: TestClient) -> None:
        response, _ = _post_eligibility(
            client, _db(draft_row=None), _openrouter_response(_model_result())
        )
        assert response.status_code == 404

    def test_other_users_draft_is_404(self, client: TestClient) -> None:
        response, _ = _post_eligibility(
            client,
            _db(_quiz_row(owner_id=OTHER_USER_ID)),
            _openrouter_response(_model_result()),
        )
        assert response.status_code == 404

    def test_non_building_draft_is_404(self, client: TestClient) -> None:
        response, _ = _post_eligibility(
            client,
            _db(_quiz_row(state="shared")),
            _openrouter_response(_model_result()),
        )
        assert response.status_code == 404


# ============================================================================
# Global daily circuit breaker (atomic reserve_daily_classification RPC:
# durable counter that draft deletion cannot reset, row-locked so racing
# workers cannot overshoot the cap)
# ============================================================================


class TestDailyCircuitBreaker:
    def test_denied_daily_reserve_is_service_limit_not_ineligible(
        self, client: TestClient, monkeypatch
    ) -> None:
        monkeypatch.setattr(get_settings(), "quiz_classification_daily_cap", 100)
        db = _db(_quiz_row())
        db.rpc.return_value = False  # atomic reserve denied: cap would overshoot
        images = [{"id": f"img-{i}", "image_base64": VALID_B64} for i in range(20)]
        response, mock_http = _post_eligibility(
            client, db, _openrouter_response(_model_result()), images
        )
        assert response.status_code == 503
        assert "results" not in response.json()
        assert response.headers.get("Retry-After") is not None
        mock_http.post.assert_not_called()
        # The whole daily decision is ONE atomic RPC: batch size + cap in,
        # boolean out -- no read-sum-compare the API could race on.
        db.rpc.assert_awaited_once_with(
            "reserve_daily_classification",
            {"p_count": 20, "p_cap": 100},
        )
        # Documented ordering: the per-draft optimistic reserve runs BEFORE
        # the daily reserve, so a denied day never strands global capacity --
        # it only tightens this draft's own budget.
        db.patch.assert_awaited_once()

    def test_granted_daily_reserve_proceeds(
        self, client: TestClient, monkeypatch
    ) -> None:
        monkeypatch.setattr(get_settings(), "quiz_classification_daily_cap", 100)
        db = _db(_quiz_row())
        db.rpc.return_value = True
        response, _ = _post_eligibility(
            client, db, _openrouter_response(_model_result())
        )
        assert response.status_code == 200
        db.rpc.assert_awaited_once_with(
            "reserve_daily_classification",
            {"p_count": 1, "p_cap": 100},
        )

    @pytest.mark.parametrize(
        "granted", [[True], [{"reserve_daily_classification": True}]]
    )
    def test_wrapped_rpc_true_shapes_proceed(
        self, client: TestClient, granted: Any
    ) -> None:
        """The client wrapper returns the JSON body as-is; wrapped shapes for
        a granted reservation must not fail closed."""
        db = _db(_quiz_row())
        db.rpc.return_value = granted
        response, _ = _post_eligibility(
            client, db, _openrouter_response(_model_result())
        )
        assert response.status_code == 200

    @pytest.mark.parametrize(
        "denied", [False, None, [], [False], [{"reserve_daily_classification": False}]]
    )
    def test_denied_and_malformed_rpc_shapes_fail_closed(
        self, client: TestClient, denied: Any
    ) -> None:
        """Any non-True reservation result -- including malformed bodies --
        must trip the breaker, never spend."""
        db = _db(_quiz_row())
        db.rpc.return_value = denied
        response, mock_http = _post_eligibility(
            client, db, _openrouter_response(_model_result())
        )
        assert response.status_code == 503
        mock_http.post.assert_not_called()


# ============================================================================
# Classifier parse unit tests (fail-closed defaults)
# ============================================================================


class TestQuizParseResponse:
    def test_valid_response_parses(self) -> None:
        from app.services.photo_vision.quiz_classifier import QuizEligibilityClassifier

        result = QuizEligibilityClassifier._parse_response(
            json.dumps(_model_result(category="scenery"))
        )
        assert result is not None
        assert result.eligible is True

    def test_invalid_json_returns_none(self) -> None:
        from app.services.photo_vision.quiz_classifier import QuizEligibilityClassifier

        assert QuizEligibilityClassifier._parse_response("nope{") is None

    def test_non_dict_returns_none(self) -> None:
        from app.services.photo_vision.quiz_classifier import QuizEligibilityClassifier

        assert QuizEligibilityClassifier._parse_response('["a"]') is None

    def test_missing_has_people_returns_none(self) -> None:
        """has_people is the safety-critical field: absent => unclassifiable."""
        from app.services.photo_vision.quiz_classifier import QuizEligibilityClassifier

        content = json.dumps({"setting": "outdoor", "category": "scenery"})
        assert QuizEligibilityClassifier._parse_response(content) is None

    def test_unknown_setting_defaults_to_unclear(self) -> None:
        from app.services.photo_vision.quiz_classifier import QuizEligibilityClassifier

        content = json.dumps(_model_result(setting="underwater"))
        result = QuizEligibilityClassifier._parse_response(content)
        assert result is not None
        assert result.setting == "unclear"
        assert result.eligible is False

    def test_unknown_category_defaults_to_other(self) -> None:
        from app.services.photo_vision.quiz_classifier import QuizEligibilityClassifier

        content = json.dumps(_model_result(category="selfie"))
        result = QuizEligibilityClassifier._parse_response(content)
        assert result is not None
        assert result.category == "other"
        assert result.eligible is False
