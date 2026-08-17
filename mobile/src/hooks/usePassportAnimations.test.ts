import {
  CARD_STAGGER_DELAY,
  ROW_STAGGER_DELAY,
  STAGGER_MAX_DURATION_PASSPORT,
} from './usePassportAnimations';

describe('usePassportAnimations', () => {
  describe('diagonal wave stagger constants', () => {
    it('exports CARD_STAGGER_DELAY as 25ms', () => {
      expect(CARD_STAGGER_DELAY).toBe(25);
    });

    it('exports ROW_STAGGER_DELAY as 12ms', () => {
      expect(ROW_STAGGER_DELAY).toBe(12);
    });

    it('exports STAGGER_MAX_DURATION_PASSPORT as 280ms', () => {
      expect(STAGGER_MAX_DURATION_PASSPORT).toBe(280);
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
      return Math.min(rowDelay + cardDelay, STAGGER_MAX_DURATION_PASSPORT);
    }

    it('calculates correct delay for first card in first row', () => {
      expect(calculateDiagonalDelay(0, 0, 0)).toBe(0);
    });

    it('calculates correct delay for second card in first row', () => {
      // Row 0, Card 1: 0 * 12 + 1 * 25 = 25ms
      expect(calculateDiagonalDelay(0, 1, 0)).toBe(25);
    });

    it('calculates correct delay for first card in second row', () => {
      // Row 1, Card 0: 1 * 12 + 0 * 25 = 12ms
      expect(calculateDiagonalDelay(1, 0, 0)).toBe(12);
    });

    it('calculates correct delay for second card in second row', () => {
      // Row 1, Card 1: 1 * 12 + 1 * 25 = 37ms
      expect(calculateDiagonalDelay(1, 1, 0)).toBe(37);
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
      // (0,0)=0ms, (1,0)=12ms, (2,0)=24ms, (0,1)=25ms, (1,1)=37ms, (2,1)=49ms
      expect(delays.map((d) => `(${d.row},${d.card})`)).toEqual([
        '(0,0)', // 0ms
        '(1,0)', // 12ms
        '(2,0)', // 24ms
        '(0,1)', // 25ms
        '(1,1)', // 37ms
        '(2,1)', // 49ms
      ]);
    });

    it('respects STAGGER_MAX_DURATION cap', () => {
      // Simulate very long list (50 rows)
      const delay = calculateDiagonalDelay(50, 5, 0);
      expect(delay).toBeLessThanOrEqual(STAGGER_MAX_DURATION_PASSPORT);
    });

    it('handles non-zero base row index correctly', () => {
      // If user scrolls and first visible row is row 5
      // Row 5, Card 0 should have 0 delay (it's the base)
      expect(calculateDiagonalDelay(5, 0, 5)).toBe(0);

      // Row 6, Card 1 should be: (6-5)*12 + 1*25 = 37ms
      expect(calculateDiagonalDelay(6, 1, 5)).toBe(37);
    });
  });
});
