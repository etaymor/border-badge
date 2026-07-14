"""Tests for media URL helpers."""

from unittest.mock import patch

import pytest

from app.core.media import (
    build_media_url,
    extract_media_urls,
    media_url,
    resize_stored_url,
)

SUPABASE_URL = "https://test.supabase.co"


@pytest.fixture
def settings_with_url():
    """Patch get_settings in app.core.media with a configured supabase_url."""
    with patch("app.core.media.get_settings") as mock_settings:
        mock_settings.return_value.supabase_url = SUPABASE_URL
        yield mock_settings


@pytest.fixture
def settings_without_url():
    """Patch get_settings in app.core.media with an unset supabase_url."""
    with patch("app.core.media.get_settings") as mock_settings:
        mock_settings.return_value.supabase_url = ""
        yield mock_settings


# --- build_media_url: behavior must be unchanged for existing callers ---


def test_build_media_url_uses_object_public_path(settings_with_url) -> None:
    assert (
        build_media_url("user/photo.jpg")
        == f"{SUPABASE_URL}/storage/v1/object/public/media/user/photo.jpg"
    )


def test_build_media_url_returns_empty_when_supabase_url_unset(
    settings_without_url,
) -> None:
    assert build_media_url("user/photo.jpg") == ""


# --- media_url ---


def test_media_url_returns_render_url_with_width(settings_with_url) -> None:
    url = media_url("user/photo.jpg", width=800)
    assert url.startswith(f"{SUPABASE_URL}/storage/v1/render/image/public/media/")
    assert "user/photo.jpg" in url
    assert "width=800" in url


def test_media_url_defaults_to_quality_80(settings_with_url) -> None:
    assert "quality=80" in media_url("user/photo.jpg", width=800)


def test_media_url_default_does_not_force_resize(settings_with_url) -> None:
    assert "resize=" not in media_url("user/photo.jpg", width=800)


def test_media_url_carries_resize_contain(settings_with_url) -> None:
    assert "resize=contain" in media_url("user/photo.jpg", width=1600, resize="contain")


def test_media_url_honors_explicit_quality(settings_with_url) -> None:
    assert "quality=60" in media_url("user/photo.jpg", width=96, quality=60)


def test_media_url_returns_empty_when_supabase_url_unset(settings_without_url) -> None:
    assert media_url("user/photo.jpg", width=800) == ""


# --- extract_media_urls ---


def test_extract_media_urls_without_thumbnail_yields_width_constrained_url(
    settings_with_url,
) -> None:
    """AE9: an uploaded .jpg original with no thumbnail must not ship full-res."""
    urls = extract_media_urls(
        [{"status": "uploaded", "file_path": "user/original.jpg"}],
        width=800,
    )

    assert len(urls) == 1
    assert "/render/image/public/media/" in urls[0]
    assert "width=800" in urls[0]
    assert "/object/public/media/" not in urls[0]


def test_extract_media_urls_thumbnail_is_width_constrained(settings_with_url) -> None:
    urls = extract_media_urls(
        [
            {
                "status": "uploaded",
                "file_path": "user/original.jpg",
                "thumbnail_path": "user/thumb.jpg",
            }
        ],
        width=800,
    )

    assert len(urls) == 1
    assert "user/thumb.jpg" in urls[0]
    assert "user/original.jpg" not in urls[0]
    assert "width=800" in urls[0]


def test_extract_media_urls_skips_heic_without_thumbnail(settings_with_url) -> None:
    """Regression guard: non-web-compatible originals stay skipped."""
    assert (
        extract_media_urls(
            [
                {"status": "uploaded", "file_path": "user/photo.HEIC"},
                {"status": "uploaded", "file_path": "user/photo.heif"},
            ],
            width=800,
        )
        == []
    )


