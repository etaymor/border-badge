# Outbound Affiliate Redirect Service PRD

## 1. Introduction / Overview

Atlasi currently lets users view and share trips with outbound links that open Google Maps or partner websites (hotels, experiences, etc.) without monetization. We want to intercept these existing outbound clicks and route them through a server-controlled redirect layer (`https://go.atlasi.app/o/{link_id}`) that logs each click, appends partner-specific affiliate parameters, and routes users to monetizable booking experiences. This feature unlocks immediate affiliate revenue opportunities without changing the existing user experience or adding new UI elements.

## 2. Goals

- Capture every monetizable outbound click (in-app, share pages, copied links) through a centralized redirect service.
- Log actionable analytics (trip, item, partner, geo) server-side without exposing sensitive partner IDs in clients.
- Provide affiliate-ready deep links for hotels and experiences using existing Google Places + Stay data, with fallbacks when no direct partner match exists.
- Enable fast onboarding of direct affiliate programs (Booking, Tripadvisor, GetYourGuide) while allowing Skimlinks/Sovrn wrapping for other merchants.

## 3. User Stories

- As a traveler viewing a shared trip, when I tap on a Stay or Experience link (as I already do today), I'm automatically routed through Atlasi's affiliate redirect to the booking site, generating revenue without any change to my experience.
- As a trip owner, I can add hotels/experiences to my itinerary knowing that when others click the existing links, Atlasi will monetize those clicks automatically.
- As a growth analyst, I can see which shared trips and itinerary items drive outbound clicks without relying on partner dashboards.
- As a product manager, I can change affiliate partners or link templates centrally without updating mobile/web clients.

## 4. Functional Requirements

1. **Outbound Redirect Endpoint**
   - Implement `GET /o/{link_id}` on FastAPI (served via `go.atlasi.app` subdomain) that logs the request, resolves the destination URL, appends affiliate parameters, and issues a 302 redirect.
   - Support query parameters such as `src`, `trip_id`, `item_id`, and signed tokens to prevent tampering.
2. **Click Logging**
   - Persist each click with timestamp, link_id, trip_id, item_id, partner, destination URL, source context (e.g., `trip_share`, `in_app`), device hints (UA sniffing), and geolocation (derived from IP when allowed).
   - Provide an internal dashboard-ready table or API for analytics tooling; no end-user exposure in v1.
3. **Link Definition & Management**
   - Store outbound link records server-side with fields: partner slug, base destination template, required affiliate params, fallbacks, and current status (active, paused, archived).
   - Allow mapping multiple itinerary objects (e.g., a Stay entry, an Experience entry) to a single link_id, enabling reuse and rotating partners.
4. **HotelOfferResolver Pipeline**
   - For each Stay (already tied to Google Places data), attempt to resolve partner-specific property IDs via: name/address/lat-long fuzzy matching against partner APIs, canonical website metadata, and cached mappings.
   - Persist partner property IDs per place plus confidence scores, and refresh periodically.
   - If no property match exists, generate a partner search deep link (city, dates if known, query string with hotel name).
5. **Experience Link Resolver**
   - Mirror the Stay pipeline for activities/experiences using partners like GetYourGuide or Tripadvisor experiences.
   - When the experience lacks a partner mapping, fall back to Skimlinks/Sovrn wrappers around the best-known URL.
6. **Client Integration**
   - Update existing outbound link handlers (on public trip share pages and eventually internal app trip view pages) to route through the outbound redirect endpoint instead of directly to destination URLs.
   - For Stays and Experiences, replace direct Google Maps or partner URLs with `go.atlasi.app/o/{link_id}` URLs that include context (trip_id, item_id, source).
   - No new UI buttons or CTAs required; existing link taps are intercepted and monetized transparently.
7. **Affiliate Parameter Management**
   - Partner affiliate IDs, campaign/subId formats, and optional Skimlinks wrapper configuration are stored in secure backend config/secrets.
   - Redirect endpoint appends `affiliate_id`, `subid` (using trip/item context), and any partner-required query params before redirecting.
8. **Skimlinks Integration**
   - Integrate Skimlinks API for automatic link monetization of merchants without direct affiliate partnerships.
   - When a Stay or Experience entry has a destination URL (from `entry.link` or Google Places metadata) that doesn't match a direct partner (Booking.com, Tripadvisor, GetYourGuide), route it through Skimlinks API to generate a monetized version.
   - Implement Skimlinks API client that:
     - Accepts a destination URL and returns a Skimlinks-wrapped affiliate URL
     - Handles Skimlinks API authentication (API key stored in backend secrets)
     - Supports Skimlinks query parameters for tracking (e.g., `subid` with trip/item context)
     - Implements caching of wrapped URLs (TTL: 24-48 hours) to reduce API calls and improve redirect latency
     - Handles API rate limits and errors gracefully (fallback to original URL if Skimlinks fails)
   - Skimlinks integration should be transparent: if Skimlinks cannot monetize a URL, redirect to the original destination URL without breaking the user experience.
   - Store Skimlinks-wrapped URLs in the link mapping table with a `partner_slug` of `skimlinks` for analytics and debugging.
