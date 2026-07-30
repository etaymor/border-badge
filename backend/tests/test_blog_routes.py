"""Tests for the public blog routes."""

import html as html_lib
import json
import re

import pytest
from fastapi.testclient import TestClient

from app.core.blog import get_registry
from app.core.seo import (
    build_blog_category_seo,
    build_blog_post_seo,
    build_blog_post_structured_data,
)
from app.schemas.blog import BLOG_CATEGORIES


@pytest.fixture
def registry():
    return get_registry()


def extract_json_ld(html: str) -> dict:
    match = re.search(
        r'<script type="application/ld\+json" nonce="[^"]+">(.*?)</script>',
        html,
        re.DOTALL,
    )
    assert match, "no nonced JSON-LD block found"
    return json.loads(match.group(1))


# ---------------------------------------------------------------------------
# Index and category
# ---------------------------------------------------------------------------


def test_blog_index_lists_every_post(client: TestClient, registry) -> None:
    response = client.get("/blog")
    assert response.status_code == 200
    assert "text/html" in response.headers["content-type"]
    for post in registry.posts:
        # Titles contain "&", which Jinja autoescapes.
        assert html_lib.escape(post.title) in response.text
        assert f'href="/blog/{post.slug}"' in response.text


def test_blog_index_is_cacheable(client: TestClient) -> None:
    assert "public" in client.get("/blog").headers["Cache-Control"]


def test_blog_index_structured_data(client: TestClient, registry) -> None:
    graph = extract_json_ld(client.get("/blog").text)["@graph"]
    types = {node["@type"] for node in graph}
    assert {"Organization", "Blog", "ItemList", "BreadcrumbList"} == types
    item_list = next(n for n in graph if n["@type"] == "ItemList")
    assert item_list["numberOfItems"] == len(registry.posts)


def test_blog_index_og_type_is_website(client: TestClient) -> None:
    """An index is a collection; tagging it `article` mis-signals to scrapers."""
    assert 'og:type" content="website"' in client.get("/blog").text


def test_category_page_lists_only_that_category(client: TestClient, registry) -> None:
    response = client.get("/blog/category/comparisons")
    assert response.status_code == 200
    for post in registry.posts:
        if post.category == "comparisons":
            assert html_lib.escape(post.title) in response.text


def test_unknown_category_returns_html_404(client: TestClient) -> None:
    response = client.get("/blog/category/nonsense")
    assert response.status_code == 404
    assert "text/html" in response.headers["content-type"]


def test_bare_category_path_404s(client: TestClient) -> None:
    """`/blog/category` matches /blog/{slug}; the reserved-slug guard makes a
    post named `category.md` impossible, so this must 404."""
    assert client.get("/blog/category").status_code == 404


# ---------------------------------------------------------------------------
# Posts
# ---------------------------------------------------------------------------


def test_post_renders(client: TestClient, registry) -> None:
    post = registry.posts[0]
    response = client.get(f"/blog/{post.slug}")
    assert response.status_code == 200
    assert html_lib.escape(post.title) in response.text


def test_post_has_canonical_and_article_og_type(client: TestClient, registry) -> None:
    post = registry.posts[0]
    text = client.get(f"/blog/{post.slug}").text
    assert f'rel="canonical" href="http://localhost:8000/blog/{post.slug}"' in text
    assert 'og:type" content="article"' in text


def test_post_structured_data(client: TestClient, registry) -> None:
    post = registry.posts[0]
    graph = extract_json_ld(client.get(f"/blog/{post.slug}").text)["@graph"]
    types = [node["@type"] for node in graph]
    assert types == ["Organization", "BlogPosting", "BreadcrumbList", "FAQPage"]

    posting = graph[1]
    assert posting["datePublished"] == post.published.isoformat()
    assert posting["wordCount"] == post.word_count
    assert posting["author"]["@id"] == posting["publisher"]["@id"] == graph[0]["@id"]

    breadcrumbs = graph[2]["itemListElement"]
    assert [b["position"] for b in breadcrumbs] == [1, 2, 3, 4]
    assert breadcrumbs[-1]["item"].endswith(f"/blog/{post.slug}")


