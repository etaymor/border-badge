"""Content assertions for the travel-photo-quiz schema migration.

There is no test database in CI, so these tests parse the migration SQL text
and assert the security-critical properties of the quiz schema:

- All four quiz tables are backend-only: RLS enabled, zero user policies.
- Grading integrity: UNIQUE (session_id, question_id) so a question grades
  at most once per session.
- Lifecycle: the state CHECK admits exactly the five lifecycle states.
- Slug: partial unique index over non-null slugs (many NULL slugs coexist).
- Score-to-beat is a pair captured together (both null or both non-null).
- Idempotency by construction (DO block + IF NOT EXISTS everywhere).
"""

import re
from pathlib import Path

import pytest

MIGRATION_PATH = (
    Path(__file__).resolve().parents[2]
    / "supabase"
    / "migrations"
    / "0060_travel_photo_quiz.sql"
)

QUIZ_TABLES = ["quiz", "quiz_question", "quiz_session", "quiz_answer", "quiz_funnel"]

FUNNEL_EVENTS = {
    "page_view",
    "session_started",
    "session_completed",
    "install_cta_tap",
}

LIFECYCLE_STATES = {
    "building",
    "awaiting_owner_play",
    "playable",
    "shared",
    "revoked",
}


@pytest.fixture(scope="module")
def sql() -> str:
    assert MIGRATION_PATH.exists(), f"missing migration: {MIGRATION_PATH}"
    return MIGRATION_PATH.read_text()


def test_migration_number_is_next_available():
    """0057 is the latest applied migration; 0058-0059 are reserved by a
    sibling plan, so this migration must be 0060 and must not collide."""
    migrations_dir = MIGRATION_PATH.parent
    numbers = [
        int(p.name[:4]) for p in migrations_dir.glob("[0-9][0-9][0-9][0-9]_*.sql")
    ]
    assert numbers.count(60) <= 1, "duplicate 0060 migration"
    assert 57 in numbers, "expected prerequisite migration 0057 to exist"


def test_wrapped_in_do_migration_block(sql: str):
    assert "DO $migration$" in sql
    assert "$migration$;" in sql


def test_creates_all_quiz_tables_idempotently(sql: str):
    for table in QUIZ_TABLES:
        pattern = rf"CREATE TABLE IF NOT EXISTS public\.{table}\s*\("
        assert re.search(pattern, sql), f"missing idempotent CREATE for {table}"


def test_rls_enabled_on_all_quiz_tables(sql: str):
    for table in QUIZ_TABLES:
        pattern = rf"ALTER TABLE public\.{table}\s+ENABLE ROW LEVEL SECURITY"
        assert re.search(pattern, sql), f"RLS not enabled on {table}"


def test_no_user_policies(sql: str):
    """Backend-only pattern: RLS on, zero policies -> anon/authenticated
    selects return nothing; all access goes through the service role."""
    assert "CREATE POLICY" not in sql.upper()


def test_state_check_lists_exactly_the_five_lifecycle_states(sql: str):
    match = re.search(
        r"state\s+TEXT[^,]*CHECK\s*\(\s*state\s+IN\s*\(([^)]*)\)", sql, re.IGNORECASE
    )
    assert match, "state column must be TEXT with an IN (...) CHECK constraint"
    states = set(re.findall(r"'([^']+)'", match.group(1)))
    assert states == LIFECYCLE_STATES


def test_state_is_text_not_enum(sql: str):
    assert not re.search(
        r"CREATE\s+TYPE", sql, re.IGNORECASE
    ), "lifecycle state must be TEXT + CHECK, not a Postgres enum"


def test_slug_unique_index_is_partial(sql: str):
    pattern = (
        r"CREATE UNIQUE INDEX IF NOT EXISTS \w+\s*"
        r"ON public\.quiz\s*\(slug\)\s*"
        r"WHERE slug IS NOT NULL"
    )
    assert re.search(
        pattern, sql
    ), "slug needs a partial unique index so many NULL slugs coexist"


def test_slug_column_is_nullable_and_hex_constrained(sql: str):
    # Nullable: no NOT NULL on the slug column definition.
    match = re.search(r"^\s*slug\s+TEXT(.*)$", sql, re.MULTILINE | re.IGNORECASE)
    assert match, "quiz table must have a slug TEXT column"
    assert (
        "NOT NULL" not in match.group(1).upper()
    ), "slug must be nullable until share time"
    # token_hex(16) shape only: 32 lowercase hex chars.
    assert re.search(
        r"slug\s*~\s*'\^\[0-9a-f\]\{32\}\$'", sql
    ), "slug CHECK must restrict values to token_hex(16) output"


def test_score_to_beat_pair_set_and_cleared_together(sql: str):
    pattern = (
        r"CHECK\s*\(\s*\(\s*score_to_beat_correct IS NULL AND score_to_beat_total IS NULL\s*\)"
        r"\s*OR\s*\(\s*score_to_beat_correct IS NOT NULL AND score_to_beat_total IS NOT NULL"
    )
    assert re.search(
        pattern, sql
    ), "score-to-beat (correct, total) must be both null or both non-null"


def test_answer_unique_per_session_and_question(sql: str):
    assert re.search(
        r"UNIQUE\s*\(\s*session_id\s*,\s*question_id\s*\)", sql
    ), "quiz_answer needs UNIQUE (session_id, question_id) so each question grades at most once"


