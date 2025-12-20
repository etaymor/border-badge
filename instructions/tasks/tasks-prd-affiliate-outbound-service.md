## Relevant Files

- `backend/app/api/outbound.py` - FastAPI router for redirect endpoint at `/o/{link_id}`
- `backend/app/api/__init__.py` - Registers the outbound router
- `backend/app/services/affiliate_links.py` - Link management, click logging, signature generation
- `backend/app/services/affiliate_resolver.py` - Partner matching and resolution logic
- `backend/app/services/skimlinks.py` - Skimlinks API client with caching
- `backend/app/db/repositories/affiliate_links.py` - DB access for links, clicks, mappings
- `backend/app/schemas/affiliate.py` - Pydantic models for affiliate entities
- `backend/app/core/affiliate_urls.py` - URL generation helpers + Jinja2 integration
- `supabase/migrations/0023_create_affiliate_tables.sql` - Database schema
- `backend/app/templates/trip_public.html` - Public trip page (add entry links)
- `backend/app/templates/list_public.html` - Public list page (update to redirect URLs)
- `backend/app/api/public.py` - Generate redirect URL context for templates
- `backend/app/core/config.py` - Add SKIMLINKS_API_KEY, AFFILIATE_SIGNING_SECRET
- `backend/app/main.py` - Register Jinja2 affiliate URL helpers
- `backend/tests/api/test_outbound_redirect.py` - Redirect endpoint tests
- `backend/tests/services/test_affiliate_links.py` - Service layer tests
- `backend/tests/test_skimlinks.py` - Skimlinks client tests (31 tests)
- `backend/tests/api/test_public_affiliate.py` - Public page affiliate URL tests (12 tests)
- `backend/app/core/bot_detection.py` - Bot detection patterns for analytics
- `backend/app/api/admin.py` - Admin endpoints for link management
- `backend/tests/api/test_admin.py` - Admin endpoint tests (14 tests)
- `docs/legal/affiliate-disclosure.md` - Legal disclosure placeholder

### Notes

- Tests placed in `backend/tests/` mirroring source structure
- Use `poetry run pytest backend/tests/` for all backend tests
- Mobile integration deferred to v2 (focus on public web pages for v1)

## Tasks

- [x] 1.0 Implement outbound redirect endpoint and click logging pipeline
  - [x] 1.1 Create Supabase migration (0023) with outbound_link, outbound_click, partner_mapping tables + indexes
  - [x] 1.2 Create Pydantic schemas in `backend/app/schemas/affiliate.py` for all affiliate entities
  - [x] 1.3 Implement affiliate_links service with link CRUD, click logging, HMAC signature gen/verify
  - [x] 1.4 Build `GET /o/{link_id}` endpoint with signature validation, resolution, and 302 redirect
  - [x] 1.5 Add pytest coverage for endpoint (success, invalid sig, missing link, disabled link)

- [x] 2.0 Build link definition storage plus resolver pipeline for Stays and Experiences
  - [x] 2.1 Extend DB repository for partner mappings (partner_slug, property_id, confidence, status)
  - [x] 2.2 Implement affiliate_resolver service with name/address/coordinate matching
  - [x] 2.3 Add background refresh hook or entry-save trigger for partner mapping updates
  - [x] 2.4 Write resolver tests (exact match, fuzzy match, no match → search URL fallback)

- [x] 3.0 Integrate Skimlinks fallback and partner-priority selection
  - [x] 3.1 Implement SkimlinksClient with auth, 2-3s timeout, subid tagging, error handling
  - [x] 3.2 Add priority resolution: direct partner → Skimlinks → original URL; log resolution path
  - [x] 3.3 Implement URL caching in DB (24-48h TTL) with invalidation on URL change
  - [x] 3.4 Write tests for Skimlinks wrap, cache hit/miss, API failure fallback

- [x] 4.0 Update public web pages to route links through redirect service
  - [x] 4.1 Update list_public.html and trip_public.html to use generated redirect URLs
  - [x] 4.2 Update public.py to generate link_id + signed context for each entry
  - [x] 4.3 Add `_generate_entry_redirect_url()` helper to public.py (no separate file needed)
  - [x] 4.4 Add pytest tests verifying template URLs use redirect service with valid signatures

- [x] 5.0 Add observability, admin tooling, and legal/compliance guardrails
  - [x] 5.1 Add structured logging for redirect latency, partner, resolution_path, errors
  - [x] 5.2 Create admin endpoints to list/inspect/pause links and override mappings
  - [x] 5.3 Configure rate limiting on /o/{link_id} and add bot detection patterns
  - [x] 5.4 Create docs/legal/affiliate-disclosure.md with placeholder text

## Deferred to v2 (Mobile Integration)

- [ ] Update TripDetailScreen to display entry links
- [ ] Create mobile/src/utils/linking.ts for redirect URL generation
- [ ] Add mobile tests for link interception
