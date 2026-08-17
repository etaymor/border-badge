"""Markdown rendering for the blog.

The renderer is the CSP enforcement point, not a sanitiser bolted on afterwards.
``mistune.HTMLRenderer(escape=True)`` emits any raw HTML in the source as escaped
*text*, so a post author cannot produce ``<script>``, ``style="..."``, or an
``onclick=`` handler no matter what they type -- those characters never survive
to the output as markup.

That matters because the default CSP (``app/main.py:_build_default_csp``) sets
``style-src 'self' 'nonce-...'`` with no ``'unsafe-inline'``, and a nonce cannot
be applied to an *attribute*. A single inline ``style=`` in rendered markdown
would be silently refused by the browser -- invisible to the test suite, obvious
on the page.
"""

import re
from dataclasses import dataclass
from typing import Any

import mistune

from app.schemas.blog import BlogContentError, TocEntry

# Anything that would be refused by, or would need an exemption from, the strict
# CSP. Checked against our own output as defence in depth: if a future renderer
# change reintroduces attributes, it fails loudly at build time instead of
# shipping a page whose styling the browser quietly drops.
#
# This is matched against *real tags only*, never raw output. With escape=True a
# source-level `<div style="...">` is emitted as the escaped text
# `&lt;div style=...&gt;`, which is inert -- but a naive substring scan would
# flag it and reject a perfectly safe post. Extracting tags first is what tells
# actual markup apart from text that merely looks like markup.
_REAL_TAG = re.compile(r"<[^>]+>")
_FORBIDDEN_IN_TAG = re.compile(
    r"(?i)^<\s*(script|style|iframe|object|embed)\b|\sstyle\s*=|\son[a-z]+\s*="
)

_SLUG_STRIP = re.compile(r"[^\w\s-]", re.UNICODE)
_SLUG_SPACES = re.compile(r"[\s_]+")
_TAG_RE = re.compile(r"<[^>]+>")


def slugify_heading(text: str) -> str:
    """Turn heading text into an anchor id.

    Falls back to the empty string for headings made entirely of punctuation or
    emoji; the caller supplies a positional fallback so every heading still gets
    a stable, unique id.
    """
    cleaned = _SLUG_STRIP.sub("", text).strip().lower()
    return _SLUG_SPACES.sub("-", cleaned)


@dataclass(frozen=True, slots=True)
class RenderedMarkdown:
    html: str
    toc: tuple[TocEntry, ...]
    word_count: int


class BlogRenderer(mistune.HTMLRenderer):
    """HTML renderer with the four post-processing behaviours the blog needs.

    Doing this per-element in the renderer -- rather than with regex over the
    finished HTML, or by adding a BeautifulSoup dependency -- means we are
    transforming structured tokens we already own.
    """

    def __init__(self) -> None:
        # escape=True is the load-bearing argument; see the module docstring.
        super().__init__(escape=True)
        self.toc: list[TocEntry] = []
        self._seen_anchors: dict[str, int] = {}

    def _unique_anchor(self, text: str) -> str:
        base = slugify_heading(text) or f"section-{len(self.toc) + 1}"
        count = self._seen_anchors.get(base, 0) + 1
        self._seen_anchors[base] = count
        return base if count == 1 else f"{base}-{count}"

    def heading(self, text: str, level: int, **attrs: Any) -> str:
        # `text` arrives already rendered, so inline markup (<strong>, <code>)
        # has to come out before it can be used as an anchor or TOC label.
        plain = _TAG_RE.sub("", text).strip()
        anchor = self._unique_anchor(plain)
        if level in (2, 3):
            self.toc.append(TocEntry(anchor=anchor, text=plain, level=level))
        return f'<h{level} id="{anchor}">{text}</h{level}>\n'

    def link(self, text: str, url: str, title: str | None = None) -> str:
        title_attr = f' title="{mistune.escape(title)}"' if title else ""
        safe_url = self.safe_url(url)
        # Internal links (and bare fragments) stay in the tab; anything pointing
        # off-site opens in a new one and drops referrer/opener access.
        if safe_url.startswith(("http://", "https://")):
            rel = ' target="_blank" rel="noopener noreferrer nofollow"'
        else:
            rel = ""
        return f'<a href="{safe_url}"{title_attr}{rel}>{text}</a>'

    def image(self, text: str, url: str, title: str | None = None) -> str:
        safe_url = self.safe_url(url)
        # CSP img-src is 'self' (plus a few API hosts that posts have no reason
        # to use), so a remote image would simply not load. Fail at build time
        # with an explanation rather than shipping a broken image.
        if not safe_url.startswith("/static/"):
            raise BlogContentError(
                f"image src {url!r} must be a /static/ path: the default CSP's "
                "img-src directive does not allow arbitrary remote hosts."
            )
        title_attr = f' title="{mistune.escape(title)}"' if title else ""
        return (
            f'<img src="{safe_url}" alt="{mistune.escape(text)}"{title_attr} '
            'loading="lazy" decoding="async" />'
        )

    def table(self, text: str) -> str:
        # Every migrated post carries a wide comparison table. Without a scroll
        # container it either overflows the viewport or squeezes columns to two
        # characters on a phone; this cannot be fixed on <table> alone.
        return f'<div class="table-scroll">\n<table>\n{text}</table>\n</div>\n'


