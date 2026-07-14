"""Tests for the normalized share view model (U2).

One template renders both `/l/{slug}` and `/t/{slug}`, so both Pydantic input
models must normalize to the same `ShareView` shape, and category styling must
have exactly one source of truth.
"""

from datetime import UTC, datetime
from uuid import UUID, uuid4

import pytest

from app.core.share_view import CATEGORY_STYLES, DEFAULT_CATEGORY, category_style
from app.schemas.entries import EntryType
from app.schemas.lists import PublicListEntry, PublicListView
from app.schemas.public import PublicTripEntry, PublicTripView
from app.schemas.share import ShareAuthor, ShareEntry, ShareView

CREATED_AT = datetime(2026, 3, 14, 12, 0, 0, tzinfo=UTC)


def _build(view, author: ShareAuthor | None = None) -> ShareView:
    from app.core.share_view import build_share_view_model

    return build_share_view_model(view, author=author)


def _author() -> ShareAuthor:
    return ShareAuthor(
        display_name="Ada Lovelace",
        avatar_url="https://cdn.example.com/ada.jpg",
        country_count=42,
    )


# ---------------------------------------------------------------------------
# CATEGORY_STYLES
# ---------------------------------------------------------------------------


@pytest.mark.parametrize("entry_type", list(EntryType))
def test_every_entry_type_has_a_category_style(entry_type: EntryType) -> None:
    """A future fifth EntryType must fail loudly, not render colorless."""
    assert entry_type.value in CATEGORY_STYLES
    style = CATEGORY_STYLES[entry_type.value]
    assert style.tint.startswith("#")
    assert style.ink.startswith("#")
    assert style.pin.startswith("#")
    assert style.label
    assert style.icon


def test_all_four_category_colors_are_distinct() -> None:
    """Guards a copy-paste error in the color table."""
    for field in ("tint", "ink", "pin", "label", "icon"):
        values = [getattr(s, field) for s in CATEGORY_STYLES.values()]
        assert len(set(values)) == len(values), f"duplicate {field}"


def test_category_style_falls_back_to_place_for_unknown_type() -> None:
    assert category_style("wormhole") == CATEGORY_STYLES[DEFAULT_CATEGORY]
    assert category_style(None) == CATEGORY_STYLES[DEFAULT_CATEGORY]
    assert category_style("food") == CATEGORY_STYLES["food"]


def test_category_styles_serialize_to_json_for_the_map_bootstrap() -> None:
    style = CATEGORY_STYLES["place"]
    dumped = style.model_dump()
    assert set(dumped) == {"key", "tint", "ink", "pin", "label", "icon"}


# ---------------------------------------------------------------------------
# List / trip equivalence -- the whole point of the unit
# ---------------------------------------------------------------------------


def _equivalent_pair() -> tuple[PublicListView, PublicTripView]:
    entry_id: UUID = uuid4()
    list_view = PublicListView(
        id=uuid4(),
        name="Tokyo Favorites",
        slug="tokyo-favorites",
        description="Best of the city",
        country_name="Japan",
        cover_image_url="https://cdn.example.com/cover.jpg",
        created_at=CREATED_AT,
        entries=[
            PublicListEntry(
                id=entry_id,
                title="Sushi Dai",
                type="food",
                notes="Worth the queue",
                place_name="Toyosu Market",
                latitude=35.6,
                longitude=139.7,
                media_urls=["https://cdn.example.com/a.jpg"],
                redirect_url="https://go.example.com/1",
            )
        ],
    )
    trip_view = PublicTripView(
        id=uuid4(),
        name="Tokyo Favorites",
        share_slug="tokyo-favorites",
        country_name="Japan",
        country_code="JP",
        cover_image_url="https://cdn.example.com/cover.jpg",
        date_range="Best of the city",
        created_at=CREATED_AT,
        entries=[
            PublicTripEntry(
                id=entry_id,
                title="Sushi Dai",
                type="food",
                notes="Worth the queue",
                place_name="Toyosu Market",
                latitude=35.6,
                longitude=139.7,
                media_urls=["https://cdn.example.com/a.jpg"],
                redirect_url="https://go.example.com/1",
            )
        ],
    )
    return list_view, trip_view


