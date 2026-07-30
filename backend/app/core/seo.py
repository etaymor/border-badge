"""SEO metadata helpers for public pages."""

from dataclasses import dataclass
from typing import TYPE_CHECKING, Any

from app.schemas.blog import (
    BLOG_CATEGORIES,
    DEFAULT_OG_IMAGE_PATH,
    ORGANIZATION_LOGO_PATH,
    category_description,
    category_label,
)

if TYPE_CHECKING:
    from app.schemas.blog import BlogPost
    from app.schemas.share import ShareView

# The landing page FAQ. This single list drives both the visible accordion and
# the FAQPage structured data, so the two cannot drift apart.
LANDING_FAQS: list[dict[str, str]] = [
    {
        "question": "Is Atlasi really free to use?",
        "answer": (
            "Atlasi is free to download and use. You can track all 227 countries,"
            " create trips, and log up to 10 entries per trip at no cost. For"
            " unlimited entries, photo imports, and social saves, Atlasi Premium is"
            " available starting at $9.99/month or $49.99/year."
        ),
    },
    {
        "question": "What does Atlasi Premium include?",
        "answer": (
            "Atlasi Premium unlocks unlimited entries per trip, unlimited photo"
            " import trips, and unlimited social media saves each month. The free"
            " tier includes tracking all 227 countries, creating trips, and up to 10"
            " entries per trip. Premium is available monthly ($9.99) or annually"
            " ($49.99) with a 7-day free trial."
        ),
    },
    {
        "question": "How many countries can I track in the app?",
        "answer": (
            "Atlasi includes all 227 countries and territories recognized worldwide."
            " From major nations to remote territories like the Faroe Islands and"
            " French Polynesia, every destination counts toward your travel"
            " collection."
        ),
    },
    {
        "question": "Can I import places from TikTok and Instagram?",
        "answer": (
            "Yes. When you find a travel video on TikTok or Instagram, use the iOS"
            " Share Extension to send it to Atlasi. Our AI automatically detects the"
            " place and lets you save it to any trip. Free users get 5 social saves"
            " per month, with unlimited saves on Premium."
        ),
    },
    {
        "question": "How does Photo Import work?",
        "answer": (
            "Photo Import scans your camera roll for photos with GPS data. Atlasi"
            " automatically groups nearby photos into location clusters and suggests"
            " matching places from Google Maps. Review the suggestions, confirm the"
            " ones you want, and Atlasi creates trip entries with your photos"
            " attached. Years of travel, organized in minutes."
        ),
    },
    {
        "question": "What's the difference between trips and entries?",
        "answer": (
            "Trips are your overall journeys to a country (like 'Summer 2024 in"
            " Japan'). Entries are the specific places within that trip - restaurants"
            " you ate at, hotels you stayed in, attractions you visited, and"
            " experiences you had. This organization keeps everything searchable and"
            " shareable."
        ),
    },
    {
        "question": "How do shareable lists work?",
        "answer": (
            "You can curate your best entries into shareable lists, like 'Best Ramen"
            " in Tokyo' or 'Hidden Gems in Lisbon.' Each list gets a unique public URL"
            " you can send to friends, post on social media, or save for your own"
            " future reference."
        ),
    },
    {
        "question": "Is my travel data private and secure?",
        "answer": (
            "Your privacy is our priority. All data is encrypted and stored securely."
            " Your passport grid, trips, and entries are private by default. Only you"
            " can see them unless you explicitly choose to share a list or trip via"
            " public link."
        ),
    },
    {
        "question": "Can I use Atlasi offline while traveling?",
        "answer": (
            "Currently, Atlasi requires an internet connection to sync your data."
            " We're exploring offline support for future updates. In the meantime,"
            " your device photos are scanned locally - GPS data never leaves your"
            " phone during photo import."
        ),
    },
    {
        "question": "What devices and platforms is Atlasi available on?",
        "answer": (
            "Atlasi is currently available for iPhone and iPad on the Apple App"
            " Store. An Android version is in development. Your account syncs across"
            " all your Apple devices automatically."
        ),
    },
]


