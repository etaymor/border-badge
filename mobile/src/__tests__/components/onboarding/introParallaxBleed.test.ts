/**
 * Bug (2026-09-26, simulator): at rest on beat 1, beat 2's stage showed on the
 * right third of the screen and covered beat 1's content. The parallax offset
 * pulled every neighbouring stage toward the centre of the viewport.
 *
 * Invariant: a page's visual may trail its page while you drag, but a
 * neighbour that is a full page away must sit entirely off-screen.
 */

import { stageParallaxX } from '@components/onboarding/introBeats/introMotion';

const W = 390;

/** Screen-space [left, right] of a page's visual at relative position p. */
function visualSpan(p: number): [number, number] {
  const pageLeft = -p * W;
  const left = pageLeft + stageParallaxX(p, W);
  return [left, left + W];
}

function overlapsViewport([left, right]: [number, number]): boolean {
  return right > 0 && left < W;
}

describe('intro parallax never lets a neighbour bleed into view', () => {
  it('the next beat (one page to the right) stays off-screen at rest', () => {
    expect(overlapsViewport(visualSpan(-1))).toBe(false);
  });

  it('the previous beat (one page to the left) stays off-screen at rest', () => {
    expect(overlapsViewport(visualSpan(1))).toBe(false);
  });

  it('the settled beat is exactly in place', () => {
    expect(visualSpan(0)).toEqual([0, W]);
  });
});
