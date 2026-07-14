"""Normalized view model shared by the public list and trip share pages.

`/l/{slug}` and `/t/{slug}` are backed by two different Pydantic models
(`PublicListView` / `PublicTripView`) that describe the same concepts under
different names. Rather than keep two near-duplicate templates in sync, both
are normalized into the `ShareView` defined here, which one editorial template
renders. See `app.core.share_view` for the builder and for `CATEGORY_STYLES`,
the single source of truth for category color.
"""

from datetime import datetime

from pydantic import BaseModel


class CategoryStyle(BaseModel):
    """Styling for one entry type, shared across every surface that colors it.

    The same record drives the tinted tile, the filter chip, the map pin, and
    the legend — it is `tojson`-serialized into the page's nonce'd bootstrap
    script so the map JS and the server-rendered HTML cannot drift apart.

    `icon` is a stable identifier only; the SVG glyph itself lives in the
    template.
    """

    key: str
    tint: str
    ink: str
    pin: str
    label: str
    icon: str


class ShareAuthor(BaseModel):
    """Byline data for the owner of a shared list or trip.

    `avatar_url` is optional: the byline shows the avatar when present and the
    name alone when absent (no letter-avatar placeholder). A page whose owner
    has no profile row renders with `ShareView.author = None` and no byline at
    all rather than failing.
    """

    display_name: str
    avatar_url: str | None = None
    country_count: int = 0


class ShareEntry(BaseModel):
    """One entry, normalized for the shared template.

    `ordinal` is assigned by the builder rather than the template so the map
    pins and the numbered feed rows share one numbering scheme without either
    surface recomputing it.
    """

    ordinal: int
    id: str
    title: str
    type: str
    style: CategoryStyle
    note: str | None = None
    place_name: str | None = None
    photo_url: str | None = None
    latitude: float | None = None
    longitude: float | None = None
    redirect_url: str | None = None

    @property
    def has_coordinates(self) -> bool:
        """True when this entry can be plotted on the map."""
        return self.latitude is not None and self.longitude is not None


class ShareView(BaseModel):
    """A public list or trip, normalized into one shape for one template."""

    title: str
    subtitle: str | None = None
    country_name: str | None = None
    cover_image_url: str | None = None
    share_date: datetime
    author: ShareAuthor | None = None
    entries: list[ShareEntry] = []

    @property
    def entry_count(self) -> int:
        """Number of entries in the feed."""
        return len(self.entries)

    @property
    def map_entries(self) -> list[ShareEntry]:
        """Only the entries the map can actually plot.

        Derived here so neither the template nor the map bootstrap has to
        filter (and neither can filter differently).
        """
        return [entry for entry in self.entries if entry.has_coordinates]

    @property
    def has_map(self) -> bool:
        """True when at least one entry has coordinates worth mapping."""
        return any(entry.has_coordinates for entry in self.entries)

    @property
    def legend(self) -> list[CategoryStyle]:
        """Category styles actually present in this collection.

        Drives both the legend and the filter chips: a collection with no
        stays should not offer a "Stays" chip. Ordered by the canonical
        `EntryType` declaration order, not by first appearance, so the chip row
        does not reshuffle between pages.
        """
        from app.core.share_view import CATEGORY_STYLES

        present = {entry.type for entry in self.entries}
        return [style for key, style in CATEGORY_STYLES.items() if key in present]

    @property
    def map_payload(self) -> list[dict[str, object]]:
        """The plottable entries, in the exact shape `share-map.js` consumes.

        Kept here rather than assembled in Jinja so the contract between the
        server and the map script is typed, unit-tested, and changes in one
        place. Carries only what a pin needs — never the whole entry.
        """
        return [
            {
                "ordinal": entry.ordinal,
                "title": entry.title,
                "lat": entry.latitude,
                "lng": entry.longitude,
                "color": entry.style.pin,
                "category": entry.style.label,
            }
            for entry in self.map_entries
        ]
