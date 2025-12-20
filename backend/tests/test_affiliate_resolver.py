"""Tests for affiliate resolver service and partner mapping CRUD."""

from datetime import datetime
from unittest.mock import AsyncMock, patch
from uuid import UUID

from app.schemas.affiliate import (
    PartnerMapping,
    PartnerMappingCreate,
    PartnerMappingUpdate,
)
from app.services.affiliate_resolver import (
    CONFIDENCE_THRESHOLD,
    PARTNER_SEARCH_URLS,
    PARTNER_SLUGS,
    build_partner_property_url,
    calculate_similarity,
    generate_search_url,
    normalize_name,
)

# Test UUIDs
TEST_ENTRY_ID = "550e8400-e29b-41d4-a716-446655440003"
TEST_MAPPING_ID = "550e8400-e29b-41d4-a716-446655440020"


def make_test_mapping(
    mapping_id: str = TEST_MAPPING_ID,
    entry_id: str = TEST_ENTRY_ID,
    partner_slug: str = "booking",
    partner_property_id: str = "hotel-123",
    confidence: float = 0.95,
    is_verified: bool = False,
    google_place_id: str | None = None,
) -> PartnerMapping:
    """Create a test PartnerMapping instance."""
    return PartnerMapping(
        id=UUID(mapping_id),
        entry_id=UUID(entry_id),
        google_place_id=google_place_id,
        partner_slug=partner_slug,
        partner_property_id=partner_property_id,
        confidence=confidence,
        is_verified=is_verified,
        created_at=datetime.fromisoformat("2024-01-01T00:00:00+00:00"),
        updated_at=datetime.fromisoformat("2024-01-01T00:00:00+00:00"),
    )


# =============================================================================
# Name Normalization Tests
# =============================================================================


class TestNormalizeName:
    """Tests for normalize_name function."""

    def test_normalize_lowercase(self) -> None:
        """Test lowercase conversion."""
        assert normalize_name("GRAND HOTEL") == "grand"

    def test_normalize_accents(self) -> None:
        """Test accent removal."""
        # "hotel" suffix removed, "cafe" remains
        assert normalize_name("Hôtel Café") == "hotel cafe"

    def test_normalize_unicode(self) -> None:
        """Test Unicode normalization."""
        assert normalize_name("Zürich Resort") == "zurich"

    def test_normalize_extra_whitespace(self) -> None:
        """Test whitespace handling."""
        assert normalize_name("  Grand   Hotel  ") == "grand"

    def test_normalize_removes_hotel_suffix(self) -> None:
        """Test removal of common hotel suffixes."""
        assert normalize_name("Grand Palace Hotel") == "grand palace"
        assert normalize_name("Ocean View Resort") == "ocean view"
        assert normalize_name("Cozy B&B") == "cozy"

    def test_normalize_empty_string(self) -> None:
        """Test empty string handling."""
        assert normalize_name("") == ""
        assert normalize_name(None) == ""  # type: ignore

    def test_normalize_preserves_meaningful_words(self) -> None:
        """Test that meaningful words are preserved."""
        assert normalize_name("Marriott") == "marriott"
        assert normalize_name("Four Seasons") == "four seasons"


# =============================================================================
# Similarity Calculation Tests
# =============================================================================


class TestCalculateSimilarity:
    """Tests for calculate_similarity function."""

    def test_exact_match(self) -> None:
        """Test exact match returns 1.0."""
        assert calculate_similarity("grand palace", "grand palace") == 1.0

    def test_empty_strings(self) -> None:
        """Test empty string handling."""
        assert calculate_similarity("", "") == 0.0
        assert calculate_similarity("test", "") == 0.0
        assert calculate_similarity("", "test") == 0.0

    def test_similar_names(self) -> None:
        """Test similar names have moderate similarity with typo."""
        similarity = calculate_similarity("grand palace", "grand palce")  # typo
        # Single typo gives moderate similarity (token match + char similarity)
        assert similarity > 0.5

    def test_reordered_words(self) -> None:
        """Test that word order differences are handled."""
        similarity = calculate_similarity("grand hotel paris", "paris grand hotel")
        assert similarity > 0.7  # Token similarity should help

    def test_completely_different(self) -> None:
        """Test completely different names have low similarity."""
        similarity = calculate_similarity("marriott", "hilton")
        assert similarity < 0.5

    def test_partial_match(self) -> None:
        """Test partial matches."""
        similarity = calculate_similarity("grand plaza hotel", "grand plaza")
        # Should have moderate similarity due to shared tokens
        assert 0.5 < similarity < 1.0


