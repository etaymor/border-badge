## Relevant Files

- `README.md` - Root project documentation describing architecture, how to run backend and mobile apps, and links to PRD/technical design/blueprint.
- `docs/` - Documentation folder containing `travel-prd.md`, `travel-technical-design.md`, `travel-mvp-blueprint.md`, and any future tech notes.
- `backend/pyproject.toml` (or `backend/requirements.txt`) - Backend Python dependencies and tooling configuration.
- `backend/app/main.py` - FastAPI entry point and router registration.
- `backend/app/core/config.py` - Centralized configuration for Supabase URL/keys, environment flags, and other shared settings.
- `backend/app/db/session.py` - Database client/session utilities for connecting FastAPI to Supabase/Postgres.
- `backend/app/api/__init__.py` - Module where routers are imported and aggregated.
- `backend/tests/` - Backend test folder, even if initially small (e.g., healthcheck tests).
- `infra/supabase/.env.example` - Example environment file for Supabase keys and URLs.
- `infra/supabase/migrations/` - Directory for SQL or schema migrations, starting with an initial "skeleton" migration.
- `infra/supabase/README.md` - Notes on how to run Supabase locally and apply migrations.
- `mobile/app.json` or `mobile/app.config.(js|ts)` - Expo app configuration with name, slug, and bundle identifiers.
- `mobile/package.json` - Mobile app dependencies and scripts.
- `mobile/tsconfig.json` - TypeScript configuration for the React Native app.
- `mobile/src/App.tsx` - Root React Native entry point that will later host navigation and providers.
- `mobile/.eslintrc.*` and `.prettierrc.*` - Linting and formatting configuration for the mobile app.
- `.github/workflows/ci.yml` - Minimal CI configuration running backend and mobile linters/tests on push/PR.
- `.editorconfig` - Optional shared editor configuration for consistent indentation and encoding.

### Notes

- Phase 0 sets up the **monorepo skeleton, Supabase dev environment, FastAPI + React Native (Expo) scaffolding, and basic tooling/CI**, as described in `docs/travel-mvp-blueprint.md` §4 (L162–195).
- Choices here should make it easy to implement all later phases without reworking directory structure or tooling; keep things simple but consistent with PRD technical considerations (`docs/travel-prd.md` L325–375).

## Tasks

- [x] 1.0 Establish repo layout and high-level documentation

  - [x] 1.1 Create the core directory structure in the repo root:
    - `backend/` (FastAPI app and tests).
    - `mobile/` (React Native/Expo app and tests).
    - `infra/` (Supabase migrations, seeds, scripts).
    - `docs/` (PRD, technical design, blueprint already present).
  - [x] 1.2 Create or update `README.md` to:
    - Briefly describe the app, architecture (backend + mobile + Supabase), and the purpose of each top-level directory.
    - Link to `docs/travel-prd.md`, `docs/travel-technical-design.md`, and `docs/travel-mvp-blueprint.md` for deeper context.
  - [x] 1.3 Add any repo-wide configuration files (e.g., `.editorconfig`) that help enforce consistent indentation, line endings, and charset across backend and mobile.

- [x] 2.0 Bootstrap Supabase project and local development configuration

  - [x] 2.1 Create a Supabase project (in the Supabase dashboard) and capture:
    - Supabase URL.
    - Anon/public key.
    - Service role key (for migrations and backend-side operations).
  - [x] 2.2 In `infra/supabase/.env.example`, define environment variables needed by local tooling (e.g., `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`), with clear comments about where to obtain them.
  - [x] 2.3 Set up a basic `infra/supabase/README.md` explaining:
    - How to install and log in with the Supabase CLI (if used).
    - How to run local Supabase (if desired) or how to apply migrations to a remote dev instance.
  - [x] 2.4 Create an initial empty or minimal migration file (e.g., `infra/supabase/migrations/0000_initial_skeleton.sql`) that confirms the migration pipeline is wired correctly, even if it only creates a placeholder schema or comment.
  - [ ] 2.5 Verify that you can run the migration pipeline against a dev Supabase instance and that Supabase's SQL editor or CLI can see the applied migration.

