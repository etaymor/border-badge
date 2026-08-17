"""Tests for video downloader cancellation handling."""

import asyncio
from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from app.services.video_extractor.downloader import download_video


@pytest.mark.asyncio
async def test_download_video_cancellation_kills_process(tmp_path):
    fake_proc = MagicMock()
    fake_proc.communicate = AsyncMock(side_effect=asyncio.CancelledError())
    fake_proc.wait = AsyncMock()
    fake_proc.kill = MagicMock()

    with patch(
        "app.services.video_extractor.downloader.asyncio.create_subprocess_exec",
        return_value=fake_proc,
    ):
        with pytest.raises(asyncio.CancelledError):
            await download_video(
                "https://www.tiktok.com/@user/video/123",
                timeout=1.0,
                output_dir=tmp_path,
            )

    fake_proc.kill.assert_called_once()
    fake_proc.wait.assert_awaited_once()
