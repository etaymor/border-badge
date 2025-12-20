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

    # Analytics
    google_analytics_id: str = ""  # GA4 Measurement ID (e.g., G-XXXXXXXXXX)

    # Affiliate service
    affiliate_signing_secret: str = ""  # HMAC secret for signing redirect URLs
    skimlinks_api_key: str = ""  # Skimlinks API key for link monetization
    skimlinks_publisher_id: str = ""  # Skimlinks publisher ID

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


@lru_cache
def get_settings() -> Settings:
    """Get cached settings instance."""
    return Settings()