def build_faq_page(faqs: list[dict[str, str]]) -> dict[str, Any]:
    """FAQPage node from question/answer pairs.

    Shared by the landing page and every blog post, so the visible accordion and
    the structured data are always generated from one list.
    """
    return {
        "@type": "FAQPage",
        "mainEntity": [
            {
                "@type": "Question",
                "name": faq["question"],
                "acceptedAnswer": {"@type": "Answer", "text": faq["answer"]},
            }
            for faq in faqs
        ],
    }


def build_breadcrumbs(trail: list[tuple[str, str]]) -> dict[str, Any]:
    """BreadcrumbList from (name, url) pairs, 1-indexed."""
    return {
        "@type": "BreadcrumbList",
        "itemListElement": [
            {"@type": "ListItem", "position": index, "name": name, "item": url}
            for index, (name, url) in enumerate(trail, start=1)
        ],
    }


def build_organization(base_url: str) -> dict[str, Any]:
    """The Atlasi Organization node, referenced by @id rather than duplicated.

    Blog posts point both `author` and `publisher` at this one node. The logo
    resolves to a file that exists -- the drafted JSON-LD referenced
    /images/logo.png, which does not.
    """
    return {
        "@type": "Organization",
        "@id": f"{base_url}/#organization",
        "name": "Atlasi",
        "url": base_url,
        "logo": {
            "@type": "ImageObject",
            "url": f"{base_url}{ORGANIZATION_LOGO_PATH}",
        },
    }


@dataclass
class SEOContext:
    """SEO metadata for a page."""

    title: str
    description: str
    canonical_url: str
    og_title: str
    og_description: str
    og_image: str | None = None
    og_type: str = "website"


def build_landing_seo(base_url: str) -> SEOContext:
    """Build SEO context for the landing page."""
    return SEOContext(
        title="Atlasi - Track Countries, Import Travel Photos & Log Trips",
        description=(
            "Track 227 countries, import photos from your camera roll to auto-create"
            " trips, and log every place, meal, stay, and experience. Free on iOS."
        ),
        canonical_url=base_url,
        og_title="Atlasi - Track Countries, Import Travel Photos & Log Trips",
        og_description=(
            "Track 227 countries, import travel photos to auto-create trips,"
            " and log every place, meal, stay, and experience."
        ),
        og_image=f"{base_url}/static/images/screens/og-image.png",
        og_type="website",
    )


def build_landing_structured_data(
    base_url: str, app_store_url: str = ""
) -> dict[str, Any]:
    """Build the landing page's JSON-LD: the app itself plus its FAQ.

    Emitted as an @graph so a single script tag carries both entities.
    """
    application: dict[str, Any] = {
        "@type": "MobileApplication",
        "name": "Atlasi",
        "applicationCategory": "TravelApplication",
        "operatingSystem": "iOS",
        "url": base_url,
        "description": (
            "Track the countries you have visited, import photos from your camera"
            " roll to create trips automatically, and log every place, meal, stay,"
            " and experience."
        ),
        "offers": {
            "@type": "Offer",
            "price": "0",
            "priceCurrency": "USD",
        },
    }
    if app_store_url:
        application["installUrl"] = app_store_url

    return {
        "@context": "https://schema.org",
        "@graph": [application, build_faq_page(LANDING_FAQS)],
    }


def build_list_seo(
    list_name: str,
    list_slug: str,
    description: str | None,
    country_name: str | None,
    base_url: str,
    cover_image_url: str | None = None,
) -> SEOContext:
    """Build SEO context for a public list page."""
    title = f"{list_name} - Atlasi"
    meta_description = description or "A curated travel list shared on Atlasi"
    if country_name:
        meta_description = f"{list_name} in {country_name} - {meta_description}"

    return SEOContext(
        title=title,
        description=meta_description[:160],  # Truncate for meta description
        canonical_url=f"{base_url}/l/{list_slug}",
        og_title=list_name,
        og_description=meta_description[:200],
        og_image=cover_image_url,
        og_type="article",
    )


