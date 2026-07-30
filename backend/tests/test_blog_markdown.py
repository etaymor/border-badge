"""Tests for the blog markdown renderer.

The CSP-related cases here are the important ones: the default policy has no
'unsafe-inline' in style-src, and a nonce cannot be applied to an attribute, so
a single inline style in rendered markdown would be silently refused by the
browser -- invisible to an end-to-end test that only checks status codes.
"""

import pytest

from app.core.markdown import count_words, render_markdown, slugify_heading
from app.schemas.blog import BlogContentError


def test_table_is_wrapped_in_scroll_container() -> None:
    html = render_markdown("| App | Best |\n|---|---|\n| Atlasi | Lists |\n").html
    assert '<div class="table-scroll">' in html
    assert "<table>" in html


def test_table_alignment_uses_class_not_inline_style() -> None:
    """mistune's table plugin emits style="text-align:left" by default."""
    html = render_markdown("| A | B |\n| :--- | ---: |\n| one | two |\n").html
    assert "style=" not in html
    assert 'class="align-left"' in html
    assert 'class="align-right"' in html


def test_headings_get_anchor_ids() -> None:
    result = render_markdown("## Getting Started\n")
    assert '<h2 id="getting-started">' in result.html
    assert [e.anchor for e in result.toc] == ["getting-started"]


def test_duplicate_headings_get_unique_anchors() -> None:
    result = render_markdown("## Notes\n\ntext\n\n## Notes\n")
    assert '<h2 id="notes">' in result.html
    assert '<h2 id="notes-2">' in result.html
    assert [e.anchor for e in result.toc] == ["notes", "notes-2"]


def test_punctuation_only_heading_falls_back_to_positional_anchor() -> None:
    result = render_markdown("## ***\n")
    assert result.toc[0].anchor.startswith("section-")


def test_heading_anchor_strips_inline_markup() -> None:
    result = render_markdown("## The **best** apps\n")
    assert result.toc[0].text == "The best apps"
    assert result.toc[0].anchor == "the-best-apps"


def test_external_links_get_rel_and_target() -> None:
    html = render_markdown("[x](https://example.com)").html
    assert 'target="_blank"' in html
    assert 'rel="noopener noreferrer nofollow"' in html


def test_internal_links_are_left_alone() -> None:
    html = render_markdown("[x](/blog/foo)").html
    assert 'href="/blog/foo"' in html
    assert "target=" not in html


def test_raw_script_tag_is_escaped_not_rendered() -> None:
    html = render_markdown("<script>alert(1)</script>").html
    assert "<script" not in html
    assert "&lt;script&gt;" in html


def test_raw_inline_style_is_escaped_not_rendered() -> None:
    """Escaped text that merely looks like markup must not trip the guard."""
    html = render_markdown('<div style="color:red">x</div>').html
    assert "<div style" not in html
    assert "&lt;div style=" in html


def test_remote_image_is_rejected() -> None:
    with pytest.raises(BlogContentError, match="/static/"):
        render_markdown("![alt](https://cdn.example.com/a.jpg)")


def test_static_image_gets_lazy_loading() -> None:
    html = render_markdown("![alt](/static/images/blog/a.jpg)").html
    assert 'loading="lazy"' in html
    assert 'decoding="async"' in html


def test_word_count_ignores_markup() -> None:
    assert count_words("# Title\n\n**one** two three") == 4


def test_slugify_handles_unicode_and_punctuation() -> None:
    assert slugify_heading("Hello, World!") == "hello-world"
    assert slugify_heading("!!!") == ""
