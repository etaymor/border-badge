"""Tests for location hint extraction (raw vs filtered)."""

from app.services.place_extractor.location_hints import (
    extract_location_hints,
    extract_raw_location_hints,
)


class TestRawLocationHints:
    def test_raw_hints_include_all_countries(self):
        """Raw hints should include all mentioned countries without filtering."""
        text = "Trip to Rome, Milan, Florence, and Ljubljana"
        raw = extract_raw_location_hints(text)
        country_codes = {h.country_code for h in raw}
        assert "IT" in country_codes
        assert "SI" in country_codes

    def test_filtered_hints_drop_minority(self):
        """Filtered hints should drop minority countries (existing behavior)."""
        text = "Trip to Rome, Milan, Florence, and Ljubljana"
        filtered = extract_location_hints(text)
        country_codes = {h.country_code for h in filtered}
        assert "IT" in country_codes
        # SI is minority (1 hint) vs IT (3 hints), so gets filtered
        assert "SI" not in country_codes

    def test_raw_and_filtered_same_for_single_country(self):
        """When all hints are from one country, raw and filtered should match."""
        text = "Trip to Rome and Milan"
        raw = extract_raw_location_hints(text)
        filtered = extract_location_hints(text)
        assert len(raw) == len(filtered)
        assert {h.name for h in raw} == {h.name for h in filtered}