# =============================================================================
# Search URL Generation Tests
# =============================================================================


class TestGenerateSearchUrl:
    """Tests for generate_search_url function."""

    def test_booking_search_url(self) -> None:
        """Test Booking.com search URL generation."""
        url = generate_search_url("booking", "Grand Hotel", "Paris, France")
        assert "booking.com/searchresults.html" in url
        assert "ss=" in url
        assert "Grand" in url or "grand" in url.lower()

    def test_tripadvisor_search_url(self) -> None:
        """Test TripAdvisor search URL generation."""
        url = generate_search_url("tripadvisor", "Amazing Tour")
        assert "tripadvisor.com/Search" in url
        assert "q=" in url

    def test_getyourguide_search_url(self) -> None:
        """Test GetYourGuide search URL generation."""
        url = generate_search_url("getyourguide", "City Walking Tour", "Rome, Italy")
        assert "getyourguide.com/s" in url
        assert "q=" in url

    def test_unknown_partner_fallback(self) -> None:
        """Test fallback to Google search for unknown partner."""
        url = generate_search_url("unknown_partner", "Test Place")
        assert "google.com/search" in url

    def test_address_extraction(self) -> None:
        """Test address is used in search query."""
        url = generate_search_url(
            "booking",
            "Hotel California",
            "123 Main St, Beverly Hills, California, USA"
        )
        # Should include city name from address
        assert "California" in url or "california" in url.lower()

    def test_url_encoding(self) -> None:
        """Test special characters are URL encoded."""
        url = generate_search_url("booking", "Hôtel & Café", "Paris, France")
        assert "%" in url  # URL encoding present


# =============================================================================
# Partner Property URL Tests
# =============================================================================


class TestBuildPartnerPropertyUrl:
    """Tests for build_partner_property_url function."""

    def test_booking_url(self) -> None:
        """Test Booking.com property URL."""
        url = build_partner_property_url("booking", "us/hotel-grand-plaza")
        assert url == "https://www.booking.com/hotel/us/hotel-grand-plaza.html"

    def test_tripadvisor_url(self) -> None:
        """Test TripAdvisor property URL."""
        url = build_partner_property_url("tripadvisor", "Hotel_Review-g123")
        assert url == "https://www.tripadvisor.com/Hotel_Review-g123"

    def test_getyourguide_url(self) -> None:
        """Test GetYourGuide activity URL."""
        url = build_partner_property_url("getyourguide", "12345")
        assert url == "https://www.getyourguide.com/activity/12345"

    def test_unknown_partner(self) -> None:
        """Test unknown partner returns property ID as-is."""
        url = build_partner_property_url("unknown", "https://custom-url.com/prop")
        assert url == "https://custom-url.com/prop"


# =============================================================================
# Partner Mapping CRUD Tests
# =============================================================================


