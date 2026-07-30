"""Tests for the blog frontmatter parser and registry builder.

These run against synthetic files in tmp_path so they never depend on the real
content; tests/test_blog_content.py covers the shipped posts.
"""

import logging
import textwrap
from pathlib import Path

import pytest

from app.core.blog import build_registry, load_post, split_frontmatter
from app.schemas.blog import BlogContentError

VALID_FRONTMATTER = """\
---
title: A Perfectly Fine Post
description: >-
  A description that comfortably clears the fifty character minimum imposed
  by the schema so validation passes.
category: guides
published: 2026-07-01
---

Body text.
"""


def write_post(directory: Path, name: str, content: str) -> Path:
    path = directory / name
    path.write_text(textwrap.dedent(content), encoding="utf-8")
    return path


# ---------------------------------------------------------------------------
# Frontmatter splitting
# ---------------------------------------------------------------------------


def test_horizontal_rules_in_body_do_not_terminate_frontmatter() -> None:
    """Regression: every migrated post uses `---` as a section separator.

    A naive split on "---" truncates the body at the first rule.
    """
    text = "---\ntitle: T\n---\n\nIntro\n\n---\n\nMiddle\n\n---\n\nEnd\n"
    meta, body = split_frontmatter(text)
    assert meta == {"title": "T"}
    assert "Middle" in body
    assert "End" in body


def test_bom_prefixed_file_parses() -> None:
    meta, _ = split_frontmatter("﻿---\ntitle: T\n---\n\nbody\n")
    assert meta == {"title": "T"}


def test_missing_frontmatter_raises() -> None:
    with pytest.raises(BlogContentError, match="frontmatter"):
        split_frontmatter("# Just a heading\n")


def test_non_mapping_frontmatter_raises() -> None:
    with pytest.raises(BlogContentError, match="mapping"):
        split_frontmatter("---\n- a\n- b\n---\n\nbody\n")


# ---------------------------------------------------------------------------
# Validation
# ---------------------------------------------------------------------------


def test_valid_post_loads(tmp_path: Path) -> None:
    path = write_post(tmp_path, "good-post.md", VALID_FRONTMATTER)
    post = load_post(path)
    assert post.slug == "good-post"
    assert post.category_label == "Guides"


@pytest.mark.parametrize(
    "field",
    ["title", "description", "category", "published"],
)
def test_missing_required_field_raises(tmp_path: Path, field: str) -> None:
    lines = [
        line
        for line in VALID_FRONTMATTER.splitlines()
        if not line.startswith(f"{field}:")
    ]
    # `description` is a folded block; drop its continuation lines too.
    if field == "description":
        lines = [line for line in lines if not line.startswith("  ")]
    path = write_post(tmp_path, "post.md", "\n".join(lines) + "\n")
    with pytest.raises(BlogContentError, match=field):
        load_post(path)


def test_unknown_category_raises(tmp_path: Path) -> None:
    path = write_post(
        tmp_path, "post.md", VALID_FRONTMATTER.replace("guides", "nonsense")
    )
    with pytest.raises(BlogContentError, match="unknown category"):
        load_post(path)


def test_typo_in_field_name_is_rejected(tmp_path: Path) -> None:
    """extra='forbid' turns a silent no-op into a build failure."""
    path = write_post(
        tmp_path,
        "post.md",
        VALID_FRONTMATTER.replace(
            "category: guides", "category: guides\ndescrption: oops"
        ),
    )
    with pytest.raises(BlogContentError, match="descrption"):
        load_post(path)


def test_updated_before_published_raises(tmp_path: Path) -> None:
    path = write_post(
        tmp_path,
        "post.md",
        VALID_FRONTMATTER.replace(
            "published: 2026-07-01", "published: 2026-07-01\nupdated: 2026-01-01"
        ),
    )
    with pytest.raises(BlogContentError, match="earlier than published"):
        load_post(path)


def test_cover_without_alt_raises(tmp_path: Path) -> None:
    path = write_post(
        tmp_path,
        "post.md",
        VALID_FRONTMATTER.replace(
            "category: guides", "category: guides\ncover: images/blog/a.jpg"
        ),
    )
    with pytest.raises(BlogContentError, match="cover_alt"):
        load_post(path)


def test_reserved_slug_raises(tmp_path: Path) -> None:
    path = write_post(tmp_path, "category.md", VALID_FRONTMATTER)
    with pytest.raises(BlogContentError, match="reserved"):
        load_post(path)


def test_invalid_filename_slug_raises(tmp_path: Path) -> None:
    path = write_post(tmp_path, "Not A Slug.md", VALID_FRONTMATTER)
    with pytest.raises(BlogContentError, match="valid slug"):
        load_post(path)


def test_app_store_token_is_substituted(tmp_path: Path) -> None:
    path = write_post(
        tmp_path,
        "post.md",
        VALID_FRONTMATTER + "\n[Get it]({{APP_STORE_URL}})\n",
    )
    post = load_post(path, app_store_url="https://apps.apple.com/app/atlasi")
    assert "https://apps.apple.com/app/atlasi" in post.html
    assert "APP_STORE_URL" not in post.html


