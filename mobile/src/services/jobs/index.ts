/**
 * Public surface of the library job runtime.
 *
 * Job owners register descriptors; screens read the store; the app-state hook
 * drives resume. Nothing outside `services/jobs` should reach for the internal
 * modules directly.
 */

export * from './jobTypes';
export { registerJob, getDescriptor, allDescriptors } from './jobRegistry';
export type { JobDescriptor, JobStartInfo } from './jobRegistry';
export {
  isAnyLibraryJobRunning,
  isJobRunning,
  isScanRunning,
  isBackgroundSyncFlagSet,
  _setBackgroundSyncFlag,
  getRunningJobKind,
} from './jobRuntimeState';
export {
  startJob,
  cancelJob,
  markJobFailed,
  publishProgress,
  resetAllForUserChange,
  getJobStartedAt,
  getLastProgressAt,
  getCancelInFlight,
  getLastOptions,
} from './jobRuntime';
export { tryResumeJobs, tryResumeJob, detectStuckJobs } from './jobResume';
export type { ResumeOutcome } from './jobResume';
export { readDurableJob, clearDurableJob } from './jobDurableFlag';
export type { DurableJobRecord } from './jobDurableFlag';
export * from './jobGates';
