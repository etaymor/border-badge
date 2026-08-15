"""Server-side entitlement and cost-weighted limits on /photos/suggest-places (U16).

The endpoint fronts two metered paid APIs (Google Places and vision), so the
free-tier limit and the per-user cost ceiling have to be enforced HERE. A
device-side marker is a fast path, never the control: it does not survive a
reinstall, and it never sees the request at all.

Three separate controls are covered:

* the photo-import entitlement, checked before any paid call, with the R17
  exemption that keeps an already-charged trip completable;
* rolling per-minute budgets on the real cost drivers -- clusters and vision
  images -- which the request-count limit alone cannot bound;
* the per-request cluster ceiling, which rejects rather than truncates.
"""

import base64
from pathlib import Path
from typing import Any
from unittest.mock import AsyncMock, patch

import pytest
from fastapi.testclient import TestClient

from app.api.photos import SUGGEST_PLACES_BURST_LIMIT, SUGGEST_PLACES_RATE_LIMIT
from app.api.subscriptions import FREE_LIMITS
from app.core.config import get_settings
from app.core.security import AuthUser, get_current_user
from app.main import app, limiter
from app.schemas.photos import MAX_CLUSTERS_PER_REQUEST
from tests.conftest import TEST_TRIP_ID, TEST_USER_ID, mock_auth_dependency

OTHER_TRIP_ID = "550e8400-e29b-41d4-a716-4466554400aa"

MIGRATION = (
    Path(__file__).resolve().parents[3]
    / "supabase"
    / "migrations"
    / "0058_photo_import_entitlement_guard.sql"
)


def _cluster(index: int = 1, vision_images: int = 0) -> dict[str, Any]:
    image = base64.b64encode(b"img").decode()
    cluster: dict[str, Any] = {
        "id": f"cluster-{index}",
        "centroid": {"latitude": 35.6762, "longitude": 139.6503},
        "photos": [
            {"asset_id": f"photo-{index}", "latitude": 35.6762, "longitude": 139.6503}
        ],
    }
    if vision_images:
        cluster["vision_images_base64"] = [image] * vision_images
    return cluster


def _profile(
    status: str = "free",
    photo_import_count: int = 0,
    consumed_trip_id: str | None = None,
) -> dict[str, Any]:
    return {
        "subscription_status": status,
        "usage_photo_import_count": photo_import_count,
        "usage_photo_import_trip_id": consumed_trip_id,
    }


class _SpyMatcher:
    """Stand-in for PlaceMatcher that records whether it was ever used."""

    constructed = 0
    searched = 0

    def __init__(self, http_client: Any) -> None:
        type(self).constructed += 1

    async def find_places_for_clusters(
        self, clusters: list[dict], vision_results_task: Any = None
    ) -> tuple[list[dict], int]:
        type(self).searched += 1
        return [], 0


@pytest.fixture(autouse=True)
def _reset_limiter():
    """Keep this file's cost-budget spend out of every other test's window."""
    limiter.reset()
    yield
    limiter.reset()


@pytest.fixture
def vision_spy() -> AsyncMock:
    return AsyncMock(return_value={})


@pytest.fixture
def paid_calls(vision_spy: AsyncMock):
    """Patch both paid call sites and report whether either was reached."""
    _SpyMatcher.constructed = 0
    _SpyMatcher.searched = 0
    with (
        patch("app.api.photos.PlaceMatcher", _SpyMatcher),
        patch("app.api.photos.classify_cluster_photos", new=vision_spy),
    ):
        yield _SpyMatcher


@pytest.fixture
def as_user(mock_user: AuthUser):
    app.dependency_overrides[get_current_user] = mock_auth_dependency(mock_user)
    yield
    app.dependency_overrides.clear()


def _post(
    client: TestClient,
    auth_headers: dict[str, str],
    clusters: list[dict[str, Any]],
    trip_id: str | None = TEST_TRIP_ID,
):
    body: dict[str, Any] = {"clusters": clusters}
    if trip_id is not None:
        body["trip_id"] = trip_id
    return client.post("/photos/suggest-places", json=body, headers=auth_headers)


def _with_profile(profile: dict[str, Any] | None) -> Any:
    db = AsyncMock()
    db.get = AsyncMock(return_value=[profile] if profile else [])
    return patch("app.api.photos.get_supabase_client", return_value=db)


