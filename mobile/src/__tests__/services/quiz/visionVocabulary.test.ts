/**
 * Every Vision label the app matches on must be one Apple's classifier can emit.
 *
 * A misspelled or invented identifier ("church", "sea", "text") never fails
 * loudly: it just scores zero on every photo forever. This pins each vocabulary
 * to the real taxonomy, dumped from `VNClassifyImageRequest.supportedIdentifiers()`.
 */

import taxonomy from '../../fixtures/visionClassifierIdentifiers.json';
import { SCENE_HINT_IDENTIFIERS } from '@services/photoImport/sceneHints';
import { TAG_SIGNAL_VOCABULARIES } from '@services/quiz/tagSignals';

const KNOWN = new Set<string>(taxonomy.identifiers);

describe('Vision label vocabularies', () => {
  it('loads the full classifier taxonomy', () => {
    expect(KNOWN.size).toBe(taxonomy.count);
    expect(KNOWN.size).toBeGreaterThan(1000);
  });

  it.each(Object.entries(TAG_SIGNAL_VOCABULARIES))(
    'tagSignals %s labels are all real classifier identifiers',
    (_name, vocabulary) => {
      expect([...vocabulary].filter((label) => !KNOWN.has(label))).toEqual([]);
    }
  );

  it.each(Object.entries(SCENE_HINT_IDENTIFIERS))(
    'sceneHints %s identifiers are all real classifier identifiers',
    (_name, identifiers) => {
      expect(identifiers.filter((label) => !KNOWN.has(label))).toEqual([]);
    }
  );
});
