"""Tests for `google_maps_place_url`.

This one helper backs three surfaces that must agree: the affiliate destination
on a feed row, the "Open in Google Maps" link in a map pin's info card, and the
description of every placemark in the KML export.
"""

from app.core.urls import google_maps_place_url


def test_coordinates_only() -> None:
    url = google_maps_place_url(41.0082, 28.9784)

    assert url == "https://www.google.com/maps/search/?api=1&query=41.0082%2C28.9784"


def test_place_id_refines_coordinates() -> None:
    """Both are sent: the id resolves the venue, `query` is the fallback."""
    url = google_maps_place_url(41.0082, 28.9784, "ChIJ_abc123")

    assert "query=41.0082%2C28.9784" in url
    assert "query_place_id=ChIJ_abc123" in url


def test_place_id_without_coordinates_still_populates_query() -> None:
    """Maps rejects `query_place_id` on its own, so the id doubles as the query."""
    url = google_maps_place_url(None, None, "ChIJ_abc123")

    assert "query=ChIJ_abc123" in url
    assert "query_place_id=ChIJ_abc123" in url


def test_nothing_to_point_at_returns_none() -> None:
    """Callers use None to omit the link rather than render a dead one."""
    assert google_maps_place_url(None, None) is None
    assert google_maps_place_url(None, None, None) is None


def test_zero_coordinates_are_a_real_location() -> None:
    """Regression: the old truthiness check sent Greenwich to the wrong URL.

    A place on the prime meridian or the equator has a falsy but perfectly valid
    coordinate, and `if lat and lng` silently discarded it.
    """
    url = google_maps_place_url(51.4779, 0.0)

    assert url is not None
    assert "query=51.4779%2C0.0" in url


def test_a_missing_half_of_the_pair_is_not_a_location() -> None:
    """One coordinate cannot plot anything; fall through to the place id."""
    assert google_maps_place_url(41.0, None) is None
    assert "query=ChIJ_x" in google_maps_place_url(41.0, None, "ChIJ_x")
