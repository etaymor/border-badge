"""Pytest configuration and fixtures."""

import os
import time
from collections.abc import Callable
from typing import Any
from unittest.mock import AsyncMock

import jwt
import pytest
from fastapi.testclient import TestClient

# Social routers are registered at import time and ONLY when
# ENABLE_SOCIAL_FEATURES is explicitly enabled (there is no dev fallback;
# see app/api/__init__.py). Enable it before app.main is imported so the
# social endpoint suites exercise registered routes. test_feature_flags
# overrides this per-test and reloads the app to cover the disabled path.
os.environ.setdefault("ENABLE_SOCIAL_FEATURES", "true")

from app.core.config import get_settings  # noqa: E402
from app.core.security import AuthUser  # noqa: E402
from app.main import app  # noqa: E402

# Valid UUIDs for test fixtures
TEST_USER_ID = "550e8400-e29b-41d4-a716-446655440000"
TEST_COUNTRY_ID = "550e8400-e29b-41d4-a716-446655440001"
TEST_TRIP_ID = "550e8400-e29b-41d4-a716-446655440002"
TEST_ENTRY_ID = "550e8400-e29b-41d4-a716-446655440003"
TEST_PLACE_ID = "550e8400-e29b-41d4-a716-446655440004"
TEST_MEDIA_ID = "550e8400-e29b-41d4-a716-446655440005"
TEST_TAG_ID = "550e8400-e29b-41d4-a716-446655440006"
TEST_USER_COUNTRY_ID = "550e8400-e29b-41d4-a716-446655440007"
TEST_LIST_ID = "550e8400-e29b-41d4-a716-446655440008"
TEST_LIST_ENTRY_ID = "550e8400-e29b-41d4-a716-446655440009"
TEST_UNCATEGORIZED_TRIP_ID = "550e8400-e29b-41d4-a716-446655440010"
TEST_PROFILE_PK_ID = "550e8400-e29b-41d4-a716-446655440011"
OTHER_USER_ID = "550e8400-e29b-41d4-a716-446655440099"


@pytest.fixture(autouse=True)
def disable_persistent_places_cache(monkeypatch) -> None:
    """Keep the persistent (Postgres L2) places cache out of every unit test.

    The L2 cache is consulted before any Google Places call. Tests build their
    matcher with a MagicMock settings object, whose auto-created `supabase_url` /
    `supabase_service_role_key` attributes read truthy -- so the cache believes it
    is configured and queries an AsyncMock "database", which dutifully fabricates
    a hit for every key. The mocked HTTP client is then never reached, and tests
    that assert on request headers or on failure handling silently pass through a
    result that no code under test produced.

    Forcing a miss keeps the mocked HTTP client the single source of truth. Tests
    that specifically exercise the L2 path should patch these back locally.
    """
    monkeypatch.setattr(
        "app.services.place_matcher.persistent_cache._persistent_cache_enabled",
        lambda: False,
    )


@pytest.fixture(autouse=True)
def pin_environment_settings(monkeypatch) -> None:
    """Pin env-dependent settings so results never vary by machine.

    `Settings` loads `backend/.env`, so an unpinned test run reads whatever the
    developer happens to have configured. That splits the suite in two
    directions at once: image tests assert on transform URLs, which
    `build_image_url` returns as `""` when `supabase_url` is unset (empty in
    CI, populated locally); the share-map test asserts the map is *omitted*,
    which only holds when `google_maps_browser_api_key` is absent (empty in CI,
    populated locally). Each set passed on exactly the machine the other
    failed on.

    Pinning both here makes every test see the same configuration everywhere.
    Tests that exercise a specific configuration should override these locally
    via their own `monkeypatch.setattr` on the settings object.
    """
    settings = get_settings()
    monkeypatch.setattr(settings, "supabase_url", "https://test.supabase.co")
    monkeypatch.setattr(settings, "google_maps_browser_api_key", "")
    monkeypatch.setattr(settings, "google_maps_map_id", "")
    monkeypatch.setattr(settings, "base_url", "http://localhost:8000")


@pytest.fixture(autouse=True)
def stub_trip_tag_push(monkeypatch) -> None:
    """Keep the trip-tag push (plan U10) out of endpoint tests by default.

    `send_trip_tag_notification` is a real push sender now: it opens a
    service-role Supabase client and calls the push edge function. Endpoint
    tests that create tags run their BackgroundTasks synchronously, so
    without this stub every such test would attempt real network calls.
    Tests that assert on notification scheduling still `patch(...)` the same
    attributes locally, which simply overrides this stub for their duration;
    tests of the core sender itself patch inside `app.core.notifications`.
    """
    monkeypatch.setattr(
        "app.api.trips.send_trip_tag_notification", AsyncMock(return_value=None)
    )
    monkeypatch.setattr(
        "app.api.trip_tags.send_trip_tag_notification", AsyncMock(return_value=None)
    )


@pytest.fixture
def client() -> TestClient:
    """Create a test client for the FastAPI app."""
    return TestClient(app)


