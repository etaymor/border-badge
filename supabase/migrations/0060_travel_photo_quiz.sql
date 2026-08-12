-- Migration: Travel Photo Quiz schema
-- Purpose: Persist owner-created photo quizzes, their questions, and public
--          play sessions. A quiz is auto-built from the owner's camera roll,
--          played first by the owner to set a score-to-beat, then shared at an
--          opaque random slug. Friends play anonymously; completed sessions form the
--          leaderboard, derived at READ time (never a stored best-score column).
--
-- Tables:
--   1. quiz           -- one row per created quiz (lifecycle state, nullable
--                        share slug, score-to-beat pair, revocation timestamps)
--   2. quiz_question  -- per-question photo + four pre-shuffled options with a
--                        server-only correct index, plus capture-year options
--   3. quiz_session   -- one play-through (opaque token, display name,
--                        server-computed score, owner-hide flag)
--   4. quiz_answer    -- one graded answer per (session, question); the UNIQUE
--                        constraint makes "each question grades at most once"
--                        a database guarantee
--
-- Security model: backend-only tables. RLS is enabled with NO user-facing
-- policies (mirrors places_search_cache in 0057_persistent_place_cache.sql):
-- anon/authenticated clients read zero rows; all reads and writes go through
-- the API using the service role key. Public serving is gated in the backend
-- on state and revoked_at.
--
-- Lifecycle: state is TEXT + CHECK (not a Postgres enum -- enums fight the
-- DO $migration$ idempotency pattern):
--   building -> awaiting_owner_play -> playable -> shared -> revoked
--
-- Wrapped in a DO block because the remote migration runner cannot prepare
-- multiple statements in one call.

