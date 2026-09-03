import { phaseFromStatus } from '../../permissions/photoLibraryPermission';

describe('phaseFromStatus', () => {
  it('maps undetermined to soft-ask', () => {
    expect(phaseFromStatus('undetermined')).toBe('soft-ask');
  });

  it('maps denied to blocked-settings', () => {
    expect(phaseFromStatus('denied')).toBe('blocked-settings');
  });

  it('maps granted to ready', () => {
    expect(phaseFromStatus('granted')).toBe('ready');
    expect(phaseFromStatus('granted', { forceRecovery: true })).toBe('ready');
  });

  it('maps limited to ready unless forceRecovery', () => {
    expect(phaseFromStatus('limited')).toBe('ready');
    expect(phaseFromStatus('limited', { forceRecovery: true })).toBe('recovery');
  });
});
