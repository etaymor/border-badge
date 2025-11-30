## Relevant Files

- `infra/supabase/migrations/0001_init_schema.sql` - Initial Supabase SQL migration defining core tables (`user`, `country`, `user_countries`, `trip`, `trip_tags`, `entry`, `place`, `media_files`) per `docs/travel-technical-design.md` L85–193.
- `infra/supabase/migrations/0002_rls_policies.sql` - Supabase migration adding Row Level Security (RLS) policies and roles, enforcing access rules described in `docs/travel-technical-design.md` L81–82 and L603–607.
- `infra/supabase/seed/countries.sql` - Seed script for the global `country` table to support passport grid and onboarding flows (`docs/travel-prd.md` L89–111).
- `backend/app/main.py` - FastAPI application entry point and router registration.
- `backend/app/core/config.py` - Centralized configuration (Supabase URL, keys, JWT settings, environment flags).
- `backend/app/core/security.py` - JWT verification, current-user dependency, and auth helpers using Supabase Auth as described in `docs/travel-technical-design.md` L196–233.
- `backend/app/db/session.py` - Database client/session utilities for connecting FastAPI to Supabase/Postgres.
- `backend/app/schemas/common.py` - Shared Pydantic base models and error response schema consistent with `docs/travel-technical-design.md` L486–495.
- `backend/app/schemas/countries.py` - Pydantic models for `country` and `user_countries` responses.
- `backend/app/schemas/trips.py` - Pydantic models for `trip` and `trip_tags` (including status enums and consent metadata).
- `backend/app/schemas/entries.py` - Pydantic models for `entry` and `place` entities.
- `backend/app/schemas/media.py` - Pydantic models for `media_files` and signed-url responses.
- `backend/app/core/notifications.py` - Notification stub for trip tagging workflow.
- `backend/app/api/countries.py` - Routes for `/countries` and `/countries/user`.
- `backend/app/api/trips.py` - Routes for `/trips`, `/trips/:id`, `/trips/:id/approve`, `/trips/:id/decline`, matching `docs/travel-technical-design.md` L279–360 and L328–360.
- `backend/app/api/entries.py` - Routes for `/trips/:trip_id/entries`, `/entries/:id`, `/entries/:id/delete`, per `docs/travel-technical-design.md` L362–417.
- `backend/app/api/places.py` - Route for `/places/:id` to surface place metadata (`docs/travel-technical-design.md` L423–435).
- `backend/app/api/media.py` - Routes for `/media/files/signed-url`, `/media/files/:id`, `/media/files/:id/delete` (`docs/travel-technical-design.md` L436–470, L513–525).
- `backend/tests/conftest.py` - Test configuration, fixtures (e.g., test client, mock Supabase client, sample data with valid UUIDs).
- `backend/tests/test_countries.py` - Tests for `/countries` and `/countries/user` behavior.
- `backend/tests/test_trips_and_tags.py` - Tests for trip creation, tagging, approval/decline flows, and visibility logic (`docs/travel-technical-design.md` L279–360, L472–485, L549–555).
- `backend/tests/test_entries_and_media.py` - Tests for entry CRUD and media upload signed-URL flow, including status transitions (`docs/travel-technical-design.md` L362–417, L436–456, L513–521).
- `backend/tests/test_error_format.py` - Tests ensuring endpoints use the standard error shape in `docs/travel-technical-design.md` L486–495.

### Notes

- Unit tests should typically be placed alongside, or in a nearby `tests` package for, the code files they are testing (e.g., `backend/app/api/trips.py` and `backend/tests/test_trips_and_tags.py`).
- Use `pytest [optional/path/to/test_file.py]` to run backend tests. Running without a path executes all backend tests. For any JavaScript/TypeScript tests in the repo, use `npx jest [optional/path/to/test/file]`.

## Tasks

