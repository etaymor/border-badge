# Travel Tracker MVP – Build Blueprint (Backend + Mobile)

This document is a **phase-by-phase, implementation-focused blueprint** for the Travel Tracker & Trip Logger MVP. It assumes:

- A **React Native** mobile app (iOS-first, Android-ready) with TypeScript.
- A **FastAPI** backend sitting in front of **Supabase** (Postgres, Auth, Storage).
- **RevenueCat** for subscriptions and **PostHog / Google Analytics** for analytics, per the PRD.

It is intentionally “black-and-white” from a UI perspective: we focus on **functional flows, data contracts, and system behavior**, while **visual polish and brand expression are deferred to the final phase**.

This blueprint **does not introduce new architecture**; instead, it tells you _how to implement_ the existing product/technical design in a practical order.

- **Primary product reference**: `docs/travel-prd.md`
  - Goals & personas: L21–83
  - Functional requirements: L87–207
  - Key UX flows (onboarding, core experience, edge cases): L209–295
  - Technical considerations & integrations: L325–375
  - User stories: L377–545
- **Primary technical reference**: `docs/travel-technical-design.md`
  - Data model / ERD: L85–193
  - System interfaces / API contracts: L196–525
  - Core user flows (backend-first): L529–573
  - Analytics, storage, security, scalability: L587–621

---

## 1. Phase Overview

This section provides a high-level overview; later sections go into detailed tasks and how they link back to the PRD and technical design.

| Phase | Name                                  | Summary                                                                                   |
| ----- | ------------------------------------- | ----------------------------------------------------------------------------------------- |
| 0     | Foundations & Tooling                 | Repo layout, Supabase project, FastAPI skeleton, RN app init, basic CI/tooling.           |
| 1     | Data Model & Backend Core API         | Implement Supabase schema, RLS, and core FastAPI endpoints used by onboarding & passport. |
| 2     | Mobile App Skeleton & Data Layer      | Navigation, screen shells, basic design system, API client & state/data layer.            |
| 3     | Auth, Onboarding & Passport Grid      | Guest mode, auth, onboarding quiz, country selection, passport summary.                   |
| 4     | Trips, Entries, Places & Media        | Trip CRUD, entry logging, Google Places integration, photo uploads.                       |
| 5     | Social Graph, Consent & Notifications | Friend graph UI, trip tagging, approvals, in-app notification center, push/email hooks.   |
| 6     | Paywall, Subscriptions & Analytics    | RevenueCat integration, basic paywall, feature gating, instrumentation.                   |
| 7     | Hardening, QA & Release Readiness     | Edge cases, performance, tests, TestFlight build pipeline.                                |
| 8     | Visual Polish & Brand Layer           | Final visual system, illustrations, animations, paywall CRO tweaks.                       |

Each phase routes back to:

- **PRD features & user stories** (`docs/travel-prd.md` L87–207, L377–545).
- **Data & API design** (`docs/travel-technical-design.md` L85–193, L196–525).

---

## 2. Product Requirements → Phases (from PRD)

### 2.1 Goals & Personas (Why we build in this order)

From PRD goals and personas (`travel-prd.md` L21–83):

- **Business goals** (L23–33) emphasize **activation and viral sharing** with low cost.
- **User goals** (L35–43) prioritize:
  - Seeing a **passport-style country map** quickly.
  - **Logging trips** and **rich entries** (places, notes, photos).
  - **Sharing lists** and **seeing where friends overlap**.
- **Personas & roles** (L55–85) imply:
  - **Guest usage** before signup (Ava logs countries before creating an account).
  - **Registered users and friends** who rely on consent-based sharing.

These drive the phase ordering:

- Early phases focus on **country logging, onboarding, and passport grid** (US-001/002/019; L381–393, L525–529).
- Mid phases add **trips, entries, social consent** (US-005–007; L411–433).
- Later phases add **paywall and visual polish**, aligning with paid features as a fast follow (L33, L191–201).

### 2.2 Functional Requirements Coverage Map

From PRD functional requirements (`travel-prd.md` L87–207), each feature aligns to blueprint phases:

