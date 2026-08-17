"""Public blog routes.

Kept out of ``public.py``, which is already ~1,100 lines. Follows the same
conventions as the other public HTML routes: the shared Jinja environment and
rate limiter from ``app.main``, an explicit ``Cache-Control`` on every response,
and SEO context spread from a single :func:`seo_context` mapping.
"""

import datetime
from typing import Any

from fastapi import APIRouter, Path, Request, Response
from fastapi.responses import HTMLResponse, RedirectResponse

from app.core.blog import get_registry
from app.core.config import get_settings
from app.core.seo import (
    blog_categories_for_nav,
    build_blog_category_seo,
    build_blog_category_structured_data,
    build_blog_index_seo,
    build_blog_index_structured_data,
    build_blog_post_seo,
    build_blog_post_structured_data,
    seo_context,
)
from app.main import limiter, templates

router = APIRouter()

# Deliberately looser than the 60/minute used elsewhere. Anonymous rate limiting
# falls back to client IP, and a post that lands on Reddit or Hacker News is read
# by many people behind one corporate or carrier-grade NAT. Throttling the exact
# traffic spike the blog exists to capture would be self-defeating.
BLOG_RATE_LIMIT = "120/minute"

INDEX_CACHE_CONTROL = "public, max-age=1800"
POST_CACHE_CONTROL = "public, max-age=3600, stale-while-revalidate=86400"


def _base_context(request: Request) -> dict[str, Any]:
    settings = get_settings()
    return {
        "app_store_url": settings.app_store_url,
        "google_analytics_id": settings.google_analytics_id,
        "current_year": datetime.datetime.now(datetime.UTC).year,
    }


def _not_found(request: Request) -> HTMLResponse:
    """Render an HTML 404.

    A bare ``HTTPException`` would return ``{"detail": ...}`` -- an API payload
    served to a human who followed a stale link, and to a crawler indexing the
    site. ``no-store`` matters too: a cached 404 would outlive the deploy that
    adds the missing post.
    """
    registry = get_registry()
    response = templates.TemplateResponse(
        request=request,
        name="blog_not_found.html",
        status_code=404,
        context={
            **_base_context(request),
            "page_title": "Post not found - Atlasi Blog",
            "page_description": "That post could not be found.",
            "recent_posts": registry.posts[:3],
        },
    )
    response.headers["Cache-Control"] = "no-store"
    return response


@router.get("/blog", response_class=HTMLResponse, include_in_schema=False)
@limiter.limit(BLOG_RATE_LIMIT)
async def blog_index(request: Request) -> HTMLResponse:
    """The blog index: every published post, newest first."""
    settings = get_settings()
    registry = get_registry()
    posts = list(registry.posts)
    seo = build_blog_index_seo(settings.base_url)

    response = templates.TemplateResponse(
        request=request,
        name="blog_index.html",
        context={
            **_base_context(request),
            **seo_context(seo),
            "posts": posts,
            "categories": blog_categories_for_nav(),
            "active_category": None,
            "heading": "The Atlasi Blog",
            "subheading": (
                "Guides and comparisons for tracking, journaling, and sharing"
                " your travels."
            ),
            "structured_data": build_blog_index_structured_data(
                posts, settings.base_url
            ),
        },
    )
    response.headers["Cache-Control"] = INDEX_CACHE_CONTROL
    return response


# Registered before /blog/{slug}. The two cannot actually collide -- Starlette
# compiles {slug} to [^/]+, so a two-segment path never matches -- but the order
# documents the intent. The real hazard is `/blog/category` with no argument,
# which is handled by RESERVED_BLOG_SLUGS at load time.
@router.get(
    "/blog/category/{category}",
    response_class=HTMLResponse,
    include_in_schema=False,
)
@limiter.limit(BLOG_RATE_LIMIT)
async def blog_category(
    request: Request,
    category: str = Path(..., min_length=1, max_length=64),
) -> HTMLResponse:
    """Posts within one category."""
    settings = get_settings()
    registry = get_registry()
    found = registry.category(category)
    if found is None:
        return _not_found(request)

    posts = list(found.posts)
    seo = build_blog_category_seo(category, settings.base_url)

    response = templates.TemplateResponse(
        request=request,
        name="blog_index.html",
        context={
            **_base_context(request),
            **seo_context(seo),
            "posts": posts,
            "categories": blog_categories_for_nav(),
            "active_category": category,
            "heading": found.label,
            "subheading": found.description,
            "structured_data": build_blog_category_structured_data(
                category, posts, settings.base_url
            ),
        },
    )
    response.headers["Cache-Control"] = INDEX_CACHE_CONTROL
    return response


@router.get("/blog/{slug}", response_class=HTMLResponse, include_in_schema=False)
@limiter.limit(BLOG_RATE_LIMIT)
async def blog_post(
    request: Request,
    # No regex pattern here on purpose: `pattern=` would make a malformed slug a
    # 422, but for an indexable public page both users and crawlers want a 404.
    slug: str = Path(..., min_length=1, max_length=120),
) -> Response:
    """A single post. May redirect when the slug matches a post's alias."""
    settings = get_settings()
    registry = get_registry()

    post = registry.get(slug)
    if post is None:
        target = registry.aliases.get(slug)
        if target:
            return RedirectResponse(f"/blog/{target}", status_code=301)
        return _not_found(request)

    seo = build_blog_post_seo(post, settings.base_url)
    response = templates.TemplateResponse(
        request=request,
        name="blog_post.html",
        context={
            **_base_context(request),
            **seo_context(seo),
            "post": post,
            "category_label": post.category_label,
            "related": registry.related_for(post),
            "newer": registry.get(post.newer_slug) if post.newer_slug else None,
            "older": registry.get(post.older_slug) if post.older_slug else None,
            "structured_data": build_blog_post_structured_data(post, settings.base_url),
        },
    )
    response.headers["Cache-Control"] = POST_CACHE_CONTROL
    return response
