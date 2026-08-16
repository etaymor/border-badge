"""Server-side entitlement and cost-weighted limits on /photos/suggest-places (U16).

The endpoint fronts two metered paid APIs (Google Places and vision), so the
free-tier limit and the per-user cost ceiling have to be enforced HERE. A
device-side marker is a fast path, never the control: it does not survive a
reinstall, and it never sees the request at all.

Five separate controls are covered:

* the photo-import entitlement, checked before any paid call, with the R17
  exemption that keeps an already-charged trip completable -- bounded by a
  finite cluster allowance so it cannot be replayed forever;
* the server-side CHARGE, which spends that entitlement on the request that
  spent the money rather than trusting the client to report its own usage;
* rolling per-minute budgets on the real cost drivers -- clusters and vision
  images -- which the request-count limit alone cannot bound;
* the per-request cluster ceiling, which rejects rather than truncates;
* graceful degradation when the backend ships ahead of migration 0058.
"""

import base64
from collections.abc import Iterator
from contextlib import contextmanager
from pathlib import Path
from typing import Any
from unittest.mock import AsyncMock, patch

import pytest
from fastapi import HTTPException
from fastapi.testclient import TestClient

from app.api.photos import (
    _COST_BUDGET_SCOPES,
    SUGGEST_PLACES_BURST_LIMIT,
    SUGGEST_PLACES_RATE_LIMIT,
)
from app.api.subscriptions import FREE_LIMITS, PHOTO_IMPORT_CLUSTER_ALLOWANCE
from app.core.config import get_settings
from app.core.security import AuthUser, get_current_user
from app.main import app, limiter
from app.schemas.photos import MAX_CLUSTERS_PER_REQUEST
from tests.conftest import TEST_TRIP_ID, TEST_USER_ID, mock_auth_dependency

OTHER_TRIP_ID = "550e8400-e29b-41d4-a716-4466554400aa"
UNOWNED_TRIP_ID = "550e8400-e29b-41d4-a716-4466554400bb"

MIGRATION = (
    Path(__file__).resolve().parents[3]
    / "supabase"
    / "migrations"
    / "0058_photo_import_entitlement_guard.sql"
)

# What PostgREST answers when the backend selects a column the database does
# not have yet: a 400 carrying PostgreSQL's 42703. `SupabaseClient` keeps only
# the message, so this is the exact string the endpoint has to recognise.
MISSING_COLUMN_ERROR = HTTPException(
    status_code=400,
    detail=(
        "Database error: column user_profile.usage_photo_import_trip_id "
        "does not exist"
    ),
)

# ...and when it cannot resolve an RPC signature (PGRST202).
MISSING_RPC_ERROR = HTTPException(
    status_code=404,
    detail=(
        "Database error: Could not find the function "
        "public.increment_photo_import_usage(p_clusters, p_trip_id, p_user_id) "
        "in the schema cache"
    ),
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
    cluster_allowance: int = PHOTO_IMPORT_CLUSTER_ALLOWANCE,
) -> dict[str, Any]:
    return {
        "subscription_status": status,
        "usage_photo_import_count": photo_import_count,
        "usage_photo_import_trip_id": consumed_trip_id,
        "usage_photo_import_cluster_allowance": cluster_allowance,
    }


class _SpyMatcher:
    """Stand-in for PlaceMatcher that records whether it was ever used."""

    constructed = 0
    searched = 0
    result: tuple[list[dict], int] = ([], 0)
    # How many of `result`'s failures were OUR capacity refusing the work
    # rather than an upstream fault. Left at 0 by default so the doubles that
    # do not care about it behave exactly as before.
    capacity_failed: int = 0

    def __init__(self, http_client: Any) -> None:
        type(self).constructed += 1
        self.last_capacity_failed_cluster_count = 0

    async def find_places_for_clusters(
        self, clusters: list[dict], vision_results_task: Any = None
    ) -> tuple[list[dict], int]:
        type(self).searched += 1
        self.last_capacity_failed_cluster_count = type(self).capacity_failed
        return type(self).result


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
    _SpyMatcher.result = ([], 0)
    _SpyMatcher.capacity_failed = 0
    with (
        patch("app.api.photos.PlaceMatcher", _SpyMatcher),
        patch("app.api.photos.classify_cluster_photos", new=vision_spy),
    ):
        yield _SpyMatcher
    _SpyMatcher.result = ([], 0)


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