def render_table_cell(
    renderer: mistune.BaseRenderer,
    text: str,
    align: str | None = None,
    head: bool = False,
) -> str:
    """Table cell renderer that expresses alignment as a class, not a style.

    mistune's bundled table plugin emits ``<th style="text-align:left">`` for
    the ``| :--- |`` alignment syntax. That inline style attribute cannot carry
    a nonce, so the strict CSP refuses it and the browser drops the alignment --
    a failure that is invisible to tests and only shows up on the rendered page.
    Emitting a class instead keeps alignment working and keeps the page policy
    clean.
    """
    tag = "th" if head else "td"
    class_attr = f' class="align-{align}"' if align else ""
    return f"  <{tag}{class_attr}>{text}</{tag}>\n"


def _assert_csp_clean(html: str, source: str) -> None:
    for tag in _REAL_TAG.findall(html):
        match = _FORBIDDEN_IN_TAG.search(tag)
        if match:
            raise BlogContentError(
                f"{source}: rendered HTML contains CSP-hostile markup "
                f"{tag!r}. The default policy sets style-src without "
                "'unsafe-inline' and a nonce cannot apply to an attribute, so "
                "the browser would refuse this at runtime."
            )


def count_words(markdown_body: str) -> int:
    """Word count from the markdown source.

    Counting the rendered HTML would count tag names and attribute values.
    """
    text = re.sub(r"```.*?```", " ", markdown_body, flags=re.DOTALL)
    text = re.sub(r"[#>*_`|\[\]()!-]", " ", text)
    return len([w for w in text.split() if any(ch.isalnum() for ch in w)])


def render_markdown(body: str, source: str = "<string>") -> RenderedMarkdown:
    """Render a post body to trusted, CSP-clean HTML."""
    renderer = BlogRenderer()
    markdown = mistune.create_markdown(
        renderer=renderer,
        plugins=["table", "strikethrough", "url"],
    )
    # Must come *after* create_markdown: the table plugin registers its own
    # table_cell renderer at setup time, and a registered method takes
    # precedence over a class method, so overriding it on BlogRenderer alone
    # would silently have no effect.
    renderer.register("table_cell", render_table_cell)
    html = markdown(body)
    if not isinstance(html, str):  # mistune returns str for a str input
        raise BlogContentError(f"{source}: renderer returned {type(html)!r}")
    _assert_csp_clean(html, source)
    return RenderedMarkdown(
        html=html,
        toc=tuple(renderer.toc),
        word_count=count_words(body),
    )