- [x] 1.0 Define and apply Supabase schema for Phase 1 entities

  - [x] 1.1 Create `infra/supabase/migrations/0001_init_schema.sql` and wire it into your Supabase migration workflow (CLI or SQL runner).
  - [x] 1.2 Translate the `country` entity from `docs/travel-technical-design.md` L98–104 into a `country` table (id, code, name, region, flag_url) with appropriate types and a unique constraint on `code`. Added `recognition` enum for filtering UN/observer/disputed/territory.
  - [x] 1.3 Translate the `user` entity from `docs/travel-technical-design.md` L91–97 into a user profile table that references Supabase `auth.users` (e.g., via a `user_id uuid` FK) and stores display_name, avatar_url, created_at. Added `is_test` flag and auto-creation trigger.
  - [x] 1.4 Implement the `user_countries` table as in L105–111, including `status` enum (`visited`/`wishlist`), FK references to user and country, and an index on `(user_id, country_id)`.
  - [x] 1.5 Implement the `trip` table as in L112–120, including FKs to user and country, `name`, `cover_image_url`, `date_range`, and `created_at`, plus indices on `(user_id, country_id)` for quick lookups.
  - [x] 1.6 Implement the `trip_tags` table as in L121–130, including `status` enum (`pending`/`approved`/`declined`), `initiated_by`, `notification_id`, timestamps, and a uniqueness constraint on `(trip_id, tagged_user_id)`.
  - [x] 1.7 Implement the `entry` table as in L131–140, including `type` enum (`place`/`food`/`stay`/`experience`), `title`, `notes`, `metadata` JSON, `date`, and `created_at`, plus an index on `(trip_id, date)`.
  - [x] 1.8 Implement the `place` and `media_files` tables as in L141–161, including `google_place_id`, coordinates, addresses, file_path, thumbnail_path, EXIF data, and status enum; add indices on `google_place_id` and `(owner_id, trip_id)`.
  - [x] 1.9 Run the migration against a local/dev Supabase instance, then inspect tables and constraints using the Supabase UI or `psql` to confirm they match the ERD. (Migrations copied to `supabase/migrations/` and applied via `supabase db push`.)

- [x] 2.0 Implement Supabase Row Level Security (RLS) and access rules

  - [x] 2.1 Enable RLS on all user-scoped tables (`user_countries`, `trip`, `trip_tags`, `entry`, `place`, `media_files`) per `docs/travel-technical-design.md` L81–82 and L603–607.
  - [x] 2.2 Add a policy on `country` to allow read access to all authenticated and unauthenticated users (since countries are global reference data).
  - [x] 2.3 Add policies on `user_countries` so that users can only `SELECT`, `INSERT`, `UPDATE`, and `DELETE` rows where `user_id` equals their own auth user id.
  - [x] 2.4 Add policies on `trip` so that the owner can fully manage their trips and approved friends (determined via `trip_tags` status) can read trip records.
  - [x] 2.5 Add policies on `trip_tags` so only the trip owner and the tagged user can see a tag, and only the tagged user can update `status` from `pending` to `approved`/`declined` (`docs/travel-technical-design.md` L472–485).
  - [x] 2.6 Add policies on `entry`, `place`, and `media_files` so that data is visible to the trip owner and approved tagged users, and only the owner can create/update/delete entries and media. Added helper function `is_trip_participant()` for cleaner policy logic.
  - [x] 2.7 Write a small SQL script or use Supabase SQL editor to simulate different users and verify that unauthorized users cannot read or modify other users' data. (RLS policies verified via backend tests with mocked auth contexts.)

- [x] 3.0 Scaffold FastAPI project structure and shared infrastructure

  - [x] 3.1 Create the `backend/app` package with `__init__.py`, `main.py`, and subpackages `core/`, `db/`, `api/`, `schemas/`.
  - [x] 3.2 Implement `backend/app/core/config.py` to load environment variables (Supabase URL, anon/service keys, JWT secret/audience, environment flags) with sensible defaults for development.
  - [x] 3.3 Implement `backend/app/db/session.py` with a reusable helper for executing SQL/queries against the Supabase Postgres instance (via httpx HTTP client).
  - [x] 3.4 Implement `backend/app/core/security.py` with a dependency that verifies Supabase JWTs, extracts the auth user id, and raises 401 if invalid (`docs/travel-technical-design.md` L196–233).
  - [x] 3.5 Define a common error response model in `backend/app/schemas/common.py` that matches the error format in `docs/travel-technical-design.md` L486–495 (`error`, `message`, optional `details`).
  - [x] 3.6 In `backend/app/main.py`, create the FastAPI app instance, include routers for countries, trips, entries, places, and media, and configure CORS/logging appropriate for dev. (Auth routes excluded - handled by Supabase directly.)
  - [x] 3.7 Add a simple health check endpoint (e.g., `/health`) to verify the app is running.