DO $migration$
BEGIN
  ----------------------------------------------------------------------------
  -- 1. Quiz
  ----------------------------------------------------------------------------
  CREATE TABLE IF NOT EXISTS public.quiz (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    owner_id    UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    state       TEXT NOT NULL DEFAULT 'building'
                  CHECK (state IN (
                    'building',
                    'awaiting_owner_play',
                    'playable',
                    'shared',
                    'revoked'
                  )),
    -- Opaque share slug: secrets.token_hex(16), minted at share time.
    -- Nullable until then; never derived from names or trip data.
    slug        TEXT
                  CHECK (slug IS NULL OR slug ~ '^[0-9a-f]{32}$'),
    -- Score-to-beat: the owner's own result, captured together as a pair.
    score_to_beat_correct  INTEGER,
    score_to_beat_total    INTEGER,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    -- Revocation gates public serving the moment it is set; storage objects
    -- are deleted asynchronously and objects_deleted_at is only set after the
    -- storage prefix is verified empty.
    revoked_at          TIMESTAMPTZ,
    objects_deleted_at  TIMESTAMPTZ,
    CONSTRAINT quiz_score_to_beat_pair CHECK (
      (score_to_beat_correct IS NULL AND score_to_beat_total IS NULL)
      OR (score_to_beat_correct IS NOT NULL AND score_to_beat_total IS NOT NULL
          AND score_to_beat_correct >= 0
          AND score_to_beat_total >= score_to_beat_correct)
    )
  );

  -- Partial unique index: slugs are unique among shared quizzes, but the many
  -- not-yet-shared quizzes (slug IS NULL) coexist freely.
  CREATE UNIQUE INDEX IF NOT EXISTS idx_quiz_slug
    ON public.quiz(slug)
    WHERE slug IS NOT NULL;

  CREATE INDEX IF NOT EXISTS idx_quiz_owner
    ON public.quiz(owner_id);

  COMMENT ON TABLE public.quiz IS
    'Travel photo quizzes. Backend-only (service role); public serving gated '
    'on state + revoked_at in the API layer.';
  COMMENT ON COLUMN public.quiz.slug IS
    'Opaque random share slug (secrets.token_hex(16)); NULL until shared.';
  COMMENT ON COLUMN public.quiz.score_to_beat_correct IS
    'Owner''s correct-answer count, set together with score_to_beat_total.';
  COMMENT ON COLUMN public.quiz.objects_deleted_at IS
    'Set only after post-revocation storage deletion verified the prefix empty.';

  -- U2 (vision eligibility gate): server-side per-draft classification
  -- budget. Accumulates the number of images this draft has sent to the
  -- vision model; the API rejects batches that would exceed
  -- QUIZ_CLASSIFICATION_BUDGET_PER_QUIZ and derives the global daily
  -- circuit breaker from these counts. Idempotent ALTER (not part of the
  -- CREATE above) so environments that applied an earlier revision of this
  -- unreleased migration converge on the same schema.
  ALTER TABLE public.quiz
    ADD COLUMN IF NOT EXISTS classified_count INTEGER NOT NULL DEFAULT 0;

  COMMENT ON COLUMN public.quiz.classified_count IS
    'Images sent to the vision eligibility classifier for this draft; the '
    'API enforces the per-quiz budget and daily circuit breaker against it.';

  ----------------------------------------------------------------------------
  -- 2. Quiz questions (photo + pre-shuffled options, server-only answer key)
  ----------------------------------------------------------------------------
  CREATE TABLE IF NOT EXISTS public.quiz_question (
    id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    quiz_id       UUID NOT NULL REFERENCES public.quiz(id) ON DELETE CASCADE,
    position      INTEGER NOT NULL CHECK (position >= 0),
    storage_path  TEXT NOT NULL,
    -- Four place options, decoys generated server-side at creation and
    -- shuffled ONCE at creation; stored as an ordered JSONB array of strings.
    options       JSONB NOT NULL,
    -- Server-only answer key into the options array; never sent to players.
    correct_index INTEGER NOT NULL CHECK (correct_index BETWEEN 0 AND 3),
    -- Year sub-question: four years bracketing the capture year. NULL when the
    -- photo has no usable capture date.
    capture_year  INTEGER,
    year_options  JSONB,
    created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT quiz_question_position_unique UNIQUE (quiz_id, position),
    CONSTRAINT quiz_question_year_pair CHECK (
      (capture_year IS NULL AND year_options IS NULL)
      OR (capture_year IS NOT NULL AND year_options IS NOT NULL)
    )
  );

  CREATE INDEX IF NOT EXISTS idx_quiz_question_quiz
    ON public.quiz_question(quiz_id);

  COMMENT ON TABLE public.quiz_question IS
    'Quiz questions with pre-shuffled options and a server-only correct index. '
    'Backend-only (service role); the API strips correct_index and '
    'capture_year before serving to players.';
  COMMENT ON COLUMN public.quiz_question.options IS
    'Ordered JSONB array of four place-option strings, shuffled once at creation.';
  COMMENT ON COLUMN public.quiz_question.year_options IS
    'Ordered JSONB array of four candidate years bracketing capture_year.';

  ----------------------------------------------------------------------------
  -- 3. Play sessions (one per play-through; leaderboard derived at read time)
  ----------------------------------------------------------------------------
  CREATE TABLE IF NOT EXISTS public.quiz_session (
    id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    quiz_id       UUID NOT NULL REFERENCES public.quiz(id) ON DELETE CASCADE,
    -- Opaque bearer token identifying this session to the (anonymous) player.
    token         TEXT NOT NULL UNIQUE,
    display_name  TEXT,
    -- Server-computed running score; clients never submit scores.
    score         INTEGER NOT NULL DEFAULT 0 CHECK (score >= 0),
    completed_at  TIMESTAMPTZ,
    -- Owner-hide flag: hidden sessions are excluded from the leaderboard.
    hidden        BOOLEAN NOT NULL DEFAULT FALSE,
    created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
  );

  CREATE INDEX IF NOT EXISTS idx_quiz_session_quiz
    ON public.quiz_session(quiz_id);

  COMMENT ON TABLE public.quiz_session IS
    'Anonymous quiz play sessions. Backend-only (service role). Leaderboard is '
    'derived at read time from completed, non-hidden sessions -- there is no '
    'stored best-score column.';
  COMMENT ON COLUMN public.quiz_session.token IS
    'Opaque random bearer token minted server-side at session start.';

  ----------------------------------------------------------------------------
  -- 4. Answers (DB-enforced single grading per question per session)
  ----------------------------------------------------------------------------
  CREATE TABLE IF NOT EXISTS public.quiz_answer (
    id                     UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    session_id  UUID NOT NULL REFERENCES public.quiz_session(id) ON DELETE CASCADE,
    question_id UUID NOT NULL REFERENCES public.quiz_question(id) ON DELETE CASCADE,
    selected_option_index  INTEGER CHECK (
      selected_option_index IS NULL OR selected_option_index BETWEEN 0 AND 3
    ),
    selected_year          INTEGER,
    place_correct          BOOLEAN NOT NULL DEFAULT FALSE,
    year_correct           BOOLEAN NOT NULL DEFAULT FALSE,
    created_at             TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT quiz_answer_session_question_unique UNIQUE (session_id, question_id)
  );

  CREATE INDEX IF NOT EXISTS idx_quiz_answer_session
    ON public.quiz_answer(session_id);

  COMMENT ON TABLE public.quiz_answer IS
    'Graded answers, one row max per (session, question) -- the unique '
    'constraint makes double-grading impossible at the database level. '
    'Backend-only (service role).';

  ----------------------------------------------------------------------------
  -- 5. Funnel counters (U12: R12/R16 + KTD9)
  --
  -- One row per (quiz, event) with a running count, so "started vs completed
  -- per quiz" -- which is ALSO the leaderboard harvest-pattern signal (KTD9)
  -- -- is a single filtered read. Appended inside this DO block (precedent:
  -- the classified_count ALTER above) because 0060 is still unapplied in
  -- production; everything here is idempotent.
  --
  -- The API increments through increment_quiz_funnel() below: an atomic
  -- insert-or-bump, never a read-modify-write from the backend.
  ----------------------------------------------------------------------------
  CREATE TABLE IF NOT EXISTS public.quiz_funnel (
    quiz_id     UUID NOT NULL REFERENCES public.quiz(id) ON DELETE CASCADE,
    event       TEXT NOT NULL
                  CHECK (event IN (
                    'page_view',
                    'session_started',
                    'session_completed',
                    'install_cta_tap'
                  )),
    count       BIGINT NOT NULL DEFAULT 0 CHECK (count >= 0),
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (quiz_id, event)
  );

  COMMENT ON TABLE public.quiz_funnel IS
    'Per-quiz funnel counters (page views, sessions started/completed, '
    'install-CTA taps). Backend-only (service role); incremented exclusively '
    'via increment_quiz_funnel().';
  COMMENT ON COLUMN public.quiz_funnel.event IS
    'Funnel step: page_view increments per render; session_started at '
    'session insert; session_completed at first completion; install_cta_tap '
    'per /q/{slug}/install redirect.';

  -- Atomic counter bump. LANGUAGE sql (single statement) with a distinct
  -- dollar-quote tag so it nests inside this DO block.
  CREATE OR REPLACE FUNCTION public.increment_quiz_funnel(
    p_quiz_id UUID,
    p_event   TEXT
  )
  RETURNS VOID
  LANGUAGE sql
  SET search_path = public
  AS $increment_quiz_funnel$
    INSERT INTO public.quiz_funnel (quiz_id, event, count)
    VALUES (p_quiz_id, p_event, 1)
    ON CONFLICT (quiz_id, event)
    DO UPDATE SET count = public.quiz_funnel.count + 1, updated_at = now();
  $increment_quiz_funnel$;

  -- PostgREST exposes /rpc/ functions to anon by default (EXECUTE is granted
  -- to PUBLIC on creation). Counter bumps are backend-only: revoke from
  -- everyone, grant back to the service role alone.
  REVOKE EXECUTE ON FUNCTION public.increment_quiz_funnel(UUID, TEXT)
    FROM PUBLIC, anon, authenticated;
  GRANT EXECUTE ON FUNCTION public.increment_quiz_funnel(UUID, TEXT)
    TO service_role;

  ----------------------------------------------------------------------------
  -- 6. Concurrency hardening (appended -- 0060 is still unapplied in
  -- production; precedent: the classified_count ALTER and quiz_funnel above).
  ----------------------------------------------------------------------------

  -- Fix #18: persist WHICH owner session seeded the score-to-beat, set
  -- atomically in the same conditional patch that seeds the pair. Rescoring
  -- after swap/remove rescopes to this session instead of guessing
  -- min(created_at), which an abandoned earlier owner session could hijack.
  -- Plain nullable UUID, no FK: loose coupling -- a missing session simply
  -- disables rescoring, it must never block session cleanup.
  ALTER TABLE public.quiz
    ADD COLUMN IF NOT EXISTS seed_session_id UUID;

  COMMENT ON COLUMN public.quiz.seed_session_id IS
    'Owner session whose first completion seeded the score-to-beat pair; '
    'rescoring after swap/remove rescopes to this session. No FK on purpose '
    '(loose coupling); NULL only on legacy rows.';

  -- Fix #7 (mitigation): optimistic version for share-vs-edit exclusion.
  -- Pre-share edits (swap/remove) bump it with the read version in the
  -- predicate; share asserts the version it read in its playable->shared
  -- patch, so a share and a concurrent edit contend on the version.
  ALTER TABLE public.quiz
    ADD COLUMN IF NOT EXISTS version INTEGER NOT NULL DEFAULT 0;

  COMMENT ON COLUMN public.quiz.version IS
    'Optimistic-concurrency counter: bumped by pre-share question edits and '
    'asserted by share, so a stale share loses its conditional write.';

  -- Fixes #4/#9: durable, atomic global daily classification counter. One
  -- row per UTC day. Draft deletion cannot erase spend from it (unlike the
  -- old sum over quiz.classified_count), and the row-locking UPDATE in
  -- reserve_daily_classification() serializes concurrent reservations so
  -- the cap can never be overshot by racing workers.
  CREATE TABLE IF NOT EXISTS public.quiz_daily_classification (
    day               DATE PRIMARY KEY,
    classified_count  INTEGER NOT NULL DEFAULT 0
  );

  COMMENT ON TABLE public.quiz_daily_classification IS
    'Durable global daily vision-classification spend counter, reserved '
    'atomically via reserve_daily_classification(). Backend-only (service '
    'role); survives draft deletion.';

  -- Atomic reserve-or-deny. LANGUAGE plpgsql with a distinct dollar-quote
  -- tag so it nests inside this DO block. The UPDATE takes a row lock on
  -- the day row, so concurrent workers serialize: at most one of two racing
  -- near-cap reservations succeeds.
  CREATE OR REPLACE FUNCTION public.reserve_daily_classification(
    p_count INTEGER,
    p_cap   INTEGER
  )
  RETURNS BOOLEAN
  LANGUAGE plpgsql
  SET search_path = public
  AS $reserve_daily_classification$
  DECLARE reserved INTEGER;
  BEGIN
    INSERT INTO public.quiz_daily_classification (day, classified_count)
      VALUES (CURRENT_DATE, 0)
      ON CONFLICT (day) DO NOTHING;
    UPDATE public.quiz_daily_classification
      SET classified_count = classified_count + p_count
      WHERE day = CURRENT_DATE AND classified_count + p_count <= p_cap
      RETURNING classified_count INTO reserved;
    RETURN reserved IS NOT NULL;
  END;
  $reserve_daily_classification$;

  -- PostgREST exposes /rpc/ functions to anon by default (EXECUTE is granted
  -- to PUBLIC on creation). Reservations are backend-only: revoke from
  -- everyone, grant back to the service role alone (mirrors
  -- increment_quiz_funnel above).
  REVOKE EXECUTE ON FUNCTION public.reserve_daily_classification(INTEGER, INTEGER)
    FROM PUBLIC, anon, authenticated;
  GRANT EXECUTE ON FUNCTION public.reserve_daily_classification(INTEGER, INTEGER)
    TO service_role;

  ----------------------------------------------------------------------------
  -- RLS: backend-only tables, no user-facing policies (mirrors 0057 caches).
  -- Anon/authenticated selects return zero rows; all access via service role.
  ----------------------------------------------------------------------------
  ALTER TABLE public.quiz          ENABLE ROW LEVEL SECURITY;
  ALTER TABLE public.quiz_question ENABLE ROW LEVEL SECURITY;
  ALTER TABLE public.quiz_session  ENABLE ROW LEVEL SECURITY;
  ALTER TABLE public.quiz_answer   ENABLE ROW LEVEL SECURITY;
  ALTER TABLE public.quiz_funnel   ENABLE ROW LEVEL SECURITY;
  ALTER TABLE public.quiz_daily_classification ENABLE ROW LEVEL SECURITY;
END;
$migration$;
