"""Application configuration using pydantic-settings."""

from functools import lru_cache
from typing import Literal

from pydantic import AliasChoices, Field, field_validator
from pydantic_settings import BaseSettings, SettingsConfigDict


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
    openrouter_api_key: str = ""
    openrouter_model: str = "google/gemini-flash-2.5-lite"
    multimodal_model: str = "google/gemini-flash-2.5-lite"

    # Analytics
    google_analytics_id: str = ""  # GA4 Measurement ID (e.g., G-XXXXXXXXXX)
    posthog_api_key: str = Field(default="", repr=False)
    posthog_host: str = "https://us.i.posthog.com"

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

    # Place extraction settings
    place_extraction_min_confidence: float = Field(
        default=0.5,
        ge=0.0,
        le=1.0,
        description="Minimum confidence score (0.0-1.0) for place extraction",
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

    # Email (Resend) - marked as secret to prevent logging exposure
    resend_api_key: str = Field(default="", repr=False)
    welcome_email_from: str = "hello@atlasi.app"
    contact_email_to: str = "hello@atlasi.app"

    # Contact form (Cloudflare Turnstile)
    turnstile_site_key: str = ""
    turnstile_secret_key: str = Field(default="", repr=False)

    # Feature flags
    enable_social_features: bool = False

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


@lru_cache
def get_settings() -> Settings:
    """Get cached settings instance."""
    return Settings()