def _fake_db(
    profile: dict[str, Any] | None,
    owned_trips: tuple[str, ...] = (TEST_TRIP_ID, OTHER_TRIP_ID),
    profile_error: Exception | None = None,
    u16_columns_missing: bool = False,
    rpc_error: Exception | None = None,
) -> AsyncMock:
    """A Supabase stand-in that answers per TABLE, not per call order.

    The endpoint reads `user_profile` (entitlement) and, for a non-premium
    caller with a trip, `trip` (ownership). A positional side-effect list would
    couple every test to the order those happen to run in.
    """

    async def get(table: str, params: dict[str, Any] | None = None) -> Any:
        params = params or {}
        if table == "user_profile":
            if profile_error is not None:
                raise profile_error
            select = str(params.get("select", ""))
            if u16_columns_missing and "usage_photo_import_trip_id" in select:
                raise MISSING_COLUMN_ERROR
            if not profile:
                return []
            row = dict(profile)
            if u16_columns_missing:
                row.pop("usage_photo_import_trip_id", None)
                row.pop("usage_photo_import_cluster_allowance", None)
            return [row]
        if table == "trip":
            wanted = str(params.get("id", "")).removeprefix("eq.").lower()
            owned = {trip.lower() for trip in owned_trips}
            return [{"id": wanted}] if wanted in owned else []
        return []

    db = AsyncMock()
    db.get = AsyncMock(side_effect=get)
    db.rpc = (
        AsyncMock(side_effect=rpc_error) if rpc_error else AsyncMock(return_value=1)
    )
    return db


@contextmanager
def _with_profile(profile: dict[str, Any] | None, **kwargs: Any) -> Iterator[AsyncMock]:
    """Patch the endpoint's Supabase factory; yields the stand-in client."""
    db = _fake_db(profile, **kwargs)
    with patch("app.api.photos.get_supabase_client", return_value=db):
        yield db


def _charges(db: AsyncMock) -> list[dict[str, Any]]:
    """Every `increment_photo_import_usage` call the endpoint made."""
    return [
        call.args[1]
        for call in db.rpc.call_args_list
        if call.args and call.args[0] == "increment_photo_import_usage"
    ]


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

    def test_a_trip_the_caller_does_not_own_is_rejected(
        self,
        client: TestClient,
        auth_headers: dict[str, str],
        as_user: None,
        paid_calls: type[_SpyMatcher],
    ) -> None:
        """The trip id is the exemption key, so it has to be the caller's.

        Without this the caller fully controls the value that becomes their
        permanent exemption -- including another user's trip id.
        """
        with _with_profile(_profile("free", photo_import_count=0)) as db:
            response = _post(client, auth_headers, [_cluster()], UNOWNED_TRIP_ID)

        assert response.status_code == 403
        assert response.json()["detail"]["code"] == "PHOTO_IMPORT_TRIP_NOT_FOUND"
        assert paid_calls.searched == 0
        assert _charges(db) == []

    def test_trip_ownership_is_checked_against_the_callers_live_trips(
        self,
        client: TestClient,
        auth_headers: dict[str, str],
        as_user: None,
        paid_calls: type[_SpyMatcher],
    ) -> None:
        with _with_profile(_profile("free")) as db:
            _post(client, auth_headers, [_cluster()], TEST_TRIP_ID)

        trip_reads = [
            call.kwargs.get("params") or call.args[1]
            for call in db.get.call_args_list
            if call.args[0] == "trip"
        ]
        assert trip_reads, "ownership was never verified"
        assert trip_reads[0]["user_id"] == f"eq.{TEST_USER_ID}"
        assert trip_reads[0]["deleted_at"] == "is.null"

    def test_premium_callers_skip_the_ownership_read(
        self,
        client: TestClient,
        auth_headers: dict[str, str],
        as_user: None,
        paid_calls: type[_SpyMatcher],
    ) -> None:
        """Nothing to launder: premium has no entitlement a trip id can buy."""
        with _with_profile(_profile("premium")) as db:
            response = _post(client, auth_headers, [_cluster()], UNOWNED_TRIP_ID)

        assert response.status_code == 200
        assert [c.args[0] for c in db.get.call_args_list] == ["user_profile"]

    def test_an_ownership_lookup_failure_is_a_transient_503(
        self,
        client: TestClient,
        auth_headers: dict[str, str],
        as_user: None,
        paid_calls: type[_SpyMatcher],
    ) -> None:
        async def get(table: str, params: dict[str, Any] | None = None) -> Any:
            if table == "user_profile":
                return [_profile("free")]
            raise RuntimeError("supabase down")

        db = AsyncMock()
        db.get = AsyncMock(side_effect=get)
        with patch("app.api.photos.get_supabase_client", return_value=db):
            response = _post(client, auth_headers, [_cluster()])

        assert response.status_code == 503
        assert "Retry-After" not in response.headers
        assert paid_calls.searched == 0