class TestPartnerMappingCrud:
    """Tests for partner mapping CRUD operations."""

    def test_create_partner_mapping(self) -> None:
        """Test creating a partner mapping."""
        with patch(
            "app.services.affiliate_links.get_supabase_client"
        ) as mock_get_client:
            mock_db = AsyncMock()
            mock_get_client.return_value = mock_db
            mock_db.post.return_value = [
                {
                    "id": TEST_MAPPING_ID,
                    "entry_id": TEST_ENTRY_ID,
                    "google_place_id": "ChIJ123",
                    "partner_slug": "booking",
                    "partner_property_id": "hotel-123",
                    "confidence": 0.95,
                    "is_verified": False,
                    "created_at": "2024-01-01T00:00:00+00:00",
                    "updated_at": "2024-01-01T00:00:00+00:00",
                }
            ]

            import asyncio

            from app.services.affiliate_links import create_partner_mapping

            data = PartnerMappingCreate(
                entry_id=UUID(TEST_ENTRY_ID),
                google_place_id="ChIJ123",
                partner_slug="booking",
                partner_property_id="hotel-123",
                confidence=0.95,
            )

            result = asyncio.get_event_loop().run_until_complete(
                create_partner_mapping(data)
            )

            assert result.partner_slug == "booking"
            assert result.partner_property_id == "hotel-123"
            assert result.confidence == 0.95
            mock_db.post.assert_called_once()

    def test_get_partner_mapping(self) -> None:
        """Test fetching a partner mapping by entry ID and partner slug."""
        with patch(
            "app.services.affiliate_links.get_supabase_client"
        ) as mock_get_client:
            mock_db = AsyncMock()
            mock_get_client.return_value = mock_db
            mock_db.get.return_value = [
                {
                    "id": TEST_MAPPING_ID,
                    "entry_id": TEST_ENTRY_ID,
                    "google_place_id": None,
                    "partner_slug": "booking",
                    "partner_property_id": "hotel-123",
                    "confidence": 0.95,
                    "is_verified": False,
                    "created_at": "2024-01-01T00:00:00+00:00",
                    "updated_at": "2024-01-01T00:00:00+00:00",
                }
            ]

            import asyncio

            from app.services.affiliate_links import get_partner_mapping

            result = asyncio.get_event_loop().run_until_complete(
                get_partner_mapping(TEST_ENTRY_ID, "booking")
            )

            assert result is not None
            assert result.partner_slug == "booking"
            mock_db.get.assert_called_once()

    def test_get_partner_mapping_not_found(self) -> None:
        """Test fetching non-existent partner mapping returns None."""
        with patch(
            "app.services.affiliate_links.get_supabase_client"
        ) as mock_get_client:
            mock_db = AsyncMock()
            mock_get_client.return_value = mock_db
            mock_db.get.return_value = []

            import asyncio

            from app.services.affiliate_links import get_partner_mapping

            result = asyncio.get_event_loop().run_until_complete(
                get_partner_mapping(TEST_ENTRY_ID, "booking")
            )

            assert result is None

    def test_get_mappings_for_entry(self) -> None:
        """Test fetching all mappings for an entry."""
        with patch(
            "app.services.affiliate_links.get_supabase_client"
        ) as mock_get_client:
            mock_db = AsyncMock()
            mock_get_client.return_value = mock_db
            mock_db.get.return_value = [
                {
                    "id": TEST_MAPPING_ID,
                    "entry_id": TEST_ENTRY_ID,
                    "google_place_id": None,
                    "partner_slug": "booking",
                    "partner_property_id": "hotel-123",
                    "confidence": 0.95,
                    "is_verified": False,
                    "created_at": "2024-01-01T00:00:00+00:00",
                    "updated_at": "2024-01-01T00:00:00+00:00",
                },
                {
                    "id": "550e8400-e29b-41d4-a716-446655440021",
                    "entry_id": TEST_ENTRY_ID,
                    "google_place_id": None,
                    "partner_slug": "tripadvisor",
                    "partner_property_id": "Hotel_Review-123",
                    "confidence": 0.85,
                    "is_verified": False,
                    "created_at": "2024-01-01T00:00:00+00:00",
                    "updated_at": "2024-01-01T00:00:00+00:00",
                },
            ]

            import asyncio

            from app.services.affiliate_links import get_mappings_for_entry

            result = asyncio.get_event_loop().run_until_complete(
                get_mappings_for_entry(TEST_ENTRY_ID)
            )

            assert len(result) == 2
            assert result[0].partner_slug == "booking"
            assert result[1].partner_slug == "tripadvisor"

    def test_upsert_partner_mapping_creates_new(self) -> None:
        """Test upserting creates a new mapping when none exists."""
        with patch(
            "app.services.affiliate_links.get_supabase_client"
        ) as mock_get_client:
            mock_db = AsyncMock()
            mock_get_client.return_value = mock_db
            mock_db.upsert.return_value = [
                {
                    "id": TEST_MAPPING_ID,
                    "entry_id": TEST_ENTRY_ID,
                    "google_place_id": "ChIJ123",
                    "partner_slug": "booking",
                    "partner_property_id": "hotel-456",
                    "confidence": 0.9,
                    "is_verified": False,
                    "created_at": "2024-01-01T00:00:00+00:00",
                    "updated_at": "2024-01-01T00:00:00+00:00",
                }
            ]

            import asyncio

            from app.services.affiliate_links import upsert_partner_mapping

            data = PartnerMappingCreate(
                entry_id=UUID(TEST_ENTRY_ID),
                google_place_id="ChIJ123",
                partner_slug="booking",
                partner_property_id="hotel-456",
                confidence=0.9,
            )

            result = asyncio.get_event_loop().run_until_complete(
                upsert_partner_mapping(data)
            )

            assert result.partner_property_id == "hotel-456"
            mock_db.upsert.assert_called_once()

    def test_update_partner_mapping(self) -> None:
        """Test updating a partner mapping."""
        with patch(
            "app.services.affiliate_links.get_supabase_client"
        ) as mock_get_client:
            mock_db = AsyncMock()
            mock_get_client.return_value = mock_db
            mock_db.patch.return_value = [
                {
                    "id": TEST_MAPPING_ID,
                    "entry_id": TEST_ENTRY_ID,
                    "google_place_id": None,
                    "partner_slug": "booking",
                    "partner_property_id": "hotel-123",
                    "confidence": 1.0,
                    "is_verified": True,
                    "created_at": "2024-01-01T00:00:00+00:00",
                    "updated_at": "2024-01-01T00:00:00+00:00",
                }
            ]

            import asyncio

            from app.services.affiliate_links import update_partner_mapping

            data = PartnerMappingUpdate(confidence=1.0, is_verified=True)

            result = asyncio.get_event_loop().run_until_complete(
                update_partner_mapping(TEST_MAPPING_ID, data)
            )

            assert result is not None
            assert result.confidence == 1.0
            assert result.is_verified is True

    def test_delete_partner_mapping(self) -> None:
        """Test deleting a partner mapping."""
        with patch(
            "app.services.affiliate_links.get_supabase_client"
        ) as mock_get_client:
            mock_db = AsyncMock()
            mock_get_client.return_value = mock_db
            mock_db.delete.return_value = [{"id": TEST_MAPPING_ID}]

            import asyncio

            from app.services.affiliate_links import delete_partner_mapping

            result = asyncio.get_event_loop().run_until_complete(
                delete_partner_mapping(TEST_MAPPING_ID)
            )

            assert result is True
            mock_db.delete.assert_called_once()

    def test_delete_partner_mapping_not_found(self) -> None:
        """Test deleting non-existent mapping returns False."""
        with patch(
            "app.services.affiliate_links.get_supabase_client"
        ) as mock_get_client:
            mock_db = AsyncMock()
            mock_get_client.return_value = mock_db
            mock_db.delete.return_value = []

            import asyncio

            from app.services.affiliate_links import delete_partner_mapping

            result = asyncio.get_event_loop().run_until_complete(
                delete_partner_mapping(TEST_MAPPING_ID)
            )

            assert result is False


