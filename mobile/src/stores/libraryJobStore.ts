/**
 * libraryJobStore - Scalar snapshot of the in-progress library jobs.
 *
 * Replaces the former `photoScanStore`, generalized from one scan to a map
 * keyed by `LibraryJobKind`. Holds ONLY scalar/JSON-friendly state that
 * subscribers render: phase, progress, failure, hasResult, and a small per-kind
 * `detail`.
 *
 * The heavyweight payloads stay on module-level refs inside each job owner —
 * the trip scan's result Maps (5-10MB for large libraries) in `photoScanService`,
 * the quiz build's pool/ledger/session in `quizBuildJob`. Callers retrieve them
 * via that owner's `consume*()`, which atomically returns and clears.
 *
 * IMPORTANT: This store MUST NOT use `persist` middleware. It holds ephemeral
 * session state only. Persisting would silently round-trip Maps to `{}` if
 * anyone ever extends the schema, `phase` / `progress` are meaningless across
 * launches anyway, and the quiz slice's `pickUris` are local `file://` URIs
 * that go stale. The actual durable job state is `job:<kind>:state` in the
 * SQLite metadata table (see `services/jobs/jobDurableFlag`).
 */

import { create } from 'zustand';

import type { JobFailure, JobPhase, JobProgress, LibraryJobKind } from '@services/jobs/jobTypes';
import type { DiscoveredCountry, ScanProgress } from '@services/photoImport';

/** Where the banner should navigate when a finished job is tapped. */
export interface JobResultRoute {
  screen: string;
  params?: Record<string, unknown>;
}

export interface TripScanDetail {
  discoveredCountries: DiscoveredCountry[];
  isIncremental: boolean;
}

/** Sub-step of a quiz build, mirroring `QuizCreationProgress['step']`. */
export type QuizBuildStep = 'scanning' | 'checking' | 'building';

export interface QuizBuildDetail {
  step: QuizBuildStep;
  /** Append-only locked slot URIs, in question order. At most 10 short strings. */
  pickUris: string[];
  /** Photos put through the eligibility gate so far. Open-ended by design. */
  examined: number;
}

export interface LibraryJobSlice<P, D> {
  phase: JobPhase;
  progress: P | null;
  failure: JobFailure | null;
  hasResult: boolean;
  startedAt: number | null;
  /** Set when a job finishes and the banner needs somewhere to send the user. */
  resultRoute: JobResultRoute | null;
  detail: D;
}

export interface LibraryJobState {
  jobs: {
    'trip-scan': LibraryJobSlice<ScanProgress, TripScanDetail>;
    'quiz-build': LibraryJobSlice<JobProgress, QuizBuildDetail>;
  };
}

const emptySlice = {
  phase: 'idle' as JobPhase,
  progress: null,
  failure: null,
  hasResult: false,
  startedAt: null,
  resultRoute: null,
};

const initialState: LibraryJobState = {
  jobs: {
    'trip-scan': {
      ...emptySlice,
      detail: { discoveredCountries: [], isIncremental: false },
    },
    'quiz-build': {
      ...emptySlice,
      detail: { step: 'scanning', pickUris: [], examined: 0 },
    },
  },
};

/**
 * Internal-use store. The runtime and job owners are the only callers of the
 * write paths below. Subscribers should use the selectors.
 */
export const useLibraryJobStore = create<LibraryJobState>(() => initialState);

/** Reset every job slice. Called on cancel/idle transitions and user change. */
export function resetLibraryJobStore(): void {
  useLibraryJobStore.setState(structuredCloneInitial(), true);
}

/** Reset a single job slice, leaving the other kind untouched. */
export function resetJobSlice(kind: LibraryJobKind): void {
  const fresh = structuredCloneInitial();
  useLibraryJobStore.setState((s) => ({
    jobs: { ...s.jobs, [kind]: fresh.jobs[kind] },
  }));
}

