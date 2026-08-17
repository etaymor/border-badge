"""Lint gate over the real blog content.

This is the file that keeps production honest. ``build_registry`` runs lenient
in production -- it skips and logs a malformed post rather than taking the whole
app down at startup -- which means a broken post would silently 404 instead of
raising. These tests are the compensating control: they parse every shipped file
strictly, so a bad post fails CI and never reaches main.
"""

import re
from pathlib import Path

import pytest

import app as app_package
from app.core.blog import CONTENT_DIR, build_registry, load_post
from app.schemas.blog import BLOG_CATEGORIES, MAX_META_DESCRIPTION

POST_FILES = sorted(p for p in CONTENT_DIR.glob("*.md") if p.stem != "README")
STATIC_DIR = Path(app_package.__file__).parent / "static"


def test_content_directory_is_not_empty() -> None:
    """Without this, every parametrized test below passes vacuously if the
    glob stops matching (a path refactor, a moved directory)."""
    assert POST_FILES, f"no blog posts found in {CONTENT_DIR}"


@pytest.mark.parametrize("path", POST_FILES, ids=lambda p: p.stem)
def test_post_parses_strictly(path: Path) -> None:
    load_post(path, app_store_url="https://apps.apple.com/app/atlasi")


@pytest.mark.parametrize("path", POST_FILES, ids=lambda p: p.stem)
def test_no_placeholder_cta_survives(path: Path) -> None:
    """The drafts used `](#)` placeholders for every download link."""
    assert "](#)" not in path.read_text(encoding="utf-8")


@pytest.mark.parametrize("path", POST_FILES, ids=lambda p: p.stem)
def test_draft_scaffolding_is_gone(path: Path) -> None:
    text = path.read_text(encoding="utf-8")
    body = text.split("---", 2)[-1]
    assert "**Meta Description**" not in body
    assert "**Target Keyword**" not in body
    # The trailing hand-written BlogPosting fence would emit a second,
    # conflicting article entity alongside the generated JSON-LD.
    assert "```json" not in body
    assert not re.search(r"^# ", body, re.MULTILINE), "H1 belongs to the template"


@pytest.mark.parametrize("path", POST_FILES, ids=lambda p: p.stem)
def test_meta_description_length(path: Path) -> None:
    post = load_post(path)
    assert len(post.description) <= MAX_META_DESCRIPTION


@pytest.mark.parametrize("path", POST_FILES, ids=lambda p: p.stem)
def test_title_tag_fits_serp(path: Path) -> None:
    post = load_post(path)
    headline = post.meta.seo_title or post.title
    assert len(f"{headline} - Atlasi") <= 62, headline


@pytest.mark.parametrize("path", POST_FILES, ids=lambda p: p.stem)
def test_post_has_three_to_five_faqs(path: Path) -> None:
    post = load_post(path)
    assert 3 <= len(post.faqs) <= 5
    for faq in post.faqs:
        assert faq["question"].strip()
        assert faq["answer"].strip()


@pytest.mark.parametrize("path", POST_FILES, ids=lambda p: p.stem)
def test_cover_image_exists_when_declared(path: Path) -> None:
    post = load_post(path)
    if post.meta.cover:
        assert (STATIC_DIR / post.meta.cover).is_file()


@pytest.mark.parametrize("path", POST_FILES, ids=lambda p: p.stem)
def test_category_is_known(path: Path) -> None:
    assert load_post(path).category in BLOG_CATEGORIES


def test_slugs_are_unique() -> None:
    slugs = [p.stem for p in POST_FILES]
    assert len(slugs) == len(set(slugs))


def test_every_internal_blog_link_resolves() -> None:
    """The highest-value test here: hand-authored cross-links rot the moment a
    slug changes, and a dead internal link is invisible until a crawler finds
    it."""
    registry = build_registry(strict=True, include_drafts=True)
    dead: list[tuple[str, str]] = []
    for post in registry.posts:
        for href in re.findall(r'href="(/blog/[^"#]+)"', post.html):
            slug = href.removeprefix("/blog/").rstrip("/")
            if slug.startswith("category/"):
                if slug.removeprefix("category/") not in BLOG_CATEGORIES:
                    dead.append((post.slug, href))
            elif slug not in registry.by_slug:
                dead.append((post.slug, href))
    assert not dead, f"dead internal links: {dead}"


def test_posts_are_interlinked() -> None:
    """Each post should link to at least two siblings."""
    registry = build_registry(strict=True, include_drafts=True)
    for post in registry.posts:
        links = {
            href
            for href in re.findall(r'href="(/blog/[^"#]+)"', post.html)
            if not href.startswith("/blog/category/")
        }
        assert len(links) >= 2, f"{post.slug} has too few internal links"


def test_rendered_content_is_csp_clean() -> None:
    """No inline style attributes and no script tags anywhere in the corpus."""
    registry = build_registry(strict=True, include_drafts=True)
    for post in registry.posts:
        for tag in re.findall(r"<[^>]+>", post.html):
            assert not re.search(r"\sstyle\s*=", tag), (post.slug, tag)
            assert not re.match(r"<\s*script", tag, re.IGNORECASE), post.slug


def test_compiled_css_includes_blog_rules() -> None:
    """Guards the easiest step to forget.

    Node is unavailable on Railway (railpack.json installs Python only), so the
    compiled stylesheets in app/static/css/ are the deploy artifact. Editing
    src/pages/blog.css without running `npm run css:build` ships a blog with no
    styles, and it looks fine locally because dev serves styles.css while
    production serves styles.min.css -- both would be stale, but you would only
    notice in production. Both files are checked deliberately: it is entirely
    possible to rebuild and commit only one.
    """
    for name in ("styles.css", "styles.min.css"):
        compiled = (STATIC_DIR / "css" / name).read_text(encoding="utf-8")
        assert ".article-body" in compiled, f"{name} is stale; run npm run css:build"
        assert ".blog-card" in compiled, f"{name} is stale; run npm run css:build"
