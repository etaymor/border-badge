# App Store Review Notes

Responses to Apple's required reviewer information.

---

## 2) Description of the app's purpose, problem solved, and value provided

Atlasi is a travel tracking and trip-logging app that helps people remember and share where they've been. Travelers' memories get scattered across camera rolls, social feeds, and notes apps; Atlasi consolidates them into one place.

The app solves three problems:

- **Tracking visited countries** — A visual "passport grid" of 227 countries and territories lets users mark places visited and build a wishlist of dream destinations.
- **Logging trip details** — Users create trips by country and add rich entries (Place, Food, Stay, Experience) with notes, links, photos, and Google Places location data.
- **Capturing and sharing inspiration** — An iOS Share Extension lets users save places from TikTok and Instagram. A photo-import feature scans the user's library to discover past trips from GPS-tagged photos. Curated lists can be shared via public web links.

Value: a single, visual record of a user's travel history that is easy to build, organize, and share.

---

## 3) Instructions for accessing and reviewing the app's main features

**Sign in:** Use email/password, Apple Sign-In, or Google. A new account walks through ~12 onboarding screens (motivations, home country, visited countries by continent, display name) before landing on the main app. To skip ahead, an existing test account can be provided on request.

**Main features to review:**

| Feature | How to access |
| --- | --- |
| Passport grid | Default tab on launch. Tap any country tile to mark visited or add to wishlist. |
| Country detail | Tap a visited country in the passport grid → see trips for that country, add a new trip. |
| Create a trip | From a country detail screen or the Trips tab → "Add Trip" → enter name, dates, optional cover photo. |
| Add an entry | Open any trip → "Add Entry" → choose Place / Food / Stay / Experience → search Google Places → add notes and photos. |
| Saved Places (quick save) | Trips tab → "Saved Places" → entries here can be moved into a specific trip later. |
| Social media ingest | From TikTok or Instagram, tap Share → "Save Place" (Atlasi). The app opens, detects the place, and prompts to save to a trip or to Saved Places. |
| Photo import | Profile → "Import from Photos" → grant photo permission → review discovered trips → confirm suggested places → create trip. |
| Shareable list | Open a trip → Share → "Create New List" → select entries, name the list → public URL is generated and can be shared. |
| Subscription | Triggered after onboarding and when free-tier limits are reached (5 share-extension uses/month, 1 photo-import trip lifetime, 10 entries/trip). Weekly $3.99, Monthly $9.99 (7-day trial), Annual $49.99 (7-day trial). |
| Profile and settings | Profile tab → edit display name, change tracking preference (193–227+ countries), restart onboarding, sign out, delete account. |

---

## 4) External services, tools, and platforms used

| Service | Purpose |
| --- | --- |
| Supabase | Authentication (email/password, Apple, Google), PostgreSQL database, file storage for photos |
| Google Places API | Place autocomplete, place details, location metadata for entries |
| RevenueCat | Subscription management, paywall, free-tier usage tracking |
| OpenRouter (Gemini 3.1 Flash-Lite) | LLM extraction of place names from social media captions, entry-type classification, traveler classification |
| TikTok oEmbed | Thumbnail and metadata for shared TikTok URLs |
| Instagram oEmbed | Thumbnail and metadata for shared Instagram URLs |
| Resend | Transactional and welcome emails |
| PostHog | Mobile product analytics |
| Google Analytics | Web analytics on public trip and list pages |
| Skimlinks | Affiliate link wrapping on public pages |
| Meta (Facebook) Ads SDK | Install attribution and ad measurement |
| Apple App Tracking Transparency | Tracking permission prompt on iOS |
| Expo / EAS | Build, OTA updates, push notifications infrastructure |
