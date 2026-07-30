"""Schemas for the markdown-backed blog.

Content lives as ``.md`` files under ``app/content/blog/`` with a YAML
frontmatter header. This module owns the *validated* shape of that header
(:class:`BlogFrontmatter`) and the runtime object the routes and templates
consume (:class:`BlogPost`).

The filename stem is the slug -- there is no ``slug`` frontmatter field, so a
post's URL and its metadata cannot drift apart, and ``ls app/content/blog/`` is
literally the URL map.
"""

from dataclasses import dataclass
from datetime import date
from typing import Any

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator

# Category slug -> (display label, index-page blurb). A category is a first-class
# URL (/blog/category/<slug>), so adding one here is all it takes to create the
# section; posts opt in via their `category` frontmatter field.
BLOG_CATEGORIES: dict[str, tuple[str, str]] = {
    "guides": (
        "Guides",
        "Hands-on guides to tracking, journaling, and sharing your travels.",
    ),
    "comparisons": (
        "Comparisons",
        "Head-to-head breakdowns of the travel apps people actually use.",
    ),
}

# Slugs that would collide with a real route. `/blog/category` (no argument)
# matches `/blog/{slug}`, so a file named `category.md` would shadow it. Guarding
# here means the collision is a build-time error rather than a live routing bug.
RESERVED_BLOG_SLUGS = frozenset(
    {
        "category",
        "categories",
        "tag",
        "tags",
        "page",
        "feed",
        "rss",
        "index",
        "sitemap",
        "search",
        "author",
        "readme",
    }
)

# Google truncates <title> around 60 chars and `headline` at 110. These are lint
# bounds enforced by the content tests, not hard parse failures.
MAX_META_DESCRIPTION = 160
MAX_HEADLINE = 110

DEFAULT_OG_IMAGE_PATH = "/static/images/screens/og-image.png"
ORGANIZATION_LOGO_PATH = "/static/images/atlasi-logo.png"

# Substituted with settings.app_store_url when a post is rendered, so the content
# files never carry an environment-specific or storefront-specific URL.
APP_STORE_TOKEN = "{{APP_STORE_URL}}"

_WORDS_PER_MINUTE = 225


class BlogContentError(ValueError):
    """A post could not be loaded: bad frontmatter, or CSP-hostile markup."""


class BlogFAQ(BaseModel):
    """One question/answer pair.

    Structurally identical to an entry in ``LANDING_FAQS`` so the same
    ``_faq_page`` builder and the same ``<details class="faq-item">`` markup
    serve both -- which is what stops the visible accordion and the FAQPage
    JSON-LD from drifting apart.
    """

    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True)

    question: str = Field(min_length=5, max_length=200)
    answer: str = Field(min_length=20, max_length=1200)


class BlogFrontmatter(BaseModel):
    """Validated YAML frontmatter.

    ``extra="forbid"`` is deliberate: a typo like ``descrption:`` becomes a hard
    error instead of a post that silently ships with no meta description.
    """

    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True)

    title: str = Field(min_length=5, max_length=140)
    description: str = Field(min_length=50, max_length=MAX_META_DESCRIPTION)
    published: date
    category: str

    # Short form for <title> and schema `headline`; the long `title` stays the H1.
    seo_title: str | None = Field(default=None, max_length=MAX_HEADLINE)
    updated: date | None = None
    tags: list[str] = Field(default_factory=list, max_length=8)
    keywords: list[str] = Field(default_factory=list, max_length=12)
    cover: str | None = None
    cover_alt: str | None = None
    author: str = "Atlasi"
    draft: bool = False
    featured: bool = False
    faqs: list[BlogFAQ] = Field(default_factory=list, max_length=8)
    related: list[str] = Field(default_factory=list, max_length=3)
    # Previous slugs, 301-redirected to this post so renames don't break links.
    aliases: list[str] = Field(default_factory=list, max_length=5)

    @field_validator("category")
    @classmethod
    def _known_category(cls, value: str) -> str:
        if value not in BLOG_CATEGORIES:
            known = ", ".join(sorted(BLOG_CATEGORIES))
            raise ValueError(f"unknown category {value!r}; known categories: {known}")
        return value

    @field_validator("tags", "keywords", mode="after")
    @classmethod
    def _clean_list(cls, value: list[str]) -> list[str]:
        seen: list[str] = []
        for item in value:
            cleaned = item.strip()
            if cleaned and cleaned not in seen:
                seen.append(cleaned)
        return seen

    @model_validator(mode="after")
    def _check_coherence(self) -> "BlogFrontmatter":
        if self.cover and not self.cover_alt:
            raise ValueError("cover requires cover_alt (accessibility + SEO)")
        if self.cover and not self.cover.startswith("images/"):
            raise ValueError(
                f"cover must be a path under static/images/, got {self.cover!r}"
            )
        if self.updated and self.updated < self.published:
            raise ValueError("updated is earlier than published")
        return self

    @property
    def category_label(self) -> str:
        return BLOG_CATEGORIES[self.category][0]

    @property
    def last_modified(self) -> date:
        return self.updated or self.published