| PRD Feature (L87–207)                           | Primary Phases      | Notes / References                                                                                                |
| ----------------------------------------------- | ------------------- | ----------------------------------------------------------------------------------------------------------------- |
| **Country tracking** (L89–111)                  | 1, 3                | Backend: `countries`/`user_countries` APIs (`technical-design.md` L234–279). Mobile: onboarding + passport views. |
| **Photo upload** (L113–119)                     | 1, 4                | Backend: media files + signed URL (`technical-design.md` L436–456). Mobile: trip/entry gallery upload.            |
| **Account & authentication** (L119–123)         | 1, 3                | Supabase Auth + FastAPI JWT (`technical-design.md` L196–233, L603–607). Onboarding & login flows.                 |
| **Friend connections** (L125–135)               | 5                   | Requires basic “friends” UI + endpoints (friend graph modeled alongside `trip_tags`).                             |
| **Social approval system** (L135–143)           | 1, 5                | `trip_tags` schema & approval endpoints (`technical-design.md` L121–130, L328–360, L472–485). UI in Phase 5.      |
| **Trip management** (L145–163)                  | 1, 4                | `/trips` endpoints (`technical-design.md` L279–360) + mobile trip form/list screens.                              |
| **Entry logging** (L165–173)                    | 1, 4                | `/entries` + `/places` (`technical-design.md` L362–436). Entry forms and per-trip log views.                      |
| **Shared lists** (L173–179)                     | 4 (backend/web), 7+ | List creation and public web views; core API can be prepared early, but full share experience can be later.       |
| **Notifications & approvals** (L181–189)        | 5                   | Uses consent flows and notification triggers (`technical-design.md` L472–485, L499–511).                          |
| **Feed & Discover** (L191–201)                  | Post-MVP            | Architecturally supported by existing schema (countries/trips/entries), but postponed.                            |
| **Analytics & engagement** (L203–205, L349–359) | 6                   | Analytics events wired into key flows (`technical-design.md` L587–595).                                           |

### 2.3 Core UX Flows & User Stories

From PRD UX and user stories:

- **Onboarding & first-time UX** (`travel-prd.md` L209–221, L233–287):
  - Welcome slides, motivation tags, country selection, progress summary, soft invite.
  - Implemented primarily in **Phases 3 and 6** (auth/onboarding and paywall surfaces).
- **Core experience** (`travel-prd.md` L233–285):
  - Add country, country view, create trip, tag friends, add entries, view passport, invite friends.
  - Implemented across **Phases 3, 4, and 5**.
- **Key user stories** in §10 (`travel-prd.md` L377–545) map to phases (see also cross-reference table in §8.1):
  - **US-001/002/019** (country + wishlist + progress): Phases 1, 3.
  - **US-003/004** (auth): Phases 1, 3.
  - **US-005–010** (trips, tagging, entries, media): Phases 1, 4, 5.
  - **US-011/012** (lists & shared links): Phases 4, 7+.
  - **US-013–015** (friend requests, approvals, notifications): Phase 5.
  - **US-016–018/020** (delete, Places quota, GDPR delete): Phases 1, 4, 7.
  - **US-017/021** (secure API, analytics events): Phases 1, 6, 7.

---

## 3. Architecture & APIs → Phases (from Technical Design)

### 3.1 Data Model & Storage Anchoring

The **canonical data model** is defined in `travel-technical-design.md` L85–193:

- `user`, `country`, `user_countries`, `trip`, `trip_tags`, `entry`, `place`, `media_files`.
- Relationships enforce:
  - Countries are global; user associations live in `user_countries` (L162–163).
  - Trips belong to a user and a country (L164–165).
  - Entries belong to a trip (L166).
  - Places and media are linked to entries/trips (L167–172).

In this blueprint:

- **Phase 1** is responsible for implementing these tables in Supabase, including:
  - Columns, types, enums (`visited/wishlist`, `pending/approved/declined`, entry `type`).
  - Foreign keys and indices (as suggested at L176–192 and L595–599).
- **RLS policies** must respect the privacy model (`travel-technical-design.md` L81–82, L603–607):
  - Users can see their own data.
  - Friends only see data for trips where there is an `approved` `trip_tags` row.

### 3.2 API Surface Mapping

System interfaces (L196–525) define the **FastAPI+Supabase API**. By phase:

