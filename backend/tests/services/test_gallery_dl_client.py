"""Tests for gallery-dl TikTok slideshow client."""

import asyncio
import json
from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from app.services.gallery_dl_client import (
    ALLOWED_IMAGE_HOST_PATTERN,
    ALLOWED_TIKTOK_PHOTO_PATTERN,
    _is_audio_url,
    _parse_gallery_dl_output,
    _validate_image_url,
    fetch_tiktok_slideshow_gallery_dl,
)

# --- URL Validation ---


class TestURLValidation:
    def test_valid_tiktok_photo_url(self):
        url = "https://www.tiktok.com/@traveler123/photo/7456789012345678901"
        assert ALLOWED_TIKTOK_PHOTO_PATTERN.match(url)

    def test_valid_tiktok_photo_url_no_www(self):
        url = "https://tiktok.com/@traveler123/photo/7456789012345678901"
        assert ALLOWED_TIKTOK_PHOTO_PATTERN.match(url)

    def test_valid_username_with_dots_and_dashes(self):
        url = "https://www.tiktok.com/@travel.er-123/photo/7456789012345678901"
        assert ALLOWED_TIKTOK_PHOTO_PATTERN.match(url)

    def test_rejects_video_url(self):
        url = "https://www.tiktok.com/@traveler123/video/7456789012345678901"
        assert not ALLOWED_TIKTOK_PHOTO_PATTERN.match(url)

    def test_rejects_non_tiktok_url(self):
        url = "https://www.instagram.com/p/ABC123"
        assert not ALLOWED_TIKTOK_PHOTO_PATTERN.match(url)

    def test_rejects_http_url(self):
        url = "http://www.tiktok.com/@traveler123/photo/7456789012345678901"
        assert not ALLOWED_TIKTOK_PHOTO_PATTERN.match(url)

    def test_rejects_url_with_query_params(self):
        url = "https://www.tiktok.com/@traveler123/photo/7456789012345678901?is_copy=1"
        assert not ALLOWED_TIKTOK_PHOTO_PATTERN.match(url)

    def test_rejects_url_with_extra_path(self):
        url = "https://www.tiktok.com/@traveler123/photo/7456789012345678901/extra"
        assert not ALLOWED_TIKTOK_PHOTO_PATTERN.match(url)


# --- Image URL Validation ---


class TestImageURLValidation:
    def test_valid_tiktok_cdn_url(self):
        url = "https://p16-sign-va.tiktokcdn.com/tos-maliva-p-0068/abc123"
        assert ALLOWED_IMAGE_HOST_PATTERN.match(url)

    def test_rejects_non_tiktok_cdn(self):
        url = "https://evil.example.com/image.jpg"
        assert not ALLOWED_IMAGE_HOST_PATTERN.match(url)

    def test_rejects_http_cdn(self):
        url = "http://p16-sign-va.tiktokcdn.com/image.jpg"
        assert not ALLOWED_IMAGE_HOST_PATTERN.match(url)

    def test_validate_image_url_filters_audio(self):
        url = "https://p16-sign-va.tiktokcdn.com/audio.m4a"
        assert not _validate_image_url(url)

    def test_validate_image_url_filters_mp3(self):
        url = "https://p16-sign-va.tiktokcdn.com/audio.mp3"
        assert not _validate_image_url(url)

    def test_validate_image_url_accepts_valid(self):
        url = "https://p16-sign-va.tiktokcdn.com/tos-maliva-p-0068/image.jpeg"
        assert _validate_image_url(url)

    def test_validate_image_url_rejects_non_cdn(self):
        url = "https://evil.com/image.jpg"
        assert not _validate_image_url(url)


# --- Audio Detection ---


class TestAudioDetection:
    def test_m4a_detected(self):
        assert _is_audio_url("https://cdn.tiktokcdn.com/audio.m4a")

    def test_mp3_detected(self):
        assert _is_audio_url("https://cdn.tiktokcdn.com/audio.mp3?token=abc")

    def test_image_not_detected(self):
        assert not _is_audio_url("https://cdn.tiktokcdn.com/image.jpeg")

    def test_no_extension_not_detected(self):
        assert not _is_audio_url("https://cdn.tiktokcdn.com/file")


