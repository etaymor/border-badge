"""Tests for URL resolver service."""

from unittest.mock import AsyncMock, patch

import pytest

from app.schemas.social_ingest import SocialProvider
from app.services.url_resolver import (
    canonicalize_url,
    detect_provider,
    extract_instagram_shortcode,
    extract_tiktok_video_id,
    follow_redirect,
    is_supported_url,
    normalize_url,
)


class TestDetectProvider:
    """Tests for detect_provider function."""

    def test_detects_tiktok_video_url(self):
        url = "https://www.tiktok.com/@username/video/1234567890123456789"
        assert detect_provider(url) == SocialProvider.TIKTOK

    def test_detects_tiktok_photo_url(self):
        url = "https://www.tiktok.com/@username/photo/1234567890123456789"
        assert detect_provider(url) == SocialProvider.TIKTOK

    def test_detects_tiktok_short_url(self):
        url = "https://vm.tiktok.com/ZMrAbCdEf/"
        assert detect_provider(url) == SocialProvider.TIKTOK

    def test_detects_tiktok_t_url(self):
        url = "https://www.tiktok.com/t/ZTRabcdef/"
        assert detect_provider(url) == SocialProvider.TIKTOK

    def test_detects_instagram_post(self):
        url = "https://www.instagram.com/p/ABC123xyz/"
        assert detect_provider(url) == SocialProvider.INSTAGRAM

    def test_detects_instagram_reel(self):
        url = "https://www.instagram.com/reel/DEF456abc/"
        assert detect_provider(url) == SocialProvider.INSTAGRAM

    def test_detects_instagram_reels(self):
        url = "https://www.instagram.com/reels/GHI789xyz/"
        assert detect_provider(url) == SocialProvider.INSTAGRAM

    def test_detects_instagram_tv(self):
        url = "https://www.instagram.com/tv/JKL012mno/"
        assert detect_provider(url) == SocialProvider.INSTAGRAM

    def test_returns_none_for_unknown_url(self):
        url = "https://www.youtube.com/watch?v=123"
        assert detect_provider(url) is None

    def test_returns_none_for_general_instagram(self):
        # Profile pages aren't supported, only posts/reels
        url = "https://www.instagram.com/username/"
        assert detect_provider(url) is None

    def test_returns_none_for_general_tiktok(self):
        # Profile pages aren't supported
        url = "https://www.tiktok.com/@username"
        assert detect_provider(url) is None


class TestNormalizeUrl:
    """Tests for normalize_url function."""

    def test_removes_tiktok_tracking_params(self):
        url = "https://www.tiktok.com/@user/video/123?is_from_webapp=1&sender_device=pc&share_app_id=456"
        normalized = normalize_url(url)
        assert "is_from_webapp" not in normalized
        assert "sender_device" not in normalized
        assert "share_app_id" not in normalized

    def test_removes_instagram_tracking_params(self):
        url = "https://www.instagram.com/p/ABC123/?igshid=xyz123&utm_source=test"
        normalized = normalize_url(url)
        assert "igshid" not in normalized
        assert "utm_source" not in normalized

    def test_removes_utm_params(self):
        url = "https://www.tiktok.com/@user/video/123?utm_campaign=test&utm_medium=email"
        normalized = normalize_url(url)
        assert "utm_campaign" not in normalized
        assert "utm_medium" not in normalized

    def test_lowercases_scheme_and_host(self):
        url = "HTTPS://WWW.TIKTOK.COM/@user/video/123"
        normalized = normalize_url(url)
        assert normalized.startswith("https://www.tiktok.com")

    def test_removes_trailing_slash(self):
        url = "https://www.tiktok.com/@user/video/123/"
        normalized = normalize_url(url)
        assert not normalized.endswith("/")

    def test_removes_fragment(self):
        url = "https://www.instagram.com/p/ABC123/#comments"
        normalized = normalize_url(url)
        assert "#comments" not in normalized


class TestIsSupportedUrl:
    """Tests for is_supported_url function."""

    def test_tiktok_is_supported(self):
        assert is_supported_url("https://www.tiktok.com/@user/video/123")

    def test_instagram_is_supported(self):
        assert is_supported_url("https://www.instagram.com/p/ABC123/")

    def test_youtube_is_not_supported(self):
        assert not is_supported_url("https://www.youtube.com/watch?v=123")

    def test_random_url_is_not_supported(self):
        assert not is_supported_url("https://example.com/page")


class TestExtractTiktokVideoId:
    """Tests for extract_tiktok_video_id function."""

    def test_extracts_video_id(self):
        url = "https://www.tiktok.com/@username/video/1234567890123456789"
        assert extract_tiktok_video_id(url) == "1234567890123456789"

    def test_extracts_photo_id(self):
        url = "https://www.tiktok.com/@username/photo/9876543210987654321"
        assert extract_tiktok_video_id(url) == "9876543210987654321"

    def test_returns_none_for_no_id(self):
        url = "https://www.tiktok.com/@username"
        assert extract_tiktok_video_id(url) is None


