/**
 * The BGProcessingTask driver.
 *
 * Three claims, each of which is a real way this can be wrong on a device
 * where none of it is observable:
 *
 *  1. The handler WAITS for the job it started. `startJob` is fire-and-forget
 *     by design; returning from a background-task handler is what tells iOS it
 *     may suspend the app, so returning early would suspend mid-step every
 *     single time and the task would never accomplish anything.
 *  2. `shouldYield` is false unless we are actually inside the handler AND iOS
 *     has warned us. A foreground build must never stop early.
 *  3. Registration failing is not an error. On a bundle running against a
 *     binary built before the plugin landed, on the simulator, or with
 *     Background App Refresh off, everything must keep working exactly as it
 *     did — foreground resume is unchanged.
 */

/**
 * What the module under test registered.
 *
 * Declared with `var` and NO initializer: the `jest.mock` factories below are
 * hoisted above this declaration, so a `let` would be in its temporal dead
 * zone and an initializer could wipe a capture that already happened. A bare
 * `var` is already `undefined`, so there is nothing to overwrite.
 */
// eslint-disable-next-line no-var
var mockCapture: {
  taskName?: string;
  task?: () => Promise<unknown>;
  onExpire?: () => void;
};

jest.mock('expo-task-manager', () => ({
  defineTask: jest.fn((name: string, fn: () => Promise<unknown>) => {
    mockCapture = { ...(mockCapture ?? {}), taskName: name, task: fn };
  }),
  isTaskRegisteredAsync: jest.fn(async () => false),
}));

jest.mock('expo-background-task', () => ({
  getStatusAsync: jest.fn(async () => 2),
  registerTaskAsync: jest.fn(async () => undefined),
  addExpirationListener: jest.fn((listener: () => void) => {
    mockCapture = { ...(mockCapture ?? {}), onExpire: listener };
    return { remove: jest.fn() };
  }),
  BackgroundTaskStatus: { Restricted: 1, Available: 2 },
  BackgroundTaskResult: { Success: 1, Failed: 2 },
}));

const mockTryResumeJobs = jest.fn(async () => ({}));
const mockWhenJobSettles = jest.fn(async (_kind: string) => undefined);
jest.mock('@services/jobs/jobResume', () => ({
  tryResumeJobs: () => mockTryResumeJobs(),
}));
jest.mock('@services/jobs/jobRuntime', () => ({
  whenJobSettles: (kind: string) => mockWhenJobSettles(kind),
}));
jest.mock('@services/jobs/jobRegistry', () => ({
  allDescriptors: () => [{ kind: 'trip-scan' }, { kind: 'quiz-build' }],
}));

import * as BackgroundTask from 'expo-background-task';
import * as TaskManager from 'expo-task-manager';

import {
  BACKGROUND_JOB_TASK,
  __resetBackgroundJobTaskForTesting,
  isExecutingInBackgroundHandler,
  registerBackgroundJobTask,
} from '@services/jobs/backgroundJobTask';
import { __resetJobRuntimeStateForTesting, shouldYieldNow } from '@services/jobs/jobRuntimeState';

const mockGetStatus = BackgroundTask.getStatusAsync as jest.Mock;
const mockRegisterTask = BackgroundTask.registerTaskAsync as jest.Mock;
const mockIsRegistered = TaskManager.isTaskRegisteredAsync as jest.Mock;

beforeEach(async () => {
  jest.clearAllMocks();
  __resetBackgroundJobTaskForTesting();
  __resetJobRuntimeStateForTesting();
  mockCapture = {};
  mockGetStatus.mockResolvedValue(BackgroundTask.BackgroundTaskStatus.Available);
  mockIsRegistered.mockResolvedValue(false);
  mockTryResumeJobs.mockResolvedValue({});
  mockWhenJobSettles.mockResolvedValue(undefined);
});

/** Register, then hand back the task the module defined. */
async function registered(): Promise<() => Promise<unknown>> {
  await registerBackgroundJobTask();
  return mockCapture.task!;
}