/** Shallow-merge a patch into one job's slice. */
export function patchJobSlice(kind: LibraryJobKind, patch: Record<string, unknown>): void {
  useLibraryJobStore.setState((s) => ({
    jobs: { ...s.jobs, [kind]: { ...s.jobs[kind], ...patch } },
  }));
}

// Fresh object graph each time so a mutation of one reset can't leak into the next.
function structuredCloneInitial(): LibraryJobState {
  return {
    jobs: {
      'trip-scan': {
        ...emptySlice,
        detail: { discoveredCountries: [], isIncremental: false },
      },
      'quiz-build': {
        ...emptySlice,
        detail: { step: 'scanning', pickUris: [], examined: 0 },
      },
    },
  };
}

// ---------------------------------------------------------------------------
// Selectors - narrow subscriptions reduce re-renders during high-frequency
// progress updates. The quiz build emits per classified image, so this
// discipline matters more now than it did for the scan alone.
// ---------------------------------------------------------------------------

export const selectTripScan = (s: LibraryJobState) => s.jobs['trip-scan'];
export const selectQuizBuild = (s: LibraryJobState) => s.jobs['quiz-build'];

export const selectScanPhase = (s: LibraryJobState) => s.jobs['trip-scan'].phase;
export const selectScanProgress = (s: LibraryJobState) => s.jobs['trip-scan'].progress;
export const selectScanFailure = (s: LibraryJobState) => s.jobs['trip-scan'].failure;
export const selectScanHasResult = (s: LibraryJobState) => s.jobs['trip-scan'].hasResult;
export const selectScanDiscoveredCountries = (s: LibraryJobState) =>
  s.jobs['trip-scan'].detail.discoveredCountries;
export const selectScanIsIncremental = (s: LibraryJobState) =>
  s.jobs['trip-scan'].detail.isIncremental;

export const selectQuizPhase = (s: LibraryJobState) => s.jobs['quiz-build'].phase;
export const selectQuizProgress = (s: LibraryJobState) => s.jobs['quiz-build'].progress;
export const selectQuizDetail = (s: LibraryJobState) => s.jobs['quiz-build'].detail;
export const selectQuizFailure = (s: LibraryJobState) => s.jobs['quiz-build'].failure;
export const selectQuizHasResult = (s: LibraryJobState) => s.jobs['quiz-build'].hasResult;

/** Normalized view for kind-agnostic consumers (the persistent banner). */
export interface ActiveJobView {
  kind: LibraryJobKind;
  phase: JobPhase;
  percentage: number;
  failure: JobFailure | null;
  hasResult: boolean;
  resultRoute: JobResultRoute | null;
}

/**
 * The job the banner should render: the running/waiting one, else the most
 * recent terminal one. Jobs are mutually exclusive, so at most one is active;
 * the tie-break only matters when one finished and the other has yet to start.
 *
 * NOT a hook selector. It builds a fresh object on every call, and zustand v5
 * hands the selector to `useSyncExternalStore`, which treats a new object as a
 * new snapshot on every render. Subscribe to `s.jobs` (stable between writes)
 * and call this inside a `useMemo` keyed on it.
 */
export function selectActiveJob(s: LibraryJobState): ActiveJobView | null {
  const kinds: LibraryJobKind[] = ['trip-scan', 'quiz-build'];
  let terminal: ActiveJobView | null = null;
  let terminalStartedAt = -1;

  for (const kind of kinds) {
    const slice = s.jobs[kind];
    if (slice.phase === 'idle') continue;
    const view: ActiveJobView = {
      kind,
      phase: slice.phase,
      percentage: slice.progress?.percentage ?? 0,
      failure: slice.failure,
      hasResult: slice.hasResult,
      resultRoute: slice.resultRoute,
    };
    if (slice.phase === 'running' || slice.phase === 'waiting') return view;
    if ((slice.startedAt ?? 0) > terminalStartedAt) {
      terminalStartedAt = slice.startedAt ?? 0;
      terminal = view;
    }
  }
  return terminal;
}
