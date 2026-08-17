# SQL-Layer Test Suite

Real-Postgres tests for behavior that lives in the database itself —
triggers, RPCs, constraints, and RLS policies — which the mocked API tests
cannot exercise. Every test runs inside a transaction that is rolled back,
so the target database is left untouched.

## What the suite covers

| File | Covers |
|------|--------|
| `test_social_integrity.py` | Signup/invite processing (`handle_new_user`, `process_pending_invites_for_user`), unfollow inbox cleanup, `block_user_full` RPC, wishlist→visited events, follow-backfill budget/filters (migration 0087) |
| `test_feed_pagination.py` | Keyset feed cursors and page shape (0088) |
| `test_search_block_exclusion.py` | User search excludes blocked pairs (0089) |
| `test_fanout_coalescing.py` | Per-trip/day event coalescing and inbox pruning (0090) |
| `test_push_token_rekey.py` | Push-token re-key to one row per device token (0091) |
| `test_rls_policies.py` | RLS policies via JWT-role simulation: trip/entry visibility (0064), `social_feed_inbox` recipient-only reads (0080), `user_block` blocker-only rows (0059), `push_token` owner-only rows (0084/0091) |

## Running locally

The tests are marked `sql` and **skip automatically** unless the
`SUPABASE_DB_URL` environment variable points at a Postgres with the full
`supabase/migrations/` set applied. `psycopg` is a dev dependency; the tests
`importorskip` it, so environments without it also stay green.

Against a Supabase local stack (Docker required):

```bash
# From the repo root: start the local stack and apply migrations
supabase start
supabase db reset   # applies everything in supabase/migrations/

# From backend/: run the suite
SUPABASE_DB_URL=postgresql://postgres:postgres@127.0.0.1:54322/postgres \
    poetry run pytest -m sql
```

Without `SUPABASE_DB_URL`, `poetry run pytest` runs the whole backend suite
and reports these tests as skipped — that is the expected state on machines
without a local stack.

## No-Docker note

This project's development machine does not run Docker; migrations are
applied through the Supabase dashboard, so the SQL suite is not expected to
execute locally there. It exists for CI or any environment with a Supabase
stack (local or disposable). Do **not** rewrite these tests to fake the
database — their whole purpose is pinning real trigger/RPC/RLS behavior.

## CI status

No CI job runs this suite yet. Wiring one up (supabase local stack +
`pytest -m sql`) is an optional follow-up.
