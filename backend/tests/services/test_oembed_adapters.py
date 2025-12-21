"""Tests for oEmbed adapters."""

from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from app.schemas.social_ingest import OEmbedResponse, SocialProvider
from app.services.oembed_adapters import (
    _extract_meta_content,
    fetch_instagram_oembed,
    fetch_oembed,
    fetch_opengraph_fallback,
    fetch_tiktok_oembed,
)


class TestFetchTiktokOembed:
    """Tests for TikTok oEmbed fetching."""

    @pytest.mark.asyncio
    async def test_fetches_oembed_successfully(self):
        mock_response_data = {
            "title": "Check out this amazing restaurant #travel",
            "author_name": "traveler123",
            "author_url": "https://www.tiktok.com/@traveler123",
            "thumbnail_url": "https://p16-sign.tiktokcdn.com/obj/123",
            "thumbnail_width": 720,
            "thumbnail_height": 1280,
            "html": "<blockquote>...</blockquote>",
            "provider_name": "TikTok",
            "provider_url": "https://www.tiktok.com",
        }

        with patch("app.services.oembed_adapters.httpx.AsyncClient") as mock_client:
            mock_response = AsyncMock()
            mock_response.status_code = 200
            mock_response.json = MagicMock(return_value=mock_response_data)

            mock_client_instance = AsyncMock()
            mock_client_instance.get = AsyncMock(return_value=mock_response)
            mock_client.return_value.__aenter__.return_value = mock_client_instance

            result = await fetch_tiktok_oembed("https://www.tiktok.com/@user/video/123")

            assert result is not None
            assert result.title == "Check out this amazing restaurant #travel"
            assert result.author_name == "traveler123"
            assert result.thumbnail_url == "https://p16-sign.tiktokcdn.com/obj/123"
            assert result.provider_name == "TikTok"

    @pytest.mark.asyncio
    async def test_returns_none_on_error(self):
        with patch("app.services.oembed_adapters.httpx.AsyncClient") as mock_client:
            mock_response = AsyncMock()
            mock_response.status_code = 404

            mock_client_instance = AsyncMock()
            mock_client_instance.get = AsyncMock(return_value=mock_response)
            mock_client.return_value.__aenter__.return_value = mock_client_instance

            result = await fetch_tiktok_oembed(
                "https://www.tiktok.com/@user/video/invalid"
            )

            assert result is None

    @pytest.mark.asyncio
    async def test_returns_none_on_timeout(self):
        import httpx

        with patch("app.services.oembed_adapters.httpx.AsyncClient") as mock_client:
            mock_client_instance = AsyncMock()
            mock_client_instance.get = AsyncMock(
                side_effect=httpx.TimeoutException("timeout")
            )
            mock_client.return_value.__aenter__.return_value = mock_client_instance

            result = await fetch_tiktok_oembed("https://www.tiktok.com/@user/video/123")

            assert result is None


class TestFetchInstagramOembed:
    """Tests for Instagram oEmbed fetching."""

    @pytest.mark.asyncio
    async def test_returns_none_when_not_configured(self):
        with patch("app.services.oembed_adapters.get_settings") as mock_settings:
            mock_settings.return_value.instagram_oembed_token = ""

            result = await fetch_instagram_oembed("https://www.instagram.com/p/ABC123/")

            assert result is None

    @pytest.mark.asyncio
    async def test_fetches_oembed_when_configured(self):
        mock_response_data = {
            "title": "Amazing beach view",
            "author_name": "beachvibes",
            "author_url": "https://www.instagram.com/beachvibes",
            "thumbnail_url": "https://instagram.com/media/123.jpg",
            "provider_name": "Instagram",
        }

        with patch("app.services.oembed_adapters.get_settings") as mock_settings:
            mock_settings.return_value.instagram_oembed_token = "test-token"

            with patch("app.services.oembed_adapters.httpx.AsyncClient") as mock_client:
                mock_response = AsyncMock()
                mock_response.status_code = 200
                mock_response.json = MagicMock(return_value=mock_response_data)

                mock_client_instance = AsyncMock()
                mock_client_instance.get = AsyncMock(return_value=mock_response)
                mock_client.return_value.__aenter__.return_value = mock_client_instance

                result = await fetch_instagram_oembed(
                    "https://www.instagram.com/p/ABC123/"
                )

                assert result is not None
                assert result.title == "Amazing beach view"
                assert result.author_name == "beachvibes"