class TestPhotoImportEntitlement:
    """The free-tier photo import is enforced server-side, before any spend."""

    def test_consumed_free_import_is_rejected_before_any_paid_call(
        self,
        client: TestClient,
        auth_headers: dict[str, str],
        as_user: None,
        paid_calls: type[_SpyMatcher],
        vision_spy: AsyncMock,
    ) -> None:
        with _with_profile(
            _profile("free", photo_import_count=1, consumed_trip_id=OTHER_TRIP_ID)
        ):
            response = _post(client, auth_headers, [_cluster()])

        assert response.status_code == 402
        detail = response.json()["detail"]
        assert detail["code"] == "PHOTO_IMPORT_LIMIT_REACHED"
        assert detail["limit"] == FREE_LIMITS["photo_import"]
        assert detail["current_count"] == 1
        assert detail["consumed_trip_id"] == OTHER_TRIP_ID
        # Not a quota wall: the client tells a quota 503 from a transient one by
        # this header, and waiting changes nothing about an entitlement.
        assert "Retry-After" not in response.headers
        # Neither metered API was touched.
        assert paid_calls.constructed == 0
        assert paid_calls.searched == 0
        vision_spy.assert_not_awaited()

    def test_free_user_under_the_limit_is_allowed(
        self,
        client: TestClient,
        auth_headers: dict[str, str],
        as_user: None,
        paid_calls: type[_SpyMatcher],
    ) -> None:
        with _with_profile(_profile("free", photo_import_count=0)):
            response = _post(client, auth_headers, [_cluster()])

        assert response.status_code == 200
        assert paid_calls.searched == 1

    def test_reentering_the_consumed_trip_is_allowed(
        self,
        client: TestClient,
        auth_headers: dict[str, str],
        as_user: None,
        paid_calls: type[_SpyMatcher],
    ) -> None:
        """R17: the trip that was already charged stays completable."""
        with _with_profile(
            _profile("free", photo_import_count=1, consumed_trip_id=TEST_TRIP_ID)
        ):
            response = _post(client, auth_headers, [_cluster()], trip_id=TEST_TRIP_ID)

        assert response.status_code == 200
        assert paid_calls.searched == 1

    def test_exemption_survives_a_reinstall_because_it_is_server_side(
        self,
        client: TestClient,
        auth_headers: dict[str, str],
        as_user: None,
        paid_calls: type[_SpyMatcher],
    ) -> None:
        """No device marker is sent at all -- only the recorded trip decides."""
        with _with_profile(
            _profile("free", photo_import_count=1, consumed_trip_id=TEST_TRIP_ID)
        ):
            allowed = _post(client, auth_headers, [_cluster()], trip_id=TEST_TRIP_ID)
            denied = _post(client, auth_headers, [_cluster()], trip_id=OTHER_TRIP_ID)

        assert allowed.status_code == 200
        assert denied.status_code == 402

    def test_trip_id_comparison_is_case_insensitive(
        self,
        client: TestClient,
        auth_headers: dict[str, str],
        as_user: None,
        paid_calls: type[_SpyMatcher],
    ) -> None:
        with _with_profile(
            _profile(
                "free", photo_import_count=1, consumed_trip_id=TEST_TRIP_ID.upper()
            )
        ):
            response = _post(client, auth_headers, [_cluster()], trip_id=TEST_TRIP_ID)

        assert response.status_code == 200

    def test_consumed_import_without_a_trip_id_is_rejected(
        self,
        client: TestClient,
        auth_headers: dict[str, str],
        as_user: None,
        paid_calls: type[_SpyMatcher],
    ) -> None:
        """An older client that sends no trip cannot claim the exemption."""
        with _with_profile(
            _profile("free", photo_import_count=1, consumed_trip_id=TEST_TRIP_ID)
        ):
            response = _post(client, auth_headers, [_cluster()], trip_id=None)

        assert response.status_code == 402
        assert paid_calls.searched == 0

    @pytest.mark.parametrize("status", ["premium", "trial"])
    def test_premium_and_trial_callers_are_unaffected(
        self,
        status: str,
        client: TestClient,
        auth_headers: dict[str, str],
        as_user: None,
        paid_calls: type[_SpyMatcher],
    ) -> None:
        with _with_profile(_profile(status, photo_import_count=99)):
            response = _post(client, auth_headers, [_cluster()], trip_id=None)

        assert response.status_code == 200
        assert paid_calls.searched == 1

    def test_missing_profile_is_treated_as_a_new_free_user(
        self,
        client: TestClient,
        auth_headers: dict[str, str],
        as_user: None,
        paid_calls: type[_SpyMatcher],
    ) -> None:
        with _with_profile(None):
            response = _post(client, auth_headers, [_cluster()])

        assert response.status_code == 200

    def test_entitlement_lookup_failure_is_a_transient_503_without_retry_after(
        self,
        client: TestClient,
        auth_headers: dict[str, str],
        as_user: None,
        paid_calls: type[_SpyMatcher],
    ) -> None:
        db = AsyncMock()
        db.get = AsyncMock(side_effect=RuntimeError("supabase down"))
        with patch("app.api.photos.get_supabase_client", return_value=db):
            response = _post(client, auth_headers, [_cluster()])

        assert response.status_code == 503
        # Header-less, so the client reads it as a retryable blip rather than a
        # day-long quota wall (U4/U7 rule).
        assert "Retry-After" not in response.headers
        assert paid_calls.searched == 0