- **Phase 1 – Core API endpoints (read/write)**
  - Auth endpoints: `/auth/signup`, `/auth/login` (`technical-design.md` L198–232).
  - Country & user-country endpoints: `/countries`, `/user_countries` (`technical-design.md` L234–279).
  - Trip endpoints: `/trips`, `/trips/:id`, approval/decline (`technical-design.md` L279–360, L328–360).
  - Entry endpoints: `/trips/:trip_id/entries`, `/entries/:id` (`technical-design.md` L362–417).
  - Place and media endpoints: `/places/:id`, `/media/files/*` (`technical-design.md` L423–470).
- **Phase 5 – Consent & notification behaviors**
  - Consent state machine and notification triggers (`technical-design.md` L472–485, L499–511).
- **Phase 6 – Analytics**
  - Event instrumentation aligns with analytics notes (`technical-design.md` L587–595 and PRD L349–359).

The **general error format** (L486–495) and **file upload handling** (L513–525) should be treated as cross-cutting constraints in Phases 1, 4, and 7.

### 3.3 Cross-Cutting Concerns

Across phases, we rely on:

- **RLS and security**: `travel-technical-design.md` L81–82, L603–607, plus PRD US-017 (L507–513).
- **Storage & performance**: `travel-technical-design.md` L595–601; PRD scalability goals L369–375.
- **Analytics & metrics**: `travel-technical-design.md` L587–595; PRD L349–359.
- **File robustness**: `travel-technical-design.md` L513–525, L619–619.

These shape how we implement each phase, even when the work is primarily on the client side.

---

## 4. Phase 0 – Foundations & Tooling

**Objective:** Establish a maintainable, scalable base for backend and mobile, aligned with solo-dev velocity but ready for future contributors.

- **Repo & directory structure**
  - Decide on **monorepo vs. multi-repo**; a common pattern:
    - `backend/` — FastAPI app, tests.
    - `mobile/` — React Native app, tests.
    - `infra/` — Supabase migrations, scripts.
    - `docs/` — existing PRD/technical design + this blueprint.
  - Ensure README(s) explain how to:
    - Run backend locally.
    - Run mobile app in iOS simulator (and basic Android emulator support).
- **Supabase bootstrap**
  - Create Supabase project and configure **dev** environment:
    - Store keys locally via environment files (never committed).
  - Align with PRD technical considerations (`travel-prd.md` L325–375):
    - Supabase Auth, Postgres, Storage as core.
    - Google Places, analytics tools, RevenueCat as integrations.
- **FastAPI skeleton**
  - Setup a basic FastAPI app with:
    - App factory, router registration.
    - Dependency injection for DB connection to Supabase.
    - Auth middleware stub that will later consume Supabase JWTs (`technical-design.md` L196–233).
- **React Native skeleton**
  - Initialize a **TypeScript** React Native project targeting iOS and Android.
  - Verify that a barebones app runs on the iOS simulator and at least builds on Android.
- **Tooling & CI**
  - Configure:
    - Linting and formatting: ESLint/Prettier (mobile), Ruff/Black (backend).
    - Test runners: Jest for frontend, pytest for backend.
  - Set up minimal CI:
    - Run linters + tests on push/PR.
    - Gate merges on green status (even if tests initially light).

---

## 5. Phase 1 – Data Model & Backend Core API

**Objective:** Implement the core **Supabase schema + RLS policies + FastAPI endpoints** that power guest mode, auth, country logging, trip creation, entries, and media metadata.

### 5.1 Schema Implementation (Supabase)

Based on `travel-technical-design.md` L85–193:

- Create tables:
  - `user`, `country`, `user_countries`, `trip`, `trip_tags`, `entry`, `place`, `media_files`.
- Define enums and constraints:
  - `user_countries.status`: `"visited" | "wishlist"` (L105–111).
  - `trip_tags.status`: `"pending" | "approved" | "declined"` (L121–130).
  - `entry.type`: `"place" | "food" | "stay" | "experience"` (L131–139).
  - `media_files.status`: `"uploaded" | "processing" | "failed"` (L151–160).
- Seed `country` data:
  - Ensure codes/names/regions/flags exist to support the PRD’s country grid (L89–111).

### 5.2 RLS & Security

