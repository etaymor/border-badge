/**
 * Shared types for the Guess Where creation pipeline.
 *
 * These live apart from the orchestration so the pipeline's stages (draft
 * store, classification, upload) can depend on the vocabulary without
 * depending on each other or on `quizCreation.ts` itself.
 */

export type QuizCreationStep = 'scanning' | 'checking' | 'building';

export interface QuizCreationProgress {
  step: QuizCreationStep;
  current?: number;
  total?: number;
  /**
   * Local URIs of the photos LOCKED into the game so far, in the order their
   * slots were filled (so `current === pickUris.length` on hunt emissions).
   * Lets the creation screen render the game live: hero = the most recent
   * find, thumbnails = every slot in order.
   *
   * APPEND-ONLY for the whole run, hunt and upload alike: the game is decided
   * as photos are found (see `pickLedger.ts`), so a photo the screen has shown
   * is never replaced, reordered, or dropped. Absent on 'scanning' emissions
   * (nothing has been found yet).
   */
  pickUris?: string[];
  /**
   * Photos put through the eligibility gate so far. Purely informational -
   * a single batch can take most of a minute, and this is the only number
   * that moves during one.
   */
  examined?: number;
}

export type QuizCreationOutcome =
  /** Quiz finalized; awaiting owner play. */
  | { status: 'created'; quizId: string; photoCount: number }
  /** Genuine thin library (AE2). hasGeoCandidates distinguishes "no geotagged
   * travel photos at all" from "photos exist but too few passed the gate";
   * dominantReason names WHY the checked photos failed so the decline screen
   * can say something better than "too few passed those checks". */
  | {
      status: 'thin-library';
      eligibleCount: number;
      hasGeoCandidates: boolean;
      dominantReason?: string | null;
    }
  /** Retryable service failure - DISTINCT from a thin-library decline. */
  | { status: 'service-error'; stage: 'scan' | 'classify' }
  /** Upload/finalize interrupted; a resumable draft is persisted locally. */
  | { status: 'interrupted'; quizId: string; uploadedCount: number; totalCount: number }
  /** Caller aborted; any persisted draft state is left resumable. */
  | { status: 'cancelled' };

export interface CreateQuizOptions {
  onProgress?: (progress: QuizCreationProgress) => void;
  signal?: AbortSignal;
}

export interface DraftPick {
  assetId: string;
  uri: string;
  countryCode: string;
  storagePath: string | null;
  uploaded: boolean;
  landscape?: string | null;
}

export interface QuizDraftState {
  quizId: string;
  createdAt: number;
  /** Empty until final picks are chosen; uploads flip `uploaded` per photo. */
  picks: DraftPick[];
}
