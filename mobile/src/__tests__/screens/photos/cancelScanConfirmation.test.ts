import { confirmCancelScan } from '../../../screens/photos/cancelScanConfirmation';

describe('confirmCancelScan', () => {
  beforeEach(() => {
    global.__mockAlert.alert.mockReset();
  });

  it('calls onConfirm directly when scan started <30s ago', () => {
    const onConfirm = jest.fn();
    confirmCancelScan(Date.now() - 5000, onConfirm);
    expect(onConfirm).toHaveBeenCalled();
    expect(global.__mockAlert.alert).not.toHaveBeenCalled();
  });

  it('calls onConfirm directly when scanStartedAt is null (banner case)', () => {
    const onConfirm = jest.fn();
    confirmCancelScan(null, onConfirm);
    expect(onConfirm).toHaveBeenCalled();
    expect(global.__mockAlert.alert).not.toHaveBeenCalled();
  });

  it('shows confirmation alert when scan has been running >30s', () => {
    const onConfirm = jest.fn();
    confirmCancelScan(Date.now() - 60_000, onConfirm);

    expect(onConfirm).not.toHaveBeenCalled();
    expect(global.__mockAlert.alert).toHaveBeenCalledWith(
      'Cancel Scan?',
      expect.stringContaining('in progress'),
      expect.any(Array)
    );

    // Press the destructive Cancel Scan button
    const buttons = global.__mockAlert.alert.mock.calls[0][2];
    const cancelBtn = buttons.find((b: { text: string }) => b.text === 'Cancel Scan');
    cancelBtn.onPress();
    expect(onConfirm).toHaveBeenCalled();
  });

  it('does not call onConfirm when user picks Keep Scanning', () => {
    const onConfirm = jest.fn();
    confirmCancelScan(Date.now() - 60_000, onConfirm);

    const buttons = global.__mockAlert.alert.mock.calls[0][2];
    const keepBtn = buttons.find((b: { text: string }) => b.text === 'Keep Scanning');
    // No onPress means tapping it just dismisses; verify by absence.
    expect(keepBtn.onPress).toBeUndefined();
    expect(onConfirm).not.toHaveBeenCalled();
  });
});