@pytest.fixture
def mock_user() -> AuthUser:
    """Create a mock authenticated user."""
    return AuthUser(
        user_id=TEST_USER_ID,
        email="test+test@example.com",
    )


@pytest.fixture
def auth_headers() -> dict[str, str]:
    """Mock authorization headers."""
    return {"Authorization": "Bearer mock-jwt-token"}


@pytest.fixture
def mock_supabase_client():
    """Create a mock Supabase client."""
    mock = AsyncMock()
    mock.get = AsyncMock(return_value=[])
    mock.post = AsyncMock(return_value=[])
    mock.patch = AsyncMock(return_value=[])
    mock.delete = AsyncMock(return_value=[])
    mock.rpc = AsyncMock(return_value=[])
    return mock


# Rows a table can return: a fixed result, a queue of results consumed one per
# call (for the rare endpoint that hits the same table twice), or a callable
# that inspects the PostgREST params and decides.
TableRows = (
    list[dict[str, Any]]
    | list[list[dict[str, Any]]]
    | Callable[[dict[str, Any]], list[dict[str, Any]]]
    | Exception
)


def supabase_tables(**tables: TableRows) -> Callable[..., Any]:
    """Build a `.get()` side effect that dispatches on the table name.

    Endpoints fetch tables in whatever order their code happens to run, and a
    positional `side_effect` list couples every test to that order: adding one
    query anywhere makes every test in the file raise `StopIteration`. This
    keys the mock on `db.get(table, params)`'s first argument instead, so a
    test declares *what data exists* rather than *when it is asked for*.

        mock_supabase_client.get.side_effect = supabase_tables(
            list=[list_row],
            list_entries=entry_rows,
            user_profile=[profile_row],
        )

    A table not named here returns `[]` — an unseeded table is "empty", never a
    crash. Values may be:

    * a list of row dicts — returned for every call to that table;
    * a list of lists — a queue, one element per call to that table, the last
      element repeating once exhausted;
    * a callable taking the PostgREST `params` dict and returning rows — use it
      to vary on a filter (e.g. `status=eq.visited`);
    * an `Exception` instance — raised, for testing degradation on DB failure.
    """
    queues: dict[str, list[list[dict[str, Any]]]] = {}

    def side_effect(table: str, params: dict[str, Any] | None = None) -> Any:
        rows = tables.get(table)
        if rows is None:
            return []
        if isinstance(rows, Exception):
            raise rows
        if callable(rows):
            return rows(params or {})
        # A list-of-lists is a per-call queue; a plain list of rows is constant.
        if rows and isinstance(rows[0], list):
            queue = queues.setdefault(table, list(rows))  # type: ignore[arg-type]
            return queue.pop(0) if len(queue) > 1 else queue[0]
        return rows

    return side_effect


@pytest.fixture
def sample_country() -> dict[str, Any]:
    """Sample country data."""
    return {
        "id": TEST_COUNTRY_ID,
        "code": "US",
        "name": "United States",
        "region": "Americas",
        "flag_url": None,
        "recognition": "un_member",
    }


@pytest.fixture
def sample_trip() -> dict[str, Any]:
    """Sample trip data."""
    return {
        "id": TEST_TRIP_ID,
        "user_id": TEST_USER_ID,
        "country_id": TEST_COUNTRY_ID,
        "name": "Summer Vacation",
        "cover_image_url": None,
        "date_range": "[2024-06-01,2024-06-15]",
        "created_at": "2024-01-01T00:00:00Z",
    }


@pytest.fixture
def sample_entry() -> dict[str, Any]:
    """Sample entry data."""
    return {
        "id": TEST_ENTRY_ID,
        "trip_id": TEST_TRIP_ID,
        "type": "place",
        "title": "Central Park",
        "notes": "Beautiful park!",
        "metadata": None,
        "date": "2024-06-05T10:00:00Z",
        "created_at": "2024-01-01T00:00:00Z",
    }


@pytest.fixture
def sample_place() -> dict[str, Any]:
    """Sample place data."""
    return {
        "id": TEST_PLACE_ID,
        "entry_id": TEST_ENTRY_ID,
        "google_place_id": "ChIJN1t_tDeuEmsRUsoyG83frY4",
        "place_name": "Central Park",
        "lat": 40.7829,
        "lng": -73.9654,
        "address": "New York, NY, USA",
        "extra_data": None,
    }


@pytest.fixture
def sample_tag() -> dict[str, Any]:
    """Sample trip tag data."""
    return {
        "id": TEST_TAG_ID,
        "trip_id": TEST_TRIP_ID,
        "tagged_user_id": TEST_USER_ID,
        "status": "pending",
        "initiated_by": OTHER_USER_ID,
        "notification_id": None,
        "created_at": "2024-01-01T00:00:00Z",
        "responded_at": None,
    }