Using principles from `travel-technical-design.md` L81–82, L603–607 and PRD US-017 (L507–513):

- Implement RLS so:
  - Users only see their own `user_countries`, `trips`, `entries`, `media_files`.
  - For `trips` and `entries`, users with an **approved** `trip_tags` row can read associated data.
  - Public list endpoints (Phase 4+) are served via separate views or APIs that expose only whitelisted fields.
- Ensure security supports:
  - GDPR-compliant deletion (US-020; L531–537).
  - Private storage of media, with signed URLs for public lists (PRD L361–367).

### 5.3 FastAPI Core Endpoints

Implement endpoints defined in `travel-technical-design.md` L196–470:

- **Auth (`/auth/*`)**
  - `/auth/signup`, `/auth/login` per L198–232.
  - Integrate with Supabase Auth; FastAPI validates tokens for all subsequent calls.
- **Countries (`/countries`, `/user_countries`)**
  - `/countries` GET: supports search/region filters (L234–244).
  - `/user_countries` GET/POST: returns and sets visited/wishlist statuses (L253–277).
- **Trips (`/trips`, `/trips/:id`)**
  - `/trips` POST: create trip with optional `tagged_user_ids` (L279–313).
  - `/trips/:id` GET: returns trip plus tags and entries filtered by viewer (L315–326).
- **Entries (`/trips/:trip_id/entries`, `/entries/:id`)**
  - CRUD operations as per L362–417:
    - Listing, creating (with metadata that can embed Google Places data), updating, deleting entries.
- **Places & Media**
  - `/places/:id` GET: fetch place metadata (L425–434).
  - `/media/files/signed-url` POST: presigned URL flow (L438–456).
  - `/media/files/:id` GET/DELETE: retrieve and delete media metadata (L462–470).

### 5.4 Consent & Notifications Stubs

Lay groundwork (full UI and flows land in Phase 5):

- Respect the **consent state machine** (`technical-design.md` L472–485):
  - Trip creation creates `trip_tags` rows with `pending` status.
  - Approval/decline endpoints update state and record timestamps.
- Implement **notification triggers** as hooks/stubs (`technical-design.md` L499–511):
  - For now, log or enqueue payloads for email + push (exact integration can be deferred).

### 5.5 Backend Testing

Focus on user stories requiring correct backend behavior:

- **US-001/002/019** – Add visited/wishlist country & view progress (L381–393, L525–529).
- **US-005–007** – Create trip, tag friends, approval (L411–433).
- **US-008–010** – Add entries and upload photos (L435–457).
- **US-016–018/020** – Delete entries, handle Places quota fallback, GDPR delete (L499–521, L531–537).

Tests should validate:

- RLS policies.
- Error format consisent with L486–495.
- File upload status transitions per L513–521.

---

## 6. Phase 2 – Mobile App Skeleton & Data Layer

**Objective:** Build a navigable, type-safe React Native shell that can talk to the backend, without focusing on brand or deep visuals.

### 6.1 Navigation & Screen Shells

Inspired by onboarding and core flows in PRD L209–221, L233–285:

- Setup navigation (e.g., React Navigation) with:
  - Auth stack: Welcome, Login, Signup.
  - Onboarding stack: Motivation tags, country selection, progress summary.
  - Main tabs: Passport (home), Trips, Friends, Profile/Settings.
- Each screen starts as a simple shell:
  - Neutral background.
  - Basic header/title.
  - Placeholder body area with minimal layout.

### 6.2 Lightweight Design System

Create a tiny UI kit to ensure consistency:

- Components: `Button`, `Text`, `Input`, `Screen` wrapper.
- Styles:
  - Use system fonts and neutral colors (black/white/gray) for now.
  - Honor accessibility basics from PRD (`travel-prd.md` L223–231):
    - 44px touch targets, scalable text, VoiceOver-friendly structure.

### 6.3 API Client & State/Data Layer

Reflecting backend interfaces (`travel-technical-design.md` L196–470):

- Create an API client:
  - Wrap HTTP calls to `/auth`, `/countries`, `/user_countries`, `/trips`, `/entries`, `/media/*`, `/places`.
  - Centralize base URL and auth token handling.