def test_extract_media_urls_uses_heic_thumbnail_when_present(settings_with_url) -> None:
    urls = extract_media_urls(
        [
            {
                "status": "uploaded",
                "file_path": "user/photo.HEIC",
                "thumbnail_path": "user/photo_thumb.jpg",
            }
        ],
        width=800,
    )

    assert len(urls) == 1
    assert "user/photo_thumb.jpg" in urls[0]


def test_extract_media_urls_skips_non_uploaded_status(settings_with_url) -> None:
    assert (
        extract_media_urls(
            [
                {"status": "pending", "file_path": "user/a.jpg"},
                {
                    "status": "failed",
                    "file_path": "user/b.jpg",
                    "thumbnail_path": "t.jpg",
                },
                {"file_path": "user/c.jpg"},
            ],
            width=800,
        )
        == []
    )


def test_extract_media_urls_handles_none_and_empty(settings_with_url) -> None:
    assert extract_media_urls(None, width=800) == []
    assert extract_media_urls([], width=800) == []


def test_extract_media_urls_skips_records_without_any_path(settings_with_url) -> None:
    assert extract_media_urls([{"status": "uploaded"}], width=800) == []


def test_extract_media_urls_without_width_keeps_object_urls(settings_with_url) -> None:
    """Default (no width) preserves the pre-existing object-URL behavior."""
    urls = extract_media_urls(
        [
            {"status": "uploaded", "file_path": "user/original.jpg"},
            {
                "status": "uploaded",
                "file_path": "user/other.jpg",
                "thumbnail_path": "user/thumb.jpg",
            },
        ]
    )

    assert urls == [
        f"{SUPABASE_URL}/storage/v1/object/public/media/user/original.jpg",
        f"{SUPABASE_URL}/storage/v1/object/public/media/user/thumb.jpg",
    ]


# --- resize_stored_url: the hero cover fix (KTD8) ---
# `cover_image_url` stores a full absolute URL, not a bucket path, so it cannot
# go through `media_url()`. It is the LCP element on every share page and today
# ships the raw original.


def test_resize_stored_url_rewrites_object_url_to_render_endpoint(
    settings_with_url,
) -> None:
    stored = f"{SUPABASE_URL}/storage/v1/object/public/media/u1/covers/abc.jpg"

    result = resize_stored_url(stored, width=1600)

    assert "/storage/v1/render/image/public/media/" in result
    assert "/object/public/" not in result
    assert "u1/covers/abc.jpg" in result
    assert "width=1600" in result


def test_resize_stored_url_carries_quality_and_resize_mode(settings_with_url) -> None:
    stored = f"{SUPABASE_URL}/storage/v1/object/public/media/cover.jpg"

    result = resize_stored_url(stored, width=1600, quality=70, resize="contain")

    assert "quality=70" in result
    assert "resize=contain" in result


def test_resize_stored_url_passes_through_a_foreign_host(settings_with_url) -> None:
    """A Google Places photo is a different host and is already right-sized."""
    stored = "https://lh3.googleusercontent.com/p/photo123"

    assert resize_stored_url(stored, width=1600) == stored


def test_resize_stored_url_passes_through_an_already_transformed_url(
    settings_with_url,
) -> None:
    stored = f"{SUPABASE_URL}/storage/v1/render/image/public/media/cover.jpg?width=800"

    assert resize_stored_url(stored, width=1600) == stored


def test_resize_stored_url_returns_none_for_missing_values(settings_with_url) -> None:
    assert resize_stored_url(None, width=1600) is None
    assert resize_stored_url("", width=1600) is None


def test_resize_stored_url_drops_an_existing_query_string(settings_with_url) -> None:
    """A cover URL with its own query must not yield a double-? render URL."""
    stored = f"{SUPABASE_URL}/storage/v1/object/public/media/a/b.jpg?t=cachebuster"

    result = resize_stored_url(stored, width=1600)

    assert result.count("?") == 1
    assert "width=1600" in result
    assert "t=cachebuster" not in result
    assert "/render/image/public/media/a/b.jpg?" in result