class TestTheImportIsChargedServerSide:
    """The counter the gate enforces must be written by the SERVER.

    It used to be written only by the mobile client volunteering a call to
    `POST /subscriptions/usage/increment`. Blocking that one request -- a proxy
    rule, a firewall, a patched client -- left the count at 0 forever, so
    `photo_import_count < limit` was always true and the "authoritative"
    server-side gate was authoritative over a number the client controlled.
    """

    def test_a_successful_match_charges_the_import_without_the_client_asking(
        self,
        client: TestClient,
        auth_headers: dict[str, str],
        as_user: None,
        paid_calls: type[_SpyMatcher],
    ) -> None:
        clusters = [_cluster(i) for i in range(3)]
        with _with_profile(_profile("free", photo_import_count=0)) as db:
            response = _post(client, auth_headers, clusters)

        assert response.status_code == 200
        assert _charges(db) == [
            {
                "p_user_id": TEST_USER_ID,
                "p_trip_id": TEST_TRIP_ID,
                "p_clusters": len(clusters),
            }
        ]

    def test_the_charge_uses_the_service_role_not_the_callers_token(
        self,
        client: TestClient,
        auth_headers: dict[str, str],
        as_user: None,
        paid_calls: type[_SpyMatcher],
    ) -> None:
        """A charge made with the caller's token is a charge the caller can
        withhold. The entitlement READ stays user-scoped for RLS."""
        db = _fake_db(_profile("free"))
        with patch("app.api.photos.get_supabase_client", return_value=db) as factory:
            response = _post(client, auth_headers, [_cluster()])

        assert response.status_code == 200
        tokens = [call.kwargs.get("user_token") for call in factory.call_args_list]
        assert None in tokens, "the charge never used the service role"

    def test_premium_callers_are_never_charged(
        self,
        client: TestClient,
        auth_headers: dict[str, str],
        as_user: None,
        paid_calls: type[_SpyMatcher],
    ) -> None:
        with _with_profile(_profile("premium", photo_import_count=99)) as db:
            response = _post(client, auth_headers, [_cluster()])

        assert response.status_code == 200
        assert _charges(db) == []

    def test_a_request_whose_clusters_all_failed_is_not_charged(
        self,
        client: TestClient,
        auth_headers: dict[str, str],
        as_user: None,
        paid_calls: type[_SpyMatcher],
    ) -> None:
        """A user must not lose their one free import to an outage."""
        paid_calls.result = ([], 2)
        with _with_profile(_profile("free")) as db:
            response = _post(client, auth_headers, [_cluster(1), _cluster(2)])

        assert response.status_code == 200
        assert response.json()["failed_cluster_count"] == 2
        assert _charges(db) == []

    def test_a_partially_failed_request_is_still_charged(
        self,
        client: TestClient,
        auth_headers: dict[str, str],
        as_user: None,
        paid_calls: type[_SpyMatcher],
    ) -> None:
        paid_calls.result = ([], 1)
        with _with_profile(_profile("free")) as db:
            response = _post(client, auth_headers, [_cluster(1), _cluster(2)])

        assert response.status_code == 200
        assert len(_charges(db)) == 1

    def test_a_charge_failure_does_not_fail_the_request(
        self,
        client: TestClient,
        auth_headers: dict[str, str],
        as_user: None,
        paid_calls: type[_SpyMatcher],
    ) -> None:
        """Google was already paid and the results are valid; bookkeeping that
        fails is logged, not turned into a 5xx the client would retry into."""
        with _with_profile(
            _profile("free"), rpc_error=RuntimeError("supabase down")
        ) as db:
            response = _post(client, auth_headers, [_cluster()])

        assert response.status_code == 200
        assert db.rpc.await_count == 1