- Data layer:
  - Use a data-fetching library (e.g., React Query) plus a minimal global auth store.
  - Provide hooks like `useCountries`, `useUserCountries`, `useTripsByCountry`, `useTripEntries`.

### 6.4 Environment Configuration

Wire environment variables for:

- API base URL.
- Supabase project URL (if used directly).
- Feature flags (e.g., paywall on/off).

This supports metrics and cost constraints from PRD L29–31, L317–323.

---

## 7. Phase 3 – Auth, Onboarding & Passport Grid

**Objective:** Deliver the **first compelling end-to-end user flow**: guest logs countries → signs up → sees passport grid and progress.

### 7.1 Auth Flow (Guest → Registered)

Based on PRD auth requirements (`travel-prd.md` L119–123, US-003/004 L395–409) and technical design auth APIs (L198–232):

- Implement:
  - **Sign up** with email/password and Google/Apple.
  - **Log in** with stored credentials.
- Session handling:
  - Store JWT securely (e.g., keychain/secure storage).
  - Attach token to all authenticated API calls.
- Migration from guest:
  - When a guest signs up, post locally stored countries to `/user_countries` (US-001/002 L381–393).

### 7.2 Motivation & Personality Tags

From PRD onboarding screen 2 (L217–221):

- Implement a bubble-tag UI capturing:
  - _Why I Travel_ and _I Am A…_ tags.
- Data handling:
  - Store locally during guest flow.
  - On signup, persist as user metadata (e.g., JSON field or auxiliary table) for future personalization.

### 7.3 Country Selection Flow (Visited + Wishlist)

Based on PRD country tracking & onboarding flows (L89–111, L217–221, L233–241, L277–279) and backend APIs (`technical-design.md` L234–279):

- Screens:
  - **Current country** autocomplete (screen 3 in PRD).
  - **Dream destination** autocomplete (screen 4).
  - **Continent intro modal & per-continent grid** (screen 5-A/5-B).
- Behavior:
  - Use `/countries` with search/region filters for autocomplete and grids.
  - POST selections to `/user_countries` as `visited` or `wishlist`.
  - Apply optimistic updates so the grid feels instant (PRD L241).

### 7.4 Passport Summary & Map Reveal

Based on PRD screen 6 and US-019 (`travel-prd.md` L217–221, L523–529):

- Implement a summary screen that:
  - Shows count of visited countries and percentage of ~195.
  - Shows wishlist count separately.
  - Reuses `user_countries` data and/or aggregated endpoints.
- Ensure performance:
  - Keep UX under the technical metric target P75 < 2.5s (PRD L319–321).

---

## 8. Phase 4 – Trips, Entries, Places & Media

**Objective:** Allow users to create trips under countries, log entries (places/food/stays/experiences), and attach photos.

### 8.1 Country Detail & Trip List

From PRD trip requirements (`travel-prd.md` L145–163, L253–257) and technical trips API (`travel-technical-design.md` L279–360):

- Implement **Country Detail** screen:
  - Shows flag/region/basic stats.
  - Lists trips for that country using `/trips` (possibly filtered by `country_id`).
  - CTA to create new trip.

### 8.2 Trip Creation & Editing

Based on US-005 (`travel-prd.md` L411–417) and trips endpoints (`travel-technical-design.md` L279–360):

- Fields:
  - Name (required), country (pre-filled), optional date range, optional cover image.
- Behavior:
  - POST to `/trips` with above fields.
  - Show pending tags appropriately if user chooses to tag friends (see Phase 5).
- Allow editing basic trip fields via PATCH/PUT-equivalent endpoints.

### 8.3 Entry Logging

From PRD entry logging (`travel-prd.md` L165–173, L265–275) and technical entries API (`travel-technical-design.md` L362–417):

- Support types: place, food, stay, experience.
- Implement:
  - Entry list per trip (GET `/trips/:trip_id/entries`).
  - Add/edit entry forms (POST `/trips/:trip_id/entries`, PATCH `/entries/:id`).
  - Manual experiences without Places (US-009; L443–449).

### 8.4 Google Places Integration

From PRD autocomplete and fallback behavior (`travel-prd.md` L167–171, L269–271, L287–291) and technical design (`travel-technical-design.md` L423–435, L529–541, L515–521):