class TestCostWeightedBudgets:
    """Requests are not a unit of cost; clusters and vision images are."""

    def test_cluster_budget_rejects_while_request_count_limit_has_room(
        self,
        client: TestClient,
        auth_headers: dict[str, str],
        as_user: None,
        paid_calls: type[_SpyMatcher],
        monkeypatch: pytest.MonkeyPatch,
    ) -> None:
        settings = get_settings()
        monkeypatch.setattr(settings, "suggest_places_cluster_budget_per_minute", 4)

        clusters = [_cluster(i) for i in range(3)]
        with _with_profile(_profile("premium")):
            first = _post(client, auth_headers, clusters)
            second = _post(client, auth_headers, clusters)

        assert first.status_code == 200
        # Two requests is nowhere near the request-count allowance, but six
        # clusters is over the cluster budget.
        assert second.status_code == 429
        assert int(SUGGEST_PLACES_RATE_LIMIT.split("/")[0]) > 2
        assert int(SUGGEST_PLACES_BURST_LIMIT.split("/")[0]) > 2
        # A budget window really does reopen, so the wait is honest.
        assert second.headers["Retry-After"] == "60"
        assert paid_calls.searched == 1

    def test_vision_image_budget_rejects_independently_of_clusters(
        self,
        client: TestClient,
        auth_headers: dict[str, str],
        as_user: None,
        paid_calls: type[_SpyMatcher],
        monkeypatch: pytest.MonkeyPatch,
    ) -> None:
        settings = get_settings()
        monkeypatch.setattr(settings, "suggest_places_cluster_budget_per_minute", 100)
        monkeypatch.setattr(
            settings, "suggest_places_vision_image_budget_per_minute", 2
        )

        with _with_profile(_profile("premium")):
            response = _post(client, auth_headers, [_cluster(1, vision_images=3)])

        assert response.status_code == 429
        assert response.headers["Retry-After"] == "60"
        assert paid_calls.searched == 0

    def test_a_rejected_request_does_not_burn_the_other_budget(
        self,
        client: TestClient,
        auth_headers: dict[str, str],
        as_user: None,
        paid_calls: type[_SpyMatcher],
        monkeypatch: pytest.MonkeyPatch,
    ) -> None:
        """Both budgets are tested before either is charged."""
        settings = get_settings()
        monkeypatch.setattr(settings, "suggest_places_cluster_budget_per_minute", 2)
        monkeypatch.setattr(
            settings, "suggest_places_vision_image_budget_per_minute", 1
        )

        with _with_profile(_profile("premium")):
            rejected = _post(
                client, auth_headers, [_cluster(1, vision_images=2), _cluster(2)]
            )
            # The two clusters of the rejected request must not have been spent.
            allowed = _post(client, auth_headers, [_cluster(3), _cluster(4)])

        assert rejected.status_code == 429
        assert allowed.status_code == 200

    def test_budgets_default_above_one_honest_import_per_minute(self) -> None:
        """A real import is ~100 clusters with up to 3 vision images each."""
        settings = get_settings()
        assert settings.suggest_places_cluster_budget_per_minute >= 100
        assert settings.suggest_places_vision_image_budget_per_minute >= 300

    def test_budgets_are_below_the_uncapped_request_rate_fan_out(self) -> None:
        """The whole point: the budget must bite before the request limit does."""
        settings = get_settings()
        requests_per_minute = int(SUGGEST_PLACES_RATE_LIMIT.split("/")[0])
        uncapped_clusters = requests_per_minute * MAX_CLUSTERS_PER_REQUEST
        assert settings.suggest_places_cluster_budget_per_minute < uncapped_clusters


class TestPerRequestClusterCeiling:
    """The ceiling is a small multiple of the client's real batch size."""

    def test_ceiling_is_a_small_multiple_of_the_client_batch(self) -> None:
        client_chunk_size = 5
        assert MAX_CLUSTERS_PER_REQUEST <= client_chunk_size * 5

    def test_over_the_ceiling_is_rejected_not_truncated(
        self,
        client: TestClient,
        auth_headers: dict[str, str],
        as_user: None,
        paid_calls: type[_SpyMatcher],
    ) -> None:
        clusters = [_cluster(i) for i in range(MAX_CLUSTERS_PER_REQUEST + 1)]
        with _with_profile(_profile("premium")):
            response = _post(client, auth_headers, clusters)

        assert response.status_code == 422
        assert paid_calls.searched == 0, "over-ceiling request was silently truncated"

    def test_at_the_ceiling_is_accepted(
        self,
        client: TestClient,
        auth_headers: dict[str, str],
        as_user: None,
        paid_calls: type[_SpyMatcher],
    ) -> None:
        clusters = [_cluster(i) for i in range(MAX_CLUSTERS_PER_REQUEST)]
        with _with_profile(_profile("premium")):
            response = _post(client, auth_headers, clusters)

        assert response.status_code == 200


