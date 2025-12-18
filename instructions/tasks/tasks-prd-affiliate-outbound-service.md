## Relevant Files

- `backend/app/api/outbound.py` - FastAPI router for the outbound redirect endpoint living at `go.atlasi.app`.
- `backend/app/api/__init__.py` - Registers the outbound router with the main FastAPI app.
- `backend/app/services/affiliate_links.py` - Core logic for resolving destination URLs, partner priority, and Skimlinks fallback.
- `backend/app/services/skimlinks.py` - HTTP client wrapper for the Skimlinks API plus caching helpers.
- `backend/app/db/repositories/affiliate_links.py` - Persistence helpers for link definitions, click logs, and partner mappings.
- `backend/app/schemas/affiliate.py` - Pydantic models for outbound link definitions, click log payloads, and resolver responses.
- `supabase/migrations/0030_create_affiliate_tables.sql` - Database tables for link definitions, partner mappings, and click logs.
- `backend/app/templates/trip_public.html` - Public trip page that emits Stay/Experience links.
- `backend/app/templates/list_public.html` - Public list page that emits entry links.
- `mobile/src/screens/trips/TripDetailScreen.tsx` - Internal app trip view that surfaces Stay/Experience links (future interception point).
- `mobile/src/hooks/useEntries.ts` - Client hook providing link metadata to detail screens.
- `mobile/src/utils/linking.ts` - Centralized helper for formatting outbound URLs in the app (if absent, create it).
- `backend/tests/api/test_outbound_redirect.py` - Endpoint and redirect behavior tests.
- `backend/tests/services/test_affiliate_links.py` - Resolver, partner priority, and Skimlinks fallback tests.
- `mobile/src/screens/trips/__tests__/TripDetailScreen.test.tsx` - Ensures client routes links through the redirect service.
- `docs/legal/affiliate-disclosure.md` - Placeholder for disclosure copy referenced by UI.

### Notes

- Unit tests should typically be placed alongside the code files they exercise.
- Use `poetry run pytest path/to/test.py` for backend tests and `npm test path/to/test.tsx` for mobile tests.

## Tasks

- [ ] 1.0 Implement outbound redirect endpoint and click logging pipeline
- [ ] 1.1 Design Supabase schema (tables + indexes) for outbound link definitions and click logs; ship via new migration.
- [ ] 1.2 Add repository/service helpers to insert and query click logs, including derived context (geo, UA, source).
- [ ] 1.3 Build `GET /o/{link_id}` FastAPI route with validation, signature checking, partner resolution hook, and 302 redirect.
- [ ] 1.4 Persist every redirect attempt (success/failure) with structured logging plus DB insert, ensuring PII rules are honored.
- [ ] 1.5 Cover endpoint + logging logic with pytest (success, missing link_id, disabled link, tampered signature).
- [ ] 2.0 Build link definition storage plus resolver pipeline for Stays and Experiences
- [ ] 2.1 Extend data model/repositories to store partner mappings per Stay/Experience (direct partner IDs, confidence, status).
- [ ] 2.2 Implement resolver service that ingests Google Places + Stay metadata and attempts direct partner matching.
- [ ] 2.3 Create scheduled job or hook to refresh partner mappings and mark stale/failed matches for manual review.
- [ ] 2.4 Add unit tests covering resolver scenarios (exact match, fuzzy match, no match fallback to search URL).
- [ ] 3.0 Integrate Skimlinks fallback and partner-priority selection
- [ ] 3.1 Implement `SkimlinksClient` with auth, error handling, caching, and subid tagging.
- [ ] 3.2 Expand resolver to follow priority order: direct partner → Skimlinks wrapped URL → original URL; log selection path.
- [ ] 3.3 Store wrapped URLs and cache metadata in DB/Redis; add invalidation strategy when originals change.
- [ ] 3.4 Write tests for fallback logic, cache hits, API failure fallback, and analytics labels.
- [ ] 4.0 Update public web and mobile clients to route existing links through the redirect service
- [ ] 4.1 Update `trip_public.html` and `list_public.html` to replace direct links with server-generated `go.atlasi.app/o/{link_id}` URLs.
- [ ] 4.2 Ensure public-share API responses include opaque link IDs plus signed context for each Stay/Experience.
- [ ] 4.3 Update mobile Trip detail components/hooks to request/linkify redirect URLs instead of raw partner URLs.
- [ ] 4.4 Add regression tests (Jest + pytest template rendering) verifying links now target the redirect domain with required params.
- [ ] 5.0 Add observability, admin tooling, and legal/compliance guardrails
- [ ] 5.1 Emit metrics/logs for redirect latency, partner success rate, Skimlinks API health, and error spikes.
- [ ] 5.2 Build lightweight admin CLI or dashboard endpoint to inspect link definitions, override partner mappings, and pause links.
- [ ] 5.3 Implement rate limiting/bot filtering (per-IP + signed tokens) and document data-retention policies for click logs.
- [ ] 5.4 Add affiliate disclosure copy to share pages (placeholder text) and ensure legal review checklist is documented.

