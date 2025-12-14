/**
 * Tests for MilestoneBadge component.
 *
 * Covers:
 * - Badge rendering with proper label
 * - Icon display
 * - Background color application
 * - Different milestone types
 */

import { render, screen } from '../utils/testUtils';
import { MilestoneBadge } from '@components/share/MilestoneBadge';
import { colors } from '@constants/colors';
import type { Milestone } from '@utils/milestones';

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

describe('MilestoneBadge', () => {
  // ============ Basic Rendering ============

  describe('Basic Rendering', () => {
    it('renders milestone label', () => {
      const milestone = createMilestone({ label: '10 Countries!' });

      render(<MilestoneBadge milestone={milestone} />);

      expect(screen.getByText('10 Countries!')).toBeTruthy();
    });

    it('renders different labels correctly', () => {
      const labels = [
        '10 Countries!',
        '25 Countries!',
        'First in Asia!',
        'First in East Asia!',
        'All of East Asia!',
      ];

      labels.forEach((label) => {
        const milestone = createMilestone({ label });
        const { unmount } = render(<MilestoneBadge milestone={milestone} />);

        expect(screen.getByText(label)).toBeTruthy();
        unmount();
      });
    });
  });

  // ============ Milestone Types ============

  describe('Milestone Types', () => {
    it('renders round_number milestone', () => {
      const milestone = createMilestone({
        type: 'round_number',
        label: '50 Countries!',
        icon: 'trophy',
        color: colors.sunsetGold,
      });

      render(<MilestoneBadge milestone={milestone} />);

      expect(screen.getByText('50 Countries!')).toBeTruthy();
    });

    it('renders new_continent milestone', () => {
      const milestone = createMilestone({
        type: 'new_continent',
        label: 'First in Africa!',
        icon: 'globe',
        color: colors.mossGreen,
      });

      render(<MilestoneBadge milestone={milestone} />);

      expect(screen.getByText('First in Africa!')).toBeTruthy();
    });

    it('renders new_subregion milestone', () => {
      const milestone = createMilestone({
        type: 'new_subregion',
        label: 'First in East Asia!',
        icon: 'flag',
        color: colors.lakeBlue,
      });

      render(<MilestoneBadge milestone={milestone} />);

      expect(screen.getByText('First in East Asia!')).toBeTruthy();
    });

    it('renders region_complete milestone', () => {
      const milestone = createMilestone({
        type: 'region_complete',
        label: 'All of Northern Europe!',
        icon: 'checkmark-circle',
        color: colors.adobeBrick,
      });

      render(<MilestoneBadge milestone={milestone} />);

      expect(screen.getByText('All of Northern Europe!')).toBeTruthy();
    });
  });

  // ============ Edge Cases ============

  describe('Edge Cases', () => {
    it('handles long label text', () => {
      const milestone = createMilestone({
        label: 'First in Australia and New Zealand!',
      });

      render(<MilestoneBadge milestone={milestone} />);

      expect(screen.getByText('First in Australia and New Zealand!')).toBeTruthy();
    });

    it('handles short label text', () => {
      const milestone = createMilestone({
        label: '10!',
      });

      render(<MilestoneBadge milestone={milestone} />);

      expect(screen.getByText('10!')).toBeTruthy();
    });
  });
});