class TestUsageColumnsAreServerManaged:
    """Static checks on the migration that closes the counter-reset hole.

    There is no database in this suite, so these assert the shape of the DDL
    that makes the durable counter meaningful: without it, any client holding
    its own token could PATCH `usage_photo_import_count` back to zero.
    """

    @pytest.fixture(scope="class")
    def sql(self) -> str:
        return MIGRATION.read_text()

    def test_migration_exists(self, sql: str) -> None:
        assert "user_profile" in sql

    def test_a_trigger_guards_updates_to_the_protected_columns(self, sql: str) -> None:
        assert "BEFORE UPDATE ON user_profile" in sql
        assert "reject_client_subscription_writes" in sql
        for column in (
            "subscription_status",
            "subscription_plan",
            "subscription_expires_at",
            "revenuecat_customer_id",
            "usage_share_extension_count",
            "usage_photo_import_count",
            "usage_photo_import_trip_id",
        ):
            assert f"NEW.{column}" in sql, f"{column} is left client-writable"
        assert "RAISE EXCEPTION" in sql

    def test_the_increment_rpcs_stay_the_only_write_path(self, sql: str) -> None:
        # Trusted functions announce themselves with a transaction-local flag
        # rather than a role check -- inside SECURITY DEFINER, current_user is
        # the owner and session_user is PostgREST's 'authenticator' (0056).
        assert sql.count("set_config('app.subscription_write', 'on', true)") >= 3
        assert "GRANT EXECUTE ON FUNCTION increment_photo_import_usage" in sql
        assert "TO service_role" in sql

    def test_service_role_and_direct_admin_access_are_not_locked_out(
        self, sql: str
    ) -> None:
        assert "v_role = 'service_role'" in sql
        assert "current_user IN ('postgres', 'supabase_admin')" in sql

    def test_the_consumed_trip_is_recorded_beside_the_counter(self, sql: str) -> None:
        assert "ADD COLUMN IF NOT EXISTS usage_photo_import_trip_id UUID" in sql
        # First trip wins, and re-entering it must not spend a second import.
        assert "COALESCE(usage_photo_import_trip_id, p_trip_id)" in sql
        assert "RETURN current_count;" in sql

    def test_the_photo_import_rpc_has_exactly_one_overload(self, sql: str) -> None:
        """Two overloads would make PostgREST's resolution ambiguous (0046)."""
        assert "DROP FUNCTION IF EXISTS increment_photo_import_usage(UUID);" in sql
        assert sql.count("CREATE FUNCTION increment_photo_import_usage(") == 1


class TestUsageEndpointExposesTheConsumedTrip:
    """R17 needs the recorded trip at every gate, not just at the endpoint."""

    def test_usage_response_carries_the_consumed_trip_id(
        self,
        client: TestClient,
        auth_headers: dict[str, str],
        as_user: None,
        mock_supabase_client: AsyncMock,
    ) -> None:
        mock_supabase_client.get.return_value = [
            {
                "usage_share_extension_count": 0,
                "usage_photo_import_count": 1,
                "usage_share_extension_period_start": None,
                "usage_photo_import_trip_id": TEST_TRIP_ID,
            }
        ]
        with patch(
            "app.api.subscriptions.get_supabase_client",
            return_value=mock_supabase_client,
        ):
            response = client.get("/subscriptions/usage", headers=auth_headers)

        assert response.status_code == 200
        assert response.json()["photo_import_trip_id"] == TEST_TRIP_ID

    def test_increment_records_the_trip_that_consumed_the_import(
        self,
        client: TestClient,
        auth_headers: dict[str, str],
        as_user: None,
        mock_supabase_client: AsyncMock,
    ) -> None:
        mock_supabase_client.rpc.return_value = 1
        with patch(
            "app.api.subscriptions.get_supabase_client",
            return_value=mock_supabase_client,
        ):
            response = client.post(
                "/subscriptions/usage/increment",
                headers=auth_headers,
                json={"feature": "photo_import", "trip_id": TEST_TRIP_ID},
            )

        assert response.status_code == 200
        rpc_name, rpc_args = mock_supabase_client.rpc.call_args[0]
        assert rpc_name == "increment_photo_import_usage"
        assert rpc_args["p_user_id"] == TEST_USER_ID
        assert rpc_args["p_trip_id"] == TEST_TRIP_ID
