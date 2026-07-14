"""Category styling and the normalizing builder for the public share pages.

`CATEGORY_STYLES` is the single source of truth for entry-type color. Four
types times four surfaces (tinted tile, filter chip, map pin, legend) is
exactly where color drifts, so the table is defined once here: the template
reads it for tints and chips, and it is `tojson`-serialized into a nonce'd
bootstrap script for the map pins and legend.

`build_share_view_model` collapses `PublicListView` and `PublicTripView` — two
models for the same concepts — into the one `ShareView` shape the shared
editorial template renders.
"""

from app.schemas.entries import EntryType
from app.schemas.lists import PublicListEntry, PublicListView
from app.schemas.public import PublicTripEntry, PublicTripView
from app.schemas.share import CategoryStyle, ShareAuthor, ShareEntry, ShareView

# Entry types whose `type` string we don't recognize (legacy rows, future
# values written by a newer client) render as places rather than 500-ing.
DEFAULT_CATEGORY = EntryType.PLACE.value

# Insertion order here is the canonical order for the legend and the filter
# chips. Keep every EntryType member represented — `test_share_view.py`
# parameterizes over the enum so an unstyled new type fails loudly.
CATEGORY_STYLES: dict[str, CategoryStyle] = {
    EntryType.PLACE.value: CategoryStyle(
        key="place",
        tint="#D2E4F1",
        ink="#2f6690",
        pin="#2f6690",
        label="Places",
        icon="pin",
    ),
    EntryType.FOOD.value: CategoryStyle(
        key="food",
        tint="#F3DAD1",
        ink="#C1543E",
        pin="#C1543E",
        label="Food",
        icon="fork",
    ),
    EntryType.STAY.value: CategoryStyle(
        key="stay",
        tint="#DAE3D6",
        ink="#547A5F",
        pin="#547A5F",
        label="Stays",
        icon="bed",
    ),
    EntryType.EXPERIENCE.value: CategoryStyle(
        key="experience",
        tint="#FBE7B4",
        ink="#a97b12",
        pin="#a97b12",
        label="Experiences",
        icon="compass",
    ),
}


def category_style(entry_type: str | None) -> CategoryStyle:
    """Look up the style for an entry type, falling back to `place`.

    An unknown or legacy `type` string must not blow up a public page, so this
    never raises.
    """
    if not entry_type:
        return CATEGORY_STYLES[DEFAULT_CATEGORY]
    return CATEGORY_STYLES.get(entry_type, CATEGORY_STYLES[DEFAULT_CATEGORY])


def _photo_url(entry: PublicListEntry | PublicTripEntry) -> str | None:
    """Pick the image for an entry: uploaded media first, then the Google photo.

    Returns `None` when the entry has neither — the template then falls back to
    a tinted category-icon tile.
    """
    if entry.media_urls:
        return entry.media_urls[0]
    return entry.place_photo_url or None


def _build_entry(entry: PublicListEntry | PublicTripEntry, ordinal: int) -> ShareEntry:
    style = category_style(entry.type)
    return ShareEntry(
        ordinal=ordinal,
        id=str(entry.id),
        title=entry.title,
        # Normalize to the resolved style's key so an unknown legacy type
        # reads as `place` everywhere downstream (chips, filters, map).
        type=style.key,
        style=style,
        note=entry.notes,
        place_name=entry.place_name,
        photo_url=_photo_url(entry),
        latitude=entry.latitude,
        longitude=entry.longitude,
        redirect_url=entry.redirect_url,
    )


def build_share_view_model(
    view: PublicListView | PublicTripView,
    *,
    author: ShareAuthor | None = None,
) -> ShareView:
    """Normalize a public list or trip into the shared `ShareView` shape.

    Args:
        view: Either page's existing view model.
        author: Byline data for the owner, or `None` when the owner has no
            profile row — the page then renders without a byline.

    Ordinals are assigned here, 1-based and contiguous in feed order, so the
    numbered feed rows and the map pins share one numbering scheme.
    """
    if isinstance(view, PublicListView):
        subtitle = view.description
        country_name = view.country_name
    else:
        subtitle = view.date_range
        country_name = view.country_name

    return ShareView(
        title=view.name,
        subtitle=subtitle,
        country_name=country_name,
        cover_image_url=view.cover_image_url,
        share_date=view.created_at,
        author=author,
        entries=[
            _build_entry(entry, ordinal)
            for ordinal, entry in enumerate(view.entries, start=1)
        ],
    )