def test_post_faq_accordion_matches_structured_data(
    client: TestClient, registry
) -> None:
    post = registry.posts[0]
    text = client.get(f"/blog/{post.slug}").text
    assert text.count('<details class="faq-item">') == len(post.faqs)


def test_unknown_post_returns_html_404_and_is_not_cached(
    client: TestClient,
) -> None:
    response = client.get("/blog/does-not-exist")
    assert response.status_code == 404
    assert "text/html" in response.headers["content-type"]
    # A cached 404 would outlive the deploy that adds the post.
    assert response.headers["Cache-Control"] == "no-store"


def test_trailing_slash_redirects(client: TestClient, registry) -> None:
    response = client.get(f"/blog/{registry.posts[0].slug}/", follow_redirects=False)
    assert response.status_code in (301, 307, 308)


# ---------------------------------------------------------------------------
# CSP
# ---------------------------------------------------------------------------


def test_post_has_no_inline_style_attributes(client: TestClient, registry) -> None:
    """style-src has no 'unsafe-inline' and a nonce cannot apply to an
    attribute, so any inline style would be refused by the browser."""
    text = client.get(f"/blog/{registry.posts[0].slug}").text
    assert re.search(r"\sstyle\s*=", text) is None


def test_post_scripts_all_carry_a_nonce(client: TestClient, registry) -> None:
    text = client.get(f"/blog/{registry.posts[0].slug}").text
    for tag in re.findall(r"<script\b[^>]*>", text):
        assert "nonce=" in tag


def test_blog_gets_the_strict_csp(client: TestClient) -> None:
    """/blog must not match SHARE_ROUTE_PREFIXES and inherit the relaxed
    Maps policy."""
    csp = client.get("/blog").headers["Content-Security-Policy"]
    assert "'unsafe-inline'" not in csp
    assert "'unsafe-eval'" not in csp


# ---------------------------------------------------------------------------
# robots.txt / sitemap.xml
# ---------------------------------------------------------------------------


def test_robots_allows_blog_and_blocks_redirects(client: TestClient) -> None:
    text = client.get("/robots.txt").text
    assert "Allow: /blog" in text
    assert "Disallow: /o/" in text
    assert "Disallow: /unsubscribe/" in text


# ---------------------------------------------------------------------------
# SEO builders
# ---------------------------------------------------------------------------


def test_post_seo_falls_back_to_shared_og_image(registry) -> None:
    post = registry.posts[0]
    assert post.meta.cover is None
    seo = build_blog_post_seo(post, "https://atlasi.app")
    assert seo.og_image == "https://atlasi.app/static/images/screens/og-image.png"
    assert seo.og_type == "article"


def test_faq_page_omitted_when_post_has_no_faqs(registry) -> None:
    post = registry.posts[0]
    stripped = post.meta.model_copy(update={"faqs": []})
    bare = type(post)(
        slug=post.slug,
        meta=stripped,
        html=post.html,
        toc=post.toc,
        word_count=post.word_count,
    )
    graph = build_blog_post_structured_data(bare, "https://atlasi.app")["@graph"]
    assert "FAQPage" not in [node["@type"] for node in graph]


def test_category_seo_canonical(registry) -> None:
    seo = build_blog_category_seo("guides", "https://atlasi.app")
    assert seo.canonical_url == "https://atlasi.app/blog/category/guides"


def test_unknown_category_seo_raises() -> None:
    with pytest.raises(KeyError):
        build_blog_category_seo("nonsense", "https://atlasi.app")


def test_all_categories_have_labels_and_descriptions() -> None:
    for slug, (label, description) in BLOG_CATEGORIES.items():
        assert slug and label and description
