import {
  CARD_STAGGER_DELAY,
  ROW_STAGGER_DELAY,
  STAGGER_MAX_DURATION,
  resetInitialAnimationFlag,
  hasInitialAnimationPlayed,
} from './usePassportAnimations';

describe('usePassportAnimations', () => {
  describe('diagonal wave stagger constants', () => {
    it('exports CARD_STAGGER_DELAY as 50ms', () => {
      expect(CARD_STAGGER_DELAY).toBe(50);
    });

    it('exports ROW_STAGGER_DELAY as 30ms', () => {
      expect(ROW_STAGGER_DELAY).toBe(30);
    });

    it('exports STAGGER_MAX_DURATION as 1500ms', () => {
      expect(STAGGER_MAX_DURATION).toBe(1500);
    });
  });

  describe('diagonal wave delay calculation', () => {
    /**
     * Simulates the delay calculation used in handleViewableItemsChanged
     */
    function calculateDiagonalDelay(
      rowIndex: number,
      cardIndex: number,
      baseRowIndex: number = 0
    ): number {
      const relativeRowIndex = rowIndex - baseRowIndex;
      const rowDelay = relativeRowIndex * ROW_STAGGER_DELAY;
      const cardDelay = cardIndex * CARD_STAGGER_DELAY;
      return Math.min(rowDelay + cardDelay, STAGGER_MAX_DURATION);
    }

    it('calculates correct delay for first card in first row', () => {
      expect(calculateDiagonalDelay(0, 0, 0)).toBe(0);
    });

    it('calculates correct delay for second card in first row', () => {
      // Row 0, Card 1: 0 * 30 + 1 * 50 = 50ms
      expect(calculateDiagonalDelay(0, 1, 0)).toBe(50);
    });

    it('calculates correct delay for first card in second row', () => {
      // Row 1, Card 0: 1 * 30 + 0 * 50 = 30ms
      expect(calculateDiagonalDelay(1, 0, 0)).toBe(30);
    });

    it('calculates correct delay for second card in second row', () => {
      // Row 1, Card 1: 1 * 30 + 1 * 50 = 80ms
      expect(calculateDiagonalDelay(1, 1, 0)).toBe(80);
    });

    it('creates diagonal wave pattern (sorted by delay)', () => {
      // Simulate a 3x2 grid (3 rows, 2 cards per row)
      const delays: Array<{ row: number; card: number; delay: number }> = [];

      for (let row = 0; row < 3; row++) {
        for (let card = 0; card < 2; card++) {
          delays.push({
            row,
            card,
            delay: calculateDiagonalDelay(row, card, 0),
          });
        }
      }

      // Sort by delay to see the wave order
      delays.sort((a, b) => a.delay - b.delay);

      // Expected diagonal wave order:
      // (0,0)=0ms, (1,0)=30ms, (0,1)=50ms, (2,0)=60ms, (1,1)=80ms, (2,1)=110ms
      expect(delays.map((d) => `(${d.row},${d.card})`)).toEqual([
        '(0,0)', // 0ms
        '(1,0)', // 30ms
        '(0,1)', // 50ms
        '(2,0)', // 60ms
        '(1,1)', // 80ms
        '(2,1)', // 110ms
      ]);
    });

    it('respects STAGGER_MAX_DURATION cap', () => {
      // Simulate very long list (50 rows)
      const delay = calculateDiagonalDelay(50, 5, 0);
      expect(delay).toBeLessThanOrEqual(STAGGER_MAX_DURATION);
    });

    it('handles non-zero base row index correctly', () => {
      // If user scrolls and first visible row is row 5
      // Row 5, Card 0 should have 0 delay (it's the base)
      expect(calculateDiagonalDelay(5, 0, 5)).toBe(0);

      // Row 6, Card 1 should be: (6-5)*30 + 1*50 = 80ms
      expect(calculateDiagonalDelay(6, 1, 5)).toBe(80);
    });
  });

  describe('first-load-only flag', () => {
    beforeEach(() => {
      // Reset the flag before each test
      resetInitialAnimationFlag();
    });

    it('starts with flag set to false', () => {
      expect(hasInitialAnimationPlayed()).toBe(false);
    });

    it('resetInitialAnimationFlag resets to false', () => {
      // We can't directly set it to true without calling the hook
      // But we can verify reset works
      resetInitialAnimationFlag();
      expect(hasInitialAnimationPlayed()).toBe(false);
    });
  });
});