class TestTheR17ExemptionIsFinite:
    """The already-charged trip stays completable, but not forever.

    `trip_id` is client-supplied and was compared against the recorded trip with
    no volume bound and no expiry, so a free user who legitimately spent their
    import on trip A could pass trip A on every future import for the life of
    the account.
    """

    def test_a_spent_cluster_allowance_ends_the_exemption(
        self,
        client: TestClient,
        auth_headers: dict[str, str],
        as_user: None,
        paid_calls: type[_SpyMatcher],
    ) -> None:
        with _with_profile(
            _profile(
                "free",
                photo_import_count=1,
                consumed_trip_id=TEST_TRIP_ID,
                cluster_allowance=0,
            )
        ) as db:
            response = _post(client, auth_headers, [_cluster()], TEST_TRIP_ID)

        assert response.status_code == 402
        assert response.json()["detail"]["code"] == "PHOTO_IMPORT_LIMIT_REACHED"
        assert paid_calls.searched == 0
        assert _charges(db) == []

    def test_the_exemption_holds_while_the_allowance_remains(
        self,
        client: TestClient,
        auth_headers: dict[str, str],
        as_user: None,
        paid_calls: type[_SpyMatcher],
    ) -> None:
        """R17's entire point: a partly-matched trip must stay completable."""
        with _with_profile(
            _profile(
                "free",
                photo_import_count=1,
                consumed_trip_id=TEST_TRIP_ID,
                cluster_allowance=10,
            )
        ):
            response = _post(client, auth_headers, [_cluster()], TEST_TRIP_ID)

        assert response.status_code == 200
        assert paid_calls.searched == 1

    def test_replaying_the_consumed_trip_draws_the_allowance_down(
        self,
        client: TestClient,
        auth_headers: dict[str, str],
        as_user: None,
        paid_calls: type[_SpyMatcher],
    ) -> None:
        """Every exempt request reports its clusters, so the bound is real."""
        clusters = [_cluster(i) for i in range(4)]
        with _with_profile(
            _profile(
                "free",
                photo_import_count=1,
                consumed_trip_id=TEST_TRIP_ID,
                cluster_allowance=10,
            )
        ) as db:
            response = _post(client, auth_headers, clusters, TEST_TRIP_ID)

        assert response.status_code == 200
        assert _charges(db) == [
            {
                "p_user_id": TEST_USER_ID,
                "p_trip_id": TEST_TRIP_ID,
                "p_clusters": len(clusters),
            }
        ]

    def test_the_allowance_is_finite_and_clears_a_very_large_import(self) -> None:
        """A large trip is 50-100 clusters; a huge multi-city one, 200-300."""
        assert PHOTO_IMPORT_CLUSTER_ALLOWANCE >= 300
        assert PHOTO_IMPORT_CLUSTER_ALLOWANCE < 10_000
        # Finite in requests too, whatever the per-request ceiling is.
        assert PHOTO_IMPORT_CLUSTER_ALLOWANCE // MAX_CLUSTERS_PER_REQUEST < 100


class TestALaggingMigrationDegradesInsteadOfFailing:
    """The backend selects columns and calls a signature migration 0058 adds.

    PostgREST answers an unknown column with a 400, which `SupabaseClient`
    raises; converting that into a header-less 503 in the entitlement gate would
    take the endpoint down for EVERY caller -- premium included, since the read
    runs before the premium branch -- and clients read a header-less 503 as
    transient and retry into it.
    """

    def test_missing_entitlement_columns_do_not_503_the_endpoint(
        self,
        client: TestClient,
        auth_headers: dict[str, str],
        as_user: None,
        paid_calls: type[_SpyMatcher],
    ) -> None:
        with _with_profile(_profile("free"), u16_columns_missing=True):
            response = _post(client, auth_headers, [_cluster()])

        assert response.status_code == 200
        assert paid_calls.searched == 1

    def test_a_premium_caller_is_not_taken_down_by_a_lagging_migration(
        self,
        client: TestClient,
        auth_headers: dict[str, str],
        as_user: None,
        paid_calls: type[_SpyMatcher],
    ) -> None:
        with _with_profile(
            _profile("premium", photo_import_count=99), u16_columns_missing=True
        ):
            response = _post(client, auth_headers, [_cluster()])

        assert response.status_code == 200

    def test_a_free_caller_at_the_limit_is_not_locked_out_mid_import(
        self,
        client: TestClient,
        auth_headers: dict[str, str],
        as_user: None,
        paid_calls: type[_SpyMatcher],
    ) -> None:
        """Degrade to the unenforced behaviour that shipped before U16.

        Without the recorded trip the server cannot tell "spent their import"
        from "still finishing the import they spent", and guessing wrong 402s a
        paying-nothing-but-legitimate user out of a half-finished trip.
        """
        with _with_profile(
            _profile("free", photo_import_count=1), u16_columns_missing=True
        ) as db:
            response = _post(client, auth_headers, [_cluster()])

        assert response.status_code == 200
        # ...and the counter is NOT advanced behind the user's back either.
        assert _charges(db) == []

    def test_a_missing_rpc_signature_does_not_fail_a_successful_import(
        self,
        client: TestClient,
        auth_headers: dict[str, str],
        as_user: None,
        paid_calls: type[_SpyMatcher],
    ) -> None:
        with _with_profile(_profile("free"), rpc_error=MISSING_RPC_ERROR):
            response = _post(client, auth_headers, [_cluster()])

        assert response.status_code == 200

    def test_an_unrelated_database_failure_is_still_a_503(
        self,
        client: TestClient,
        auth_headers: dict[str, str],
        as_user: None,
        paid_calls: type[_SpyMatcher],
    ) -> None:
        """The tolerance is for one specific condition, not for all errors."""
        with _with_profile(
            _profile("free"),
            profile_error=HTTPException(status_code=400, detail="Database error: nope"),
        ):
            response = _post(client, auth_headers, [_cluster()])

        assert response.status_code == 503
        assert paid_calls.searched == 0


