"""SEO metadata helpers for public pages."""

from dataclasses import dataclass
from typing import Any

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

    faq_page: dict[str, Any] = {
        "@type": "FAQPage",
        "mainEntity": [
            {
                "@type": "Question",
                "name": faq["question"],
                "acceptedAnswer": {"@type": "Answer", "text": faq["answer"]},
            }
            for faq in LANDING_FAQS
        ],
    }

    return {"@context": "https://schema.org", "@graph": [application, faq_page]}


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