9. **Fallback Strategy & Partner Priority**
   - Implement partner resolution priority: Direct partners (Booking, Tripadvisor, GetYourGuide) > Skimlinks > Original URL (no monetization).
   - For each Stay/Experience, attempt direct partner resolution first; if no match exists and a destination URL is available, use Skimlinks; if Skimlinks fails or URL is unavailable, redirect to original URL or Google Maps.
   - Log the resolution path (direct_partner, skimlinks, fallback) for analytics to understand monetization coverage.
10. **Rate Limiting & Abuse Prevention**

- Add lightweight abuse protections: per-IP rate limits, HMAC-signed `link_id` payloads, and bot filtering to avoid fraudulent clicks.

11. **Observability**

- Emit structured logs/metrics (successes, partner breakdown, errors) and alert on spikes in failures or 4xx/5xx responses from partner URLs.
- Track Skimlinks API call volume, success rate, and latency separately from direct partner redirects.
- Monitor cache hit rates for Skimlinks-wrapped URLs to optimize caching strategy.

## 5. Non-Goals

- Surfacing affiliate analytics or earnings to end users in-app.
- Incentivizing or rewarding users for outbound clicks (explicitly disallowed by many programs).
- Building a full partner onboarding UI; configuration can remain code/config-based for v1.
- Handling restaurants or other categories with no affiliate potential.

## 6. Design Considerations

- No UI changes required; existing links continue to work as before, just routed through the affiliate redirect service.
- Include a lightweight affiliate disclosure on trip share pages once legal copy is available; copy placeholder text now, final wording later.

## 7. Technical Considerations

- Host the redirect endpoint within the existing FastAPI backend to reuse auth, logging, and deployment tooling; mount it behind `go.atlasi.app` via reverse proxy configuration.
- Store partner credentials/IDs (including Skimlinks API key) in backend secrets (not mobile/web). Clients receive only opaque link IDs.
- Use Supabase (or a dedicated table) for click logs and partner mappings; consider partitioning by date for scalability.
- The resolver should run as part of backend ingestion (e.g., when a Stay is saved) or as a scheduled job to precompute partner mappings, minimizing latency during clicks.
- **Skimlinks API Integration:**
  - Use Skimlinks REST API (not JavaScript SDK) for server-side link wrapping
  - Implement async HTTP client with timeout (2-3 seconds) to avoid blocking redirects
  - Cache Skimlinks-wrapped URLs in Redis or database with TTL to reduce API calls
  - Handle Skimlinks API errors (rate limits, invalid URLs, network failures) by falling back to original URL
  - Include Skimlinks subid parameter with format: `trip_{trip_id}_item_{item_id}` for tracking
- Provide admin tooling (CLI script or simple dashboard) to review unresolved items and manually map partners when automated matching fails.

## 8. Success Metrics

- % of eligible Stay/Experience entries that have a monetizable link (`link_id`) available (target >80% once resolver matures).
- Outbound click-through rate on existing Stay/Experience links on shared trips and internal app views.
- Revenue-per-trip-share session (tracked via partner reporting, even if offline).
- Redirect uptime and median latency (<100 ms before partner redirect).

## 9. Open Questions

- Which partner APIs will be available first (Booking.com via affiliate portal, Tripadvisor, GetYourGuide, Travelpayouts) and what SLA/costs do they impose?
- Do we need dynamic stay dates/guest counts for deep links, or will default "2 adults, 1 room" suffice until users specify otherwise?
- Should we support multiple partner options per Stay (e.g., user chooses between Booking vs Tripadvisor) or auto-select the best-paying partner? (Note: Since we're intercepting existing links, this may be determined by the original link destination.)
- What legal copy is required for affiliate disclosures, and where should it live within the UI?
- **Skimlinks-specific:**
  - What is the Skimlinks API rate limit and pricing model? (affects caching strategy and error handling)
  - Should we pre-warm Skimlinks cache for popular destinations or wrap URLs on-demand?
  - Does Skimlinks support all the merchants we expect (hotels, activities, travel services)? What's their coverage?
  - How do we handle Skimlinks reporting/analytics? Do we need to integrate their reporting API or rely on their dashboard?