describe('backgroundJobTask', () => {
  it('does NOT touch the native modules until registration is asked for', () => {
    // The OTA hazard this guards: `expo-task-manager` throws at import when
    // its native module is missing, so a static import here would brick every
    // already-shipped build the moment this bundle published.
    expect(mockCapture.taskName).toBeUndefined();
    expect(TaskManager.defineTask).not.toHaveBeenCalled();
  });

  it('defines the task under an app-owned name once registered', async () => {
    await registerBackgroundJobTask();
    expect(mockCapture.taskName).toBe(BACKGROUND_JOB_TASK);
    // Not the BGTaskScheduler identifier, which belongs to the Expo module.
    expect(BACKGROUND_JOB_TASK).not.toContain('com.expo.modules');
  });

  it('waits for the resumed job before reporting the task done', async () => {
    let settled = false;
    mockWhenJobSettles.mockImplementation(async () => {
      settled = true;
      return undefined;
    });

    const result = await (await registered())();

    // If this were false, iOS would suspend the app the moment the handler
    // returned — mid-step, every time.
    expect(settled).toBe(true);
    expect(mockTryResumeJobs).toHaveBeenCalled();
    expect(result).toBe(BackgroundTask.BackgroundTaskResult.Success);
  });

  it('waits on every registered kind, not just the first', async () => {
    await (
      await registered()
    )();
    expect(mockWhenJobSettles).toHaveBeenCalledWith('trip-scan');
    expect(mockWhenJobSettles).toHaveBeenCalledWith('quiz-build');
  });

  it('reports a failed task rather than throwing out of the handler', async () => {
    mockTryResumeJobs.mockRejectedValue(new Error('resume blew up'));
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});

    const task = await registered();
    await expect(task()).resolves.toBe(BackgroundTask.BackgroundTaskResult.Failed);

    warn.mockRestore();
  });

  describe('shouldYield', () => {
    it('is false in the foreground even after registration', async () => {
      await registerBackgroundJobTask();
      expect(shouldYieldNow('trip-scan', 1)).toBe(false);
    });

    it('is false inside the handler until iOS actually warns us', async () => {
      const task = await registered();
      mockWhenJobSettles.mockImplementation(async () => {
        // Executing in the background, but no expiration yet.
        expect(shouldYieldNow('trip-scan', 1)).toBe(false);
        return undefined;
      });

      await task();
    });

    it('becomes true once the expiration listener fires', async () => {
      const task = await registered();
      mockWhenJobSettles.mockImplementation(async () => {
        mockCapture.onExpire?.();
        expect(shouldYieldNow('trip-scan', 1)).toBe(true);
        return undefined;
      });

      await task();

      // ...and goes back to false once the handler is off the stack, so the
      // next foreground run is unaffected.
      expect(shouldYieldNow('trip-scan', 1)).toBe(false);
    });
  });

  describe('isExecutingInBackgroundHandler', () => {
    it('is true only while the handler is on the stack', async () => {
      expect(isExecutingInBackgroundHandler()).toBe(false);
      const task = await registered();
      mockWhenJobSettles.mockImplementation(async () => {
        expect(isExecutingInBackgroundHandler()).toBe(true);
        return undefined;
      });
      await task();
      expect(isExecutingInBackgroundHandler()).toBe(false);
    });
  });

  describe('registration', () => {
    it('registers once, however many times it is called', async () => {
      await registerBackgroundJobTask();
      await registerBackgroundJobTask();
      expect(mockRegisterTask).toHaveBeenCalledTimes(1);
    });

    it('does not re-register a task TaskManager already restored', async () => {
      mockIsRegistered.mockResolvedValue(true);
      await registerBackgroundJobTask();
      expect(mockRegisterTask).not.toHaveBeenCalled();
    });

    it('gives up quietly when background tasks are restricted', async () => {
      mockGetStatus.mockResolvedValue(BackgroundTask.BackgroundTaskStatus.Restricted);

      await expect(registerBackgroundJobTask()).resolves.toBeUndefined();
      expect(mockRegisterTask).not.toHaveBeenCalled();
    });

    it('survives a binary that has no background-task modules at all', async () => {
      // The full OTA case: `expo-task-manager` throws on require because its
      // native module is missing. Registration must be a quiet no-op, not a
      // crash — this is the difference between a dud feature and a bricked app.
      jest.resetModules();
      jest.doMock('expo-task-manager', () => {
        throw new Error("Cannot find native module 'ExpoTaskManager'");
      });

      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const fresh = require('@services/jobs/backgroundJobTask') as {
        registerBackgroundJobTask: () => Promise<void>;
      };
      await expect(fresh.registerBackgroundJobTask()).resolves.toBeUndefined();

      jest.dontMock('expo-task-manager');
      jest.resetModules();
    });

    it('survives a binary where scheduling is unavailable', async () => {
      mockGetStatus.mockRejectedValue(new Error('ExpoBackgroundTask not found'));

      await expect(registerBackgroundJobTask()).resolves.toBeUndefined();
      // The foreground still behaves exactly as it did.
      expect(shouldYieldNow('trip-scan', 1)).toBe(false);
    });
  });
});