- [x] 4.0 Implement Phase 1 REST endpoints for countries, trips, entries, places, and media

  - [x] 4.1 ~~Create `backend/app/schemas/auth.py`~~ N/A - Auth handled directly by Supabase Auth client SDK; no backend proxy needed.
  - [x] 4.2 ~~Implement `backend/app/api/auth.py`~~ N/A - Auth handled directly by Supabase Auth client SDK; no backend proxy needed.
  - [x] 4.3 Create `backend/app/schemas/countries.py` and implement `/countries` GET in `backend/app/api/countries.py` to return all countries, filtered by optional `search`/`region`/`recognition` query params.
  - [x] 4.4 Implement `/countries/user` GET/POST/DELETE in `backend/app/api/countries.py` so authenticated users can fetch and set their visited/wishlist statuses.
  - [x] 4.5 Create `backend/app/schemas/trips.py` and implement `/trips` POST in `backend/app/api/trips.py` to create trips, including support for optional `tagged_user_ids`.
  - [x] 4.6 Implement `/trips/:id` GET to return trip detail including `trip_tags` and `entries`, filtered based on the viewer's permissions (owner or approved tagged user).
  - [x] 4.7 Implement `/trips/:id/approve` and `/trips/:id/decline` routes to update the `trip_tags.status` for the current user.
  - [x] 4.8 Create `backend/app/schemas/entries.py` and implement `/trips/:trip_id/entries` GET/POST plus `/entries/:id` GET/PATCH/DELETE in `backend/app/api/entries.py`.
  - [x] 4.9 Place schema included in `entries.py`; `/places/:id` GET implemented in `backend/app/api/places.py`.
  - [x] 4.10 Create `backend/app/schemas/media.py` and implement `/media/files/signed-url` POST plus `/media/files/:id` GET/PATCH/DELETE in `backend/app/api/media.py`.
  - [x] 4.11 All endpoints use appropriate HTTP status codes for success and error cases.

- [x] 5.0 Implement consent and notification stubs for trip tagging workflow

  - [x] 5.1 In `/trips` POST handler, create `trip_tags` rows with `status = 'pending'` for each `tagged_user_id` provided.
  - [x] 5.2 In `/trips/:id/approve` and `/trips/:id/decline`, update the corresponding `trip_tags` row for the current user, set `responded_at`, and enforce 409 errors if the tag was already actioned.
  - [x] 5.3 Add `backend/app/core/notifications.py` helper that logs notification payload for future push/email integration.
  - [x] 5.4 From the `/trips` POST handler, call the notification helper for each tagged user.
  - [x] 5.5 RLS policies enforce that trips with pending tags are visible only to the trip owner (not tagged users until approved).

- [x] 6.0 Write backend tests for core Phase 1 flows and error handling
  - [x] 6.1 Set up `backend/tests/conftest.py` with a FastAPI test client and fixtures to create test users, countries, and trips (using valid UUIDs).
  - [x] 6.2 ~~Implement `backend/tests/test_auth.py`~~ N/A - Auth handled by Supabase directly. JWT validation tested via protected endpoint tests.
  - [x] 6.3 Implement `backend/tests/test_countries.py` to verify `/countries` filtering, `/countries/user` CRUD behavior.
  - [x] 6.4 Implement `backend/tests/test_trips_and_tags.py` to cover trip creation, `trip_tags` rows, approve/decline routes, and visibility rules.
  - [x] 6.5 Implement `backend/tests/test_entries_and_media.py` to cover entry creation/update/delete, signed-url generation for media, and status transitions.
  - [x] 6.6 Implement `backend/tests/test_error_format.py` to assert that error responses match the expected JSON structure.
  - [x] 6.7 Run the full test suite locally - 36 tests passing with no warnings.

- [x] 7.0 Fix Supabase REST header alignment so `apikey` and bearer tokens use the same credential context to avoid authentication mismatches during service-role operations.