def build_trip_seo(
    trip_name: str,
    share_slug: str,
    country_name: str,
    base_url: str,
    cover_image_url: str | None = None,
) -> SEOContext:
    """Build SEO context for a public trip page."""
    if country_name:
        title = f"{trip_name} in {country_name} - Atlasi"
        description = f"Explore {trip_name} in {country_name} - A trip shared on Atlasi"
        og_title = f"{trip_name} in {country_name}"
    else:
        title = f"{trip_name} - Atlasi"
        description = f"Explore {trip_name} - A trip shared on Atlasi"
        og_title = trip_name

    return SEOContext(
        title=title,
        description=description,
        canonical_url=f"{base_url}/t/{share_slug}",
        og_title=og_title,
        og_description=description,
        og_image=cover_image_url,
        og_type="article",
    )


def build_share_structured_data(
    share: "ShareView",
    canonical_url: str,
    base_url: str,
) -> dict[str, Any]:
    """Build the JSON-LD for a public share page (list or trip).

    Both share pages emit the same structure. Previously only the list page had
    structured data — hand-rolled inline in its template, and without a CSP
    nonce — while the trip page had none at all. Building it here means the two
    pages cannot drift, and the emitted script gets the nonce like any other.

    Entries become `Place` items rather than bare strings: now that they carry
    coordinates, a category, a note, and a photo, the `ItemList` can say what
    each item actually *is*, which is a materially better search result than a
    list of names. An entry with no coordinates simply omits `geo` rather than
    emitting nulls.
    """
    items: list[dict[str, Any]] = []
    for entry in share.entries:
        place: dict[str, Any] = {
            "@type": "Place",
            "name": entry.title,
        }
        if entry.place_name:
            place["address"] = entry.place_name
        if entry.note:
            place["description"] = entry.note
        if entry.photo_url:
            place["image"] = entry.photo_url
        if entry.has_coordinates:
            place["geo"] = {
                "@type": "GeoCoordinates",
                "latitude": entry.latitude,
                "longitude": entry.longitude,
            }
        items.append(
            {
                "@type": "ListItem",
                "position": entry.ordinal,
                "item": place,
            }
        )

    item_list: dict[str, Any] = {
        "@type": "ItemList",
        "name": share.title,
        "numberOfItems": share.entry_count,
        "datePublished": share.share_date.isoformat(),
        "url": canonical_url,
        "itemListElement": items,
    }
    if share.subtitle:
        item_list["description"] = share.subtitle
    if share.author:
        item_list["author"] = {
            "@type": "Person",
            "name": share.author.display_name,
        }

    breadcrumbs: dict[str, Any] = {
        "@type": "BreadcrumbList",
        "itemListElement": [
            {
                "@type": "ListItem",
                "position": 1,
                "name": "Home",
                "item": base_url,
            },
            {
                "@type": "ListItem",
                "position": 2,
                "name": share.title,
                "item": canonical_url,
            },
        ],
    }

    return {"@context": "https://schema.org", "@graph": [item_list, breadcrumbs]}


# ---------------------------------------------------------------------------
# Blog
# ---------------------------------------------------------------------------

BLOG_TITLE = "Travel App Guides & Comparisons - Atlasi Blog"
BLOG_DESCRIPTION = (
    "Guides and head-to-head comparisons of the best travel tracking,"
    " journaling, and recommendation apps - from the team behind Atlasi."
)

# Static marketing pages that had OG tags but no canonical URL. Copy is kept
# verbatim from the values the routes previously passed inline.
STATIC_PAGE_SEO: dict[str, tuple[str, str]] = {
    "privacy": (
        "Privacy Policy - Atlasi",
        "Privacy Policy for the Atlasi travel tracking application",
    ),
    "terms": (
        "Terms & Conditions - Atlasi",
        "Terms and Conditions for the Atlasi travel tracking application",
    ),
    "contact": (
        "Contact Us - Atlasi",
        "Get in touch with the Atlasi team",
    ),
}


