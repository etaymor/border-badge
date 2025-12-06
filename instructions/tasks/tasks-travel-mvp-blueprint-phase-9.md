## Relevant Files

- `supabase/migrations/0008_trip_sharing.sql` - Database migration adding `share_slug` column to trips for public sharing, plus slug generation function and RLS policy.
- `backend/app/schemas/public.py` - Pydantic schemas for public views: `PublicTripView`, `PublicTripEntry`, and `TripShareResponse`.
- `backend/app/api/public.py` - FastAPI router exposing read-only public endpoints for landing page, shared lists, and optional shared trip views, backed by existing schema (`docs/travel-mvp-blueprint.md` L620–645; `docs/travel-technical-design.md` L85–193).
- `backend/app/templates/base.html` - Base Jinja2/HTML template defining `<head>` (SEO/meta tags, Open Graph/Twitter cards), global styles, and shared header/footer CTAs.
- `backend/app/templates/landing.html` - Public landing page template focused on explaining the product and driving users to download/open the app (PRD entry points `docs/travel-prd.md` L209–213, L335–337).
- `backend/app/templates/list_public.html` - Public shared city list template showing entries with photos/notes and a strong “Download the app” CTA (US-011/012 `docs/travel-prd.md` L459–473).
- `backend/app/templates/trip_public.html` - Optional public trip view template showing high-level trip info and a subset of entries, respecting consent and privacy (`docs/travel-prd.md` L135–143, L145–163; `docs/travel-technical-design.md` L472–485).
- `backend/app/static/css/styles.css` - Lightweight CSS file implementing a token-like system (colors, typography, spacing) aligned with the mobile design language from Phase 8.
- `backend/app/core/seo.py` - Helper functions for building SEO metadata (titles, descriptions, canonical URLs, Open Graph and Twitter tags).
- `backend/app/core/analytics.py` - Existing analytics helper extended to emit events for public page views and CTA clicks (`docs/travel-technical-design.md` L587–595).
- `backend/app/core/config.py` - Configuration for base URL, public domain, analytics keys, and caching headers for public endpoints.
- `backend/tests/test_public_endpoints.py` - Backend tests for public endpoints: landing page, list by slug, trip by id/slug, SEO fields, and privacy constraints.
- `docs/travel-mvp-blueprint.md` - Phase 9 blueprint (`§12.5 Phase 9 – Shared Lists & Public Web Views`) driving requirements.
- `backend/app/db/session.py` - Supabase client for REST/RPC operations used by API routes.
- `backend/tests/test_db_session.py` - Tests covering Supabase client header setup and RPC helper behavior.

### Notes

- Phase 9 focuses on **shared lists and public web views** using **FastAPI + server-rendered HTML templates**, not a separate frontend stack, to keep implementation lightweight but on-brand (`docs/travel-mvp-blueprint.md` L620–645).
- Behavior must satisfy PRD shared lists and public link user stories US-011/012 (`docs/travel-prd.md` L459–473) and trip sharing constraints (L135–143, L145–163), while respecting RLS/privacy from the technical design (`docs/travel-technical-design.md` L81–82, L603–607).
- Public pages should be **SEO-friendly** (titles, meta tags, canonical URLs, OG/Twitter cards) and include clear CTAs that route visitors back to the mobile app landing/download surfaces.
- The same stack and templates will also serve the **main marketing landing page** for the app, reusing the visual language from Phase 8 where practical.

## Tasks

- [x] 1.0 Design and implement backend data/API layer for shared lists and public trip views

  - [x] 1.1 Review PRD shared list requirements and user stories US-011/012 (`docs/travel-prd.md` L173–179, L459–473) plus trip-sharing/privacy notes (L135–143, L145–163) and map them onto the existing schema (`docs/travel-technical-design.md` L85–193).
  - [x] 1.2 Define the public data contract for shared lists (e.g., `/public/lists/:slug`) including: list name, description, owner display name (if allowed), curated entries (title, notes, limited place/media info), and creation metadata.
  - [x] 1.3 Implement backend logic (e.g., views or helper queries) that fetch list data by slug and assemble a **denormalized DTO** suitable for a single render, avoiding N+1 queries and ensuring only whitelisted fields are exposed.
  - [x] 1.4 Similarly, define the public data contract for optional trip views (e.g., `/public/trips/:id-or-slug`), ensuring that only:
    - Trips explicitly marked shareable via a public-link flag are exposed.
    - Only approved tagged users and publicly permitted fields appear in the payload.
  - [x] 1.5 Implement `backend/app/api/public.py` with endpoints:
    - `GET /public/landing` (or `/`) returning landing page context.
    - `GET /public/lists/{slug}` returning data for a shared list.
    - (Optional) `GET /public/trips/{slug_or_id}` returning data for a shared trip.
  - [x] 1.6 Ensure these endpoints use existing RLS/privacy guarantees plus additional safeguards (e.g., checking list/trip share flags) so that private or non-consented data is never leaked.

