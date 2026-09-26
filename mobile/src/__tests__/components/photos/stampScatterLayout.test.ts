import {
  layoutStampScatter,
  stampTilt,
  type StampBand,
} from '@components/photos/stampScatterLayout';

/** iPhone 17 hero: full width, header ~120pt, sheet overlap 28pt. */
const BAND: StampBand = { width: 402, height: 470, top: 120, bottom: 28 };

describe('stampScatterLayout', () => {
  it('keeps every tilted stamp inside the visible band', () => {
    const bands: StampBand[] = [
      BAND,
      { width: 375, height: 360, top: 100, bottom: 28 },
      { width: 440, height: 560, top: 130, bottom: 28 },
    ];
    for (const band of bands) {
      for (const capacity of [3, 4, 6]) {
        for (const seed of [0, 1, 7, 12345]) {
          const { stampSize, anchors } = layoutStampScatter(band, capacity, seed);
          const reach = (stampSize / 2) * Math.SQRT2 * 0.82;
          for (const anchor of anchors) {
            expect(anchor.x - reach).toBeGreaterThanOrEqual(0);
            expect(anchor.x + reach).toBeLessThanOrEqual(band.width);
            expect(anchor.y - reach).toBeGreaterThanOrEqual(band.top);
            expect(anchor.y + reach).toBeLessThanOrEqual(band.height - band.bottom);
          }
        }
      }
    }
  });

  it('uses the top of the stage beside a title-less back button, never under it', () => {
    const open: StampBand = {
      width: 402,
      height: 470,
      top: 70,
      bottom: 28,
      corner: { width: 72, height: 118 },
    };
    let reachesTop = false;
    for (const seed of [0, 1, 7, 42, 12345]) {
      const { stampSize, anchors } = layoutStampScatter(open, 6, seed);
      const reach = (stampSize / 2) * Math.SQRT2 * 0.82;
      for (const anchor of anchors) {
        const underButton =
          anchor.x - reach < open.corner!.width && anchor.y - reach < open.corner!.height;
        expect(underButton).toBe(false);
        if (anchor.y - reach < BAND.top) reachesTop = true;
      }
      for (let i = 0; i < anchors.length; i += 1) {
        for (let j = i + 1; j < anchors.length; j += 1) {
          expect(
            Math.hypot(anchors[i].x - anchors[j].x, anchors[i].y - anchors[j].y)
          ).toBeGreaterThan(stampSize * 0.9);
        }
      }
    }
    expect(reachesTop).toBe(true);
  });

  it('never puts two stamps on top of each other', () => {
    for (const capacity of [3, 4, 6]) {
      for (const seed of [0, 3, 42]) {
        const { stampSize, anchors } = layoutStampScatter(BAND, capacity, seed);
        for (let i = 0; i < anchors.length; i += 1) {
          for (let j = i + 1; j < anchors.length; j += 1) {
            const distance = Math.hypot(anchors[i].x - anchors[j].x, anchors[i].y - anchors[j].y);
            expect(distance).toBeGreaterThan(stampSize * 0.9);
          }
        }
      }
    }
  });

  it('makes stamps bigger when the page holds fewer of them', () => {
    const four = layoutStampScatter(BAND, 4, 1).stampSize;
    const six = layoutStampScatter(BAND, 6, 1).stampSize;

    expect(four).toBeGreaterThan(six);
    expect(six).toBeGreaterThanOrEqual(76);
  });

  it('spreads the first finds across the band instead of filling top-down', () => {
    const { anchors } = layoutStampScatter(BAND, 6, 0);
    const [first, second] = anchors;

    expect(Math.hypot(first.x - second.x, first.y - second.y)).toBeGreaterThan(BAND.width / 3);
  });

  it('is stable for a seed and varies across seeds', () => {
    const first = layoutStampScatter(BAND, 6, 99);
    expect(layoutStampScatter(BAND, 6, 99)).toEqual(first);
    expect(layoutStampScatter(BAND, 6, 100)).not.toEqual(first);
  });

  it('returns exactly capacity anchors, and none before layout', () => {
    expect(layoutStampScatter(BAND, 6, 1).anchors).toHaveLength(6);
    expect(layoutStampScatter({ width: 0, height: 0, top: 0, bottom: 0 }, 3, 1).anchors).toEqual(
      []
    );
  });

  it('tilts each stamp a little, the same way every time', () => {
    for (const code of ['PT', 'JP', 'MX', 'hr']) {
      const tilt = stampTilt(code);
      expect(Math.abs(tilt)).toBeLessThanOrEqual(10);
      expect(stampTilt(code.toUpperCase())).toBe(tilt);
    }
  });
});
