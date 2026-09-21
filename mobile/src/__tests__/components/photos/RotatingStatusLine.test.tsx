import { render as bareRender } from '@testing-library/react-native';

import { RotatingStatusLine } from '@components/photos/RotatingStatusLine';

import { act, render, screen } from '../../utils/testUtils';

const LINES = [
  'Reading where each photo was taken',
  'Everything stays on your device',
  'Keeps going',
] as const;

describe('RotatingStatusLine', () => {
  beforeEach(() => {
    jest.useFakeTimers({ doNotFake: ['setImmediate'] });
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('renders nothing when lines is empty', () => {
    // Bare render so provider wrappers do not mask a null return.
    const { toJSON } = bareRender(
      <RotatingStatusLine lines={[]} firstHoldMs={6000} holdMs={4000} reduceMotion={false} />
    );

    expect(toJSON()).toBeNull();
  });

  it('shows the first line and does not advance before firstHoldMs', () => {
    render(
      <RotatingStatusLine lines={LINES} firstHoldMs={6000} holdMs={4000} reduceMotion={false} />
    );

    expect(screen.getByText(LINES[0])).toBeTruthy();
    expect(screen.queryByText(LINES[1])).toBeNull();

    act(() => {
      jest.advanceTimersByTime(5999);
    });

    expect(screen.getByText(LINES[0])).toBeTruthy();
    expect(screen.queryByText(LINES[1])).toBeNull();
  });

  it('advances after firstHoldMs, then uses holdMs, then wraps', () => {
    render(
      <RotatingStatusLine lines={LINES} firstHoldMs={6000} holdMs={4000} reduceMotion={false} />
    );

    act(() => {
      jest.advanceTimersByTime(6000);
    });
    expect(screen.getByText(LINES[1])).toBeTruthy();
    expect(screen.queryByText(LINES[0])).toBeNull();

    act(() => {
      jest.advanceTimersByTime(3999);
    });
    expect(screen.getByText(LINES[1])).toBeTruthy();

    act(() => {
      jest.advanceTimersByTime(1);
    });
    expect(screen.getByText(LINES[2])).toBeTruthy();

    act(() => {
      jest.advanceTimersByTime(4000);
    });
    expect(screen.getByText(LINES[0])).toBeTruthy();
  });

  it('still advances on the same holds when reduceMotion is true', () => {
    render(<RotatingStatusLine lines={LINES} firstHoldMs={6000} holdMs={4000} reduceMotion />);

    expect(screen.getByText(LINES[0])).toBeTruthy();

    act(() => {
      jest.advanceTimersByTime(6000);
    });
    expect(screen.getByText(LINES[1])).toBeTruthy();

    act(() => {
      jest.advanceTimersByTime(4000);
    });
    expect(screen.getByText(LINES[2])).toBeTruthy();
  });

  it('renders exactly one Text with numberOfLines={1}', () => {
    render(
      <RotatingStatusLine lines={LINES} firstHoldMs={6000} holdMs={4000} reduceMotion={false} />
    );

    const line = screen.getByText(LINES[0]);
    expect(line.props.numberOfLines).toBe(1);
    expect(screen.getAllByText(LINES[0])).toHaveLength(1);
  });
});
