/**
 * Tests for ShareCard component.
 *
 * Covers:
 * - Default mode: Full-bleed illustration with bold typography
 * - Photo mode: User's photo with stamp in corner
 * - Milestone badges rendering
 * - Watermark presence
 */

import { render, screen } from '../utils/testUtils';
import { ShareCard } from '@components/share/ShareCard';
import { colors } from '@constants/colors';
import type { MilestoneContext, Milestone } from '@utils/milestones';

// Mock the country image getter
jest.mock('../../assets/countryImages', () => ({
  getCountryImage: jest.fn((code: string) => {
    if (code === 'JP') return { uri: 'test-country-image-jp' };
    return null;
  }),
}));

// Mock the stamp image getter
jest.mock('../../assets/stampImages', () => ({
  getStampImage: jest.fn((code: string) => {
    if (code === 'JP') return { uri: 'test-stamp-jp' };
    return null;
  }),
}));

// Helper to create milestone context
function createMilestoneContext(overrides?: Partial<MilestoneContext>): MilestoneContext {
  return {
    countryCode: 'JP',
    countryName: 'Japan',
    countryRegion: 'Asia',
    countrySubregion: 'East Asia',
    newTotalCount: 5,
    milestones: [],
    ...overrides,
  };
}

// Helper to create milestone
function createMilestone(overrides?: Partial<Milestone>): Milestone {
  return {
    type: 'round_number',
    label: '10 Countries!',
    icon: 'trophy',
    color: colors.sunsetGold,
    ...overrides,
  };
}

describe('ShareCard', () => {
  // ============ Default Mode (No Background Image) ============

  describe('Default Mode', () => {
    it('renders country name in uppercase', () => {
      const context = createMilestoneContext({ countryName: 'Japan' });

      render(<ShareCard context={context} />);

      // Country name is displayed in uppercase
      expect(screen.getByText('JAPAN')).toBeTruthy();
    });

    it('renders country number with # prefix', () => {
      const context = createMilestoneContext({ newTotalCount: 27 });

      render(<ShareCard context={context} />);

      // Number with # prefix in the new design
      expect(screen.getByText('#27')).toBeTruthy();
    });

    it('renders watermark text', () => {
      const context = createMilestoneContext();

      render(<ShareCard context={context} />);

      expect(screen.getByText('Border Badge')).toBeTruthy();
    });

    it('renders different country names in uppercase', () => {
      const countries = [
        { name: 'France', expected: 'FRANCE' },
        { name: 'Brazil', expected: 'BRAZIL' },
        { name: 'Australia', expected: 'AUSTRALIA' },
      ];

      countries.forEach(({ name, expected }) => {
        const context = createMilestoneContext({ countryName: name });
        const { unmount } = render(<ShareCard context={context} />);

        expect(screen.getByText(expected)).toBeTruthy();
        unmount();
      });
    });

    it('handles long country names', () => {
      const context = createMilestoneContext({
        countryName: 'Democratic Republic of the Congo',
      });

      render(<ShareCard context={context} />);

      expect(screen.getByText('DEMOCRATIC REPUBLIC OF THE CONGO')).toBeTruthy();
    });
  });

  // ============ Milestone Badges ============

  describe('Milestone Badges', () => {
    it('renders milestone badges when present', () => {
      const milestones: Milestone[] = [
        createMilestone({ type: 'round_number', label: '10 Countries!' }),
        createMilestone({ type: 'new_continent', label: 'First in Asia!' }),
      ];
      const context = createMilestoneContext({ milestones });

      render(<ShareCard context={context} />);

      expect(screen.getByText('10 Countries!')).toBeTruthy();
      expect(screen.getByText('First in Asia!')).toBeTruthy();
    });

    it('does not render milestones when none provided', () => {
      const context = createMilestoneContext({ milestones: [] });

      render(<ShareCard context={context} />);

      // Country name should still be there
      expect(screen.getByText('JAPAN')).toBeTruthy();
      // But specific milestone texts should not
      expect(screen.queryByText('10 Countries!')).toBeNull();
    });

    it('renders multiple milestones', () => {
      const milestones: Milestone[] = [
        createMilestone({ label: 'First' }),
        createMilestone({ label: 'Second' }),
        createMilestone({ label: 'Third' }),
      ];
      const context = createMilestoneContext({ milestones });

      render(<ShareCard context={context} />);

      expect(screen.getByText('First')).toBeTruthy();
      expect(screen.getByText('Second')).toBeTruthy();
      expect(screen.getByText('Third')).toBeTruthy();
    });
  });

  // ============ Country Numbers ============

  describe('Country Numbers', () => {
    it('renders first country number with # prefix', () => {
      const context = createMilestoneContext({ newTotalCount: 1 });

      render(<ShareCard context={context} />);

      expect(screen.getByText('#1')).toBeTruthy();
    });

    it('renders high country numbers with # prefix', () => {
      const context = createMilestoneContext({ newTotalCount: 100 });

      render(<ShareCard context={context} />);

      expect(screen.getByText('#100')).toBeTruthy();
    });
  });

  // ============ Photo Mode (With Background Image) ============

  describe('Photo Mode', () => {
    it('renders with background image', () => {
      const context = createMilestoneContext();
      const backgroundImage = 'file:///path/to/image.jpg';

      // Just ensure it renders without error
      const { toJSON } = render(<ShareCard context={context} backgroundImage={backgroundImage} />);

      expect(toJSON()).toBeTruthy();
    });

    it('shows stamp with number badge in photo mode', () => {
      const context = createMilestoneContext({ newTotalCount: 42 });
      const backgroundImage = 'file:///path/to/image.jpg';

      render(<ShareCard context={context} backgroundImage={backgroundImage} />);

      // In photo mode, number shows as #42 on badge
      expect(screen.getByText('#42')).toBeTruthy();
    });

    it('limits milestones to 2 in photo mode', () => {
      const milestones: Milestone[] = [
        createMilestone({ label: 'First' }),
        createMilestone({ label: 'Second' }),
        createMilestone({ label: 'Third' }),
      ];
      const context = createMilestoneContext({ milestones });
      const backgroundImage = 'file:///path/to/image.jpg';

      render(<ShareCard context={context} backgroundImage={backgroundImage} />);

      // Photo mode shows max 2 milestones
      expect(screen.getByText('First')).toBeTruthy();
      expect(screen.getByText('Second')).toBeTruthy();
      expect(screen.queryByText('Third')).toBeNull();
    });
  });

  // ============ Background Handling ============

  describe('Background Handling', () => {
    it('renders with default mode when no background image', () => {
      const context = createMilestoneContext();

      const { toJSON } = render(<ShareCard context={context} />);

      expect(toJSON()).toBeTruthy();
    });

    it('renders photo mode when background image provided', () => {
      const context = createMilestoneContext();
      const backgroundImage = 'file:///path/to/image.jpg';

      const { toJSON } = render(<ShareCard context={context} backgroundImage={backgroundImage} />);

      expect(toJSON()).toBeTruthy();
    });
  });
});