def test_list_and_trip_with_equivalent_content_produce_equal_share_views() -> None:
    list_view, trip_view = _equivalent_pair()
    author = _author()

    from_list = _build(list_view, author)
    from_trip = _build(trip_view, author)

    assert from_list == from_trip
    assert from_list.title == "Tokyo Favorites"
    assert from_list.subtitle == "Best of the city"
    assert from_list.country_name == "Japan"
    assert from_list.cover_image_url == "https://cdn.example.com/cover.jpg"
    assert from_list.share_date == CREATED_AT
    assert from_list.entry_count == 1


def test_subtitle_maps_from_description_and_date_range() -> None:
    list_view, trip_view = _equivalent_pair()
    list_view.description = None
    trip_view.date_range = None
    assert _build(list_view).subtitle is None
    assert _build(trip_view).subtitle is None


# ---------------------------------------------------------------------------
# Photo precedence
# ---------------------------------------------------------------------------


def _list_with(**kwargs) -> PublicListView:
    return PublicListView(
        id=uuid4(),
        name="L",
        slug="l",
        created_at=CREATED_AT,
        entries=[
            PublicListEntry(id=uuid4(), title="E", type="place", **kwargs),
        ],
    )


def test_media_urls_first_beats_place_photo_url() -> None:
    view = _list_with(
        media_urls=["https://cdn.example.com/one.jpg", "https://x/two.jpg"],
        place_photo_url="https://places/g.jpg",
    )
    assert _build(view).entries[0].photo_url == "https://cdn.example.com/one.jpg"


def test_place_photo_url_used_when_media_urls_empty() -> None:
    view = _list_with(media_urls=[], place_photo_url="https://places/g.jpg")
    assert _build(view).entries[0].photo_url == "https://places/g.jpg"


def test_photo_url_is_none_when_neither_present() -> None:
    view = _list_with(media_urls=[], place_photo_url=None)
    assert _build(view).entries[0].photo_url is None


def test_photo_precedence_matches_for_trip_entries() -> None:
    trip = PublicTripView(
        id=uuid4(),
        name="T",
        share_slug="t",
        country_name="Japan",
        country_code="JP",
        created_at=CREATED_AT,
        entries=[
            PublicTripEntry(
                id=uuid4(),
                title="E",
                type="place",
                media_urls=["https://cdn/one.jpg"],
                place_photo_url="https://places/g.jpg",
            )
        ],
    )
    assert _build(trip).entries[0].photo_url == "https://cdn/one.jpg"


# ---------------------------------------------------------------------------
# Ordinals
# ---------------------------------------------------------------------------


def test_ordinals_are_one_based_contiguous_and_in_feed_order() -> None:
    view = PublicListView(
        id=uuid4(),
        name="L",
        slug="l",
        created_at=CREATED_AT,
        entries=[
            PublicListEntry(id=uuid4(), title=f"E{i}", type="place") for i in range(5)
        ],
    )
    share = _build(view)
    assert [e.ordinal for e in share.entries] == [1, 2, 3, 4, 5]
    assert [e.title for e in share.entries] == ["E0", "E1", "E2", "E3", "E4"]
    assert share.entry_count == 5


# ---------------------------------------------------------------------------
# Unknown entry type
# ---------------------------------------------------------------------------


def test_unknown_entry_type_falls_back_to_place_styling() -> None:
    view = PublicListView(
        id=uuid4(),
        name="L",
        slug="l",
        created_at=CREATED_AT,
        entries=[PublicListEntry(id=uuid4(), title="Legacy", type="activity")],
    )
    share = _build(view)
    entry = share.entries[0]
    assert entry.style == CATEGORY_STYLES["place"]
    assert entry.type == "place"


# ---------------------------------------------------------------------------
# Author
# ---------------------------------------------------------------------------