# =============================================================================
# Resolver Tests
# =============================================================================


class TestResolveEntry:
    """Tests for resolve_entry function."""

    def test_resolve_uses_existing_mapping(self) -> None:
        """Test resolver returns existing high-confidence mapping."""
        mapping = make_test_mapping(confidence=0.95)

        with patch(
            "app.services.affiliate_resolver.get_partner_mapping",
            new_callable=AsyncMock,
            return_value=mapping,
        ):
            import asyncio

            from app.services.affiliate_resolver import resolve_entry

            result = asyncio.get_event_loop().run_until_complete(
                resolve_entry(
                    entry_id=UUID(TEST_ENTRY_ID),
                    place_name="Grand Hotel",
                    partner_slug="booking",
                )
            )

            assert result is not None
            assert result.confidence == 0.95

    def test_resolve_ignores_low_confidence_mapping(self) -> None:
        """Test resolver ignores existing low-confidence mapping."""
        mapping = make_test_mapping(confidence=0.5)  # Below threshold

        with (
            patch(
                "app.services.affiliate_resolver.get_partner_mapping",
                new_callable=AsyncMock,
                return_value=mapping,
            ),
            patch(
                "app.services.affiliate_resolver.get_mapping_by_google_place_id",
                new_callable=AsyncMock,
                return_value=None,
            ),
        ):
            import asyncio

            from app.services.affiliate_resolver import resolve_entry

            result = asyncio.get_event_loop().run_until_complete(
                resolve_entry(
                    entry_id=UUID(TEST_ENTRY_ID),
                    place_name="Grand Hotel",
                    partner_slug="booking",
                )
            )

            # Should try to find better match, but return None if not found
            # (low confidence mapping doesn't meet threshold)
            assert result is None

    def test_resolve_via_google_place_id(self) -> None:
        """Test resolver finds match via Google Place ID."""
        place_mapping = make_test_mapping(
            google_place_id="ChIJ123",
            confidence=1.0,
        )
        new_mapping = make_test_mapping(
            entry_id=TEST_ENTRY_ID,
            google_place_id="ChIJ123",
            confidence=1.0,
        )

        with (
            patch(
                "app.services.affiliate_resolver.get_partner_mapping",
                new_callable=AsyncMock,
                return_value=None,
            ),
            patch(
                "app.services.affiliate_resolver.get_mapping_by_google_place_id",
                new_callable=AsyncMock,
                return_value=place_mapping,
            ),
            patch(
                "app.services.affiliate_resolver.upsert_partner_mapping",
                new_callable=AsyncMock,
                return_value=new_mapping,
            ),
        ):
            import asyncio

            from app.services.affiliate_resolver import resolve_entry

            result = asyncio.get_event_loop().run_until_complete(
                resolve_entry(
                    entry_id=UUID(TEST_ENTRY_ID),
                    place_name="Grand Hotel",
                    partner_slug="booking",
                    google_place_id="ChIJ123",
                )
            )

            assert result is not None
            assert result.google_place_id == "ChIJ123"
            assert result.confidence == 1.0

    def test_resolve_returns_none_for_no_match(self) -> None:
        """Test resolver returns None when no match found."""
        with (
            patch(
                "app.services.affiliate_resolver.get_partner_mapping",
                new_callable=AsyncMock,
                return_value=None,
            ),
            patch(
                "app.services.affiliate_resolver.get_mapping_by_google_place_id",
                new_callable=AsyncMock,
                return_value=None,
            ),
        ):
            import asyncio

            from app.services.affiliate_resolver import resolve_entry

            result = asyncio.get_event_loop().run_until_complete(
                resolve_entry(
                    entry_id=UUID(TEST_ENTRY_ID),
                    place_name="Grand Hotel",
                    partner_slug="booking",
                )
            )

            assert result is None

    def test_resolve_unknown_partner_returns_none(self) -> None:
        """Test resolver returns None for unknown partner."""
        import asyncio

        from app.services.affiliate_resolver import resolve_entry

        result = asyncio.get_event_loop().run_until_complete(
            resolve_entry(
                entry_id=UUID(TEST_ENTRY_ID),
                place_name="Grand Hotel",
                partner_slug="unknown_partner",
            )
        )

        assert result is None


