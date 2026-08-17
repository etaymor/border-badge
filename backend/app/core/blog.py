"""Loader and in-memory registry for the markdown blog.

Posts are plain ``.md`` files under ``app/content/blog/``. Publishing is a commit
plus a deploy -- there is no database, no CMS, and no admin UI to secure.

Validation strictness is deliberately environment-dependent. See
:func:`build_registry` for the reasoning; the short version is that this module
is imported at app startup, so a fail-fast on bad content would take the landing
page and the entire API down over a typo in a blog post.
"""

import logging
import re
from collections.abc import Mapping
from dataclasses import dataclass, replace
from pathlib import Path
from typing import Any

import yaml

from app.core.config import get_settings
from app.core.markdown import render_markdown
from app.schemas.blog import (
    APP_STORE_TOKEN,
    BLOG_CATEGORIES,
    RESERVED_BLOG_SLUGS,
    BlogCategory,
    BlogContentError,
    BlogPost,
    category_description,
    category_label,
    coerce_frontmatter,
)

logger = logging.getLogger(__name__)

CONTENT_DIR = Path(__file__).resolve().parent.parent / "content" / "blog"

# Files that live alongside posts but are not posts.
_NON_POST_STEMS = frozenset({"readme"})

_SLUG_RE = re.compile(r"^[a-z0-9]+(?:-[a-z0-9]+)*$")

# Matches only a frontmatter block that opens at the very start of the file. The
# non-greedy body plus the line-anchored closing `---` is what keeps the many
# `---` horizontal rules *inside* a post from terminating the header early --
# every migrated post uses them as section separators, so a naive
# `text.split("---")` would truncate bodies mid-article.
_FRONTMATTER_RE = re.compile(
    r"\A---[ \t]*\r?\n(.*?)\r?\n---[ \t]*(?:\r?\n|\Z)",
    re.DOTALL,
)

_MAX_RELATED = 3


def split_frontmatter(text: str) -> tuple[dict[str, Any], str]:
    """Split a post into its frontmatter mapping and its markdown body."""
    text = text.lstrip("﻿")  # a BOM makes the YAML parser choke
    match = _FRONTMATTER_RE.match(text)
    if not match:
        raise BlogContentError("missing or malformed YAML frontmatter block")
    # safe_load only -- never yaml.load, which can construct arbitrary objects.
    data = yaml.safe_load(match.group(1)) or {}
    if not isinstance(data, dict):
        raise BlogContentError("frontmatter must be a YAML mapping")
    return data, text[match.end() :]


def load_post(path: Path, app_store_url: str = "") -> BlogPost:
    """Parse, validate and render a single post file. Raises on any problem."""
    slug = path.stem
    if not _SLUG_RE.match(slug):
        raise BlogContentError(
            f"filename {path.name!r} is not a valid slug (expected lowercase "
            "words separated by single hyphens)"
        )
    if slug in RESERVED_BLOG_SLUGS:
        raise BlogContentError(
            f"slug {slug!r} is reserved because it would collide with a route"
        )

    raw = path.read_text(encoding="utf-8")
    data, body = split_frontmatter(raw)
    meta = coerce_frontmatter(data)

    # Keeps the storefront URL out of the content files entirely, so changing it
    # is a config edit rather than a six-file find-and-replace.
    if app_store_url:
        body = body.replace(APP_STORE_TOKEN, app_store_url)

    rendered = render_markdown(body, source=path.name)
    return BlogPost(
        slug=slug,
        meta=meta,
        html=rendered.html,
        toc=rendered.toc,
        word_count=rendered.word_count,
    )


@dataclass(frozen=True, slots=True)
class BlogRegistry:
    """Every published post, plus the indexes the routes need."""

    posts: tuple[BlogPost, ...]
    by_slug: Mapping[str, BlogPost]
    by_category: Mapping[str, tuple[BlogPost, ...]]
    by_tag: Mapping[str, tuple[BlogPost, ...]]
    aliases: Mapping[str, str]

    def get(self, slug: str) -> BlogPost | None:
        return self.by_slug.get(slug)

    def category(self, slug: str) -> BlogCategory | None:
        """None (not an empty category) for an unknown slug, so routes 404."""
        if slug not in BLOG_CATEGORIES:
            return None
        return BlogCategory(
            slug=slug,
            label=category_label(slug),
            description=category_description(slug),
            posts=self.by_category.get(slug, ()),
        )

    def categories(self) -> tuple[BlogCategory, ...]:
        """Categories that actually contain posts, in declaration order."""
        result = []
        for slug in BLOG_CATEGORIES:
            posts = self.by_category.get(slug, ())
            if posts:
                result.append(
                    BlogCategory(
                        slug=slug,
                        label=category_label(slug),
                        description=category_description(slug),
                        posts=posts,
                    )
                )
        return tuple(result)

    def related_for(self, post: BlogPost) -> tuple[BlogPost, ...]:
        return tuple(self.by_slug[s] for s in post.related_slugs if s in self.by_slug)


def _sort_key(post: BlogPost) -> tuple[Any, ...]:
    # Newest first; `featured` breaks a date tie, then slug. The tiebreak is not
    # cosmetic: six posts migrated in one commit share a publish date, and
    # without it the order would depend on filesystem iteration and differ
    # between a laptop and the deployed container.
    return (-post.published.toordinal(), not post.meta.featured, post.slug)


