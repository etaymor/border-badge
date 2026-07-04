/**
 * Tests for useReducedMotion.
 *
 * Verifies the module-level shared listener behavior added in U11:
 * - Multiple mounted components register exactly ONE native
 *   `AccessibilityInfo` listener total (not one per instance).
 * - A `reduceMotionChanged` event propagates to every subscriber.
 * - The initial async value resolves and is reflected.
 * - The single native listener is torn down when the last subscriber unmounts.
 */

import { AccessibilityInfo, Text, View } from 'react-native';
import { act, render } from '@testing-library/react-native';

import { useReducedMotion } from '@hooks/useReducedMotion';

// --- AccessibilityInfo spies (spy on the real module, don't replace it) ------

let reduceMotionChangedCb: ((value: boolean) => void) | null = null;
const mockRemove = jest.fn();
let initialValue = false;

let addEventListenerSpy: jest.SpyInstance;
let isReduceMotionEnabledSpy: jest.SpyInstance;

function Probe({ onRender }: { onRender: (value: boolean) => void }) {
  const value = useReducedMotion();
  onRender(value);
  return <Text>{value ? 'reduced' : 'full'}</Text>;
}

beforeAll(() => {
  // Warm up RTL's host-component-name detection with a synchronous render so it
  // doesn't run (and get unmounted) inside our async act() blocks below, which
  // would otherwise throw "Can't access .root on unmounted test renderer".
  render(<Text>warmup</Text>).unmount();
});

beforeEach(() => {
  jest.clearAllMocks();
  reduceMotionChangedCb = null;
  initialValue = false;

  addEventListenerSpy = jest
    .spyOn(AccessibilityInfo, 'addEventListener')
    .mockImplementation((event: string, cb: (value: boolean) => void) => {
      if (event === 'reduceMotionChanged') {
        reduceMotionChangedCb = cb;
      }
      return { remove: mockRemove } as never;
    });

  isReduceMotionEnabledSpy = jest
    .spyOn(AccessibilityInfo, 'isReduceMotionEnabled')
    .mockImplementation(() => Promise.resolve(initialValue));
});

afterEach(() => {
  addEventListenerSpy.mockRestore();
  isReduceMotionEnabledSpy.mockRestore();
});

describe('useReducedMotion', () => {
  it('registers exactly ONE native listener for two mounted components', async () => {
    const onRenderA = jest.fn();
    const onRenderB = jest.fn();

    const view = render(
      <View>
        <Probe onRender={onRenderA} />
        <Probe onRender={onRenderB} />
      </View>
    );
    await act(async () => {}); // flush the initial async resolve

    // Two components, but only ONE shared native listener.
    expect(addEventListenerSpy).toHaveBeenCalledTimes(1);

    view.unmount();
  });

  it('propagates a reduceMotionChanged update to both components', async () => {
    const onRenderA = jest.fn();
    const onRenderB = jest.fn();

    const view = render(
      <View>
        <Probe onRender={onRenderA} />
        <Probe onRender={onRenderB} />
      </View>
    );
    await act(async () => {});

    // Both start with the resolved initial value (false).
    expect(onRenderA).toHaveBeenLastCalledWith(false);
    expect(onRenderB).toHaveBeenLastCalledWith(false);

    // Fire a native "reduce motion enabled" change.
    await act(async () => {
      reduceMotionChangedCb?.(true);
    });

    expect(onRenderA).toHaveBeenLastCalledWith(true);
    expect(onRenderB).toHaveBeenLastCalledWith(true);

    view.unmount();
  });

  it('reflects the initial async value once resolved', async () => {
    initialValue = true;
    const onRender = jest.fn();

    const view = render(<Probe onRender={onRender} />);
    await act(async () => {});

    expect(isReduceMotionEnabledSpy).toHaveBeenCalledTimes(1);
    expect(onRender).toHaveBeenLastCalledWith(true);

    view.unmount();
  });

  it('removes the shared native listener when the last subscriber unmounts', async () => {
    const onRender = jest.fn();

    const viewA = render(<Probe onRender={onRender} />);
    const viewB = render(<Probe onRender={onRender} />);
    await act(async () => {});

    expect(mockRemove).not.toHaveBeenCalled();

    viewA.unmount();
    // Still one subscriber left — listener stays.
    expect(mockRemove).not.toHaveBeenCalled();

    viewB.unmount();
    // Last subscriber gone — the single native listener is torn down.
    expect(mockRemove).toHaveBeenCalledTimes(1);
  });
});
