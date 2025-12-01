"""Pytest configuration and fixtures."""

from typing import Any
from unittest.mock import AsyncMock

import pytest
from fastapi.testclient import TestClient

from app.core.security import AuthUser
from app.main import app

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
OTHER_USER_ID = "550e8400-e29b-41d4-a716-446655440099"


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
    return mock


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
        "is_public": True,
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


def mock_auth_dependency(user: AuthUser):
    """Create a mock auth dependency override."""

    async def override_get_current_user():
        return user

    return override_get_current_user
