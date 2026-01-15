/**
 * Tests for ShareExtensionTutorialSheet component.
 *
 * Tests the bottom sheet modal that displays the video tutorial
 * for using the iOS share extension.
 */

import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';

import { ShareExtensionTutorialSheet } from '@components/share/ShareExtensionTutorialSheet';

// Get reference to mocked modules
const Haptics = jest.requireMock('expo-haptics');
const { useVideoPlayer } = jest.requireMock('expo-video');

describe('ShareExtensionTutorialSheet', () => {
  const mockOnClose = jest.fn();

  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('visibility', () => {
    it('returns null when visible is false', () => {
      const { toJSON } = render(
        <ShareExtensionTutorialSheet visible={false} onClose={mockOnClose} />
      );

      expect(toJSON()).toBeNull();
    });

    it('renders modal when visible is true', () => {
      render(<ShareExtensionTutorialSheet visible={true} onClose={mockOnClose} />);

      expect(screen.getByText('Save Travel Inspiration')).toBeTruthy();
    });
  });

  describe('content', () => {
    beforeEach(() => {
      render(<ShareExtensionTutorialSheet visible={true} onClose={mockOnClose} />);
    });

    it('displays title', () => {
      expect(screen.getByText('Save Travel Inspiration')).toBeTruthy();
    });

    it('displays step 1 instruction', () => {
      expect(screen.getByText('Find a video or post on TikTok or Instagram')).toBeTruthy();
    });

    it('displays step 2 instruction', () => {
      expect(screen.getByText('Tap the share button')).toBeTruthy();
    });

    it('displays step 3 instruction with Atlasi highlighted', () => {
      // The step 3 text contains "Atlasi" as a bold styled text
      expect(screen.getByText(/Select/)).toBeTruthy();
      expect(screen.getByText('Atlasi')).toBeTruthy();
    });

    it('displays step 4 instruction', () => {
      expect(screen.getByText('Choose which trip to save it to')).toBeTruthy();
    });

    it('displays footer text', () => {
      expect(
        screen.getByText("Your saves appear in your trip's log alongside your own memories.")
      ).toBeTruthy();
    });

    it('displays Got It button', () => {
      expect(screen.getByText('Got It')).toBeTruthy();
    });

    it('displays step numbers 1-4', () => {
      expect(screen.getByText('1')).toBeTruthy();
      expect(screen.getByText('2')).toBeTruthy();
      expect(screen.getByText('3')).toBeTruthy();
      expect(screen.getByText('4')).toBeTruthy();
    });
  });

  describe('accessibility', () => {
    beforeEach(() => {
      render(<ShareExtensionTutorialSheet visible={true} onClose={mockOnClose} />);
    });

    it('has accessible video description', () => {
      expect(
        screen.getByLabelText(
          'Video showing how to use the share extension to save content from TikTok and Instagram'
        )
      ).toBeTruthy();
    });

    it('has accessible close button', () => {
      expect(screen.getByLabelText('Close tutorial')).toBeTruthy();
    });
  });

  describe('interactions', () => {
    it('calls onClose when Got It button is pressed', async () => {
      render(<ShareExtensionTutorialSheet visible={true} onClose={mockOnClose} />);

      fireEvent.press(screen.getByText('Got It'));

      // The close happens after animation, so we need to wait
      await waitFor(
        () => {
          expect(mockOnClose).toHaveBeenCalled();
        },
        { timeout: 500 }
      );
    });

    it('triggers haptic feedback when Got It button is pressed', () => {
      render(<ShareExtensionTutorialSheet visible={true} onClose={mockOnClose} />);

      fireEvent.press(screen.getByText('Got It'));

      expect(Haptics.impactAsync).toHaveBeenCalledWith(Haptics.ImpactFeedbackStyle.Medium);
    });
  });

  describe('video player', () => {
    it('creates video player with loop and muted config', () => {
      render(<ShareExtensionTutorialSheet visible={true} onClose={mockOnClose} />);

      expect(useVideoPlayer).toHaveBeenCalled();
      // The callback is called with the player to configure it
      const callback = useVideoPlayer.mock.calls[0][1];
      const mockPlayer = { loop: false, muted: false };
      callback(mockPlayer);

      expect(mockPlayer.loop).toBe(true);
      expect(mockPlayer.muted).toBe(true);
    });
  });
});