@dataclass(frozen=True, slots=True)
class TocEntry:
    """One heading in a post's table of contents."""

    anchor: str
    text: str
    level: int


@dataclass(frozen=True, slots=True)
class BlogPost:
    """A loaded, rendered post.

    Frozen because the registry is built once and shared across requests; nothing
    downstream should be able to mutate a post in place.
    """

    slug: str
    meta: BlogFrontmatter
    html: str
    toc: tuple[TocEntry, ...]
    word_count: int
    # Neighbours are stored as slugs rather than objects so the frozen dataclass
    # never has to hold a reference cycle.
    newer_slug: str | None = None
    older_slug: str | None = None
    related_slugs: tuple[str, ...] = ()

    @property
    def title(self) -> str:
        return self.meta.title

    @property
    def description(self) -> str:
        return self.meta.description

    @property
    def category(self) -> str:
        return self.meta.category

    @property
    def category_label(self) -> str:
        return self.meta.category_label

    @property
    def published(self) -> date:
        return self.meta.published

    @property
    def updated(self) -> date:
        return self.meta.last_modified

    @property
    def faqs(self) -> list[dict[str, str]]:
        """FAQs in the same plain-dict shape as ``LANDING_FAQS``."""
        return [{"question": f.question, "answer": f.answer} for f in self.meta.faqs]

    @property
    def reading_minutes(self) -> int:
        return max(1, round(self.word_count / _WORDS_PER_MINUTE))

    @property
    def url_path(self) -> str:
        return f"/blog/{self.slug}"

    def cover_url(self, base_url: str = "") -> str:
        """Absolute-or-rooted cover URL, falling back to the shared OG card."""
        cover = self.meta.cover
        if not cover:
            return f"{base_url}{DEFAULT_OG_IMAGE_PATH}"
        if cover.startswith(("http://", "https://")):
            return cover
        return f"{base_url}/static/{cover.lstrip('/')}"


@dataclass(frozen=True, slots=True)
class BlogCategory:
    """A category with its posts, for index rendering."""

    slug: str
    label: str
    description: str
    posts: tuple[BlogPost, ...]

    @property
    def url_path(self) -> str:
        return f"/blog/category/{self.slug}"

    @property
    def last_modified(self) -> date | None:
        return max((p.updated for p in self.posts), default=None)


def category_label(slug: str) -> str:
    return BLOG_CATEGORIES[slug][0]


def category_description(slug: str) -> str:
    return BLOG_CATEGORIES[slug][1]


def as_json_ld_date(value: date) -> str:
    """YAML gives us ``date`` for unquoted values and ``str`` for quoted ones.

    Normalising here keeps templates and JSON-LD from having to care which.
    """
    return value.isoformat()


def coerce_frontmatter(data: dict[str, Any]) -> BlogFrontmatter:
    """Validate a raw frontmatter mapping, re-raising as BlogContentError."""
    try:
        return BlogFrontmatter.model_validate(data)
    except Exception as exc:  # pydantic ValidationError and friends
        raise BlogContentError(str(exc)) from exc