@pytest.fixture
def sample_list() -> dict[str, Any]:
    """Sample list data."""
    return {
        "id": TEST_LIST_ID,
        "trip_id": TEST_TRIP_ID,
        "owner_id": TEST_USER_ID,
        "name": "Best Places to Visit",
        "slug": "best-places-to-visit-abc123",
        "description": "My favorite spots",
        "created_at": "2024-01-01T00:00:00Z",
        "updated_at": "2024-01-01T00:00:00Z",
    }


@pytest.fixture
def sample_list_entry() -> dict[str, Any]:
    """Sample list entry data."""
    return {
        "id": TEST_LIST_ENTRY_ID,
        "list_id": TEST_LIST_ID,
        "entry_id": TEST_ENTRY_ID,
        "position": 0,
        "created_at": "2024-01-01T00:00:00Z",
    }


@pytest.fixture
def sample_uncategorized_trip() -> dict[str, Any]:
    """Sample uncategorized/system trip data (Saved Places)."""
    return {
        "id": TEST_UNCATEGORIZED_TRIP_ID,
        "user_id": TEST_USER_ID,
        "country_id": None,
        "name": "Saved Places",
        "cover_image_url": None,
        "date_range": None,
        "is_system": True,
        "created_at": "2024-01-01T00:00:00Z",
        "deleted_at": None,
        "entry_count": 0,
    }


# ============================================================================
# Subscription Test Fixtures
# ============================================================================


@pytest.fixture
def sample_free_profile() -> dict[str, Any]:
    """Sample user profile with free subscription."""
    return {
        "id": TEST_PROFILE_PK_ID,
        "user_id": TEST_USER_ID,
        "subscription_status": "free",
        "subscription_plan": None,
        "subscription_expires_at": None,
        "usage_share_extension_count": 0,
        "usage_photo_import_count": 0,
        "revenuecat_customer_id": None,
    }


@pytest.fixture
def sample_premium_profile() -> dict[str, Any]:
    """Sample user profile with premium subscription."""
    return {
        "id": TEST_PROFILE_PK_ID,
        "user_id": TEST_USER_ID,
        "subscription_status": "premium",
        "subscription_plan": "annual",
        "subscription_expires_at": "2025-12-31T00:00:00+00:00",
        "usage_share_extension_count": 10,
        "usage_photo_import_count": 5,
        "revenuecat_customer_id": f"rc_{TEST_USER_ID}",
    }


@pytest.fixture
def sample_trial_profile() -> dict[str, Any]:
    """Sample user profile with trial subscription."""
    return {
        "id": TEST_PROFILE_PK_ID,
        "user_id": TEST_USER_ID,
        "subscription_status": "trial",
        "subscription_plan": "monthly",
        "subscription_expires_at": "2024-02-15T00:00:00+00:00",
        "usage_share_extension_count": 0,
        "usage_photo_import_count": 0,
        "revenuecat_customer_id": f"rc_{TEST_USER_ID}",
    }


def mock_auth_dependency(user: AuthUser):
    """Create a mock auth dependency override."""

    async def override_get_current_user():
        return user

    return override_get_current_user


# ============================================================================
# JWT Test Fixtures
# ============================================================================


@pytest.fixture
def jwt_test_config() -> dict[str, str]:
    """Configuration for generating test JWTs."""
    return {
        "secret": "test-jwt-secret-for-unit-tests",
        "issuer": "https://test.supabase.co/auth/v1",
        "audience": "authenticated",
        "user_id": TEST_USER_ID,
        "email": "test@example.com",
    }


def generate_test_jwt(
    config: dict[str, str],
    exp_offset_seconds: int = 3600,
    **overrides: Any,
) -> str:
    """Generate a test JWT token with configurable claims.

    Args:
        config: JWT configuration dict with secret, issuer, audience, user_id, email
        exp_offset_seconds: Seconds from now until expiration (negative for expired)
        **overrides: Additional claims to override or add. Set a value to None
            to remove that claim from the payload entirely.

    Returns:
        Encoded JWT token string
    """
    payload: dict[str, Any] = {
        "sub": config["user_id"],
        "email": config["email"],
        "aud": config["audience"],
        "iss": config["issuer"],
        "exp": int(time.time()) + exp_offset_seconds,
        "iat": int(time.time()),
    }
    payload.update(overrides)

    # Remove any claims set to None (allows omitting claims like 'sub')
    payload = {k: v for k, v in payload.items() if v is not None}

    return jwt.encode(payload, config["secret"], algorithm="HS256")


# ============================================================================
# Time Mocking Fixtures
# ============================================================================


@pytest.fixture
def mock_time():
    """Fixture to control time.time() for deterministic cache tests.

    Returns a dict with:
        - get(): Returns current mocked time
        - advance(seconds): Advance time by specified seconds
        - set(value): Set time to specific value
    """
    current_time = [1000000.0]  # Mutable container

    def get_time() -> float:
        return current_time[0]

    def advance(seconds: float) -> None:
        current_time[0] += seconds

    def set_time(value: float) -> None:
        current_time[0] = value

    return {"get": get_time, "advance": advance, "set": set_time}