- [x] 3.0 Scaffold FastAPI backend skeleton

  - [x] 3.1 Initialize a Python project under `backend/`:
    - Create `pyproject.toml` or `requirements.txt` with at least: `fastapi`, `uvicorn[standard]`, an HTTP client for Supabase (e.g., `httpx` or `psycopg2`/`asyncpg`), and testing tools (`pytest`).
  - [x] 3.2 Create `backend/app/__init__.py`, `backend/app/main.py`, `backend/app/core/config.py`, and `backend/app/db/session.py`:
    - `config.py` should read environment variables for Supabase URL/keys and other core settings, with sensible defaults for development.
    - `session.py` should provide a simple helper or client object to talk to Supabase/Postgres.
  - [x] 3.3 In `main.py`, define:
    - A FastAPI instance.
    - Router registration (even if there's only a placeholder router initially).
    - A `GET /health` endpoint that returns a simple JSON payload (e.g., `{ "status": "ok" }`).
  - [x] 3.4 Add `backend/tests/test_health.py` to verify that the `/health` endpoint returns 200 and a valid JSON body when the app is running.
  - [x] 3.5 Add a small "How to run backend" section to `README.md` (or a `backend/README.md`) documenting the command to start the dev server (e.g., `uvicorn backend.app.main:app --reload`).

- [x] 4.0 Scaffold React Native (Expo) mobile skeleton with TypeScript

  - [x] 4.1 Initialize an Expo-managed React Native project in `mobile/` (e.g., `npx create-expo-app mobile -t expo-template-blank-typescript` or equivalent), ensuring TypeScript support.
  - [x] 4.2 Configure `mobile/app.json` or `app.config.(js|ts)` with:
    - App name and slug.
    - iOS bundle identifier.
    - (Optional) URL scheme for future deep-linking.
  - [x] 4.3 Ensure `mobile/tsconfig.json` is present and configured for React Native:
    - Enable strict type-checking where reasonable.
    - Set module resolution and JSX options appropriate for Expo.
  - [x] 4.4 Clean up the default Expo template in `mobile/src/App.tsx` to:
    - Render a minimal placeholder screen (e.g., app name and a note that navigation will be added in Phase 2).
    - Keep the layout simple and un-opinionated about design (consistent with Phase 0's goal).
  - [x] 4.5 Verify that `cd mobile && npx expo start` runs and that the app launches in the iOS simulator, and at least builds successfully for Android (even if not fully tested yet).
  - [x] 4.6 Add a "How to run mobile" section to `README.md` documenting how to start Expo and open the app in the iOS simulator.

- [x] 5.0 Set up tooling and CI (linting, formatting, and tests)

  - [x] 5.1 Configure backend tooling:
    - Add `ruff` and/or `black` to `backend/pyproject.toml` or requirements.
    - Optionally add a `Makefile` or `backend/README.md` snippets for running `ruff`, `black`, and `pytest`.
  - [x] 5.2 Configure mobile tooling:
    - Install `eslint`, `@typescript-eslint/*`, and `prettier` in `mobile/package.json`.
    - Add `.eslintrc.*` and `.prettierrc.*` with a sensible React Native + TypeScript config.
  - [x] 5.3 Create a minimal Jest setup for the mobile app (to align with later phases):
    - Add Jest-related dev dependencies (`jest`, `@testing-library/react-native`, `jest-expo` or equivalent).
    - Create `mobile/jest.config.(js|ts)` and a `mobile/src/__tests__/App.smoke.test.tsx` that simply renders `App` and asserts it doesn't crash.
  - [x] 5.4 Create `.github/workflows/ci.yml` (or equivalent) that:
    - Installs backend dependencies and runs `ruff`/`black` checks and `pytest`.
    - Installs mobile dependencies and runs ESLint, Prettier check (if configured), and Jest.
    - Runs on pull requests and pushes to the main branch.
  - [ ] 5.5 Confirm CI passes with the initial skeleton and document in `README.md` that passing CI is a prerequisite for merging future changes.


