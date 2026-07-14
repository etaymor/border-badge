"""Application configuration using pydantic-settings."""

import ipaddress
import re
from functools import lru_cache
from typing import Literal
from urllib.parse import urlparse

from pydantic import AliasChoices, Field, field_validator
from pydantic_settings import BaseSettings, SettingsConfigDict

# Private/reserved IP networks that should never be used as proxy targets
_BLOCKED_NETWORKS = [
    ipaddress.ip_network("0.0.0.0/8"),  # "This host" / loopback-resolvable
    ipaddress.ip_network("10.0.0.0/8"),
    ipaddress.ip_network("100.64.0.0/10"),  # CGNAT / shared address space
    ipaddress.ip_network("172.16.0.0/12"),
    ipaddress.ip_network("192.168.0.0/16"),
    ipaddress.ip_network("127.0.0.0/8"),
    ipaddress.ip_network("169.254.0.0/16"),  # Link-local / cloud metadata
    ipaddress.ip_network("::1/128"),
    ipaddress.ip_network("fd00::/8"),  # Unique local (includes fd00:ec2::254)
    ipaddress.ip_network("fe80::/10"),  # Link-local IPv6
]


class Settings(BaseSettings):
    """Application settings loaded from environment variables."""

    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        case_sensitive=False,
    )

    # Environment
    env: Literal["development", "staging", "production"] = "development"
    debug: bool = False  # Safe default for production

    # CORS - comma-separated list of allowed origins for production
    allowed_origins: list[str] = []

    # Supabase
    supabase_url: str = ""
    supabase_anon_key: str = ""
    supabase_service_role_key: str = ""
    supabase_jwt_secret: str = ""

    # Public web settings
    base_url: str = Field(
        default="http://localhost:8000",
        validation_alias=AliasChoices("PUBLIC_WEB_BASE_URL", "BASE_URL"),
        description="Base URL for public web pages (landing, lists, trips)",
    )
    app_store_url: str = ""  # iOS App Store URL (placeholder)
    play_store_url: str = ""  # Google Play Store URL (placeholder)

    # OpenRouter Configuration (for traveler classification)
    openrouter_api_key: str = Field(default="", repr=False)
    openrouter_model: str = "google/gemini-2.5-flash-lite"
    multimodal_model: str = "google/gemini-2.5-flash-lite"

    # Analytics
    google_analytics_id: str = ""  # GA4 Measurement ID (e.g., G-XXXXXXXXXX)
    posthog_api_key: str = Field(default="", repr=False)
    posthog_host: str = "https://us.i.posthog.com"
    posthog_user_salt: str = Field(
        default="",
        repr=False,
        description="Secret salt for hashing user IDs in analytics",
    )

    # Affiliate service
    affiliate_signing_secret: str = ""  # HMAC secret for signing redirect URLs
    skimlinks_api_key: str = ""  # Skimlinks API key for link monetization
    skimlinks_publisher_id: str = ""  # Skimlinks publisher ID

    # Social ingest - marked as secrets to prevent logging exposure
    instagram_oembed_token: str = Field(
        default="", repr=False
    )  # Meta app token for Instagram oEmbed API
    google_places_api_key: str = Field(
        default="", repr=False
    )  # Google Places API key for place resolution

    # Google Maps JS API (public share pages). Separate from the server-side
    # Places key: this one is embedded in the page, so it must be a
    # browser-restricted (HTTP-referrer) key.
    google_maps_browser_api_key: str = Field(
        default="",
        repr=False,
        description="Browser-restricted Google Maps JS API key for public share pages",
    )
    google_maps_map_id: str = ""  # Cloud-styled Map ID (required for Advanced Markers)

    # Place extraction settings
    place_extraction_min_confidence: float = Field(
        default=0.5,
        ge=0.0,
        le=1.0,
        description="Minimum confidence score (0.0-1.0) for place extraction",
    )
    multimodal_max_resolved_places: int = Field(
        default=5,
        ge=1,
        le=10,
        description=(
            "Max places resolved (Autocomplete+Details) per multimodal/video "
            "extraction. Bounds worst-case Google Places fan-out for video/carousel "
            "posts (each resolved place is one Autocomplete + one Place Details)."
        ),
    )

    # Google Places API settings
    places_api_timeout_seconds: float = Field(
        default=5.0,
        gt=0.0,
        le=30.0,
        description="Timeout for Google Places API requests in seconds",
    )
    places_cluster_timeout_seconds: float = Field(
        default=15.0,
        gt=0.0,
        le=60.0,
        description="Timeout for processing a single cluster (includes retries)",
    )
    places_rank_distance_weight: float = Field(
        default=1.0,
        ge=0.0,
        le=5.0,
        description="Weight for distance penalty term in place ranking",
    )
    places_rank_review_weight: float = Field(
        default=1.0,
        ge=0.0,
        le=5.0,
        description="Weight for review-count bonus term in place ranking",
    )
    places_rank_rating_weight: float = Field(
        default=1.0,
        ge=0.0,
        le=5.0,
        description="Weight for Bayesian rating bonus term in place ranking",
    )
    places_rank_fame_weight: float = Field(
        default=1.0,
        ge=0.0,
        le=5.0,
        description="Weight for fame bonus term in place ranking",
    )
    places_rank_dwell_weight: float = Field(
        default=1.0,
        ge=0.0,
        le=5.0,
        description="Weight for dwell/time-hint bonus term in place ranking",
    )
    places_rank_vision_weight: float = Field(
        default=2.0,
        ge=0.0,
        le=5.0,
        description=(
            "Weight for vision category bonus term in place ranking. Default "
            "raised from 1.0 to 2.0 (C4/U7): pre-enrichment the only live "
            "first-pass signals are distance and vision, so a high-confidence "
            "category match offsetting only ~30m of distance let a closer "
            "wrong-category place consume a top-3 finalist slot. At 2.0 it "
            "offsets ~60m — within typical indoor GPS drift — pulling the "
            "correct place into the finalists where enrichment can re-rank it, "
            "while still not erasing a large distance gap."
        ),
    )
    places_rank_name_match_weight: float = Field(
        default=1.0,
        ge=0.0,
        le=5.0,
        description="Weight for vision signage name-match bonus in place ranking",
    )
    places_rank_lodging_penalty: float = Field(
        default=2.5,
        ge=0.0,
        le=10.0,
        description=(
            "U3 type prior: score penalty for lodging-typed candidates (points; "
            "2.5 ≈ 50m of distance). Applied in full when vision confidently "
            "says the photo is NOT accommodation, at half strength when there "
            "is no usable vision signal, and not at all when vision says "
            "'stay'. Demotion only — an all-lodging candidate world still "
            "returns lodging. 0 disables (runtime rollback)."
        ),
    )
    places_rank_landmark_boost: float = Field(
        default=1.5,
        ge=0.0,
        le=10.0,
        description=(
            "U3 type prior: extra score bonus for landmark-family places "
            "(museum/monument/tourist_attraction/...) when vision classifies "
            "the photo as 'landmark' (full at high confidence, half at "
            "medium). Stacks with the generic vision category bonus so the "
            "large venue beats its own micro-POIs in the rating-blind first "
            "pass. 0 disables (runtime rollback)."
        ),
    )

    # Place-matcher recall tunables (migrated from constants.py; the constant
    # values remain the defaults, so behavior is unchanged unless overridden).
    places_min_quality_results_before_stop: int = Field(
        default=5,
        ge=1,
        le=20,
        description=(
            "Tiered Nearby search keeps expanding until it accumulates this many "
            "quality candidates (deduped across tiers) or runs out of radii. "
            "Raising it widens recall at the cost of more Nearby calls."
        ),
    )
    places_min_review_count: int = Field(
        default=3,
        ge=0,
        le=50,
        description=(
            "Minimum userRatingCount for a non-institutional place to pass the "
            "quality gate (only enforced once a rating count is present, i.e. on "
            "enriched finalists). Lowered 5->3 (C3/U13) so small/new real places "
            "a finalist on distance aren't demoted below a backfill."
        ),
    )
    places_enrich_backfill_limit: int = Field(
        default=3,
        ge=0,
        le=10,
        description=(
            "U4: when the post-enrichment review gate drops finalists, enrich "
            "up to this many first-pass tail candidates per cluster (one "
            "global second batch per request) and gate them before falling "
            "back to un-gated candidates. 0 disables the second batch (legacy "
            "un-gated backfill)."
        ),
    )
    places_text_rescue_on_empty: bool = Field(
        default=False,
        description=(
            "C2/U14: broaden Text Search rescue to fire on an empty Nearby result "
            "even when vision found no strong business-name candidate, using any "
            "detected signage text as the query. Text Search is the most "
            "expensive (Enterprise-tier) lever, so this stays OFF until a "
            "real-world A/B justifies the per-cluster cost."
        ),
    )
    places_extra_search_tier_m: int | None = Field(
        default=None,
        ge=15,
        le=1000,
        description=(
            "Optional extra outer Nearby radius (meters) appended after the "
            "density-adaptive tiers when the stop threshold has not been met. "
            "None preserves the current DENSITY_SEARCH_RADII profiles."
        ),
    )
    places_landmark_text_rescue: bool = Field(
        default=True,
        description=(
            "U5: when vision recognizes a landmark (category 'landmark', "
            "confidence above low) whose name has no strong match among the "
            "Nearby candidates, fire a Text Search for the recognized name. "
            "Large venues' Google points sit beyond the dense-city Nearby "
            "radii, so this is the only way they enter the candidate world. "
            "Cost-bounded: landmark clusters only, suppressed on a strong "
            "match, and the coarse cache key dedupes repeat venues."
        ),
    )
    places_landmark_rescue_bias_radius_m: int = Field(
        default=500,
        ge=50,
        le=2000,
        description=(
            "Location-bias radius (meters) for landmark-rescue Text Searches. "
            "Wider than the default 200m business-name bias because large "
            "venues' point locations sit far from photo GPS."
        ),
    )
    places_popularity_probe: bool = Field(
        default=False,
        description=(
            "U6: last-resort extra Nearby call ranked by POPULARITY (200m) "
            "for landmark-classified clusters whose candidate world contains "
            "no landmark-family place and no text signal to rescue with. OFF "
            "by default — enable if verification shows text-less landmark "
            "clusters still missing their venue after the U5 rescue."
        ),
    )

    # Email (Resend) - marked as secret to prevent logging exposure
    resend_api_key: str = Field(default="", repr=False)
    welcome_email_from: str = "hello@atlasi.app"
    contact_email_to: str = "hello@atlasi.app"

    # Contact form (Cloudflare Turnstile)
    turnstile_site_key: str = ""
    turnstile_secret_key: str = Field(default="", repr=False)

    # Feature flags
    enable_social_features: bool = False

    # Per-cluster place-matcher diagnostics. When true, the matcher emits one
    # structured JSON trace per cluster (full raw candidate world, filter-drop
    # tallies, vision signals, finalists, outcome). Off by default — retaining
    # the raw world has a memory cost, so production stays clean.
    places_diagnostics: bool = Field(
        default=False,
        description="Emit per-cluster place-matcher diagnostic traces (verbose)",
    )

    # LLM Place Extraction (reuses existing openrouter_api_key and openrouter_model)
    llm_place_extraction_enabled: bool = Field(
        default=False,
        description="Enable LLM-first place extraction (experimental)",
    )

    # TikTok proxy (for gallery-dl and yt-dlp TikTok requests)
    tiktok_proxy_url: str | None = Field(default=None, repr=False)

    # RevenueCat Configuration
    revenuecat_webhook_auth_header: str = Field(
        default="", repr=False, description="Shared secret for RevenueCat webhook auth"
    )
    revenuecat_api_key: str = Field(
        default="",
        repr=False,
        description="RevenueCat API key for subscription verification",
    )

    # Facebook Conversions API
    facebook_pixel_id: str = Field(default="", repr=False)
    facebook_capi_access_token: str = Field(default="", repr=False)

    # TikTok Events API
    tiktok_events_access_token: str = Field(default="", repr=False)
    tiktok_pixel_code: str = Field(default="", repr=False)

    @field_validator("tiktok_proxy_url")
    @classmethod
    def validate_tiktok_proxy_url(cls, v: str | None) -> str | None:
        """Validate proxy URL scheme and block private/reserved IPs."""
        if v is None or v == "":
            return None
        allowed_schemes = ("http://", "https://", "socks5://")
        if not v.startswith(allowed_schemes):
            raise ValueError(
                f"tiktok_proxy_url must start with one of {allowed_schemes}"
            )

        # Parse hostname and check against blocked networks
        # socks5:// isn't recognized by urlparse, temporarily swap for parsing
        parse_url = (
            v.replace("socks5://", "http://", 1) if v.startswith("socks5://") else v
        )
        parsed = urlparse(parse_url)
        hostname = parsed.hostname
        if not hostname:
            raise ValueError("tiktok_proxy_url must contain a valid hostname")

        try:
            addr = ipaddress.ip_address(hostname)
            for network in _BLOCKED_NETWORKS:
                if addr in network:
                    raise ValueError(
                        f"tiktok_proxy_url must not point to private/reserved IP: {hostname}"
                    )
        except ValueError as e:
            # Re-raise our own validation errors
            if "must not point to" in str(e) or "must contain" in str(e):
                raise
            # hostname is a DNS name, not an IP literal — allow it
            blocked_hostnames = {"localhost", "metadata.google.internal"}
            if hostname.lower() in blocked_hostnames:
                raise ValueError(
                    f"tiktok_proxy_url must not point to blocked host: {hostname}"
                ) from None

        return v

    @field_validator("supabase_url")
    @classmethod
    def validate_supabase_url(cls, v: str) -> str:
        """Validate Supabase URL is provided and uses HTTPS in production."""
        # Allow empty for local development without Supabase
        if not v:
            return v
        if not v.startswith("https://"):
            raise ValueError("supabase_url must use HTTPS")
        return v

    @field_validator("allowed_origins", mode="before")
    @classmethod
    def parse_allowed_origins(cls, v: str | list[str]) -> list[str]:
        """Parse comma-separated string to list."""
        if isinstance(v, str):
            if not v:
                return []
            return [origin.strip() for origin in v.split(",")]
        return v

    @property
    def apple_app_id(self) -> str:
        """Extract numeric App Store ID from app_store_url for Smart App Banner."""
        if not self.app_store_url:
            return ""
        match = re.search(r"/id(\d+)", self.app_store_url)
        return match.group(1) if match else ""

    @property
    def is_development(self) -> bool:
        """Check if running in development mode."""
        return self.env == "development"

    @property
    def is_production(self) -> bool:
        """Check if running in production mode."""
        return self.env == "production"

    @property
    def posthog_configured(self) -> bool:
        """Check if PostHog analytics is configured."""
        return bool(self.posthog_api_key)

    @property
    def revenuecat_configured(self) -> bool:
        """Check if RevenueCat credentials are configured."""
        return bool(self.revenuecat_webhook_auth_header and self.revenuecat_api_key)

    @property
    def revenuecat_missing_fields(self) -> list[str]:
        """Return missing RevenueCat credential field names."""
        missing: list[str] = []
        if not self.revenuecat_webhook_auth_header:
            missing.append("REVENUECAT_WEBHOOK_AUTH_HEADER")
        if not self.revenuecat_api_key:
            missing.append("REVENUECAT_API_KEY")
        return missing

    @property
    def ad_tracking_configured(self) -> bool:
        """Check if at least one ad tracking platform is configured."""
        fb = bool(self.facebook_pixel_id and self.facebook_capi_access_token)
        tt = bool(self.tiktok_events_access_token and self.tiktok_pixel_code)
        return fb or tt

    @property
    def ad_tracking_missing_fields(self) -> dict[str, list[str]]:
        """Return missing ad tracking credential field names per platform."""
        result: dict[str, list[str]] = {}
        fb_missing: list[str] = []
        if not self.facebook_pixel_id:
            fb_missing.append("FACEBOOK_PIXEL_ID")
        if not self.facebook_capi_access_token:
            fb_missing.append("FACEBOOK_CAPI_ACCESS_TOKEN")
        if fb_missing:
            result["Facebook CAPI"] = fb_missing

        tt_missing: list[str] = []
        if not self.tiktok_events_access_token:
            tt_missing.append("TIKTOK_EVENTS_ACCESS_TOKEN")
        if not self.tiktok_pixel_code:
            tt_missing.append("TIKTOK_PIXEL_CODE")
        if tt_missing:
            result["TikTok Events"] = tt_missing
        return result


@lru_cache
def get_settings() -> Settings:
    """Get cached settings instance."""
    return Settings()
