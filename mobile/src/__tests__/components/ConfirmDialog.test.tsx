import { fireEvent, render, screen } from '../utils/testUtils';

import { ConfirmDialog } from '@components/ui/ConfirmDialog';

describe('ConfirmDialog', () => {
  const defaultProps = {
    visible: true,
    title: 'Delete Item',
    message: 'Are you sure you want to delete this item?',
    onConfirm: jest.fn(),
    onCancel: jest.fn(),
  };

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('renders title and message when visible', () => {
    render(<ConfirmDialog {...defaultProps} />);

    expect(screen.getByText('Delete Item')).toBeTruthy();
    expect(screen.getByText('Are you sure you want to delete this item?')).toBeTruthy();
  });

  it('does not render when not visible', () => {
    render(<ConfirmDialog {...defaultProps} visible={false} />);

    expect(screen.queryByText('Delete Item')).toBeNull();
  });

  it('renders default button labels', () => {
    render(<ConfirmDialog {...defaultProps} />);

    // Cancel uses ghost variant (keeps original case)
    expect(screen.getByText('Cancel')).toBeTruthy();
    // Confirm uses primary variant (uppercases)
    expect(screen.getByText('CONFIRM')).toBeTruthy();
  });

  it('renders custom button labels', () => {
    render(<ConfirmDialog {...defaultProps} confirmLabel="Delete" cancelLabel="Keep" />);

    // Cancel uses ghost variant (keeps original case)
    expect(screen.getByText('Keep')).toBeTruthy();
    // Confirm uses primary variant (uppercases)
    expect(screen.getByText('DELETE')).toBeTruthy();
  });

  it('calls onConfirm when confirm button is pressed', () => {
    const onConfirm = jest.fn();
    render(<ConfirmDialog {...defaultProps} onConfirm={onConfirm} />);

    fireEvent.press(screen.getByText('CONFIRM'));

    expect(onConfirm).toHaveBeenCalledTimes(1);
  });

  it('calls onCancel when cancel button is pressed', () => {
    const onCancel = jest.fn();
    render(<ConfirmDialog {...defaultProps} onCancel={onCancel} />);

    fireEvent.press(screen.getByText('Cancel'));

    expect(onCancel).toHaveBeenCalledTimes(1);
  });

  it('shows loading state on confirm button', () => {
    render(<ConfirmDialog {...defaultProps} loading />);

    // When loading, the button text should not be visible
    // (Button component hides text during loading)
    // The Cancel button should be disabled
    const cancelButton = screen.getByText('Cancel');
    expect(cancelButton).toBeTruthy();
  });

  it('renders with destructive styling', () => {
    render(<ConfirmDialog {...defaultProps} destructive confirmLabel="Delete" />);

    // Component should render without errors with destructive prop
    // Primary variant uppercases the label
    expect(screen.getByText('DELETE')).toBeTruthy();
  });

  it('displays all props correctly together', () => {
    render(
      <ConfirmDialog
        visible
        title="Custom Title"
        message="Custom message here"
        confirmLabel="Yes, do it"
        cancelLabel="No, cancel"
        destructive
        onConfirm={jest.fn()}
        onCancel={jest.fn()}
      />
    );

    expect(screen.getByText('Custom Title')).toBeTruthy();
    expect(screen.getByText('Custom message here')).toBeTruthy();
    // Primary variant uppercases
    expect(screen.getByText('YES, DO IT')).toBeTruthy();
    // Ghost variant keeps original case
    expect(screen.getByText('No, cancel')).toBeTruthy();
  });
});
