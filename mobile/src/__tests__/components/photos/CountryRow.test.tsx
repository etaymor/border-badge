import { StyleSheet, View } from 'react-native';
import { useSharedValue, withSpring, withTiming } from 'react-native-reanimated';

import { CountryRow } from '@components/photos/CountryRow';

import { render, screen } from '../../utils/testUtils';

const renderSlot = (testID: string) =>
  function CountryRowTestSlot() {
    return <View testID={testID} />;
  };

describe('CountryRow', () => {
  it('renders the country stamp and name', () => {
    render(<CountryRow code="pt" name="Portugal" slots={[]} entering={false} reduceMotion />);

    expect(screen.getByTestId('country-row-stamp-PT').props.source).toBeTruthy();
    expect(screen.getByText('Portugal')).toBeTruthy();
  });

  it('renders only populated thumbnail slots without an empty placeholder frame', () => {
    render(
      <CountryRow
        code="PT"
        name="Portugal"
        slots={[renderSlot('preview-one')]}
        entering={false}
        reduceMotion
      />
    );

    expect(screen.getByTestId('preview-one')).toBeTruthy();
    expect(screen.getAllByTestId(/country-row-slot-/)).toHaveLength(1);
    expect(screen.queryByTestId('country-row-slot-1')).toBeNull();
    expect(StyleSheet.flatten(screen.getByTestId('country-row-slot-0').props.style)).toMatchObject({
      width: 56,
      height: 56,
    });
  });

  it('caps thumbnail content at two fixed slots', () => {
    render(
      <CountryRow
        code="PT"
        name="Portugal"
        slots={[renderSlot('preview-one'), renderSlot('preview-two'), renderSlot('preview-three')]}
        entering={false}
        reduceMotion
      />
    );

    expect(screen.getAllByTestId(/country-row-slot-/)).toHaveLength(2);
    expect(screen.queryByTestId('preview-three')).toBeNull();
  });

  it('renders the final static state and starts no animation with Reduce Motion', () => {
    render(
      <CountryRow
        code="JP"
        name="Japan"
        slots={[renderSlot('preview-one'), renderSlot('preview-two')]}
        entering
        reduceMotion
      />
    );

    expect(StyleSheet.flatten(screen.getByTestId('country-row-JP').props.style)).toMatchObject({
      opacity: 1,
      transform: [{ translateY: 0 }],
    });
    expect(StyleSheet.flatten(screen.getByTestId('country-row-slot-0').props.style)).toMatchObject({
      opacity: 1,
      transform: [{ translateX: 0 }, { translateY: 0 }, { scale: 1 }],
    });
    expect(withTiming).not.toHaveBeenCalled();
    expect(withSpring).not.toHaveBeenCalled();
  });

  it('starts row and slot entrance animations when entering with motion enabled', () => {
    render(
      <CountryRow
        code="MX"
        name="Mexico"
        slots={[renderSlot('preview-one')]}
        entering
        reduceMotion={false}
      />
    );

    expect(withTiming).toHaveBeenCalled();
    expect(withSpring).toHaveBeenCalled();
  });

  it('resets settled shared values before animating after entering flips true', () => {
    const { rerender } = render(
      <CountryRow
        code="MX"
        name="Mexico"
        slots={[renderSlot('preview-one'), renderSlot('preview-two')]}
        entering={false}
        reduceMotion={false}
      />
    );
    const [rowProgress, firstSlotProgress, secondSlotProgress] = jest
      .mocked(useSharedValue)
      .mock.results.slice(-3)
      .map((result) => result.value);

    jest.mocked(withTiming).mockImplementationOnce((value) => {
      expect(rowProgress.value).toBe(0);
      expect(firstSlotProgress.value).toBe(0);
      expect(secondSlotProgress.value).toBe(0);
      return value;
    });

    rerender(
      <CountryRow
        code="MX"
        name="Mexico"
        slots={[renderSlot('preview-one'), renderSlot('preview-two')]}
        entering
        reduceMotion={false}
      />
    );

    expect(withTiming).toHaveBeenCalled();
    expect(withSpring).toHaveBeenCalledTimes(2);
  });

  it('keeps the name and omits the stamp for an unknown code', () => {
    render(<CountryRow code="??" name="Unknown" slots={[]} entering={false} reduceMotion />);

    expect(screen.getByText('Unknown')).toBeTruthy();
    expect(screen.queryByTestId('country-row-stamp-??')).toBeNull();
  });
});
