-- Migration: Quiz funnel reveal-first events
-- Purpose: Extend the quiz_funnel event vocabulary with the two reveal-first
--          steps the public play surface now records:
--            name_submitted -- the bind-once POST /q/{slug}/name succeeded
--                              (a reveal-first completion posted its score to
--                              the leaderboard after seeing it)
--            score_reshared -- a POST /q/{slug}/reshared tap (the player
--                              shared their result onward; every tap counts,
--                              mirroring install_cta_tap)
--
-- 0060 is applied in production, so its inline CHECK on quiz_funnel.event
-- exists under the Postgres auto-generated name quiz_funnel_event_check.
-- Extending an IN (...) CHECK means dropping and re-adding it; re-adding
-- under the SAME name keeps this drop-then-add pair rerunnable and preserves
-- the name for any future extension migration.
--
-- Wrapped in a DO block because the remote migration runner cannot prepare
-- multiple statements in one call.

DO $migration$
BEGIN
  ALTER TABLE public.quiz_funnel
    DROP CONSTRAINT IF EXISTS quiz_funnel_event_check;

  ALTER TABLE public.quiz_funnel
    ADD CONSTRAINT quiz_funnel_event_check
      CHECK (event IN (
        'page_view',
        'session_started',
        'session_completed',
        'install_cta_tap',
        'name_submitted',
        'score_reshared'
      ));

  COMMENT ON COLUMN public.quiz_funnel.event IS
    'Funnel step: page_view increments per render; session_started at '
    'session insert; session_completed at first completion; install_cta_tap '
    'per /q/{slug}/install redirect; name_submitted at the first successful '
    'bind-once name post; score_reshared per /q/{slug}/reshared tap.';
END;
$migration$;