class TestFetchOpengraphFallback:
    """Tests for OpenGraph fallback."""

    @pytest.mark.asyncio
    async def test_extracts_opengraph_metadata(self):
        html_content = """
        <html>
        <head>
            <meta property="og:title" content="Beautiful Sunset at Beach Resort" />
            <meta property="og:image" content="https://example.com/image.jpg" />
            <meta property="og:description" content="Amazing sunset view" />
            <meta property="og:site_name" content="TravelGram" />
        </head>
        </html>
        """

        with patch("app.services.oembed_adapters.httpx.AsyncClient") as mock_client:
            mock_response = AsyncMock()
            mock_response.status_code = 200
            mock_response.text = html_content

            mock_client_instance = AsyncMock()
            mock_client_instance.get = AsyncMock(return_value=mock_response)
            mock_client.return_value.__aenter__.return_value = mock_client_instance

            result = await fetch_opengraph_fallback(
                "https://www.instagram.com/p/ABC123/"
            )

            assert result is not None
            assert result.title == "Beautiful Sunset at Beach Resort"
            assert result.thumbnail_url == "https://example.com/image.jpg"
            assert result.provider_name == "TravelGram"

    @pytest.mark.asyncio
    async def test_returns_none_when_no_og_tags(self):
        html_content = "<html><head><title>Page</title></head></html>"

        with patch("app.services.oembed_adapters.httpx.AsyncClient") as mock_client:
            mock_response = AsyncMock()
            mock_response.status_code = 200
            mock_response.text = html_content

            mock_client_instance = AsyncMock()
            mock_client_instance.get = AsyncMock(return_value=mock_response)
            mock_client.return_value.__aenter__.return_value = mock_client_instance

            result = await fetch_opengraph_fallback("https://example.com/page")

            assert result is None


class TestExtractMetaContent:
    """Tests for _extract_meta_content helper."""

    def test_extracts_property_before_content(self):
        html = '<meta property="og:title" content="Test Title" />'
        assert _extract_meta_content(html, "og:title") == "Test Title"

    def test_extracts_content_before_property(self):
        html = '<meta content="Test Title" property="og:title" />'
        assert _extract_meta_content(html, "og:title") == "Test Title"

    def test_handles_single_quotes(self):
        html = "<meta property='og:title' content='Test Title' />"
        assert _extract_meta_content(html, "og:title") == "Test Title"

    def test_returns_none_when_not_found(self):
        html = '<meta property="og:description" content="Description" />'
        assert _extract_meta_content(html, "og:title") is None


class TestFetchOembed:
    """Tests for high-level fetch_oembed function."""

    @pytest.mark.asyncio
    async def test_returns_cached_result(self):
        cached_response = OEmbedResponse(
            title="Cached Title",
            author_name="cached_user",
            thumbnail_url="https://example.com/cached.jpg",
        )

        with patch("app.services.oembed_adapters.get_cached_oembed") as mock_cache:
            mock_cache.return_value = cached_response

            result = await fetch_oembed(
                "https://www.tiktok.com/@user/video/123",
                SocialProvider.TIKTOK,
            )

            assert result == cached_response
            mock_cache.assert_called_once()

    @pytest.mark.asyncio
    async def test_fetches_from_api_on_cache_miss(self):
        with patch("app.services.oembed_adapters.get_cached_oembed") as mock_cache:
            mock_cache.return_value = None

            with patch(
                "app.services.oembed_adapters.fetch_tiktok_oembed"
            ) as mock_fetch:
                mock_fetch.return_value = OEmbedResponse(
                    title="Fresh Title",
                    author_name="fresh_user",
                )

                with patch("app.services.oembed_adapters.cache_oembed") as mock_save:
                    result = await fetch_oembed(
                        "https://www.tiktok.com/@user/video/123",
                        SocialProvider.TIKTOK,
                    )

                    assert result.title == "Fresh Title"
                    mock_fetch.assert_called_once()
                    mock_save.assert_called_once()

    @pytest.mark.asyncio
    async def test_instagram_falls_back_to_opengraph(self):
        with patch("app.services.oembed_adapters.get_cached_oembed") as mock_cache:
            mock_cache.return_value = None

            with patch(
                "app.services.oembed_adapters.fetch_instagram_oembed"
            ) as mock_insta:
                mock_insta.return_value = None  # Instagram oEmbed failed

                with patch(
                    "app.services.oembed_adapters.fetch_opengraph_fallback"
                ) as mock_og:
                    mock_og.return_value = OEmbedResponse(
                        title="Fallback Title",
                        thumbnail_url="https://example.com/og.jpg",
                    )

                    with patch("app.services.oembed_adapters.cache_oembed"):
                        result = await fetch_oembed(
                            "https://www.instagram.com/p/ABC123/",
                            SocialProvider.INSTAGRAM,
                        )

                        assert result.title == "Fallback Title"
                        mock_og.assert_called_once()