def test_author_present_carries_byline_data() -> None:
    share = _build(_list_with(), _author())
    assert share.author is not None
    assert share.author.display_name == "Ada Lovelace"
    assert share.author.avatar_url == "https://cdn.example.com/ada.jpg"
    assert share.author.country_count == 42


def test_share_view_builds_without_an_author() -> None:
    share = _build(_list_with(), None)
    assert share.author is None


def test_author_avatar_url_is_optional() -> None:
    author = ShareAuthor(display_name="Ada", avatar_url=None, country_count=0)
    share = _build(_list_with(), author)
    assert share.author is not None
    assert share.author.avatar_url is None


# ---------------------------------------------------------------------------
# Derived helpers: map entries + legend
# ---------------------------------------------------------------------------


def test_entries_without_coordinates_appear_in_feed_but_not_on_map() -> None:
    view = PublicListView(
        id=uuid4(),
        name="L",
        slug="l",
        created_at=CREATED_AT,
        entries=[
            PublicListEntry(
                id=uuid4(), title="Mapped", type="place", latitude=1.0, longitude=2.0
            ),
            PublicListEntry(id=uuid4(), title="Unmapped", type="food"),
            PublicListEntry(id=uuid4(), title="HalfMapped", type="stay", latitude=3.0),
        ],
    )
    share = _build(view)
    assert [e.title for e in share.entries] == ["Mapped", "Unmapped", "HalfMapped"]
    assert [e.ordinal for e in share.entries] == [1, 2, 3]

    mapped = share.map_entries
    assert [e.title for e in mapped] == ["Mapped"]
    assert mapped[0].ordinal == 1
    assert mapped[0].latitude == 1.0
    assert mapped[0].longitude == 2.0
    assert share.has_map is True


def test_has_map_is_false_when_no_entry_has_coordinates() -> None:
    view = _list_with()
    share = _build(view)
    assert share.map_entries == []
    assert share.has_map is False


def test_legend_only_contains_categories_present_in_the_collection() -> None:
    view = PublicListView(
        id=uuid4(),
        name="L",
        slug="l",
        created_at=CREATED_AT,
        entries=[
            PublicListEntry(id=uuid4(), title="A", type="food"),
            PublicListEntry(id=uuid4(), title="B", type="place"),
            PublicListEntry(id=uuid4(), title="C", type="food"),
        ],
    )
    share = _build(view)
    keys = [style.key for style in share.legend]
    assert keys == ["place", "food"]  # canonical order, deduped, no stay/experience


def test_legend_order_follows_entry_type_declaration_order() -> None:
    view = PublicListView(
        id=uuid4(),
        name="L",
        slug="l",
        created_at=CREATED_AT,
        entries=[
            PublicListEntry(id=uuid4(), title="A", type="experience"),
            PublicListEntry(id=uuid4(), title="B", type="stay"),
            PublicListEntry(id=uuid4(), title="C", type="place"),
            PublicListEntry(id=uuid4(), title="D", type="food"),
        ],
    )
    share = _build(view)
    assert [s.key for s in share.legend] == ["place", "food", "stay", "experience"]


def test_share_entry_fields_are_normalized_from_list_entry() -> None:
    view = PublicListView(
        id=uuid4(),
        name="L",
        slug="l",
        created_at=CREATED_AT,
        entries=[
            PublicListEntry(
                id=uuid4(),
                title="Sushi Dai",
                type="food",
                notes="Queue early",
                place_name="Toyosu",
                latitude=35.6,
                longitude=139.7,
                redirect_url="https://go/1",
            )
        ],
    )
    entry: ShareEntry = _build(view).entries[0]
    assert entry.ordinal == 1
    assert entry.title == "Sushi Dai"
    assert entry.type == "food"
    assert entry.note == "Queue early"
    assert entry.place_name == "Toyosu"
    assert entry.redirect_url == "https://go/1"
    assert entry.style.pin == CATEGORY_STYLES["food"].pin