class TestExtractInstagramShortcode:
    """Tests for extract_instagram_shortcode function."""

    def test_extracts_post_shortcode(self):
        url = "https://www.instagram.com/p/CxyZabc123/"
        assert extract_instagram_shortcode(url) == "CxyZabc123"

    def test_extracts_reel_shortcode(self):
        url = "https://www.instagram.com/reel/Def456ghi/"
        assert extract_instagram_shortcode(url) == "Def456ghi"

    def test_extracts_reels_shortcode(self):
        url = "https://www.instagram.com/reels/Jkl789mno/"
        assert extract_instagram_shortcode(url) == "Jkl789mno"

    def test_extracts_tv_shortcode(self):
        url = "https://www.instagram.com/tv/Pqr012stu/"
        assert extract_instagram_shortcode(url) == "Pqr012stu"

    def test_returns_none_for_profile(self):
        url = "https://www.instagram.com/username/"
        assert extract_instagram_shortcode(url) is None


class TestFollowRedirect:
    """Tests for follow_redirect function."""

    @pytest.mark.asyncio
    async def test_follows_redirect(self):
        with patch("app.services.url_resolver.httpx.AsyncClient") as mock_client:
            mock_response = AsyncMock()
            mock_response.status_code = 302
            mock_response.headers = {"location": "https://www.tiktok.com/@user/video/123"}

            mock_client_instance = AsyncMock()
            mock_client_instance.head = AsyncMock(return_value=mock_response)
            mock_client.return_value.__aenter__.return_value = mock_client_instance

            result = await follow_redirect("https://vm.tiktok.com/short")
            assert result == "https://www.tiktok.com/@user/video/123"

    @pytest.mark.asyncio
    async def test_returns_original_if_no_redirect(self):
        with patch("app.services.url_resolver.httpx.AsyncClient") as mock_client:
            mock_response = AsyncMock()
            mock_response.status_code = 200
            mock_response.headers = {}

            mock_client_instance = AsyncMock()
            mock_client_instance.head = AsyncMock(return_value=mock_response)
            mock_client.return_value.__aenter__.return_value = mock_client_instance

            original_url = "https://www.tiktok.com/@user/video/123"
            result = await follow_redirect(original_url)
            assert result == original_url

    @pytest.mark.asyncio
    async def test_handles_relative_redirect(self):
        with patch("app.services.url_resolver.httpx.AsyncClient") as mock_client:
            mock_response = AsyncMock()
            mock_response.status_code = 301
            mock_response.headers = {"location": "/@user/video/123"}

            mock_client_instance = AsyncMock()
            mock_client_instance.head = AsyncMock(return_value=mock_response)
            mock_client.return_value.__aenter__.return_value = mock_client_instance

            result = await follow_redirect("https://vm.tiktok.com/short")
            assert result == "https://vm.tiktok.com/@user/video/123"

    @pytest.mark.asyncio
    async def test_returns_original_on_timeout(self):
        import httpx

        with patch("app.services.url_resolver.httpx.AsyncClient") as mock_client:
            mock_client_instance = AsyncMock()
            mock_client_instance.head = AsyncMock(side_effect=httpx.TimeoutException("timeout"))
            mock_client.return_value.__aenter__.return_value = mock_client_instance

            original_url = "https://vm.tiktok.com/short"
            result = await follow_redirect(original_url)
            assert result == original_url


class TestCanonicalizeUrl:
    """Tests for canonicalize_url function."""

    @pytest.mark.asyncio
    async def test_canonicalizes_tiktok_url(self):
        with patch("app.services.url_resolver.follow_redirect") as mock_redirect:
            mock_redirect.return_value = "https://www.tiktok.com/@user/video/123?is_from_webapp=1"

            canonical, provider = await canonicalize_url("https://vm.tiktok.com/short")

            assert provider == SocialProvider.TIKTOK
            assert "is_from_webapp" not in canonical
            assert "www.tiktok.com" in canonical

    @pytest.mark.asyncio
    async def test_canonicalizes_instagram_url(self):
        with patch("app.services.url_resolver.follow_redirect") as mock_redirect:
            mock_redirect.return_value = "https://www.instagram.com/p/ABC123/?igshid=xyz"

            canonical, provider = await canonicalize_url("https://www.instagram.com/p/ABC123/?igshid=xyz")

            assert provider == SocialProvider.INSTAGRAM
            assert "igshid" not in canonical

    @pytest.mark.asyncio
    async def test_returns_none_provider_for_unknown(self):
        with patch("app.services.url_resolver.follow_redirect") as mock_redirect:
            mock_redirect.return_value = "https://www.youtube.com/watch?v=123"

            canonical, provider = await canonicalize_url("https://www.youtube.com/watch?v=123")

            assert provider is None