class TestResolveOrFallback:
    """Tests for resolve_or_fallback function."""

    def test_returns_partner_url_on_match(self) -> None:
        """Test returns partner URL when match found."""
        mapping = make_test_mapping(
            partner_slug="booking",
            partner_property_id="us/grand-hotel",
            confidence=0.95,
        )

        with patch(
            "app.services.affiliate_resolver.resolve_entry",
            new_callable=AsyncMock,
            return_value=mapping,
        ):
            import asyncio

            from app.services.affiliate_resolver import resolve_or_fallback

            url, confidence = asyncio.get_event_loop().run_until_complete(
                resolve_or_fallback(
                    entry_id=UUID(TEST_ENTRY_ID),
                    place_name="Grand Hotel",
                    partner_slug="booking",
                )
            )

            assert "booking.com/hotel" in url
            assert confidence == 0.95

    def test_returns_search_url_on_no_match(self) -> None:
        """Test returns search URL when no match found."""
        with patch(
            "app.services.affiliate_resolver.resolve_entry",
            new_callable=AsyncMock,
            return_value=None,
        ):
            import asyncio

            from app.services.affiliate_resolver import resolve_or_fallback

            url, confidence = asyncio.get_event_loop().run_until_complete(
                resolve_or_fallback(
                    entry_id=UUID(TEST_ENTRY_ID),
                    place_name="Grand Hotel",
                    partner_slug="booking",
                    address="Paris, France",
                )
            )

            assert "booking.com/searchresults.html" in url
            assert confidence == 0.0


