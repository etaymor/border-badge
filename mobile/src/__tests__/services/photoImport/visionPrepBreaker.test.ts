/**
 * Tests for the dispatch-scoped vision preparation breaker (KTD2).
 */

import {
  createVisionPrepBreaker,
  VISION_PREP_BREAKER_THRESHOLD,
} from '../../../services/photoImport/visionPrepBreaker';

describe('createVisionPrepBreaker', () => {
  let warnSpy: jest.SpyInstance;

  beforeEach(() => {
    warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => undefined);
  });

  afterEach(() => {
    warnSpy.mockRestore();
  });

  it('ships with a threshold of 3', () => {
    expect(VISION_PREP_BREAKER_THRESHOLD).toBe(3);
  });

  it('starts closed', () => {
    const breaker = createVisionPrepBreaker();
    expect(breaker.isOpen()).toBe(false);
    expect(breaker.consecutiveTimeouts()).toBe(0);
  });

  it('opens after exactly 3 consecutive timeouts', () => {
    const breaker = createVisionPrepBreaker();

    breaker.recordTimeout();
    breaker.recordTimeout();
    expect(breaker.isOpen()).toBe(false);

    breaker.recordTimeout();
    expect(breaker.isOpen()).toBe(true);
  });

  it('a success in between resets the streak', () => {
    const breaker = createVisionPrepBreaker();

    breaker.recordTimeout();
    breaker.recordTimeout();
    breaker.recordSuccess();
    expect(breaker.consecutiveTimeouts()).toBe(0);

    breaker.recordTimeout();
    breaker.recordTimeout();
    expect(breaker.isOpen()).toBe(false);

    breaker.recordTimeout();
    expect(breaker.isOpen()).toBe(true);
  });

  it('stays open once open, even if an in-flight photo later succeeds', () => {
    const breaker = createVisionPrepBreaker();
    for (let i = 0; i < VISION_PREP_BREAKER_THRESHOLD; i++) breaker.recordTimeout();

    breaker.recordSuccess();

    expect(breaker.isOpen()).toBe(true);
  });

  it('warns once, in a form that survives production console stripping', () => {
    const breaker = createVisionPrepBreaker();
    for (let i = 0; i < 5; i++) breaker.recordTimeout();

    expect(warnSpy).toHaveBeenCalledTimes(1);
    expect(warnSpy.mock.calls[0][0]).toContain('Breaker open');
  });

  it('each dispatch gets its own breaker: a new one starts closed', () => {
    const first = createVisionPrepBreaker();
    for (let i = 0; i < VISION_PREP_BREAKER_THRESHOLD; i++) first.recordTimeout();

    const next = createVisionPrepBreaker();

    expect(first.isOpen()).toBe(true);
    expect(next.isOpen()).toBe(false);
  });

  it('honors a custom threshold', () => {
    const breaker = createVisionPrepBreaker(1);
    breaker.recordTimeout();
    expect(breaker.isOpen()).toBe(true);
  });
});