- Implement a debounced autocomplete UI:
  - For place/food/stay entries only.
  - Use Google Places API directly from mobile or via backend proxy.
- Error handling:
  - On quota errors (HTTP 429/403), show manual entry UI as per US-018 (L515–521).

### 8.5 Media Upload & Gallery

From PRD photo upload (`travel-prd.md` L113–119, L273–275) and media API (`travel-technical-design.md` L436–456, L513–525, L619–619):

- Implement:
  - Photo picker limited to 10 photos per entry (US-010; L451–457).
  - Upload flow:
    - Request signed URL (`/media/files/signed-url`).
    - Upload to Storage.
    - Poll or confirm status to move from `processing` → `uploaded`.
  - Simple gallery UI per entry with thumbnails and a detail view.
- Deletion:
  - Implement delete with undo snack bar (PRD L293; US-016 L499–505).

---

## 9. Phase 5 – Social Graph, Consent & Notifications

**Objective:** Implement friend connections, trip tagging with consent, and in-app approvals, reflecting the PRD’s consent-focused social layer.

### 9.1 Friend Connections

From PRD friend connections (`travel-prd.md` L125–135, L281–285, US-013–015 L475–497):

- UI:
  - Friend search by username/email.
  - List of friends with basic stats (country count, shared trips).
  - Simple requests list with pending/accepted states.
- Backend:
  - Use or extend schema to represent friend relationships (consistent with social assumptions in `travel-technical-design.md` L575–583).

### 9.2 Trip Tagging & Consent Workflow

From PRD social approval system (`travel-prd.md` L135–143, L257–263, US-006–007 L419–433) and technical consent flows (`travel-technical-design.md` L121–130, L328–360, L472–485, L549–555):

- UI:
  - On trip creation or edit, user selects friends to tag.
  - Trips show:
    - Pending indicator when tags are awaiting approval.
    - Approved status once all relevant tags are approved.
- Backend:
  - Use `trip_tags` for per-user status (pending/approved/declined).
  - Respect rules:
    - Pending trips do not appear on tagged users’ profiles.
    - Approved trips appear on both profiles and count toward joint stats.

### 9.3 Notification Center & Push/Email

From PRD notifications (`travel-prd.md` L181–189, US-015 L491–497) and technical notification notes (`travel-technical-design.md` L499–511):

- Implement a **minimal in-app notification center**:
  - Shows pending trip approvals, friend requests.
  - Provides approve/reject actions.
- Push/email:
  - Use notification triggers from Phase 1 hooks.
  - Connect to push provider and email service in a minimal but functional way.

### 9.4 Privacy & Visibility Checks

Aligning with PRD privacy expectations and technical security model (`travel-technical-design.md` L603–609):

- Ensure:
  - Only owners and approved participants see trip details.
  - Declined tags do not leak trip metadata to non-approved users.

---

## 10. Phase 6 – Paywall, Subscriptions & Analytics

**Objective:** Add a basic subscription layer and make sure key product events are tracked.

### 10.1 Paywall Surfaces

From PRD paywall notes (`travel-prd.md` L217–221, L223–231, L231–231, L349–359):

- Implement:
  - A simple paywall screen triggered:
    - After passport reveal or when hitting premium-only features.
  - Content:
    - Bullet list of benefits (social overlays, deeper journaling, AI tips, etc.).
    - Primary CTA for free trial / subscribe.

### 10.2 RevenueCat Integration

Using PRD technical considerations (L337–347):

- Integrate RevenueCat SDK:
  - Configure one or two products (e.g., monthly subscription).
  - Keep local feature flags in sync with subscription status.
- On backend (if needed):
  - Provide a simple endpoint or verification hook to confirm subscription status for server-side gated operations.

### 10.3 Analytics Events

From PRD metrics and analytics requirements (`travel-prd.md` L299–323, L341–359, L541–545) and technical design analytics notes (`travel-technical-design.md` L587–595):

- Instrument events:
  - Onboarding started/completed.
  - Country added / wishlist added.
  - Trip created / approved.
  - Friend request sent/accepted.
  - Paywall views, trial starts, subscriptions/cancellations.
- Ensure:
  - Event names and payloads are documented for analysis.
  - No passive or invasive tracking beyond described flows (L591–593).

---

