/**
 * backgroundJobTask - The iOS BGProcessingTask driver for library jobs.
 *
 * This is the phase the whole runtime was shaped for, and it adds NO job code:
 * every step already returns a durable checkpoint, and the runtime already owns
 * the loop over them. All this module does is (a) install a real `shouldYield`
 * so the loop stops politely when iOS says time is up, and (b) register a task
 * whose handler is the same `tryResumeJobs()` the foreground path calls.
 *
 * WHAT THIS DOES AND DOES NOT BUY. `BGProcessingTask` is scheduled by iOS
 * OPPORTUNISTICALLY — typically overnight, on charge, on WiFi. It cannot be
 * requested on demand, it may not run at all, and the user has no way to make
 * it happen. So this is a way for a long scan to make progress the user never
 * had to wait through; it is NOT a promise that anything runs while the app is
 * closed. `constants/scanCopy` still bans that claim, and its test still
 * enforces the ban. That is deliberate: the copy describes what a user can
 * RELY on, and nobody can rely on this.
 *
 * REQUIRES A NATIVE BUILD, AND MUST NOT BREAK THE ONE THAT IS SHIPPED.
 * `expo-background-task`'s config plugin adds `UIBackgroundModes:
 * ['processing']` and the permitted task identifier to Info.plist, so the task
 * cannot fire until an `eas build` goes out. But the JS around it CAN reach an
 * older binary over the air, and `expo-task-manager` throws at import when its
 * native module is missing. A static import here would therefore brick every
 * TestFlight build at launch the moment this bundle published — which is why
 * both modules are required LAZILY, inside a try/catch, and why the task is
 * defined there rather than at module scope. On a binary without them,
 * everything below is a no-op and foreground resume is completely unchanged.
 */

import { allDescriptors } from './jobRegistry';
import { tryResumeJobs } from './jobResume';
import { registerJobDriver } from './jobRuntimeState';
import { whenJobSettles } from './jobRuntime';

type TaskManagerModule = typeof import('expo-task-manager');
type BackgroundTaskModule = typeof import('expo-background-task');

/**
 * Our TaskManager task name. Deliberately NOT the BGTaskScheduler identifier —
 * that one (`com.expo.modules.backgroundtask.processing`) belongs to
 * `expo-background-task` itself, is what its config plugin writes into
 * `BGTaskSchedulerPermittedIdentifiers`, and is shared by every task the module
 * runs. This name is app-level and durable: TaskManager persists registrations
 * across launches, so renaming it would orphan the old one.
 */
export const BACKGROUND_JOB_TASK = 'atlasi.library-jobs.resume';

/** True only while the task handler below is on the stack. */
let executingInBackground = false;
/** Flipped by the expiration listener: iOS is about to reclaim the process. */
let expired = false;

/**
 * True only while the BGProcessingTask handler is on the stack. The
 * continued-processing lease driver reads this to refuse a lease for a job the
 * opportunistic task started: a lease may only be acquired from the foreground.
 */
export function isExecutingInBackgroundHandler(): boolean {
  return executingInBackground;
}

/**
 * Stop after the current unit of work — but only in the background, and only
 * once iOS has warned us.
 *
 * Deliberately NOT a time-budget estimate. iOS gives no reliable remaining-time
 * figure for a processing task, and a guess that fires early would turn a
 * finishable build into an unnecessary extra wake-up; a guess that fires late
 * would be killed mid-step anyway. The expiration handler is the one signal the
 * system actually provides, and because the checkpoint is written after every
 * unit, being killed without warning costs at most the unit in flight.
 *
 * Registered as a runtime driver. The `(kind, generation)` the loop asks about
 * is irrelevant here: whatever is running inside the handler is what the
 * handler started, and every run must stop once iOS has warned us.
 */
function shouldYield(): boolean {
  return executingInBackground && expired;
}

let removeDriver: (() => void) | null = null;