def build_static_page_seo(page: str, base_url: str) -> SEOContext:
    """SEO for /privacy, /terms and /contact.

    These pages previously emitted OG tags with no canonical URL, because each
    route hand-copied a subset of the keys base.html reads.
    """
    title, description = STATIC_PAGE_SEO[page]
    return SEOContext(
        title=title,
        description=description,
        canonical_url=f"{base_url}/{page}",
        og_title=title,
        og_description=description,
        og_image=f"{base_url}{DEFAULT_OG_IMAGE_PATH}",
        og_type="website",
    )


def build_blog_index_seo(base_url: str) -> SEOContext:
    """SEO for /blog.

    og_type stays "website": an index is a collection, and tagging it "article"
    mis-signals to social scrapers.
    """
    return SEOContext(
        title=BLOG_TITLE,
        description=BLOG_DESCRIPTION,
        canonical_url=f"{base_url}/blog",
        og_title="The Atlasi Blog",
        og_description=(
            "Guides and comparisons of the best travel tracking and" " journaling apps."
        ),
        og_image=f"{base_url}{DEFAULT_OG_IMAGE_PATH}",
        og_type="website",
    )


def build_blog_category_seo(category_slug: str, base_url: str) -> SEOContext:
    """SEO for /blog/category/{slug}. Raises KeyError for an unknown slug."""
    label = category_label(category_slug)
    description = category_description(category_slug)
    return SEOContext(
        title=f"{label} - Atlasi Blog",
        description=description,
        canonical_url=f"{base_url}/blog/category/{category_slug}",
        og_title=f"{label} - Atlasi Blog",
        og_description=description,
        og_image=f"{base_url}{DEFAULT_OG_IMAGE_PATH}",
        og_type="website",
    )


def build_blog_post_seo(post: "BlogPost", base_url: str) -> SEOContext:
    """SEO for a single post.

    `seo_title` exists because the H1 titles run 50-68 characters, and the
    " - Atlasi" suffix pushes every one of them past the ~60-character SERP
    cutoff. Frontmatter carries the short form for <title> and the long form
    for the H1.
    """
    headline = post.meta.seo_title or post.title
    return SEOContext(
        title=f"{headline} - Atlasi",
        description=post.description,
        canonical_url=f"{base_url}/blog/{post.slug}",
        og_title=post.title,
        og_description=post.description,
        og_image=post.cover_url(base_url),
        og_type="article",
    )


def build_blog_post_structured_data(post: "BlogPost", base_url: str) -> dict[str, Any]:
    """@graph of Organization + BlogPosting + BreadcrumbList (+ FAQPage)."""
    canonical = f"{base_url}/blog/{post.slug}"
    org_ref = {"@id": f"{base_url}/#organization"}

    posting: dict[str, Any] = {
        "@type": "BlogPosting",
        "@id": f"{canonical}#article",
        "mainEntityOfPage": {"@type": "WebPage", "@id": canonical},
        "url": canonical,
        "headline": post.meta.seo_title or post.title,
        "name": post.title,
        "description": post.description,
        "image": post.cover_url(base_url),
        # Author and publisher are the same Organization node. Inventing a
        # personal byline for content nobody signed is the E-E-A-T failure mode
        # Google's reviewer guidance targets; upgrade to a Person only once a
        # named human actually writes and reviews these.
        "author": org_ref,
        "publisher": org_ref,
        "datePublished": post.published.isoformat(),
        "dateModified": post.updated.isoformat(),
        "articleSection": post.category_label,
        "wordCount": post.word_count,
        "inLanguage": "en-US",
        "isAccessibleForFree": True,
    }
    if post.meta.keywords:
        posting["keywords"] = post.meta.keywords

    graph: list[dict[str, Any]] = [
        build_organization(base_url),
        posting,
        build_breadcrumbs(
            [
                ("Home", base_url),
                ("Blog", f"{base_url}/blog"),
                (
                    post.category_label,
                    f"{base_url}/blog/category/{post.category}",
                ),
                (post.title, canonical),
            ]
        ),
    ]

    if post.faqs:
        faq_page = build_faq_page(post.faqs)
        faq_page["@id"] = f"{canonical}#faq"
        graph.append(faq_page)

    return {"@context": "https://schema.org", "@graph": graph}