def test_child_tables_cascade_from_quiz(sql: str):
    assert re.search(
        r"quiz_id\s+UUID NOT NULL REFERENCES public\.quiz\(id\) ON DELETE CASCADE",
        sql,
    ), "questions and sessions must cascade from their quiz"
    assert re.search(
        r"session_id\s+UUID NOT NULL REFERENCES public\.quiz_session\(id\) ON DELETE CASCADE",
        sql,
    ), "answers must cascade from their session"
    assert re.search(
        r"question_id\s+UUID NOT NULL REFERENCES public\.quiz_question\(id\) ON DELETE CASCADE",
        sql,
    ), "answers must cascade from their question"


def test_revocation_timestamps_present(sql: str):
    assert re.search(r"^\s*revoked_at\s+TIMESTAMPTZ", sql, re.MULTILINE | re.IGNORECASE)
    assert re.search(
        r"^\s*objects_deleted_at\s+TIMESTAMPTZ", sql, re.MULTILINE | re.IGNORECASE
    )


def test_classified_count_column_added_idempotently(sql: str):
    """U2: the per-draft classification budget anchor. Added via an
    idempotent ALTER so pre-U2 local applies of this unreleased migration
    converge; NOT NULL DEFAULT 0 keeps budget math simple in the API."""
    assert re.search(
        r"ALTER TABLE public\.quiz\s+"
        r"ADD COLUMN IF NOT EXISTS classified_count INTEGER NOT NULL DEFAULT 0",
        sql,
    ), "quiz needs an idempotent classified_count INTEGER NOT NULL DEFAULT 0"


def test_funnel_counters_keyed_by_quiz_and_event(sql: str):
    """U12: one counter row per (quiz, event) so started-vs-completed per quiz
    is a single filtered read (KTD9: also the leaderboard harvest signal)."""
    assert re.search(
        r"PRIMARY KEY\s*\(\s*quiz_id\s*,\s*event\s*\)", sql
    ), "quiz_funnel needs PRIMARY KEY (quiz_id, event)"


def test_funnel_event_check_lists_exactly_the_four_events(sql: str):
    match = re.search(
        r"event\s+TEXT[^,]*CHECK\s*\(\s*event\s+IN\s*\(([^)]*)\)", sql, re.IGNORECASE
    )
    assert match, "quiz_funnel.event must be TEXT with an IN (...) CHECK constraint"
    events = set(re.findall(r"'([^']+)'", match.group(1)))
    assert events == FUNNEL_EVENTS


def test_funnel_increment_function_is_an_atomic_upsert(sql: str):
    """The API increments through ONE SQL function (insert-or-bump) so
    concurrent taps never lose counts to read-modify-write races."""
    assert re.search(
        r"CREATE OR REPLACE FUNCTION public\.increment_quiz_funnel\s*"
        r"\(\s*p_quiz_id\s+UUID\s*,\s*p_event\s+TEXT\s*\)",
        sql,
        re.IGNORECASE,
    ), "missing increment_quiz_funnel(p_quiz_id UUID, p_event TEXT)"
    assert re.search(
        r"ON CONFLICT\s*\(\s*quiz_id\s*,\s*event\s*\)\s*"
        r"DO UPDATE SET\s+count\s*=\s*(public\.)?quiz_funnel\.count\s*\+\s*1",
        sql,
        re.IGNORECASE,
    ), "increment_quiz_funnel must upsert via ON CONFLICT ... count + 1"


def test_funnel_increment_function_is_service_role_only(sql: str):
    """PostgREST exposes /rpc/ functions to anon by default; the counter bump
    must be callable only through the backend's service role."""
    assert re.search(
        r"REVOKE\s+(EXECUTE\s+)?(ALL\s+)?ON FUNCTION public\.increment_quiz_funnel"
        r"[^;]*FROM\s+PUBLIC",
        sql,
        re.IGNORECASE,
    ), "increment_quiz_funnel must revoke EXECUTE from PUBLIC"
    assert re.search(
        r"GRANT\s+EXECUTE\s+ON FUNCTION public\.increment_quiz_funnel"
        r"[^;]*TO\s+service_role",
        sql,
        re.IGNORECASE,
    ), "increment_quiz_funnel must grant EXECUTE to service_role"


def test_funnel_increment_function_pins_search_path(sql: str):
    """Migration 0053 retroactively pinned search_path on every LANGUAGE sql
    function; new functions must ship with it inline so an attacker-controlled
    search_path can never redirect the upsert's table references."""
    match = re.search(
        r"CREATE OR REPLACE FUNCTION public\.increment_quiz_funnel"
        r"[\s\S]*?AS \$increment_quiz_funnel\$",
        sql,
    )
    assert match, "missing increment_quiz_funnel definition"
    assert re.search(
        r"SET\s+search_path\s*=\s*public",
        match.group(0),
        re.IGNORECASE,
    ), "increment_quiz_funnel must SET search_path = public"


def test_all_indexes_are_idempotent(sql: str):
    bare = re.findall(r"CREATE (?:UNIQUE )?INDEX (?!IF NOT EXISTS)", sql)
    assert not bare, "every CREATE INDEX must use IF NOT EXISTS"


def test_correct_index_is_server_side_bounded(sql: str):
    assert re.search(
        r"correct_index\s+INTEGER NOT NULL CHECK\s*\(\s*correct_index BETWEEN 0 AND 3\s*\)",
        sql,
        re.IGNORECASE,
    ), "shuffled options need a server-only correct_index bounded to the 4 options"
