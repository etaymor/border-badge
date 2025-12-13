import { fireEvent, render, screen } from '../utils/testUtils';

import LiquidGlassTabBar from '@components/navigation/LiquidGlassTabBar';

// Mock expo-haptics
jest.mock('expo-haptics', () => ({
  impactAsync: jest.fn(),
  ImpactFeedbackStyle: { Light: 'light' },
}));

describe('LiquidGlassTabBar', () => {
  const createMockProps = (activeIndex = 0) => {
    const mockNavigation = {
      emit: jest.fn(() => ({ defaultPrevented: false })),
      navigate: jest.fn(),
    };

    const mockState = {
      index: activeIndex,
      routes: [
        { key: 'passport-key', name: 'Passport', params: undefined },
        { key: 'dreams-key', name: 'Dreams', params: undefined },
        { key: 'trips-key', name: 'Trips', params: undefined },
        { key: 'friends-key', name: 'Friends', params: undefined },
      ],
    };

    const mockDescriptors = {
      'passport-key': { options: { title: 'Passport' } },
      'dreams-key': { options: { title: 'Dreams' } },
      'trips-key': { options: { title: 'Trips' } },
      'friends-key': { options: { title: 'Friends' } },
    };

    return {
      state: mockState,
      descriptors: mockDescriptors,
      navigation: mockNavigation,
    } as unknown as Parameters<typeof LiquidGlassTabBar>[0];
  };

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('renders all tab items', () => {
    render(<LiquidGlassTabBar {...createMockProps()} />);

    expect(screen.getByTestId('tab-passport')).toBeTruthy();
    expect(screen.getByTestId('tab-dreams')).toBeTruthy();
    expect(screen.getByTestId('tab-trips')).toBeTruthy();
    expect(screen.getByTestId('tab-friends')).toBeTruthy();
  });

  it('marks the active tab as selected', () => {
    render(<LiquidGlassTabBar {...createMockProps(0)} />);

    const passportTab = screen.getByTestId('tab-passport');
    expect(passportTab.props.accessibilityState).toEqual({ selected: true });

    const dreamsTab = screen.getByTestId('tab-dreams');
    expect(dreamsTab.props.accessibilityState).toEqual({});
  });

  it('navigates to tab when pressed', () => {
    const props = createMockProps(0);
    render(<LiquidGlassTabBar {...props} />);

    fireEvent.press(screen.getByTestId('tab-dreams'));

    expect(props.navigation.emit).toHaveBeenCalledWith({
      type: 'tabPress',
      target: 'dreams-key',
      canPreventDefault: true,
    });
    expect(props.navigation.navigate).toHaveBeenCalledWith('Dreams', undefined);
  });

  it('does not navigate when pressing already active tab', () => {
    const props = createMockProps(0);
    render(<LiquidGlassTabBar {...props} />);

    fireEvent.press(screen.getByTestId('tab-passport'));

    expect(props.navigation.emit).toHaveBeenCalled();
    expect(props.navigation.navigate).not.toHaveBeenCalled();
  });

  it('emits tabLongPress event on long press', () => {
    const props = createMockProps(0);
    render(<LiquidGlassTabBar {...props} />);

    fireEvent(screen.getByTestId('tab-dreams'), 'longPress');

    expect(props.navigation.emit).toHaveBeenCalledWith({
      type: 'tabLongPress',
      target: 'dreams-key',
    });
  });

  it('has correct accessibility labels', () => {
    render(<LiquidGlassTabBar {...createMockProps()} />);

    expect(screen.getByTestId('tab-passport').props.accessibilityLabel).toBe('Passport tab');
    expect(screen.getByTestId('tab-dreams').props.accessibilityLabel).toBe('Dreams tab');
    expect(screen.getByTestId('tab-trips').props.accessibilityLabel).toBe('Trips tab');
    expect(screen.getByTestId('tab-friends').props.accessibilityLabel).toBe('Friends tab');
  });

  it('triggers haptic feedback on press', async () => {
    const Haptics = jest.requireMock('expo-haptics');
    const props = createMockProps(0);
    render(<LiquidGlassTabBar {...props} />);

    fireEvent.press(screen.getByTestId('tab-dreams'));

    expect(Haptics.impactAsync).toHaveBeenCalledWith(Haptics.ImpactFeedbackStyle.Light);
  });
});
