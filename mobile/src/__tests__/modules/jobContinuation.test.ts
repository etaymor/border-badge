/**
 * The native module is absent in Jest exactly as it is on Android and in any
 * app binary built before it existed. That absence is the contract the lease
 * driver leans on: the TypeScript half ships over-the-air first and must no-op
 * cleanly until the binary catches up (KTD10, R11).
 */

import {
  addLeaseExpiredListener,
  addLeaseStateListener,
  backgroundRefreshStatus,
  beginLease,
  endLease,
  isJobContinuationAvailable,
  jobContinuationCapabilities,
  updateLeaseProgress,
  updateLeaseTitle,
} from '@modules/job-continuation';

describe('job-continuation module surface (module absent)', () => {
  it('reports unavailable when the native module is not linked', () => {
    expect(isJobContinuationAvailable()).toBe(false);
  });

  it('reports no capabilities rather than throwing', () => {
    expect(jobContinuationCapabilities()).toEqual({
      continuedProcessing: false,
      graceWindow: false,
    });
  });

  it('begin / updateProgress / updateTitle / end resolve without throwing', async () => {
    await expect(beginLease({ title: 't', subtitle: 's' })).resolves.toEqual({
      leaseId: '',
      state: 'unavailable',
    });
    expect(() => updateLeaseProgress(3, 10)).not.toThrow();
    expect(() => updateLeaseTitle('t', 's')).not.toThrow();
    await expect(endLease(true)).resolves.toBeUndefined();
    await expect(backgroundRefreshStatus()).resolves.toBe('unknown');
  });

  it('event subscriptions return a remover and do not throw', () => {
    const removeState = addLeaseStateListener(() => {});
    const removeExpired = addLeaseExpiredListener(() => {});
    expect(() => removeState()).not.toThrow();
    expect(() => removeExpired()).not.toThrow();
  });
});

describe('job-continuation on Android', () => {
  it('never asks for the native module', () => {
    jest.resetModules();
    jest.doMock('react-native', () => ({ Platform: { OS: 'android' } }));
    const requireOptionalNativeModule = jest.fn(() => null);
    jest.doMock('expo-modules-core', () => ({ requireOptionalNativeModule }));

    type Surface = typeof import('@modules/job-continuation');
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const fresh = require('@modules/job-continuation') as Surface;
    expect(fresh.isJobContinuationAvailable()).toBe(false);
    expect(requireOptionalNativeModule).not.toHaveBeenCalled();

    jest.dontMock('react-native');
    jest.dontMock('expo-modules-core');
    jest.resetModules();
  });
});