# --- JSON Output Parsing ---


class TestParseGalleryDLOutput:
    def test_successful_parse(self):
        lines = [
            json.dumps(
                [
                    1,
                    "https://p16-sign-va.tiktokcdn.com/image1.jpeg",
                    {"description": "Best restaurants in Tokyo"},
                ]
            ),
            json.dumps(
                [
                    1,
                    "https://p16-sign-va.tiktokcdn.com/image2.jpeg",
                    {"description": "Best restaurants in Tokyo"},
                ]
            ),
        ]
        stdout = "\n".join(lines).encode()
        result = _parse_gallery_dl_output(stdout)

        assert result is not None
        assert len(result.image_urls) == 2
        assert result.caption == "Best restaurants in Tokyo"

    def test_filters_audio_files(self):
        lines = [
            json.dumps(
                [
                    1,
                    "https://p16-sign-va.tiktokcdn.com/image1.jpeg",
                    {"description": "caption"},
                ]
            ),
            json.dumps(
                [
                    1,
                    "https://p16-sign-va.tiktokcdn.com/audio.m4a",
                    {},
                ]
            ),
        ]
        stdout = "\n".join(lines).encode()
        result = _parse_gallery_dl_output(stdout)

        assert result is not None
        assert len(result.image_urls) == 1
        assert "image1" in result.image_urls[0]

    def test_filters_non_tiktok_cdn_urls(self):
        lines = [
            json.dumps(
                [
                    1,
                    "https://evil.com/image.jpg",
                    {"description": "caption"},
                ]
            ),
        ]
        stdout = "\n".join(lines).encode()
        result = _parse_gallery_dl_output(stdout)

        assert result is None  # No valid images

    def test_skips_non_json_lines(self):
        lines = [
            "gallery-dl: some warning message",
            json.dumps(
                [
                    1,
                    "https://p16-sign-va.tiktokcdn.com/image1.jpeg",
                    {"description": "caption"},
                ]
            ),
            "another warning",
        ]
        stdout = "\n".join(lines).encode()
        result = _parse_gallery_dl_output(stdout)

        assert result is not None
        assert len(result.image_urls) == 1

    def test_skips_non_type_1_entries(self):
        lines = [
            json.dumps([2, "https://p16-sign-va.tiktokcdn.com/dir/", {}]),
            json.dumps(
                [
                    1,
                    "https://p16-sign-va.tiktokcdn.com/image1.jpeg",
                    {"description": "caption"},
                ]
            ),
        ]
        stdout = "\n".join(lines).encode()
        result = _parse_gallery_dl_output(stdout)

        assert result is not None
        assert len(result.image_urls) == 1

    def test_empty_output_returns_none(self):
        assert _parse_gallery_dl_output(b"") is None

    def test_only_warnings_returns_none(self):
        stdout = b"gallery-dl: warning\ngallery-dl: another warning\n"
        assert _parse_gallery_dl_output(stdout) is None

    def test_extracts_desc_field_as_caption(self):
        lines = [
            json.dumps(
                [
                    1,
                    "https://p16-sign-va.tiktokcdn.com/image1.jpeg",
                    {"desc": "Short caption"},
                ]
            ),
        ]
        stdout = "\n".join(lines).encode()
        result = _parse_gallery_dl_output(stdout)

        assert result is not None
        assert result.caption == "Short caption"

    def test_malformed_json_array_skipped(self):
        """Short arrays (< 3 elements) are skipped."""
        lines = [
            json.dumps([1, "url"]),  # Too short
            json.dumps(
                [
                    1,
                    "https://p16-sign-va.tiktokcdn.com/image1.jpeg",
                    {"description": "ok"},
                ]
            ),
        ]
        stdout = "\n".join(lines).encode()
        result = _parse_gallery_dl_output(stdout)

        assert result is not None
        assert len(result.image_urls) == 1


# --- Subprocess Integration (mocked) ---


