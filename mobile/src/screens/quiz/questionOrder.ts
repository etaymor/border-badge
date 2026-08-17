/**
 * Shared question ordering for the Guess Where screens: a stable ascending
 * sort by position, returned as a copy (the input is never mutated).
 */
export function sortQuestionsByPosition<T extends { position: number }>(
  questions: readonly T[]
): T[] {
  return [...questions].sort((a, b) => a.position - b.position);
}
