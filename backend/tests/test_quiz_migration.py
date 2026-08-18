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

MIGRATIONS_DIR = Path(__file__).resolve().parents[2] / "supabase" / "migrations"
MIGRATION_PATH = MIGRATIONS_DIR / "0060_travel_photo_quiz.sql"
FUNNEL_MIGRATION_PATH = MIGRATIONS_DIR / "0061_quiz_funnel_reveal_events.sql"
DROP_YEAR_MIGRATION_PATH = MIGRATIONS_DIR / "0062_quiz_remove_year_question.sql"

QUIZ_TABLES = [
    "quiz",
    "quiz_question",
    "quiz_session",
    "quiz_answer",
    "quiz_funnel",
    "quiz_daily_classification",
]

# The four original funnel steps shipped (and applied in production) by 0060.
FUNNEL_EVENTS_0060 = {
    "page_view",
    "session_started",
    "session_completed",
    "install_cta_tap",
}

# The CURRENT funnel vocabulary: 0060's four plus the reveal-first events
# added by 0061 (name_submitted at the bind-once name post, score_reshared at
# the post-completion reshare tap).
FUNNEL_EVENTS = FUNNEL_EVENTS_0060 | {
    "name_submitted",
    "score_reshared",
}

# Auto-generated name Postgres gave 0060's inline CHECK; 0061 must drop and
# re-add the constraint under this exact name.
FUNNEL_EVENT_CONSTRAINT = "quiz_funnel_event_check"

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


def test_funnel_event_check_in_0060_lists_its_original_four_events(sql: str):
    """0060 is APPLIED in production and therefore immutable: it must keep
    listing exactly the four events it shipped with. New events extend the
    constraint via 0061 (and successors), never by editing 0060."""
    match = re.search(
        r"event\s+TEXT[^,]*CHECK\s*\(\s*event\s+IN\s*\(([^)]*)\)", sql, re.IGNORECASE
    )
    assert match, "quiz_funnel.event must be TEXT with an IN (...) CHECK constraint"
    events = set(re.findall(r"'([^']+)'", match.group(1)))
    assert events == FUNNEL_EVENTS_0060


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


def test_seed_session_id_column_added_idempotently(sql: str):
    """Fix #18: the seeding session is persisted (set atomically with the
    score-to-beat seed) so rescoring never guesses via min(created_at).
    Plain nullable UUID, deliberately without an FK (loose coupling)."""
    match = re.search(
        r"ALTER TABLE public\.quiz\s+"
        r"ADD COLUMN IF NOT EXISTS seed_session_id UUID(.*)$",
        sql,
        re.MULTILINE,
    )
    assert match, "quiz needs an idempotent seed_session_id UUID column"
    assert "REFERENCES" not in match.group(1).upper(), (
        "seed_session_id must not carry an FK -- a missing session disables "
        "rescoring but must never block session cleanup"
    )
    assert (
        "NOT NULL" not in match.group(1).upper()
    ), "seed_session_id must be nullable (legacy rows seeded before it existed)"


def test_version_column_added_idempotently(sql: str):
    """Fix #7: the optimistic-concurrency counter pre-share edits bump and
    share asserts, making a stale share lose its conditional write."""
    assert re.search(
        r"ALTER TABLE public\.quiz\s+"
        r"ADD COLUMN IF NOT EXISTS version INTEGER NOT NULL DEFAULT 0",
        sql,
    ), "quiz needs an idempotent version INTEGER NOT NULL DEFAULT 0"


def test_daily_classification_counter_table_shape(sql: str):
    """Fixes #4/#9: the durable global daily spend counter -- one row per
    day, keyed on the date so the reserve function's upsert-then-update is
    race-free. Lives outside the quiz table so draft deletion cannot erase
    recorded spend. (RLS-on/no-policies is asserted by the QUIZ_TABLES loops.)
    """
    match = re.search(
        r"CREATE TABLE IF NOT EXISTS public\.quiz_daily_classification\s*\(([^;]*)\);",
        sql,
    )
    assert match, "missing quiz_daily_classification table"
    body = match.group(1)
    assert re.search(
        r"day\s+DATE PRIMARY KEY", body
    ), "quiz_daily_classification needs day DATE PRIMARY KEY"
    assert re.search(
        r"classified_count\s+INTEGER NOT NULL DEFAULT 0", body
    ), "quiz_daily_classification needs classified_count INTEGER NOT NULL DEFAULT 0"