class TestFetchTikTokSlideshow:
    @pytest.mark.asyncio
    async def test_rejects_non_photo_url(self):
        result = await fetch_tiktok_slideshow_gallery_dl(
            "https://www.tiktok.com/@user/video/123"
        )
        assert result is None

    @pytest.mark.asyncio
    async def test_rejects_non_tiktok_url(self):
        result = await fetch_tiktok_slideshow_gallery_dl(
            "https://www.instagram.com/p/ABC123"
        )
        assert result is None

    @pytest.mark.asyncio
    async def test_successful_extraction(self):
        json_lines = "\n".join(
            [
                json.dumps(
                    [
                        1,
                        "https://p16-sign-va.tiktokcdn.com/image1.jpeg",
                        {"description": "Top spots in Bali"},
                    ]
                ),
                json.dumps(
                    [
                        1,
                        "https://p16-sign-va.tiktokcdn.com/image2.jpeg",
                        {},
                    ]
                ),
            ]
        )

        fake_proc = MagicMock()
        fake_proc.stdout = AsyncMock()
        fake_proc.stdout.read = AsyncMock(return_value=json_lines.encode())
        fake_proc.stderr = AsyncMock()
        fake_proc.stderr.read = AsyncMock(return_value=b"")
        fake_proc.wait = AsyncMock()
        fake_proc.returncode = 0

        with patch(
            "app.services.gallery_dl_client.asyncio.create_subprocess_exec",
            return_value=fake_proc,
        ):
            result = await fetch_tiktok_slideshow_gallery_dl(
                "https://www.tiktok.com/@traveler/photo/7456789012345678901"
            )

        assert result is not None
        assert len(result.image_urls) == 2
        assert result.caption == "Top spots in Bali"

    @pytest.mark.asyncio
    async def test_gallery_dl_not_installed(self):
        with patch(
            "app.services.gallery_dl_client.asyncio.create_subprocess_exec",
            side_effect=FileNotFoundError("gallery-dl not found"),
        ):
            result = await fetch_tiktok_slideshow_gallery_dl(
                "https://www.tiktok.com/@traveler/photo/7456789012345678901"
            )

        assert result is None

    @pytest.mark.asyncio
    async def test_subprocess_timeout(self):
        fake_proc = MagicMock()
        fake_proc.stdout = AsyncMock()
        fake_proc.stderr = AsyncMock()
        fake_proc.kill = MagicMock()
        fake_proc.wait = AsyncMock()

        async def slow_read(n):
            await asyncio.sleep(100)
            return b""

        fake_proc.stdout.read = slow_read
        fake_proc.stderr.read = AsyncMock(return_value=b"")

        with patch(
            "app.services.gallery_dl_client.asyncio.create_subprocess_exec",
            return_value=fake_proc,
        ):
            result = await fetch_tiktok_slideshow_gallery_dl(
                "https://www.tiktok.com/@traveler/photo/7456789012345678901",
                timeout=0.1,
            )

        assert result is None
        fake_proc.kill.assert_called_once()

    @pytest.mark.asyncio
    async def test_cancellation_kills_process(self):
        fake_proc = MagicMock()
        fake_proc.stdout = AsyncMock()
        fake_proc.stderr = AsyncMock()
        fake_proc.kill = MagicMock()
        fake_proc.wait = AsyncMock()

        async def cancelled_read(n):
            raise asyncio.CancelledError()

        fake_proc.stdout.read = cancelled_read

        with patch(
            "app.services.gallery_dl_client.asyncio.create_subprocess_exec",
            return_value=fake_proc,
        ):
            with pytest.raises(asyncio.CancelledError):
                await fetch_tiktok_slideshow_gallery_dl(
                    "https://www.tiktok.com/@traveler/photo/7456789012345678901"
                )

        fake_proc.kill.assert_called_once()
        fake_proc.wait.assert_awaited_once()

    @pytest.mark.asyncio
    async def test_nonzero_exit_returns_none(self):
        fake_proc = MagicMock()
        fake_proc.stdout = AsyncMock()
        fake_proc.stdout.read = AsyncMock(return_value=b"")
        fake_proc.stderr = AsyncMock()
        fake_proc.stderr.read = AsyncMock(return_value=b"error: something failed")
        fake_proc.wait = AsyncMock()
        fake_proc.returncode = 1

        with patch(
            "app.services.gallery_dl_client.asyncio.create_subprocess_exec",
            return_value=fake_proc,
        ):
            result = await fetch_tiktok_slideshow_gallery_dl(
                "https://www.tiktok.com/@traveler/photo/7456789012345678901"
            )

        assert result is None

    @pytest.mark.asyncio
    async def test_empty_output_returns_none(self):
        fake_proc = MagicMock()
        fake_proc.stdout = AsyncMock()
        fake_proc.stdout.read = AsyncMock(return_value=b"")
        fake_proc.stderr = AsyncMock()
        fake_proc.stderr.read = AsyncMock(return_value=b"")
        fake_proc.wait = AsyncMock()
        fake_proc.returncode = 0

        with patch(
            "app.services.gallery_dl_client.asyncio.create_subprocess_exec",
            return_value=fake_proc,
        ):
            result = await fetch_tiktok_slideshow_gallery_dl(
                "https://www.tiktok.com/@traveler/photo/7456789012345678901"
            )

        assert result is None

    @pytest.mark.asyncio
    async def test_proxy_config_propagated(self):
        fake_proc = MagicMock()
        fake_proc.stdout = AsyncMock()
        fake_proc.stdout.read = AsyncMock(return_value=b"")
        fake_proc.stderr = AsyncMock()
        fake_proc.stderr.read = AsyncMock(return_value=b"")
        fake_proc.wait = AsyncMock()
        fake_proc.returncode = 0

        with patch(
            "app.services.gallery_dl_client.asyncio.create_subprocess_exec",
            return_value=fake_proc,
        ) as mock_exec:
            await fetch_tiktok_slideshow_gallery_dl(
                "https://www.tiktok.com/@traveler/photo/7456789012345678901",
                proxy_url="http://proxy:8080",
            )

        # Check that --proxy was passed in the command
        call_args = mock_exec.call_args
        cmd_args = call_args[0]  # positional args
        assert "--proxy" in cmd_args
        proxy_idx = cmd_args.index("--proxy")
        assert cmd_args[proxy_idx + 1] == "http://proxy:8080"

    @pytest.mark.asyncio
    async def test_no_proxy_when_not_configured(self):
        fake_proc = MagicMock()
        fake_proc.stdout = AsyncMock()
        fake_proc.stdout.read = AsyncMock(return_value=b"")
        fake_proc.stderr = AsyncMock()
        fake_proc.stderr.read = AsyncMock(return_value=b"")
        fake_proc.wait = AsyncMock()
        fake_proc.returncode = 0

        with patch(
            "app.services.gallery_dl_client.asyncio.create_subprocess_exec",
            return_value=fake_proc,
        ) as mock_exec:
            await fetch_tiktok_slideshow_gallery_dl(
                "https://www.tiktok.com/@traveler/photo/7456789012345678901",
            )

        cmd_args = mock_exec.call_args[0]
        assert "--proxy" not in cmd_args

    @pytest.mark.asyncio
    async def test_stdout_size_capped(self):
        """Verify we read at most MAX_STDOUT_BYTES from stdout."""
        json_line = json.dumps(
            [
                1,
                "https://p16-sign-va.tiktokcdn.com/image1.jpeg",
                {"description": "caption"},
            ]
        )
        # Create output larger than the cap to verify truncation doesn't crash
        large_output = (json_line + "\n") * 10000

        fake_proc = MagicMock()
        fake_proc.stdout = AsyncMock()
        # Simulate reading capped output (only first N bytes)
        fake_proc.stdout.read = AsyncMock(
            return_value=large_output.encode()[: 512 * 1024]
        )
        fake_proc.stderr = AsyncMock()
        fake_proc.stderr.read = AsyncMock(return_value=b"")
        fake_proc.wait = AsyncMock()
        fake_proc.returncode = 0

        with patch(
            "app.services.gallery_dl_client.asyncio.create_subprocess_exec",
            return_value=fake_proc,
        ):
            result = await fetch_tiktok_slideshow_gallery_dl(
                "https://www.tiktok.com/@traveler/photo/7456789012345678901"
            )

        # Should still parse successfully with truncated output
        assert result is not None
        assert len(result.image_urls) > 0
