"""Tests for feature flag behavior.

These tests verify that social feature routers are conditionally registered
based on the ENABLE_SOCIAL_FEATURES environment variable.
"""

import importlib
import os

import pytest
from fastapi.testclient import TestClient


class TestSocialFeaturesDisabled:
    """Test suite for when ENABLE_SOCIAL_FEATURES=false."""

    @pytest.fixture(autouse=True)
    def reload_app_with_social_disabled(self):
        """Reload app modules with social features disabled."""
        # Store original env value
        original_value = os.environ.get("ENABLE_SOCIAL_FEATURES")

        # Set to disabled
        os.environ["ENABLE_SOCIAL_FEATURES"] = "false"

        # Reload modules in correct order (dependencies first)
        from app.core import config

        importlib.reload(config)

        from app import api

        importlib.reload(api)

        from app import main

        importlib.reload(main)

        yield

        # Restore original value
        if original_value is not None:
            os.environ["ENABLE_SOCIAL_FEATURES"] = original_value
        elif "ENABLE_SOCIAL_FEATURES" in os.environ:
            del os.environ["ENABLE_SOCIAL_FEATURES"]

        # Reload to restore original state
        importlib.reload(config)
        importlib.reload(api)
        importlib.reload(main)

    def test_users_search_returns_404_when_disabled(self):
        """Test /users/search returns 404 when social features disabled."""
        from app import main

        client = TestClient(main.app)
        response = client.get("/users/search", params={"q": "test"})
        assert response.status_code == 404

    def test_feed_returns_404_when_disabled(self):
        """Test /feed returns 404 when social features disabled."""
        from app import main

        client = TestClient(main.app)
        response = client.get("/feed")
        assert response.status_code == 404

    def test_follows_returns_404_when_disabled(self):
        """Test /follows endpoints return 404 when social features disabled."""
        from app import main

        client = TestClient(main.app)
        response = client.get("/follows/followers")
        assert response.status_code == 404

    def test_blocks_returns_404_when_disabled(self):
        """Test /blocks returns 404 when social features disabled."""
        from app import main

        client = TestClient(main.app)
        response = client.get("/blocks")
        assert response.status_code == 404

    def test_invites_returns_404_when_disabled(self):
        """Test /invites endpoints return 404 when social features disabled."""
        from app import main

        client = TestClient(main.app)
        response = client.get("/invites/pending")
        assert response.status_code == 404

    def test_notifications_returns_404_when_disabled(self):
        """Test /notifications returns 404 when social features disabled."""
        from app import main

        client = TestClient(main.app)
        response = client.get("/notifications")
        assert response.status_code == 404

    def test_trip_tags_returns_404_when_disabled(self):
        """Test /trip-tags endpoints return 404 when social features disabled."""
        from app import main

        client = TestClient(main.app)
        response = client.get("/trip-tags/pending")
        assert response.status_code == 404


class TestDevelopmentEnvDoesNotAutoEnable:
    """ENV=development alone must never expose social routes (plan U3/R2).

    A previous dev convenience auto-registered social routers whenever
    ENV was 'development' (outside pytest). ENV defaults to 'development',
    so any deployment that forgot to set ENV would silently expose every
    social endpoint with the flag off. ENABLE_SOCIAL_FEATURES is now the
    only gate.
    """

    @pytest.fixture(autouse=True)
    def reload_app_dev_env_without_flag(self):
        """Reload app with ENV=development, flag off, outside pytest context."""
        original_flag = os.environ.get("ENABLE_SOCIAL_FEATURES")
        original_env = os.environ.get("ENV")
        original_pytest_marker = os.environ.get("PYTEST_CURRENT_TEST")

        os.environ["ENABLE_SOCIAL_FEATURES"] = "false"
        os.environ["ENV"] = "development"
        # Simulate a deployed (non-pytest) process: the removed dev fallback
        # keyed off PYTEST_CURRENT_TEST, so clearing it proves the fallback
        # is gone rather than merely inhibited by the test context.
        os.environ.pop("PYTEST_CURRENT_TEST", None)

        from app.core import config

        importlib.reload(config)

        from app import api

        importlib.reload(api)

        from app import main

        importlib.reload(main)

        yield

        for key, value in (
            ("ENABLE_SOCIAL_FEATURES", original_flag),
            ("ENV", original_env),
            ("PYTEST_CURRENT_TEST", original_pytest_marker),
        ):
            if value is not None:
                os.environ[key] = value
            elif key in os.environ:
                del os.environ[key]

        importlib.reload(config)
        importlib.reload(api)
        importlib.reload(main)

    def test_social_routes_404_in_development_without_flag(self):
        """Social endpoints 404 in ENV=development unless the flag is set."""
        from app import main

        client = TestClient(main.app)
        assert client.get("/users/search", params={"q": "test"}).status_code == 404
        assert client.get("/feed").status_code == 404
        assert client.get("/follows/followers").status_code == 404
        assert client.get("/blocks").status_code == 404
        assert client.get("/trip-tags/pending").status_code == 404

    def test_non_social_routes_still_work_in_development(self):
        """Non-social routes are unaffected by the missing flag."""
        from app import main

        client = TestClient(main.app)
        assert client.get("/").status_code == 200
        # 403 = route exists, needs auth (404 would mean it vanished)
        assert client.get("/profile").status_code == 403


