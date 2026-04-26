# Environment Setup

Local env files: `mobile/.env.local` and `backend/.env`. Never commit secrets.

## Mobile (`mobile/.env.local`)

```
EXPO_PUBLIC_API_URL=http://<your-ip>:8000  # iOS simulator needs IP, not localhost
EXPO_PUBLIC_SUPABASE_URL=<supabase-url>
EXPO_PUBLIC_SUPABASE_ANON_KEY=<anon-key>
EXPO_PUBLIC_APP_ENV=development
EXPO_PUBLIC_GOOGLE_PLACES_API_KEY=<google-places-key>
EXPO_PUBLIC_WEB_BASE_URL=http://<your-ip>:8000  # Base URL for public web pages (Terms, Privacy)
EXPO_PUBLIC_POSTHOG_API_KEY=<posthog-api-key>  # Optional: for production analytics
EXPO_PUBLIC_POSTHOG_HOST=https://us.i.posthog.com  # Optional: defaults to US region
EXPO_PUBLIC_FB_APP_ID=<facebook-app-id>  # Required: Facebook App ID for ads SDK
EXPO_PUBLIC_FB_CLIENT_TOKEN=<facebook-client-token>  # Required: Facebook Client Token for ads SDK
EXPO_PUBLIC_REVENUECAT_IOS_API_KEY=appl_xxx
EXPO_PUBLIC_REVENUECAT_ANDROID_API_KEY=goog_xxx  # Optional
```

## Backend (`backend/.env`)

```
ENV=development
DEBUG=true
SUPABASE_URL=<supabase-url>
SUPABASE_ANON_KEY=<anon-key>
SUPABASE_SERVICE_ROLE_KEY=<service-role-key>
SUPABASE_JWT_SECRET=<jwt-secret>
GOOGLE_ANALYTICS_ID=<ga4-measurement-id>  # Optional: GA4 ID for public pages (e.g., G-XXXXXXXXXX)
AFFILIATE_SIGNING_SECRET=<secret-key>  # Required in production: HMAC signing for affiliate redirect URLs
SKIMLINKS_API_KEY=<skimlinks-api-key>  # Optional: for affiliate link wrapping via Skimlinks
SKIMLINKS_PUBLISHER_ID=<publisher-id>  # Optional: your Skimlinks publisher ID
RESEND_API_KEY=<resend-api-key>  # Optional: for welcome email drip campaign (get key from resend.com)
WELCOME_EMAIL_FROM=Emerson <hello@atlasi.com>  # From address for welcome emails
POSTHOG_API_KEY=<posthog-api-key>  # Optional: same project key as mobile app, for LLM accuracy tracking
POSTHOG_HOST=https://us.i.posthog.com  # Optional: defaults to US region
PLACES_API_TIMEOUT_SECONDS=5.0  # Optional: timeout for Google Places API requests (default 5s)
PLACES_CLUSTER_TIMEOUT_SECONDS=15.0  # Optional: timeout for processing a single cluster (default 15s)
GOOGLE_PLACES_API_KEY=<google-places-key>  # Required: Google Places API key for place matching
PLACES_RANK_DISTANCE_WEIGHT=1.0  # Optional: ranking weight for distance penalty (0.0-5.0)
PLACES_RANK_REVIEW_WEIGHT=1.0  # Optional: ranking weight for review-count bonus (0.0-5.0)
PLACES_RANK_RATING_WEIGHT=1.0  # Optional: ranking weight for Bayesian rating bonus (0.0-5.0)
PLACES_RANK_FAME_WEIGHT=1.0  # Optional: ranking weight for fame bonus (0.0-5.0)
PLACES_RANK_DWELL_WEIGHT=1.0  # Optional: ranking weight for dwell/time-hint bonus (0.0-5.0)
PLACES_RANK_VISION_WEIGHT=1.0  # Optional: ranking weight for vision category bonus (0.0-5.0)
MULTIMODAL_MODEL=google/gemini-2.5-flash-lite  # Optional: model for photo vision classification
PLACE_EXTRACTION_MIN_CONFIDENCE=0.5  # Optional: minimum confidence for place extraction (0.0-1.0)
LLM_PLACE_EXTRACTION_ENABLED=true  # Optional: opt in to LLM-first place extraction
INSTAGRAM_OEMBED_TOKEN=<meta-app-token>  # Optional: Meta app token for Instagram oEmbed API
TIKTOK_PROXY_URL=<proxy-url>  # Optional: SOCKS5/HTTP proxy for TikTok requests
TURNSTILE_SITE_KEY=<cloudflare-key>  # Optional: Cloudflare Turnstile site key for contact form
TURNSTILE_SECRET_KEY=<cloudflare-secret>  # Optional: Cloudflare Turnstile secret key
CONTACT_EMAIL_TO=hello@atlasi.app  # Optional: recipient for contact form emails
REVENUECAT_WEBHOOK_AUTH_HEADER=secure-random-string
REVENUECAT_API_KEY=sk_xxx
```

## iOS Simulator Networking

Use your machine's IP address (e.g., `http://192.168.1.50:8000`), not `localhost`. The iOS simulator does not resolve `localhost` to the host machine reliably.