# ---------------------------------------------------------------------------
# Registry
# ---------------------------------------------------------------------------


def make_post(
    directory: Path,
    slug: str,
    *,
    published: str = "2026-07-01",
    category: str = "guides",
    draft: bool = False,
    tags: str = "",
) -> None:
    write_post(
        directory,
        f"{slug}.md",
        f"""\
        ---
        title: Post {slug}
        description: >-
          A description long enough to clear the fifty character minimum that
          the frontmatter schema enforces on every post.
        category: {category}
        published: {published}
        draft: {str(draft).lower()}
        {tags}
        ---

        Body of {slug}.
        """,
    )


def test_posts_sorted_newest_first(tmp_path: Path) -> None:
    make_post(tmp_path, "older", published="2026-01-01")
    make_post(tmp_path, "newer", published="2026-06-01")
    registry = build_registry(tmp_path)
    assert [p.slug for p in registry.posts] == ["newer", "older"]


def test_same_date_order_is_deterministic(tmp_path: Path) -> None:
    """Six posts migrated in one commit share a date; order must not depend
    on filesystem iteration."""
    make_post(tmp_path, "bravo")
    make_post(tmp_path, "alpha")
    assert [p.slug for p in build_registry(tmp_path).posts] == [
        "alpha",
        "bravo",
    ]


def test_neighbours_are_assigned(tmp_path: Path) -> None:
    make_post(tmp_path, "older", published="2026-01-01")
    make_post(tmp_path, "newer", published="2026-06-01")
    registry = build_registry(tmp_path)
    newer, older = registry.posts
    assert newer.newer_slug is None
    assert newer.older_slug == "older"
    assert older.older_slug is None


def test_drafts_excluded_by_default(tmp_path: Path) -> None:
    make_post(tmp_path, "live")
    make_post(tmp_path, "wip", draft=True)
    assert [p.slug for p in build_registry(tmp_path).posts] == ["live"]


def test_drafts_included_when_requested(tmp_path: Path) -> None:
    make_post(tmp_path, "live")
    make_post(tmp_path, "wip", draft=True)
    registry = build_registry(tmp_path, include_drafts=True)
    assert {p.slug for p in registry.posts} == {"live", "wip"}


def test_drafts_never_leak_into_related(tmp_path: Path) -> None:
    make_post(tmp_path, "live")
    make_post(tmp_path, "other")
    make_post(tmp_path, "wip", draft=True)
    registry = build_registry(tmp_path)
    for post in registry.posts:
        assert "wip" not in post.related_slugs


def test_related_never_includes_self(tmp_path: Path) -> None:
    for slug in ("one", "two", "three", "four", "five"):
        make_post(tmp_path, slug)
    registry = build_registry(tmp_path)
    for post in registry.posts:
        assert post.slug not in post.related_slugs
        assert len(post.related_slugs) <= 3


def test_categories_index(tmp_path: Path) -> None:
    make_post(tmp_path, "a-guide", category="guides")
    make_post(tmp_path, "a-comparison", category="comparisons")
    registry = build_registry(tmp_path)
    assert [p.slug for p in registry.category("guides").posts] == ["a-guide"]
    assert registry.category("nope") is None


def test_readme_is_not_treated_as_a_post(tmp_path: Path) -> None:
    make_post(tmp_path, "real")
    (tmp_path / "README.md").write_text("# Notes for authors\n", encoding="utf-8")
    assert [p.slug for p in build_registry(tmp_path).posts] == ["real"]


def test_strict_mode_raises_on_bad_post(tmp_path: Path) -> None:
    make_post(tmp_path, "good")
    write_post(tmp_path, "bad.md", "no frontmatter here\n")
    with pytest.raises(BlogContentError):
        build_registry(tmp_path, strict=True)


def test_lenient_mode_skips_and_logs(
    tmp_path: Path, caplog: pytest.LogCaptureFixture
) -> None:
    """Production degrades rather than taking the whole app down."""
    make_post(tmp_path, "good")
    write_post(tmp_path, "bad.md", "no frontmatter here\n")
    with caplog.at_level(logging.ERROR):
        registry = build_registry(tmp_path, strict=False)
    assert [p.slug for p in registry.posts] == ["good"]
    assert "BLOG_CONTENT_INVALID" in caplog.text


def test_missing_content_dir_returns_empty_registry(tmp_path: Path) -> None:
    registry = build_registry(tmp_path / "nope")
    assert registry.posts == ()


def test_aliases_map_to_current_slug(tmp_path: Path) -> None:
    write_post(
        tmp_path,
        "new-slug.md",
        VALID_FRONTMATTER.replace(
            "category: guides", "category: guides\naliases: [old-slug]"
        ),
    )
    assert build_registry(tmp_path).aliases == {"old-slug": "new-slug"}
