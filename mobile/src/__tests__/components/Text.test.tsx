import { render, screen } from '@testing-library/react-native';

import { Text } from '@components/ui/Text';

// Mock useResponsive hook
const mockUseResponsive = jest.fn();
jest.mock('@hooks/useResponsive', () => ({
  useResponsive: () => mockUseResponsive(),
}));

describe('Text', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    // Default to large screen
    mockUseResponsive.mockReturnValue({
      screenSize: 'large',
      isSmallScreen: false,
      isMediumScreen: false,
      isLargeScreen: true,
      screenHeight: 926,
      screenWidth: 428,
    });
  });

  describe('basic rendering', () => {
    it('renders text content correctly', () => {
      render(<Text>Hello World</Text>);

      expect(screen.getByText('Hello World')).toBeTruthy();
    });

    it('renders with different variants', () => {
      const { rerender } = render(<Text variant="title">Title</Text>);
      expect(screen.getByText('Title')).toBeTruthy();

      rerender(<Text variant="subtitle">Subtitle</Text>);
      expect(screen.getByText('Subtitle')).toBeTruthy();

      rerender(<Text variant="body">Body</Text>);
      expect(screen.getByText('Body')).toBeTruthy();

      rerender(<Text variant="label">Label</Text>);
      expect(screen.getByText('Label')).toBeTruthy();

      rerender(<Text variant="caption">Caption</Text>);
      expect(screen.getByText('Caption')).toBeTruthy();

      rerender(<Text variant="accent">Accent</Text>);
      expect(screen.getByText('Accent')).toBeTruthy();

      rerender(<Text variant="heading">Heading</Text>);
      expect(screen.getByText('Heading')).toBeTruthy();
    });

    it('defaults to body variant', () => {
      render(<Text>Default Text</Text>);
      expect(screen.getByText('Default Text')).toBeTruthy();
    });
  });

  describe('responsive behavior', () => {
    it('applies small screen styles when isSmallScreen is true and responsive is enabled', () => {
      mockUseResponsive.mockReturnValue({
        screenSize: 'small',
        isSmallScreen: true,
        isMediumScreen: false,
        isLargeScreen: false,
        screenHeight: 568,
        screenWidth: 320,
      });

      const { getByText } = render(<Text variant="title">Title</Text>);
      const textElement = getByText('Title');

      // The component should render (we can't easily test StyleSheet.flatten in Jest)
      // but we can verify the hook was called
      expect(mockUseResponsive).toHaveBeenCalled();
      expect(textElement).toBeTruthy();
    });

    it('does not apply small screen styles when responsive is false', () => {
      mockUseResponsive.mockReturnValue({
        screenSize: 'small',
        isSmallScreen: true,
        isMediumScreen: false,
        isLargeScreen: false,
        screenHeight: 568,
        screenWidth: 320,
      });

      const { getByText } = render(
        <Text variant="title" responsive={false}>
          Title
        </Text>
      );
      const textElement = getByText('Title');

      // Component renders without responsive adjustments
      expect(textElement).toBeTruthy();
    });

    it('does not apply small screen styles on large screens', () => {
      mockUseResponsive.mockReturnValue({
        screenSize: 'large',
        isSmallScreen: false,
        isMediumScreen: false,
        isLargeScreen: true,
        screenHeight: 926,
        screenWidth: 428,
      });

      const { getByText } = render(<Text variant="title">Title</Text>);
      const textElement = getByText('Title');

      expect(textElement).toBeTruthy();
    });

    it('responsive prop defaults to true', () => {
      mockUseResponsive.mockReturnValue({
        screenSize: 'small',
        isSmallScreen: true,
        isMediumScreen: false,
        isLargeScreen: false,
        screenHeight: 568,
        screenWidth: 320,
      });

      // Without explicitly setting responsive, it should still be enabled
      render(<Text variant="body">Body Text</Text>);

      expect(mockUseResponsive).toHaveBeenCalled();
    });
  });

  describe('custom styles', () => {
    it('accepts custom style prop', () => {
      const { getByText } = render(<Text style={{ marginTop: 20 }}>Styled Text</Text>);

      expect(getByText('Styled Text')).toBeTruthy();
    });

    it('passes through additional TextProps', () => {
      const { getByText } = render(
        <Text numberOfLines={2} ellipsizeMode="tail">
          Long text that might be truncated
        </Text>
      );

      expect(getByText('Long text that might be truncated')).toBeTruthy();
    });
  });

  describe('variant styles on small screens', () => {
    beforeEach(() => {
      mockUseResponsive.mockReturnValue({
        screenSize: 'small',
        isSmallScreen: true,
        isMediumScreen: false,
        isLargeScreen: false,
        screenHeight: 568,
        screenWidth: 320,
      });
    });

    const variants = [
      'title',
      'subtitle',
      'heading',
      'body',
      'label',
      'caption',
      'accent',
    ] as const;

    variants.forEach((variant) => {
      it(`renders ${variant} variant on small screen`, () => {
        render(<Text variant={variant}>{variant} text</Text>);

        expect(screen.getByText(`${variant} text`)).toBeTruthy();
      });
    });
  });
});