class TestNonSocialRoutesAlwaysWork:
    """Test that non-social routes work regardless of feature flag."""

    @pytest.fixture(autouse=True)
    def reload_app_with_social_disabled(self):
        """Reload app modules with social features disabled."""
        original_value = os.environ.get("ENABLE_SOCIAL_FEATURES")
        os.environ["ENABLE_SOCIAL_FEATURES"] = "false"

        from app.core import config

        importlib.reload(config)

        from app import api

        importlib.reload(api)

        from app import main

        importlib.reload(main)

        yield

        if original_value is not None:
            os.environ["ENABLE_SOCIAL_FEATURES"] = original_value
        elif "ENABLE_SOCIAL_FEATURES" in os.environ:
            del os.environ["ENABLE_SOCIAL_FEATURES"]

        importlib.reload(config)
        importlib.reload(api)
        importlib.reload(main)

    def test_landing_page_works_when_disabled(self):
        """Test landing page (/) works when social features disabled."""
        from app import main

        client = TestClient(main.app)
        response = client.get("/")
        assert response.status_code == 200
        assert "text/html" in response.headers["content-type"]

    def test_profile_endpoint_exists_when_disabled(self):
        """Test /profile endpoint exists when social features disabled.

        Note: Returns 403 without auth, but route exists.
        """
        from app import main

        client = TestClient(main.app)
        response = client.get("/profile")
        # 403 means route exists but requires auth, 404 would mean route doesn't exist
        assert response.status_code == 403

    def test_countries_endpoint_exists_when_disabled(self):
        """Test /countries endpoint exists when social features disabled."""
        from app import main

        client = TestClient(main.app)
        response = client.get("/countries")
        # Should return 200 (public endpoint), 403 (if auth required),
        # or 503 (database unavailable in CI - but route exists)
        # The key assertion is NOT 404, which would mean the route doesn't exist
        assert response.status_code in (200, 403, 503)


class TestSocialFeaturesEnabled:
    """Test suite for when ENABLE_SOCIAL_FEATURES=true."""

    @pytest.fixture(autouse=True)
    def reload_app_with_social_enabled(self):
        """Reload app modules with social features enabled."""
        original_value = os.environ.get("ENABLE_SOCIAL_FEATURES")
        os.environ["ENABLE_SOCIAL_FEATURES"] = "true"

        from app.core import config

        importlib.reload(config)

        from app import api

        importlib.reload(api)

        from app import main

        importlib.reload(main)

        yield

        if original_value is not None:
            os.environ["ENABLE_SOCIAL_FEATURES"] = original_value
        elif "ENABLE_SOCIAL_FEATURES" in os.environ:
            del os.environ["ENABLE_SOCIAL_FEATURES"]

        importlib.reload(config)
        importlib.reload(api)
        importlib.reload(main)

    def test_users_search_exists_when_enabled(self):
        """Test /users/search returns 403 (needs auth) when enabled, not 404."""
        from app import main

        client = TestClient(main.app)
        response = client.get("/users/search", params={"q": "test"})
        # 403 = route exists, needs auth. 404 = route doesn't exist
        assert response.status_code == 403

    def test_feed_exists_when_enabled(self):
        """Test /feed returns 403 (needs auth) when enabled, not 404."""
        from app import main

        client = TestClient(main.app)
        response = client.get("/feed")
        assert response.status_code == 403

    def test_follows_exists_when_enabled(self):
        """Test /follows/followers returns 403 when enabled, not 404."""
        from app import main

        client = TestClient(main.app)
        response = client.get("/follows/followers")
        assert response.status_code == 403

    def test_blocks_exists_when_enabled(self):
        """Test /blocks returns 403 when enabled, not 404."""
        from app import main

        client = TestClient(main.app)
        response = client.get("/blocks")
        assert response.status_code == 403

    def test_invites_exists_when_enabled(self):
        """Test /invites/pending returns 403 when enabled, not 404."""
        from app import main

        client = TestClient(main.app)
        response = client.get("/invites/pending")
        assert response.status_code == 403


# ============================================================================
# require_social_features Dependency Tests
# ============================================================================


def test_require_social_features_raises_404_when_disabled():
    """Test that require_social_features dependency raises 404 when disabled."""
    from unittest.mock import MagicMock

    from fastapi import HTTPException

    from app.core.feature_flags import require_social_features

    # Create mock settings with social features disabled
    mock_settings = MagicMock()
    mock_settings.enable_social_features = False

    with pytest.raises(HTTPException) as exc_info:
        require_social_features(settings=mock_settings)

    assert exc_info.value.status_code == 404
    assert exc_info.value.detail == "Not found"


def test_require_social_features_passes_when_enabled():
    """Test that require_social_features dependency passes when enabled."""
    from unittest.mock import MagicMock

    from app.core.feature_flags import require_social_features

    # Create mock settings with social features enabled
    mock_settings = MagicMock()
    mock_settings.enable_social_features = True

    # Should not raise
    result = require_social_features(settings=mock_settings)
    assert result is None