- [x] 2.0 Build FastAPI-rendered public web pages that reuse the core design aesthetic

  - [x] 2.1 Set up Jinja2 or equivalent template rendering in the FastAPI app (if not already present), configuring template and static directories (e.g., `backend/app/templates`, `backend/app/static`).
  - [x] 2.2 Create `base.html` that:
    - Defines a consistent `<head>` with responsive meta tag, favicon links, CSS includes, and placeholder blocks for SEO/OG tags.
    - Includes a simple header/footer with app name/logo and "Download the app" buttons linking to the App Store (and Play Store if relevant).
  - [x] 2.3 Implement `landing.html`:
    - Explain the product succinctly (drawing from PRD overview `docs/travel-prd.md` L11–19).
    - Highlight key benefits (passport grid, trip logging, social layer).
    - Provide clear CTAs to download or open the app and a small section for screenshots or illustration.
  - [x] 2.4 Implement `list_public.html`:
    - Show list title, short description, and owner attribution if allowed.
    - Render entry cards (place name, short note, thumbnails) using a clean, mobile-friendly layout.
    - Include a prominent CTA to download/open the app and optional "See more in the app" microcopy.
  - [x] 2.5 Implement `trip_public.html` (if required):
    - Show trip title, country, dates, and a few highlight entries.
    - Make sure content reflects consent and privacy rules (only approved tagged users, no sensitive details).
  - [x] 2.6 Implement `backend/app/static/css/styles.css` with a small set of **CSS tokens** (CSS variables) that mirror the mobile design (colors, typography, spacing) without recreating the entire design system.

- [x] 3.0 Implement SEO and shareability (meta tags, OG/Twitter cards, canonical URLs)

  - [x] 3.1 Implement `backend/app/core/seo.py` with helpers to build per-route SEO context:
    - Title, description, canonical URL.
    - Open Graph tags (og:title, og:description, og:image, og:url).
    - Twitter card tags.
  - [x] 3.2 For `landing.html`:
    - Use a descriptive title and meta description that reflect the product's core value (PRD summary `docs/travel-prd.md` L13–19).
    - Set canonical URL to the main site root (or /landing).
    - Include OG/Twitter tags with a branded image to improve link previews.
  - [x] 3.3 For `list_public.html` and `trip_public.html`:
    - Construct titles and descriptions based on list/trip content (e.g., "CDMX for Foodies – Shared List from [AppName]").
    - Include OG image pointing to a generic but on-brand image or a representative screenshot.
    - Ensure each has a stable canonical URL based on slug or ID.
  - [x] 3.4 Validate that pages render correctly when crawled without JS and that key content is server-rendered (not reliant on client-side hydration) to improve SEO and social sharing previews.
  - [x] 3.5 Add basic `robots.txt` and, if appropriate, `sitemap.xml` generation for landing and public list/trip routes to help search engines discover the pages.

- [x] 4.0 Implement CTAs, deep links, and analytics for public → app funnel

  - [x] 4.1 Decide on primary CTAs for landing and public pages (e.g., "Download on the App Store", "Open in the app") and ensure these are consistent in header, hero, and end-of-page sections.
  - [x] 4.2 Implement platform-specific links:
    - App Store URL for iOS.
    - (Optional) Play Store URL for Android.
    - Deep link or universal link URL that, when tapped on mobile, attempts to open the native app directly.
  - [x] 4.3 In `backend/app/core/analytics.py`, add event helpers for:
    - `public_landing_viewed`, `public_list_viewed`, `public_trip_viewed`.
    - `cta_appstore_clicked`, `cta_open_app_clicked`.
  - [x] 4.4 Invoke these events from the public endpoints/templates (e.g., via server-side logging combined with minimal client-side tracking where needed), ensuring they adhere to analytics requirements from Phase 6 (`docs/travel-technical-design.md` L587–595; `docs/travel-prd.md` L341–359).
  - [x] 4.5 Keep tracking explicit and non-invasive: do not add extra tracking beyond page views and CTA clicks described in the PRD, and ensure any cookies/identifiers respect privacy expectations.

- [x] 5.0 Add caching, performance hardening, and tests for public endpoints
  - [x] 5.1 Add appropriate caching headers to public endpoints (e.g., short to medium TTL with ETag or Last-Modified) to improve load times while allowing updates to propagate reasonably quickly.
  - [x] 5.2 Consider optional in-memory or CDN caching for public list/trip payloads, leveraging scalability advice in `docs/travel-technical-design.md` L595–601 (e.g., caching small JSON blobs keyed by slug/ID).
  - [x] 5.3 Implement `backend/tests/test_public_endpoints.py` to cover:
    - 200 responses for valid landing, list, and trip URLs.
    - 404 responses for unknown slugs/IDs.
    - Privacy rules (e.g., non-shareable trips/lists are not accessible).
    - Presence of key SEO tags in rendered HTML.
  - [x] 5.4 Perform basic performance checks (e.g., using `ab`/`wrk` or timing logs) to ensure public pages respond quickly under expected traffic and remain within P75 targets (building on PRD technical metrics `docs/travel-prd.md` L317–323).
  - [x] 5.5 Document how to run and test the public web views (dev/staging URLs, expected environment variables, how to validate SEO/open-graph previews) in `README.md` or a small `docs/public-web.md`.
- [x] 6.0 Fix Supabase RPC support for trip sharing
  - [x] 6.1 Add `SupabaseClient.rpc` helper and tests to support slug generation
  - [x] 6.2 Add entry RLS policy to allow viewing entries from shared trips
