import { fireEvent, render, screen } from '@testing-library/react-native';

import { SegmentedTabs } from '@components/ui/SegmentedTabs';

describe('SegmentedTabs', () => {
  const defaultProps = {
    tabs: ['Tab 1', 'Tab 2'],
    selectedIndex: 0,
    onSelect: jest.fn(),
  };

  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('basic rendering', () => {
    it('renders all tabs', () => {
      render(<SegmentedTabs {...defaultProps} />);

      expect(screen.getByText('Tab 1')).toBeTruthy();
      expect(screen.getByText('Tab 2')).toBeTruthy();
    });

    it('renders with testID', () => {
      render(<SegmentedTabs {...defaultProps} testID="my-tabs" />);

      expect(screen.getByTestId('my-tabs')).toBeTruthy();
    });

    it('renders three tabs', () => {
      render(
        <SegmentedTabs tabs={['One', 'Two', 'Three']} selectedIndex={1} onSelect={jest.fn()} />
      );

      expect(screen.getByText('One')).toBeTruthy();
      expect(screen.getByText('Two')).toBeTruthy();
      expect(screen.getByText('Three')).toBeTruthy();
    });
  });

  describe('accessibility', () => {
    it('renders tabs with correct accessibility role', () => {
      render(<SegmentedTabs {...defaultProps} />);

      const tab1 = screen.getByRole('tab', { name: 'Tab 1' });
      const tab2 = screen.getByRole('tab', { name: 'Tab 2' });

      expect(tab1).toBeTruthy();
      expect(tab2).toBeTruthy();
    });

    it('marks selected tab with accessibility state', () => {
      render(<SegmentedTabs {...defaultProps} selectedIndex={0} />);

      const tab1 = screen.getByRole('tab', { name: 'Tab 1' });
      const tab2 = screen.getByRole('tab', { name: 'Tab 2' });

      expect(tab1.props.accessibilityState).toEqual({ selected: true });
      expect(tab2.props.accessibilityState).toEqual({ selected: false });
    });

    it('updates accessibility state when selection changes', () => {
      const { rerender } = render(<SegmentedTabs {...defaultProps} selectedIndex={0} />);

      let tab1 = screen.getByRole('tab', { name: 'Tab 1' });
      let tab2 = screen.getByRole('tab', { name: 'Tab 2' });

      expect(tab1.props.accessibilityState).toEqual({ selected: true });
      expect(tab2.props.accessibilityState).toEqual({ selected: false });

      rerender(<SegmentedTabs {...defaultProps} selectedIndex={1} />);

      tab1 = screen.getByRole('tab', { name: 'Tab 1' });
      tab2 = screen.getByRole('tab', { name: 'Tab 2' });

      expect(tab1.props.accessibilityState).toEqual({ selected: false });
      expect(tab2.props.accessibilityState).toEqual({ selected: true });
    });
  });

  describe('interactions', () => {
    it('calls onSelect with index 0 when first tab pressed', () => {
      const onSelect = jest.fn();
      render(<SegmentedTabs {...defaultProps} onSelect={onSelect} selectedIndex={1} />);

      fireEvent.press(screen.getByText('Tab 1'));

      expect(onSelect).toHaveBeenCalledTimes(1);
      expect(onSelect).toHaveBeenCalledWith(0);
    });

    it('calls onSelect with index 1 when second tab pressed', () => {
      const onSelect = jest.fn();
      render(<SegmentedTabs {...defaultProps} onSelect={onSelect} selectedIndex={0} />);

      fireEvent.press(screen.getByText('Tab 2'));

      expect(onSelect).toHaveBeenCalledTimes(1);
      expect(onSelect).toHaveBeenCalledWith(1);
    });

    it('calls onSelect when pressing already selected tab', () => {
      const onSelect = jest.fn();
      render(<SegmentedTabs {...defaultProps} onSelect={onSelect} selectedIndex={0} />);

      fireEvent.press(screen.getByText('Tab 1'));

      expect(onSelect).toHaveBeenCalledWith(0);
    });

    it('handles press in and press out events', () => {
      render(<SegmentedTabs {...defaultProps} />);

      const tab = screen.getByRole('tab', { name: 'Tab 1' });

      // These events trigger animations but shouldn't throw
      fireEvent(tab, 'pressIn');
      fireEvent(tab, 'pressOut');

      // Component should still be rendered correctly
      expect(screen.getByText('Tab 1')).toBeTruthy();
    });
  });

  describe('My Trips / Tagged use case', () => {
    it('renders trip tabs correctly', () => {
      render(
        <SegmentedTabs
          tabs={['My Trips', 'Tagged']}
          selectedIndex={0}
          onSelect={jest.fn()}
          testID="trip-tabs"
        />
      );

      expect(screen.getByText('My Trips')).toBeTruthy();
      expect(screen.getByText('Tagged')).toBeTruthy();
      expect(screen.getByTestId('trip-tabs')).toBeTruthy();
    });

    it('shows My Trips as selected by default', () => {
      render(
        <SegmentedTabs tabs={['My Trips', 'Tagged']} selectedIndex={0} onSelect={jest.fn()} />
      );

      const myTripsTab = screen.getByRole('tab', { name: 'My Trips' });
      const taggedTab = screen.getByRole('tab', { name: 'Tagged' });

      expect(myTripsTab.props.accessibilityState).toEqual({ selected: true });
      expect(taggedTab.props.accessibilityState).toEqual({ selected: false });
    });

    it('switches to Tagged when second tab pressed', () => {
      const onSelect = jest.fn();
      render(<SegmentedTabs tabs={['My Trips', 'Tagged']} selectedIndex={0} onSelect={onSelect} />);

      fireEvent.press(screen.getByText('Tagged'));

      expect(onSelect).toHaveBeenCalledWith(1);
    });
  });
});