class TestSlotStarvationDegradesToFailedClusters:
    """How OUR capacity limits reach the caller.

    `SlotUnavailableError` is raised inside `places_outbound_slot`, but every
    call site catches it per cluster or is collected by
    `asyncio.gather(..., return_exceptions=True)`, so the endpoint's
    `except SlotUnavailableError -> 503` branch never fires. The matcher
    therefore publishes a COUNT of capacity-refused clusters instead, and the
    route answers busy on it.

    This distinction is the whole point: reporting our own saturation as
    ordinary per-cluster failures hands the client retry-ENABLED rows and a
    "Retry all" control that dispatches straight back into the still-open
    circuit breaker. Answering busy is what actually slows the caller down.
    """

    def test_ordinary_cluster_failures_are_still_a_200(
        self,
        client: TestClient,
        auth_headers: dict[str, str],
        as_user: None,
        paid_calls: type[_SpyMatcher],
    ) -> None:
        """An upstream fault is the client's to retry, not a busy signal."""
        paid_calls.result = ([], 2)
        paid_calls.capacity_failed = 0
        with _with_profile(_profile("premium")):
            response = _post(client, auth_headers, [_cluster(1), _cluster(2)])

        assert response.status_code == 200
        assert response.json()["failed_cluster_count"] == 2

    def test_capacity_refused_clusters_report_busy_instead_of_failing_them(
        self,
        client: TestClient,
        auth_headers: dict[str, str],
        as_user: None,
        paid_calls: type[_SpyMatcher],
    ) -> None:
        """Our own saturation answers 503, not a 200 full of failed rows."""
        paid_calls.result = ([], 2)
        paid_calls.capacity_failed = 2
        with _with_profile(_profile("premium")):
            response = _post(client, auth_headers, [_cluster(1), _cluster(2)])

        assert response.status_code == 503
        # Header-less on purpose: the client tells a quota 503 from a transient
        # one by the presence of Retry-After, and this is a seconds-long local
        # blip, not a day-long quota wall.
        assert "retry-after" not in {k.lower() for k in response.headers}

    def test_a_capacity_failure_among_worse_upstream_ones_stays_a_200(
        self,
        client: TestClient,
        auth_headers: dict[str, str],
        as_user: None,
        paid_calls: type[_SpyMatcher],
    ) -> None:
        """Busy is claimed only when capacity is the DOMINANT cause."""
        paid_calls.result = ([], 3)
        paid_calls.capacity_failed = 1
        with _with_profile(_profile("premium")):
            response = _post(
                client, auth_headers, [_cluster(1), _cluster(2), _cluster(3)]
            )

        assert response.status_code == 200
        assert response.json()["failed_cluster_count"] == 3


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

    def test_a_charge_landing_between_check_and_charge_cannot_overshoot(
        self,
        client: TestClient,
        auth_headers: dict[str, str],
        as_user: None,
        paid_calls: type[_SpyMatcher],
        monkeypatch: pytest.MonkeyPatch,
    ) -> None:
        """Checking the budget and spending it must be ONE operation.

        A `test` pass followed by a separate `hit` pass leaves a window:
        concurrent requests all see room, all charge, and the budget overshoots
        by up to (concurrent requests x per-request cost). This drops exactly
        one competing request into that window, hooking the limiter storage's
        first increment for the cluster budget -- a point BOTH a test-then-hit
        and an atomic-hit implementation reach, so the test is not written
        against either shape.
        """
        settings = get_settings()
        monkeypatch.setattr(settings, "suggest_places_cluster_budget_per_minute", 5)

        storage = limiter.limiter.storage
        real_incr = storage.incr
        landed = {"competitor": False}

        def racing_incr(key: str, expiry: float, *args: Any, **kwargs: Any) -> int:
            if _COST_BUDGET_SCOPES["clusters"] in key and not landed["competitor"]:
                landed["competitor"] = True
                real_incr(key, expiry, amount=5)  # a concurrent 5-cluster request
            return real_incr(key, expiry, *args, **kwargs)

        monkeypatch.setattr(storage, "incr", racing_incr)

        with _with_profile(_profile("premium")):
            response = _post(client, auth_headers, [_cluster(i) for i in range(5)])

        assert landed["competitor"], "the race was never simulated"
        assert response.status_code == 429
        assert paid_calls.searched == 0

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