def _post_list_items(posts: "list[BlogPost]", base_url: str) -> list[dict[str, Any]]:
    """ListItem entries for a collection page.

    Deliberately not full BlogPosting entities: duplicating article nodes on a
    listing page confuses entity resolution, and url + name is what a collection
    actually needs.
    """
    return [
        {
            "@type": "ListItem",
            "position": index,
            "url": f"{base_url}/blog/{post.slug}",
            "name": post.title,
        }
        for index, post in enumerate(posts, start=1)
    ]


def build_blog_index_structured_data(
    posts: "list[BlogPost]", base_url: str
) -> dict[str, Any]:
    """@graph of Blog + ItemList + BreadcrumbList for /blog."""
    blog_url = f"{base_url}/blog"
    blog_node: dict[str, Any] = {
        "@type": "Blog",
        "@id": f"{blog_url}#blog",
        "url": blog_url,
        "name": "The Atlasi Blog",
        "description": BLOG_DESCRIPTION,
        "publisher": {"@id": f"{base_url}/#organization"},
        "inLanguage": "en-US",
    }
    item_list: dict[str, Any] = {
        "@type": "ItemList",
        "numberOfItems": len(posts),
        "itemListElement": _post_list_items(posts, base_url),
    }
    return {
        "@context": "https://schema.org",
        "@graph": [
            build_organization(base_url),
            blog_node,
            item_list,
            build_breadcrumbs([("Home", base_url), ("Blog", blog_url)]),
        ],
    }


def build_blog_category_structured_data(
    category_slug: str, posts: "list[BlogPost]", base_url: str
) -> dict[str, Any]:
    """@graph of CollectionPage + ItemList + BreadcrumbList."""
    label = category_label(category_slug)
    category_url = f"{base_url}/blog/category/{category_slug}"
    collection: dict[str, Any] = {
        "@type": "CollectionPage",
        "@id": f"{category_url}#collection",
        "url": category_url,
        "name": f"{label} - Atlasi Blog",
        "description": category_description(category_slug),
        "isPartOf": {"@id": f"{base_url}/blog#blog"},
        "inLanguage": "en-US",
    }
    item_list: dict[str, Any] = {
        "@type": "ItemList",
        "numberOfItems": len(posts),
        "itemListElement": _post_list_items(posts, base_url),
    }
    return {
        "@context": "https://schema.org",
        "@graph": [
            collection,
            item_list,
            build_breadcrumbs(
                [
                    ("Home", base_url),
                    ("Blog", f"{base_url}/blog"),
                    (label, category_url),
                ]
            ),
        ],
    }


def seo_context(seo: SEOContext) -> dict[str, Any]:
    """Map an SEOContext onto the keys base.html reads.

    Every HTML route spreads this. Previously each route hand-copied a subset of
    these keys, which is how /privacy and /terms ended up with OG tags but no
    canonical URL, and how SEOContext.og_type never reached the page at all.
    """
    return {
        "page_title": seo.title,
        "page_description": seo.description,
        "og_title": seo.og_title,
        "og_description": seo.og_description,
        "og_image": seo.og_image,
        "og_url": seo.canonical_url,
        "og_type": seo.og_type,
        "canonical_url": seo.canonical_url,
    }


def blog_categories_for_nav() -> list[dict[str, str]]:
    """Category slug/label pairs for rendering the index chip row."""
    return [
        {"slug": slug, "label": label}
        for slug, (label, _description) in BLOG_CATEGORIES.items()
    ]
