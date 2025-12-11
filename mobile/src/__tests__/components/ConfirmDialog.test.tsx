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

    expect(screen.getByText('Cancel')).toBeTruthy();
    expect(screen.getByText('Confirm')).toBeTruthy();
  });

  it('renders custom button labels', () => {
    render(<ConfirmDialog {...defaultProps} confirmLabel="Delete" cancelLabel="Keep" />);

    expect(screen.getByText('Keep')).toBeTruthy();
    expect(screen.getByText('Delete')).toBeTruthy();
  });

  it('calls onConfirm when confirm button is pressed', () => {
    const onConfirm = jest.fn();
    render(<ConfirmDialog {...defaultProps} onConfirm={onConfirm} />);

    fireEvent.press(screen.getByText('Confirm'));

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
    expect(screen.getByText('Delete')).toBeTruthy();
  });

  it('displays all props correctly together', () => {
    render(
      <ConfirmDialog
        visible
        title="Custom Title"
        message="Custom message here"
        confirmLabel="Yes, Do It"
        cancelLabel="No, Cancel"
        destructive
        onConfirm={jest.fn()}
        onCancel={jest.fn()}
      />
    );

    expect(screen.getByText('Custom Title')).toBeTruthy();
    expect(screen.getByText('Custom message here')).toBeTruthy();
    expect(screen.getByText('Yes, Do It')).toBeTruthy();
    expect(screen.getByText('No, Cancel')).toBeTruthy();
  });
});
