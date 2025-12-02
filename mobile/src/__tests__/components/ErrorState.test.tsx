import { fireEvent, render, screen } from '../utils/testUtils';

import { ErrorState } from '@components/ui/ErrorState';

describe('ErrorState', () => {
  it('renders with default title and message', () => {
    render(<ErrorState />);

    expect(screen.getByText('Something went wrong')).toBeTruthy();
    expect(screen.getByText('Please try again later.')).toBeTruthy();
  });

  it('renders with custom title and message', () => {
    render(<ErrorState title="Network Error" message="Could not connect to server" />);

    expect(screen.getByText('Network Error')).toBeTruthy();
    expect(screen.getByText('Could not connect to server')).toBeTruthy();
  });

  it('renders retry button when onRetry is provided', () => {
    const onRetry = jest.fn();
    render(<ErrorState onRetry={onRetry} />);

    expect(screen.getByText('Try Again')).toBeTruthy();
  });

  it('calls onRetry when retry button is pressed', () => {
    const onRetry = jest.fn();
    render(<ErrorState onRetry={onRetry} />);

    fireEvent.press(screen.getByText('Try Again'));

    expect(onRetry).toHaveBeenCalledTimes(1);
  });

  it('does not render retry button when onRetry is not provided', () => {
    render(<ErrorState />);

    expect(screen.queryByText('Try Again')).toBeNull();
  });

  it('renders with custom retry label', () => {
    const onRetry = jest.fn();
    render(<ErrorState onRetry={onRetry} retryLabel="Reload" />);

    expect(screen.getByText('Reload')).toBeTruthy();
    expect(screen.queryByText('Try Again')).toBeNull();
  });

  it('renders all props together', () => {
    const onRetry = jest.fn();
    render(
      <ErrorState
        title="Custom Error"
        message="Custom message"
        retryLabel="Retry Now"
        onRetry={onRetry}
      />
    );

    expect(screen.getByText('Custom Error')).toBeTruthy();
    expect(screen.getByText('Custom message')).toBeTruthy();
    expect(screen.getByText('Retry Now')).toBeTruthy();
  });
});
