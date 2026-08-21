-- Migration: Remove the Guess Where year sub-question
-- Purpose: The quiz is country-only. The "what year was this?" question ran
--          exclusively in the owner's own in-app play-through -- the public
--          /q/{slug} page, its JSON island, the unfurl card and every share
--          string have always been country-only by invariant -- and it fed
--          nothing but a private "Memory" card on the owner's results screen.
--          Dropping it halves the taps per photo and removes a whole column
--          family of ground truth from the backend-only tables.
--
--          Removed here:
--            quiz_question.capture_year  \
--            quiz_question.year_options   > plus the paired CHECK constraint
--            quiz_answer.selected_year
--            quiz_answer.year_correct
--
-- DEPLOY ORDER (opposite of 0061): deploy the backend FIRST, then apply this.
-- The new backend stops selecting and writing these columns; quiz_answer's
-- year_correct is NOT NULL DEFAULT FALSE, so omitting it from the insert is
-- safe while the columns still exist. Applying this migration against the OLD
-- backend would break every in-flight POST /quiz/{id}/answer.
--
-- No data is stranded: capture_year was derived on device from each photo's
-- own creationTime at creation time, so a future re-introduction re-derives
-- it rather than recovering it.
--
-- Wrapped in a DO block because the remote migration runner cannot prepare
-- multiple statements in one call.

DO $migration$
BEGIN
  ALTER TABLE public.quiz_question
    DROP CONSTRAINT IF EXISTS quiz_question_year_pair;

  ALTER TABLE public.quiz_question
    DROP COLUMN IF EXISTS capture_year,
    DROP COLUMN IF EXISTS year_options;

  ALTER TABLE public.quiz_answer
    DROP COLUMN IF EXISTS selected_year,
    DROP COLUMN IF EXISTS year_correct;

  COMMENT ON TABLE public.quiz_question IS
    'Quiz questions with pre-shuffled options and a server-only correct index. '
    'Backend-only (service role); the API strips correct_index before serving '
    'to players.';
END;
$migration$;