def _pick_related(post: BlogPost, candidates: list[BlogPost]) -> tuple[str, ...]:
    """Explicit `related:` first, then same category, then tag overlap."""
    chosen: list[str] = []
    by_slug = {p.slug: p for p in candidates}

    for slug in post.meta.related:
        if slug != post.slug and slug in by_slug and slug not in chosen:
            chosen.append(slug)

    if len(chosen) < _MAX_RELATED:
        for other in candidates:
            if len(chosen) >= _MAX_RELATED:
                break
            if other.slug == post.slug or other.slug in chosen:
                continue
            if other.category == post.category:
                chosen.append(other.slug)

    if len(chosen) < _MAX_RELATED:
        tags = set(post.meta.tags)
        scored = sorted(
            (
                other
                for other in candidates
                if other.slug != post.slug and other.slug not in chosen
            ),
            key=lambda o: (-len(tags & set(o.meta.tags)), _sort_key(o)),
        )
        for other in scored:
            if len(chosen) >= _MAX_RELATED:
                break
            chosen.append(other.slug)

    return tuple(chosen[:_MAX_RELATED])


def build_registry(
    content_dir: Path | None = None,
    *,
    strict: bool = True,
    include_drafts: bool = False,
    app_store_url: str = "",
) -> BlogRegistry:
    """Load every post under ``content_dir``.

    ``strict`` controls what a malformed post does, and the split is deliberate.

    Fail-fast everywhere would be wrong here: this module is imported by
    ``app/api/__init__.py``, so raising at startup over one bad frontmatter key
    takes down the landing page, the share pages and the whole API -- and the
    platform would restart straight back into it. The blast radius is wildly out
    of proportion to the fault.

    Skip-and-log everywhere would be equally wrong: a post would vanish with no
    error, which is precisely the failure SEO cannot detect.

    So CI is the gate and production degrades. Tests run ``strict=True`` over
    every file, which means a bad post cannot reach main; production runs
    ``strict=False`` and logs at ERROR, as a net for whatever CI missed.
    """
    directory = content_dir or CONTENT_DIR
    loaded: list[BlogPost] = []

    if not directory.is_dir():
        logger.warning("Blog content directory not found: %s", directory)
        return BlogRegistry((), {}, {}, {}, {})

    for path in sorted(directory.glob("*.md")):
        if path.stem.lower() in _NON_POST_STEMS:
            continue
        try:
            post = load_post(path, app_store_url=app_store_url)
        except BlogContentError as exc:
            if strict:
                raise
            logger.error("BLOG_CONTENT_INVALID: %s: %s", path.name, exc)
            continue
        if post.meta.draft and not include_drafts:
            continue
        loaded.append(post)

    loaded.sort(key=_sort_key)

    # Neighbours and related posts are computed once here, against the final
    # filtered list, so drafts can never leak in through the pager or the
    # related module.
    posts: list[BlogPost] = []
    for index, post in enumerate(loaded):
        posts.append(
            replace(
                post,
                newer_slug=loaded[index - 1].slug if index > 0 else None,
                older_slug=(
                    loaded[index + 1].slug if index + 1 < len(loaded) else None
                ),
                related_slugs=_pick_related(post, loaded),
            )
        )

    by_slug = {p.slug: p for p in posts}

    by_category: dict[str, tuple[BlogPost, ...]] = {}
    for slug in BLOG_CATEGORIES:
        matching = tuple(p for p in posts if p.category == slug)
        if matching:
            by_category[slug] = matching

    by_tag: dict[str, list[BlogPost]] = {}
    for post in posts:
        for tag in post.meta.tags:
            by_tag.setdefault(tag, []).append(post)

    aliases: dict[str, str] = {}
    for post in posts:
        for alias in post.meta.aliases:
            aliases[alias] = post.slug

    return BlogRegistry(
        posts=tuple(posts),
        by_slug=by_slug,
        by_category=by_category,
        by_tag={k: tuple(v) for k, v in by_tag.items()},
        aliases=aliases,
    )


_registry: BlogRegistry | None = None
_signature: tuple[tuple[str, int, int], ...] | None = None


def _content_signature(directory: Path) -> tuple[tuple[str, int, int], ...]:
    if not directory.is_dir():
        return ()
    return tuple(
        (p.name, p.stat().st_mtime_ns, p.stat().st_size)
        for p in sorted(directory.glob("*.md"))
    )


def get_registry() -> BlogRegistry:
    """Cached registry.

    Built lazily rather than in ``lifespan``: the test client is constructed as
    ``TestClient(app)`` without a context manager, so startup hooks never fire
    and a lifespan-built registry would be empty in every route test. This also
    mirrors ``get_settings`` and the cached template loader in
    ``app/services/email.py``.

    Each worker process builds its own copy from the same immutable files. There
    is no shared cache and no invalidation protocol because content only changes
    via deploy.
    """
    global _registry, _signature
    settings = get_settings()

    if settings.is_production:
        if _registry is None:
            _registry = build_registry(
                strict=False,
                include_drafts=False,
                app_store_url=settings.app_store_url,
            )
        return _registry

    # Outside production, rebuild when a file changes so editing a post shows up
    # on refresh -- uvicorn --reload watches .py, not .md.
    signature = _content_signature(CONTENT_DIR)
    if _registry is None or signature != _signature:
        _registry = build_registry(
            strict=True,
            include_drafts=True,
            app_store_url=settings.app_store_url,
        )
        _signature = signature
    return _registry


def clear_registry_cache() -> None:
    """Drop the cached registry (used by tests)."""
    global _registry, _signature
    _registry = None
    _signature = None
