import { fireEvent, render, screen, act } from '../utils/testUtils';

import { Snackbar } from '@components/ui/Snackbar';

// Mock timers for auto-dismiss testing
jest.useFakeTimers();

describe('Snackbar', () => {
  afterEach(() => {
    jest.clearAllTimers();
  });

  it('renders message when visible', () => {
    render(<Snackbar visible message="Item deleted" onDismiss={jest.fn()} />);

    expect(screen.getByText('Item deleted')).toBeTruthy();
  });

  it('does not render when not visible', () => {
    render(<Snackbar visible={false} message="Item deleted" onDismiss={jest.fn()} />);

    expect(screen.queryByText('Item deleted')).toBeNull();
  });

  it('renders action button when actionLabel and onAction provided', () => {
    render(
      <Snackbar
        visible
        message="Item deleted"
        actionLabel="Undo"
        onAction={jest.fn()}
        onDismiss={jest.fn()}
      />
    );

    expect(screen.getByText('Undo')).toBeTruthy();
  });

  it('calls onAction when action button is pressed', () => {
    const onAction = jest.fn();
    render(
      <Snackbar
        visible
        message="Item deleted"
        actionLabel="Undo"
        onAction={onAction}
        onDismiss={jest.fn()}
      />
    );

    fireEvent.press(screen.getByText('Undo'));

    expect(onAction).toHaveBeenCalledTimes(1);
  });

  it('does not render action button when actionLabel is missing', () => {
    render(<Snackbar visible message="Item deleted" onAction={jest.fn()} onDismiss={jest.fn()} />);

    expect(screen.queryByText('Undo')).toBeNull();
  });

  it('auto-dismisses after duration', () => {
    const onDismiss = jest.fn();
    render(<Snackbar visible message="Item deleted" onDismiss={onDismiss} duration={4000} />);

    expect(onDismiss).not.toHaveBeenCalled();

    act(() => {
      jest.advanceTimersByTime(4000);
    });

    expect(onDismiss).toHaveBeenCalledTimes(1);
  });

  it('does not auto-dismiss when duration is 0', () => {
    const onDismiss = jest.fn();
    render(<Snackbar visible message="Item deleted" onDismiss={onDismiss} duration={0} />);

    act(() => {
      jest.advanceTimersByTime(10000);
    });

    expect(onDismiss).not.toHaveBeenCalled();
  });

  it('uses default duration of 4000ms', () => {
    const onDismiss = jest.fn();
    render(<Snackbar visible message="Item deleted" onDismiss={onDismiss} />);

    act(() => {
      jest.advanceTimersByTime(3999);
    });
    expect(onDismiss).not.toHaveBeenCalled();

    act(() => {
      jest.advanceTimersByTime(1);
    });
    expect(onDismiss).toHaveBeenCalledTimes(1);
  });
});