class TestRefreshEntryMappings:
    """Tests for refresh_entry_mappings function."""

    def test_refresh_all_partners(self) -> None:
        """Test refreshing mappings for all partners."""
        mappings = [
            make_test_mapping(partner_slug="booking", confidence=0.95),
        ]

        with patch(
            "app.services.affiliate_resolver.resolve_entry",
            new_callable=AsyncMock,
            side_effect=[mappings[0], None, None],  # Only booking matches
        ):
            import asyncio

            from app.services.affiliate_resolver import refresh_entry_mappings

            result = asyncio.get_event_loop().run_until_complete(
                refresh_entry_mappings(
                    entry_id=UUID(TEST_ENTRY_ID),
                    place_name="Grand Hotel",
                )
            )

            assert len(result) == 1
            assert result[0].partner_slug == "booking"

    def test_refresh_specific_partners(self) -> None:
        """Test refreshing mappings for specific partners only."""
        mapping = make_test_mapping(partner_slug="tripadvisor", confidence=0.9)

        with patch(
            "app.services.affiliate_resolver.resolve_entry",
            new_callable=AsyncMock,
            return_value=mapping,
        ):
            import asyncio

            from app.services.affiliate_resolver import refresh_entry_mappings

            result = asyncio.get_event_loop().run_until_complete(
                refresh_entry_mappings(
                    entry_id=UUID(TEST_ENTRY_ID),
                    place_name="Grand Hotel",
                    partner_slugs=["tripadvisor"],
                )
            )

            assert len(result) == 1
            assert result[0].partner_slug == "tripadvisor"


class TestGetBestPartnerForEntry:
    """Tests for get_best_partner_for_entry function."""

    def test_returns_highest_confidence_mapping(self) -> None:
        """Test returns mapping with highest confidence."""
        mappings = [
            make_test_mapping(partner_slug="booking", confidence=0.85),
            make_test_mapping(partner_slug="tripadvisor", confidence=0.95),
        ]

        with patch(
            "app.services.affiliate_resolver.refresh_entry_mappings",
            new_callable=AsyncMock,
            return_value=mappings,
        ):
            import asyncio

            from app.services.affiliate_resolver import get_best_partner_for_entry

            best, fallback = asyncio.get_event_loop().run_until_complete(
                get_best_partner_for_entry(
                    entry_id=UUID(TEST_ENTRY_ID),
                    place_name="Grand Hotel",
                )
            )

            assert best is not None
            assert best.partner_slug == "tripadvisor"
            assert best.confidence == 0.95
            assert fallback is None

    def test_returns_fallback_when_no_matches(self) -> None:
        """Test returns fallback URL when no matches found."""
        with patch(
            "app.services.affiliate_resolver.refresh_entry_mappings",
            new_callable=AsyncMock,
            return_value=[],
        ):
            import asyncio

            from app.services.affiliate_resolver import get_best_partner_for_entry

            best, fallback = asyncio.get_event_loop().run_until_complete(
                get_best_partner_for_entry(
                    entry_id=UUID(TEST_ENTRY_ID),
                    place_name="Grand Hotel",
                    address="Paris, France",
                )
            )

            assert best is None
            assert fallback is not None
            assert "booking.com" in fallback


# =============================================================================
# Constants Tests
# =============================================================================


class TestConstants:
    """Tests for module constants."""

    def test_partner_slugs_defined(self) -> None:
        """Test all expected partner slugs are defined."""
        assert "booking" in PARTNER_SLUGS
        assert "tripadvisor" in PARTNER_SLUGS
        assert "getyourguide" in PARTNER_SLUGS

    def test_confidence_threshold_valid(self) -> None:
        """Test confidence threshold is reasonable."""
        assert 0.0 < CONFIDENCE_THRESHOLD < 1.0
        assert CONFIDENCE_THRESHOLD == 0.8

    def test_search_urls_defined_for_all_partners(self) -> None:
        """Test search URLs are defined for all partners."""
        for slug in PARTNER_SLUGS:
            assert slug in PARTNER_SEARCH_URLS