## 11. Phase 7 – Hardening, QA & Release Readiness

**Objective:** Address edge cases, performance, reliability, and get to a stable TestFlight-ready build.

### 11.1 Edge Cases & Error Handling

From PRD advanced features & edge cases (`travel-prd.md` L287–293, US-016–018 L499–521) and technical error patterns (`travel-technical-design.md` L486–495, L513–525):

- Confirm:
  - Places quota fallback is correct and user-friendly.
  - Duplicate trip names behavior (append “(2)”) is implemented.
  - Deletes show confirmation + undo snack bar.
  - Failed uploads and orphaned files can be retried/cleaned.

### 11.2 Performance & Scalability

Based on PRD technical metrics (`travel-prd.md` L317–323, L369–375) and technical scalability notes (`travel-technical-design.md` L595–601, L613–619):

- Optimize:
  - API usage and caching for passport and trips/entries screens.
  - Query patterns and indices for Supabase (per L595–599).
  - Image sizes and loading strategies to hit P75 goals.

### 11.3 Testing Strategy

Tie tests to critical user stories in `travel-prd.md` L377–545:

- Backend:
  - Unit tests for each endpoint group.
  - Integration tests for flows like onboarding, trip creation, tagging/approval.
- Mobile:
  - Unit tests for key logic functions.
  - Integration/E2E tests (e.g., via Detox or equivalent) for:
    - Onboarding country logging.
    - Trip creation + entry logging.
    - Tagging & approval flow.
    - Paywall display on expected triggers.

### 11.4 Release Pipeline

- Implement:
  - Scripts or CI jobs to:
    - Build and upload to TestFlight.
    - Optionally, generate Android internal builds.
  - Simple versioning and changelog conventions.

---

## 12. Phase 8 – Visual Polish & Brand Layer

**Objective:** Apply final visuals, animations, and polish on top of stable functional flows.

**Precondition:** Do **not** begin implementation work for this phase until a high-fidelity visual design system has been handed off (e.g., Figma files or equivalent) that defines colors, typography, spacing, components, and key motion patterns; treat this design handoff as a blocking gate before starting Phase 8.

### 12.1 Visual Language & Design Tokens

From PRD visual and animation notes (`travel-prd.md` L223–231, L229–230):

- Define:
  - Color palette, typography scale, spacing rules, iconography set.
  - Store these as **design tokens** consumable by the existing UI components.
- Update:
  - Core UI primitives (`Button`, `Text`, `Screen`, etc.) to use tokens.
  - Ensure accessibility (contrast, text size) remains compliant.

### 12.2 Passport & Map Visuals

Aligned with PRD’s emphasis on **passport grid** and stamps (L89–111, L277–279, L229–230):

- Replace placeholder tiles with:
  - Final country illustrations.
  - Stamp/badge animations on visited/wishlist toggles.
  - Confetti or celebratory animations for key milestones.

### 12.3 Onboarding & Paywall Polish

Using PRD onboarding and paywall copy/visual guidance (`travel-prd.md` L217–221, L223–231):

- Enhance:
  - Welcome slides and motivation screens with final art, microcopy.
  - Paywall with improved layout, A/B-testable elements (trial length, ribbons, testimonials).

### 12.4 Design Debt Sweep

- Standardize:
  - Spacing, typography usage, and component variants across all screens.
  - Error/empty states, loaders, and dialog styles.

---

## 12.5 Phase 9 – Shared Lists & Public Web Views (Trips & City Lists)

From PRD shared lists and trip sharing (`travel-prd.md` L173–179, L145–163) and user stories US-011/012 (`travel-prd.md` L459–473), plus technical considerations for simple web experiences and public payloads (`travel-prd.md` L211–221, L335–337, L369–375; `travel-technical-design.md` L81–82, L595–601):

- Scope:
  - Provide **minimal public web views** for:
    - **City lists** created from multiple entries (US-011/012; `travel-prd.md` L173–179, L459–473).
    - **Trip shares** that expose a curated subset of trip/entry data via unique links (`travel-prd.md` L135–143, L145–163).
  - These views focus on **read-only consumption + app download CTA**, not full web editing.