def _rpc_body(sql: str) -> str:
    """The text of `increment_photo_import_usage`, and nothing else."""
    start = sql.index("CREATE FUNCTION increment_photo_import_usage(")
    return sql[start : sql.index("$$;", start)]


class TestUsageColumnsAreServerManaged:
    """STRUCTURAL checks on migration 0058. NO DATABASE IS INVOLVED.

    These read the DDL as text. They can prove a guard, an ownership predicate,
    an ordering, or a lock precaution is WRITTEN; they cannot prove Postgres
    executes any of it as intended. Specifically, they cannot show that the
    trigger fires, that `ON DELETE SET NULL`'s referential UPDATE really is
    exempted, that the advisory lock serialises concurrent increments, or that
    the allowance arithmetic settles where it should.

    Only an integration run against a live Postgres could, and this suite has
    none: `poetry run pytest` opens no connection, and the migration is applied
    by hand through the Supabase dashboard. Read a green result here as "the
    migration still says what it is supposed to say", nothing stronger.
    """

    @pytest.fixture(scope="class")
    def sql(self) -> str:
        return MIGRATION.read_text()

    def test_the_guard_exempts_trusted_writers_before_it_rejects_anything(
        self, sql: str
    ) -> None:
        """Order matters: an exemption evaluated after the RAISE is no
        exemption, and each one has to return rather than fall through."""
        trusted_flag = sql.index("current_setting('app.subscription_write', true)")
        service_role = sql.index("v_role = 'service_role'")
        direct_admin = sql.index("current_user IN ('postgres', 'supabase_admin')")
        rejection = sql.index("USING ERRCODE = '42501'")

        assert trusted_flag < service_role < direct_admin < rejection
        for start, end in (
            (trusted_flag, service_role),
            (service_role, direct_admin),
            (direct_admin, rejection),
        ):
            assert "RETURN NEW;" in sql[start:end], "an exemption falls through"

    def test_a_trigger_guards_updates_to_the_protected_columns(self, sql: str) -> None:
        assert "BEFORE UPDATE ON user_profile" in sql
        assert "reject_client_subscription_writes" in sql
        for column in (
            "subscription_status",
            "subscription_plan",
            "subscription_expires_at",
            "subscription_last_verified_at",
            "revenuecat_customer_id",
            "last_webhook_timestamp_ms",
            "last_webhook_event_id",
            "usage_share_extension_count",
            "usage_share_extension_period_start",
            "usage_photo_import_count",
            "usage_photo_import_trip_id",
            "usage_photo_import_cluster_allowance",
        ):
            assert f"NEW.{column}" in sql, f"{column} is left client-writable"
        assert "RAISE EXCEPTION" in sql

    def test_the_referential_null_out_is_exempted_from_the_guard(
        self, sql: str
    ) -> None:
        """`ON DELETE SET NULL` fires an UPDATE the guard would otherwise
        reject with 42501, aborting the trip delete that triggered it."""
        assert "ON DELETE SET NULL" in sql
        exemption = sql.index("OLD.usage_photo_import_trip_id IS NOT NULL")
        assert "NEW.usage_photo_import_trip_id IS NULL" in sql[exemption:]
        # ...and only for that column: any other guarded column moving in the
        # same statement must still be rejected.
        assert "NOT v_other_guarded_changed" in sql[exemption:]
        assert exemption < sql.index("USING ERRCODE = '42501'")

    def test_the_increment_rpcs_stay_the_only_write_path(self, sql: str) -> None:
        # Trusted functions announce themselves with a transaction-local flag
        # rather than a role check -- inside SECURITY DEFINER, current_user is
        # the owner and session_user is PostgREST's 'authenticator' (0056).
        assert sql.count("set_config('app.subscription_write', 'on', true)") >= 3
        assert (
            "GRANT EXECUTE ON FUNCTION increment_photo_import_usage(UUID, UUID, INTEGER)"
            in sql
        )
        assert "TO service_role" in sql

    def test_the_unused_guard_bypass_primitive_is_gone(self, sql: str) -> None:
        """`begin_trusted_subscription_write()` was created, granted, and never
        called -- a PostgREST-reachable way to flip the guard off whose only
        protection was that each request happens to get its own transaction."""
        assert "CREATE OR REPLACE FUNCTION begin_trusted_subscription_write" not in sql
        assert "GRANT EXECUTE ON FUNCTION begin_trusted_subscription_write" not in sql
        assert "DROP FUNCTION IF EXISTS begin_trusted_subscription_write()" in sql

    def test_service_role_and_direct_admin_access_are_not_locked_out(
        self, sql: str
    ) -> None:
        assert "v_role = 'service_role'" in sql
        assert "current_user IN ('postgres', 'supabase_admin')" in sql

    def test_first_trip_wins_and_the_recorded_trip_is_never_double_charged(
        self, sql: str
    ) -> None:
        """The specific control flow, not just the presence of the literals."""
        rpc = _rpc_body(sql)
        guard = rpc.index(
            "IF owned_trip_id IS NOT NULL AND current_trip_id IS NOT NULL"
        )
        early_return = rpc.index("RETURN current_count;")
        increment = rpc.index("SET usage_photo_import_count = current_count + 1")

        assert guard < early_return < increment, (
            "the already-charged-this-trip guard must short-circuit BEFORE the "
            "counter is incremented"
        )
        # Re-entering the recorded trip costs no import...
        assert "usage_photo_import_count" not in rpc[guard:early_return]
        # ...only the allowance that charge bought.
        assert "usage_photo_import_cluster_allowance" in rpc[guard:early_return]
        # And the exemption belongs to the import that was paid for, not to
        # whichever trip was opened most recently.
        assert "COALESCE(usage_photo_import_trip_id, owned_trip_id)" in rpc[increment:]

    def test_the_rpc_verifies_the_caller_owns_the_trip(self, sql: str) -> None:
        """`auth.uid() = p_user_id` said nothing at all about p_trip_id."""
        rpc = _rpc_body(sql)
        ownership = rpc.index("owned_trip_id := p_trip_id;")
        predicate = rpc[rpc.index("EXISTS (", 0) : ownership]
        assert "FROM trip" in predicate
        assert "id = p_trip_id" in predicate
        assert "user_id = p_user_id" in predicate
        assert "deleted_at IS NULL" in predicate
        # A trip that is not the caller's degrades to NULL rather than raising:
        # the new FK would otherwise turn a stale id into a 23503 that rolls the
        # whole increment back.
        assert "owned_trip_id := NULL;" in rpc
        assert "RAISE EXCEPTION" not in rpc[ownership:]

    def test_the_exemption_is_bounded_by_a_finite_cluster_allowance(
        self, sql: str
    ) -> None:
        assert (
            "ADD COLUMN IF NOT EXISTS usage_photo_import_cluster_allowance INTEGER"
            in sql
        )
        rpc = _rpc_body(sql)
        assert (
            f"allowance_grant CONSTANT INTEGER := {PHOTO_IMPORT_CLUSTER_ALLOWANCE};"
            in rpc
        ), "the SQL grant drifted from PHOTO_IMPORT_CLUSTER_ALLOWANCE"
        assert "GREATEST(allowance_grant - spend, 0)" in rpc

    def test_the_column_is_added_without_a_long_lock_on_trip(self, sql: str) -> None:
        """An inline REFERENCES makes ADD COLUMN an ADD CONSTRAINT, taking
        SHARE ROW EXCLUSIVE on the hot `trip` table for a full validation."""
        assert "SET lock_timeout = '3s';" in sql
        add_column = sql.index(
            "ADD COLUMN IF NOT EXISTS usage_photo_import_trip_id UUID"
        )
        statement = sql[add_column : sql.index(";", add_column)]
        assert "REFERENCES" not in statement

        not_valid = sql.index("NOT VALID")
        validate = sql.index(
            "VALIDATE CONSTRAINT user_profile_usage_photo_import_trip_id_fkey"
        )
        assert not_valid < validate

    def test_the_foreign_key_column_is_indexed(self, sql: str) -> None:
        """Without it every trip delete sequentially scans user_profile."""
        assert (
            "CREATE INDEX IF NOT EXISTS idx_user_profile_usage_photo_import_trip_id"
            in sql
        )
        assert "WHERE usage_photo_import_trip_id IS NOT NULL" in sql

    def test_the_photo_import_rpc_has_exactly_one_overload(self, sql: str) -> None:
        """Two overloads would make PostgREST's resolution ambiguous (0046)."""
        for dropped in (
            "increment_photo_import_usage(UUID);",
            "increment_photo_import_usage(UUID, UUID);",
            "increment_photo_import_usage(UUID, UUID, INTEGER);",
        ):
            assert f"DROP FUNCTION IF EXISTS {dropped}" in sql
        assert sql.count("CREATE FUNCTION increment_photo_import_usage(") == 1

    def test_the_deploy_order_and_the_rollback_are_documented(self, sql: str) -> None:
        header = sql[: sql.index("SET lock_timeout")]
        assert "DEPLOY ORDER" in header
        assert "BEFORE DEPLOYING THE BACKEND" in header
        assert "-- rollback: ALTER TABLE user_profile DISABLE TRIGGER" in header
        assert "DO NOT DROP THE NEW COLUMNS" in header

    def test_the_schema_cache_is_reloaded_after_the_rpc_is_recreated(
        self, sql: str
    ) -> None:
        """DROP+CREATE opens a window in which PostgREST 404s the RPC."""
        assert sql.rstrip().endswith("NOTIFY pgrst, 'reload schema';")
        recreated = sql.index("DROP FUNCTION IF EXISTS increment_photo_import_usage")
        assert recreated < sql.rindex("NOTIFY pgrst")
        assert "LOW-TRAFFIC WINDOW" in sql


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

    def test_usage_endpoint_serves_without_the_trip_column(
        self,
        client: TestClient,
        auth_headers: dict[str, str],
        as_user: None,
        mock_supabase_client: AsyncMock,
    ) -> None:
        """This query backs the app-wide usage/paywall state: a backend that
        ships ahead of migration 0058 must lose the trip id, not the endpoint."""
        legacy_row = {
            "usage_share_extension_count": 0,
            "usage_photo_import_count": 1,
            "usage_share_extension_period_start": None,
        }

        async def get(table: str, params: dict[str, Any] | None = None) -> Any:
            select = str((params or {}).get("select", ""))
            if "usage_photo_import_trip_id" in select:
                raise MISSING_COLUMN_ERROR
            return [legacy_row]

        mock_supabase_client.get.side_effect = get
        with patch(
            "app.api.subscriptions.get_supabase_client",
            return_value=mock_supabase_client,
        ):
            response = client.get("/subscriptions/usage", headers=auth_headers)

        assert response.status_code == 200
        assert response.json()["photo_import_trip_id"] is None
        assert response.json()["photo_import_count"] == 1

    def test_the_client_mirror_falls_back_when_the_trip_arg_is_unknown(
        self,
        client: TestClient,
        auth_headers: dict[str, str],
        as_user: None,
        mock_supabase_client: AsyncMock,
    ) -> None:
        """Until 0058 lands there is no two-argument overload, and PGRST202
        would turn every client-side usage report into a 502."""
        calls: list[dict[str, Any]] = []

        async def rpc(name: str, args: dict[str, Any]) -> Any:
            calls.append(args)
            if "p_trip_id" in args:
                raise MISSING_RPC_ERROR
            return 1

        mock_supabase_client.rpc.side_effect = rpc
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
        assert response.json()["new_count"] == 1
        assert [sorted(args) for args in calls] == [
            ["p_trip_id", "p_user_id"],
            ["p_user_id"],
        ]

    def test_an_unrelated_rpc_failure_is_still_a_502(
        self,
        client: TestClient,
        auth_headers: dict[str, str],
        as_user: None,
        mock_supabase_client: AsyncMock,
    ) -> None:
        mock_supabase_client.rpc.side_effect = RuntimeError("supabase down")
        with patch(
            "app.api.subscriptions.get_supabase_client",
            return_value=mock_supabase_client,
        ):
            response = client.post(
                "/subscriptions/usage/increment",
                headers=auth_headers,
                json={"feature": "photo_import", "trip_id": TEST_TRIP_ID},
            )

        assert response.status_code == 502