def test_reserve_daily_classification_is_an_atomic_capped_reserve(sql: str):
    """The API's whole daily decision is ONE function call: insert the day
    row if absent, then a cap-guarded row-locking UPDATE -- concurrent
    workers serialize on the row lock, so the cap cannot be overshot."""
    match = re.search(
        r"CREATE OR REPLACE FUNCTION public\.reserve_daily_classification\s*"
        r"\(\s*p_count\s+INTEGER\s*,\s*p_cap\s+INTEGER\s*\)"
        r"[\s\S]*?\$reserve_daily_classification\$;",
        sql,
        re.IGNORECASE,
    )
    assert match, "missing reserve_daily_classification(p_count, p_cap)"
    fn = match.group(0)
    assert re.search(r"RETURNS\s+BOOLEAN", fn, re.IGNORECASE)
    assert re.search(
        r"ON CONFLICT\s*\(\s*day\s*\)\s*DO NOTHING", fn, re.IGNORECASE
    ), "the day row must be created idempotently (ON CONFLICT (day) DO NOTHING)"
    assert re.search(
        r"UPDATE public\.quiz_daily_classification[\s\S]*?"
        r"WHERE day = CURRENT_DATE AND classified_count \+ p_count <= p_cap",
        fn,
    ), "the UPDATE must be cap-guarded so a reserve past the cap matches no row"
    assert re.search(
        r"RETURN reserved IS NOT NULL", fn
    ), "the function must report whether the reservation succeeded"
    assert re.search(
        r"SET\s+search_path\s*=\s*public", fn, re.IGNORECASE
    ), "reserve_daily_classification must SET search_path = public"


def test_reserve_daily_classification_is_service_role_only(sql: str):
    """PostgREST exposes /rpc/ functions to anon by default; the reserve must
    be callable only through the backend's service role (mirrors
    increment_quiz_funnel)."""
    assert re.search(
        r"REVOKE\s+(EXECUTE\s+)?(ALL\s+)?ON FUNCTION "
        r"public\.reserve_daily_classification[^;]*FROM\s+PUBLIC",
        sql,
        re.IGNORECASE,
    ), "reserve_daily_classification must revoke EXECUTE from PUBLIC"
    assert re.search(
        r"GRANT\s+EXECUTE\s+ON FUNCTION public\.reserve_daily_classification"
        r"[^;]*TO\s+service_role",
        sql,
        re.IGNORECASE,
    ), "reserve_daily_classification must grant EXECUTE to service_role"


def test_leaderboard_composite_index_on_session(sql: str):
    """The leaderboard read (completed_public_sessions in quiz_leaderboard.py)
    scans every completed session per quiz; a (quiz_id, completed_at) composite
    index lets that filter use the index instead of a full per-quiz scan. The
    read stays unbounded on purpose (best-per-name needs every completed row),
    so this only speeds the scan."""
    assert re.search(
        r"CREATE INDEX IF NOT EXISTS \w+\s*"
        r"ON public\.quiz_session\s*\(\s*quiz_id\s*,\s*completed_at\s*\)",
        sql,
    ), "quiz_session needs a (quiz_id, completed_at) index for the leaderboard read"


def test_all_indexes_are_idempotent(sql: str):
    bare = re.findall(r"CREATE (?:UNIQUE )?INDEX (?!IF NOT EXISTS)", sql)
    assert not bare, "every CREATE INDEX must use IF NOT EXISTS"


def test_correct_index_is_server_side_bounded(sql: str):
    assert re.search(
        r"correct_index\s+INTEGER NOT NULL CHECK\s*\(\s*correct_index BETWEEN 0 AND 3\s*\)",
        sql,
        re.IGNORECASE,
    ), "shuffled options need a server-only correct_index bounded to the 4 options"


# ============================================================================
# 0061: reveal-first funnel events (name_submitted, score_reshared)
# ============================================================================


@pytest.fixture(scope="module")
def funnel_sql() -> str:
    assert FUNNEL_MIGRATION_PATH.exists(), f"missing migration: {FUNNEL_MIGRATION_PATH}"
    return FUNNEL_MIGRATION_PATH.read_text()


def _current_funnel_event_constraint() -> set[str]:
    """The event vocabulary the DATABASE enforces today: the LAST
    quiz_funnel event CHECK across all migrations in apply order.

    This is the tripwire that keeps code and schema in lockstep: adding a
    future event to the code vocabulary without shipping a migration leaves
    this set behind, and the cross-check tests below go red."""
    current: set[str] | None = None
    for path in sorted(MIGRATIONS_DIR.glob("[0-9][0-9][0-9][0-9]_*.sql")):
        text = path.read_text()
        if "quiz_funnel" not in text:
            continue
        for match in re.finditer(r"event\s+IN\s*\(([^)]*)\)", text, re.IGNORECASE):
            current = set(re.findall(r"'([^']+)'", match.group(1)))
    assert current is not None, "no migration defines the quiz_funnel event CHECK"
    return current