- Backend contracts:
  - Define **public-read endpoints** (e.g., `/public/lists/:slug`, `/public/trips/:id` or equivalent) that:
    - Resolve a **slug or token** to underlying trips/entries using the existing schema (`travel-technical-design.md` L85–193).
    - Return a **denormalized payload** optimized for web display (list name, entries with titles, notes, photos, and basic place metadata).
    - Respect privacy/RLS by exposing only whitelisted fields and only for explicitly shared lists/trips (`travel-technical-design.md` L81–82, L603–607).
  - Reuse the media and signed-URL handling from `/media/files/*` so public images are served through safe, time-bounded URLs (`travel-technical-design.md` L436–470, L513–525).
- Web application:
  - Introduce a lightweight **web front end** (e.g., `web/` app using Next.js or a static-site framework) that:
    - Renders **public list pages**: gallery of entries with photos and notes, plus a prominent CTA to download/open the app (`travel-prd.md` L211–221, L459–473).
    - Renders **public trip views** similarly (cover image, basic trip info, high-level entry highlights) while keeping social consent logic intact (only approved participants and explicitly shared trips appear; `travel-prd.md` L135–143, `travel-technical-design.md` L472–485).
    - Implements basic SEO (title/meta tags) and responsive layout but defers heavy branding and CRO experiments to Phase 8.
- Performance & scale:
  - Plan for **edge caching** of public list/trip payloads and pages, per scalability notes about public payloads and Supabase-backed queries (`travel-prd.md` L369–375; `travel-technical-design.md` L595–601).
  - Keep initial implementation simple:
    - Cache small JSON payloads per slug/id.
    - Rely on existing indices on trips/entries/media to serve lists efficiently.
  - Instrument minimal analytics events on the web side (list view, CTA click) to feed into the analytics plan in Phase 6 (`travel-prd.md` L349–359; `travel-technical-design.md` L587–595).

## 13. Cross-References, Assumptions & Future Extensions

### 13.1 User Stories → Phases

High-level mapping of PRD user stories (`travel-prd.md` L377–545) to blueprint phases:

| User Story ID | Summary                                         | Primary Phases |
| ------------- | ----------------------------------------------- | -------------- |
| US-001        | Add visited country                             | 1, 3           |
| US-002        | Add wishlist country                            | 1, 3           |
| US-003/004    | Sign up with Google / email-password            | 1, 3           |
| US-005        | Create trip                                     | 1, 4           |
| US-006/007    | Tag friends & approve trip                      | 1, 5           |
| US-008–010    | Add restaurant/experience with photos           | 1, 4           |
| US-011/012    | Create & view shared city list                  | 4, 7+          |
| US-013/014    | Friend request & acceptance                     | 5              |
| US-015        | Notifications for social interactions           | 5, 7           |
| US-016–018    | Delete entry, Places quota fallback, secure API | 1, 4, 7        |
| US-019        | View passport progress                          | 1, 3           |
| US-020        | Reset account & data                            | 1, 7           |
| US-021        | Track key analytics events                      | 6, 7           |

### 13.2 Key Assumptions

- **Offline behavior**:
  - MVP starts with **basic caching**, not full offline-first as described in `travel-technical-design.md` L47–53 and L601–601; robust offline can be a fast-follow.
- **Monetization scope**:
  - Initial paywall is **simple** (one product, minimal variants), leaving advanced CRO experiments (trial length tests, ribbons) for later (PRD L229–231).
- **Friend graph modeling**:
  - A basic friend model is sufficient for MVP; future features like feeds and richer social surfaces may extend this (PRD L191–201, `travel-technical-design.md` L575–583).

### 13.3 Future Work Hooks (Post-MVP)

From PRD feed and discover features (`travel-prd.md` L191–201):

- **Feed**:
  - Can reuse `trip` and `entry` models to build activity timelines.
  - Likely added as a new tab or screen within the existing navigation.
- **Discover**:
  - Can leverage:
    - Aggregated entry data.
    - AI-driven recommendations tailored by motivation/personality tags (Phase 3 data).
  - Requires additional backend services or functions, but the current schema is ready for it.

This blueprint should give you a **clear, step-by-step implementation path** from empty repos to a functional, testable MVP that aligns tightly with the existing PRD and technical design documents, while keeping visual polish and experimentation for the final phase.