/**
 * Run the resume pass and WAIT for whatever it started.
 *
 * `startJob` is fire-and-forget by design — in the foreground a job outliving
 * its caller is the entire point. Here the opposite is true: returning from
 * this handler is what tells iOS the app may be suspended again, so returning
 * early would suspend the app mid-step every single time.
 */
async function runResumePass(): Promise<void> {
  await tryResumeJobs();
  await Promise.all(allDescriptors().map((descriptor) => whenJobSettles(descriptor.kind)));
}

/**
 * Require both native-backed modules, or null when this binary has neither.
 *
 * The null case is the OTA case and it is completely normal: JS that knows
 * about the task, running on an app built before the config plugin landed.
 */
function loadNativeModules(): {
  TaskManager: TaskManagerModule;
  BackgroundTask: BackgroundTaskModule;
} | null {
  try {
    /* eslint-disable @typescript-eslint/no-require-imports */
    const TaskManager = require('expo-task-manager') as TaskManagerModule;
    const BackgroundTask = require('expo-background-task') as BackgroundTaskModule;
    /* eslint-enable @typescript-eslint/no-require-imports */
    return { TaskManager, BackgroundTask };
  } catch {
    return null;
  }
}

function defineTask(TaskManager: TaskManagerModule, BackgroundTask: BackgroundTaskModule): void {
  TaskManager.defineTask(BACKGROUND_JOB_TASK, async () => {
    executingInBackground = true;
    expired = false;
    const subscription = BackgroundTask.addExpirationListener(() => {
      // The loop reads this between units and returns 'suspended', which leaves
      // the durable breadcrumb in place for the next wake-up or foreground.
      expired = true;
    });
    try {
      await runResumePass();
      return BackgroundTask.BackgroundTaskResult.Success;
    } catch (error) {
      console.warn(
        '[backgroundJobTask] Resume pass failed:',
        error instanceof Error ? error.message : error
      );
      return BackgroundTask.BackgroundTaskResult.Failed;
    } finally {
      subscription.remove();
      executingInBackground = false;
      expired = false;
    }
  });
}

let registration: Promise<void> | null = null;

/**
 * Define the task, register the yield driver, and ask iOS to schedule it.
 *
 * Call this as early as possible in app startup: TaskManager can hand back a
 * task the OS restored from a previous launch, and it has to be defined before
 * that happens.
 *
 * Idempotent and safe to call on every launch. Every failure is swallowed: on
 * a binary built before the plugin landed, on the simulator, and on a device
 * where the user has disabled Background App Refresh, registration simply does
 * not take — and everything still works exactly as it did, because foreground
 * resume is unchanged.
 */
export function registerBackgroundJobTask(): Promise<void> {
  if (registration) return registration;
  registration = (async () => {
    const native = loadNativeModules();
    if (!native) return;
    const { TaskManager, BackgroundTask } = native;

    defineTask(TaskManager, BackgroundTask);
    // Registered regardless of whether SCHEDULING succeeds: `shouldYield` is
    // gated on actually executing inside the handler, so a foreground run
    // still never yields.
    removeDriver?.();
    removeDriver = registerJobDriver({ shouldYield });

    try {
      const status = await BackgroundTask.getStatusAsync();
      if (status !== BackgroundTask.BackgroundTaskStatus.Available) return;
      if (await TaskManager.isTaskRegisteredAsync(BACKGROUND_JOB_TASK)) return;
      await BackgroundTask.registerTaskAsync(BACKGROUND_JOB_TASK);
    } catch (error) {
      if (__DEV__) {
        console.warn(
          '[backgroundJobTask] Scheduling unavailable:',
          error instanceof Error ? error.message : error
        );
      }
    }
  })();
  return registration;
}

/** Test-only. */
export function __resetBackgroundJobTaskForTesting(): void {
  registration = null;
  executingInBackground = false;
  expired = false;
  removeDriver?.();
  removeDriver = null;
}