def test_0061_migration_number_is_unique():
    numbers = [
        int(p.name[:4]) for p in MIGRATIONS_DIR.glob("[0-9][0-9][0-9][0-9]_*.sql")
    ]
    assert numbers.count(61) == 1, "expected exactly one 0061 migration"


def test_0061_wrapped_in_do_migration_block(funnel_sql: str):
    assert "DO $migration$" in funnel_sql
    assert "$migration$;" in funnel_sql


def test_0061_drops_the_0060_constraint_by_name_idempotently(funnel_sql: str):
    """0060 is applied, so its inline CHECK exists under the Postgres
    auto-generated name. 0061 must drop it BY that name, IF EXISTS so the
    drop-then-add pair is rerunnable."""
    assert re.search(
        r"ALTER TABLE public\.quiz_funnel\s+"
        rf"DROP CONSTRAINT IF EXISTS {FUNNEL_EVENT_CONSTRAINT}",
        funnel_sql,
    ), f"0061 must DROP CONSTRAINT IF EXISTS {FUNNEL_EVENT_CONSTRAINT}"


def test_0061_readds_the_constraint_under_the_same_name(funnel_sql: str):
    """Re-adding under the SAME name keeps the drop-by-name idempotent on
    rerun and preserves the name for any future extension migration."""
    assert re.search(
        r"ALTER TABLE public\.quiz_funnel\s+"
        rf"ADD CONSTRAINT {FUNNEL_EVENT_CONSTRAINT}\s+CHECK",
        funnel_sql,
    ), f"0061 must ADD CONSTRAINT {FUNNEL_EVENT_CONSTRAINT} CHECK (...)"


def test_current_constraint_lists_exactly_the_six_events():
    assert _current_funnel_event_constraint() == FUNNEL_EVENTS


def test_code_vocabulary_matches_the_database_constraint():
    """The runtime event vocabulary (QuizFunnelEvent) and the DB CHECK must
    agree exactly -- an event added to code without a migration would be
    silently rejected by the constraint (best-effort writes swallow the
    error), so this mismatch must fail CI instead."""
    from typing import get_args

    from app.core.analytics import QuizFunnelEvent

    assert set(get_args(QuizFunnelEvent)) == _current_funnel_event_constraint()


# ============================================================================
# 0062: the year sub-question is removed (the quiz is country-only)
# ============================================================================


@pytest.fixture(scope="module")
def drop_year_sql() -> str:
    assert (
        DROP_YEAR_MIGRATION_PATH.exists()
    ), f"missing migration: {DROP_YEAR_MIGRATION_PATH}"
    return DROP_YEAR_MIGRATION_PATH.read_text()


def test_0062_is_wrapped_in_do_migration_block(drop_year_sql: str):
    assert "DO $migration$" in drop_year_sql


def test_0062_drops_the_paired_year_check_before_the_columns(drop_year_sql: str):
    """The CHECK references both columns, so it has to go first -- and by
    name, because 0060 named it explicitly."""
    drop_constraint = drop_year_sql.index("quiz_question_year_pair")
    drop_columns = drop_year_sql.index("DROP COLUMN IF EXISTS capture_year")
    assert "DROP CONSTRAINT IF EXISTS quiz_question_year_pair" in drop_year_sql
    assert drop_constraint < drop_columns


@pytest.mark.parametrize(
    ("table", "column"),
    [
        ("quiz_question", "capture_year"),
        ("quiz_question", "year_options"),
        ("quiz_answer", "selected_year"),
        ("quiz_answer", "year_correct"),
    ],
)
def test_0062_drops_every_year_column_idempotently(
    drop_year_sql: str, table: str, column: str
):
    assert (
        f"DROP COLUMN IF EXISTS {column}" in drop_year_sql
    ), f"{table}.{column} must be dropped idempotently"


def test_no_year_columns_survive_across_the_migration_set(sql: str, drop_year_sql: str):
    """The tripwire: 0060 creates the year columns and 0062 removes them, so
    the schema in apply order ends with none. Re-introducing one in 0060
    without a matching drop in 0062 fails here."""
    created = {
        match.group(1)
        for match in re.finditer(r"^\s{4}(\w*year\w*)\s+\w", sql, re.MULTILINE)
    }
    dropped = set(re.findall(r"DROP COLUMN IF EXISTS (\w+)", drop_year_sql))
    assert created, "expected 0060 to be the migration that created the year columns"
    assert created == dropped
