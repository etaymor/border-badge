/**
 * Venue-rollup U10: the effective tagger version and the native-to-stored row
 * mapping. The version keys on the native `textRecognition` capability, so an
 * OTA bundle running on an older binary neither re-tags the library nor stamps
 * rows as text-recognized.
 */

import type { NativePhotoTag } from '@modules/photo-tagger';

import {
  TAGGER_VERSION,
  TEXT_RECOGNITION_TAGGER_VERSION,
  effectiveTaggerVersion,
  toStoredTags,
} from '../../../services/photoImport/photoTagRows';

function nativeTag(over: Partial<NativePhotoTag> = {}): NativePhotoTag {
  return {
    id: 'photo-1',
    status: 'ok',
    isScreenshot: false,
    faceCount: 0,
    maxFaceArea: 0,
    totalFaceArea: 0,
    humanCount: 0,
    maxHumanArea: 0,
    totalHumanArea: 0,
    labels: [{ identifier: 'museum', confidence: 0.8 }],
    aestheticScore: null,
    isUtility: null,
    ...over,
  };
}

const caps = (textRecognition?: boolean) => ({
  aesthetics: true,
  osMajor: 26,
  lowPower: false,
  thermalState: 'nominal' as const,
  ...(textRecognition === undefined ? {} : { textRecognition }),
});

describe('effectiveTaggerVersion', () => {
  it('is one above the base version only when text recognition is reported', () => {
    expect(TEXT_RECOGNITION_TAGGER_VERSION).toBe(TAGGER_VERSION + 1);
    expect(effectiveTaggerVersion(caps(true))).toBe(TEXT_RECOGNITION_TAGGER_VERSION);
  });

  it('stays at the base version when the capability is absent or false', () => {
    expect(effectiveTaggerVersion(null)).toBe(TAGGER_VERSION);
    expect(effectiveTaggerVersion(caps())).toBe(TAGGER_VERSION);
    expect(effectiveTaggerVersion(caps(false))).toBe(TAGGER_VERSION);
  });

  it('reads the live native capabilities by default (absent in Jest)', () => {
    expect(effectiveTaggerVersion()).toBe(TAGGER_VERSION);
  });
});

describe('toStoredTags', () => {
  it('stamps the version it is given and keeps the recognized text', () => {
    const [row] = toStoredTags(
      [nativeTag({ text: [{ string: 'Cafe Marly', confidence: 1, area: 0.04 }] })],
      TEXT_RECOGNITION_TAGGER_VERSION,
      42
    );
    expect(row.taggerVersion).toBe(TEXT_RECOGNITION_TAGGER_VERSION);
    expect(row.signText).toEqual([{ text: 'Cafe Marly', confidence: 1, area: 0.04 }]);
    expect(row.computedAt).toBe(42);
  });

  it('stores null sign text for an older binary that emits no text key', () => {
    const [row] = toStoredTags([nativeTag()], TAGGER_VERSION, 1);
    expect(row.taggerVersion).toBe(TAGGER_VERSION);
    expect(row.signText).toBeNull();
  });

  it('keeps a measured empty list distinct from not measured', () => {
    expect(toStoredTags([nativeTag({ text: [] })], 2, 1)[0].signText).toEqual([]);
    expect(toStoredTags([nativeTag({ text: null })], 2, 1)[0].signText).toBeNull();
  });

  it('drops malformed text entries instead of throwing', () => {
    const text = [
      { string: 'Louvre', confidence: 0.5, area: 0.1 },
      { string: 42, confidence: 1, area: 0.1 },
      null,
    ] as unknown as NativePhotoTag['text'];
    expect(toStoredTags([nativeTag({ text })], 2, 1)[0].signText).toEqual([
      { text: 'Louvre', confidence: 0.5, area: 0.1 },
    ]);
  });

  it('defaults to the base version in Jest, where the native module is absent', () => {
    expect(toStoredTags([nativeTag()])[0].taggerVersion).toBe(TAGGER_VERSION);
  });
});
