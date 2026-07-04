/**
 * Structural guards for the cluster photo-upload path (U8 / R12 upload-half).
 *
 * The cluster upload path (`useClusterPhotoUpload`) uploads photos in a
 * sequential `for` loop, giving it naturally bounded concurrency. The U8 resize
 * is applied centrally inside `useUploadMedia` (the single chokepoint every real
 * upload path funnels through), so the cluster path gets resize for free by
 * calling `uploadMedia.mutateAsync`. These tests guard the invariants that matter
 * and are costly to regress:
 *
 *   1. Resize is applied to every upload via the shared `useUploadMedia` mutation.
 *   2. The cluster path's uploads remain sequential — NO unbounded `Promise.all`
 *      fan-out over the per-photo upload calls.
 *
 * We assert this at the source level rather than spinning up the full native
 * module stack (expo-media-library, expo-file-system/legacy, image manipulator,
 * React Query), which would add fragile mocking for no additional signal on
 * these particular invariants.
 */

import { readFileSync } from 'fs';
import { join } from 'path';

const clusterSource = readFileSync(join(__dirname, '../../hooks/useClusterPhotoUpload.ts'), 'utf8');
const useMediaSource = readFileSync(join(__dirname, '../../hooks/useMedia.ts'), 'utf8');

describe('useClusterPhotoUpload resize + bounded concurrency', () => {
  it('resizes every upload centrally in useUploadMedia (covers the cluster path)', () => {
    // The shared upload mutation imports and applies the resize helper, so the
    // cluster path (and the manual picker, and multi-cluster) all get resize.
    expect(useMediaSource).toMatch(
      /import\s+\{\s*resizeImageForUpload\s*\}\s+from\s+['"]@services\/mediaUpload['"]/
    );
    expect(useMediaSource).toMatch(/await\s+resizeImageForUpload\(\s*file\s*\)/);
  });

  it('cluster path uploads through the shared useUploadMedia mutation', () => {
    // It funnels uploads through uploadMedia.mutateAsync rather than a bespoke
    // uploader, which is what lets the central resize cover it.
    expect(clusterSource).toMatch(/uploadMedia\.mutateAsync\(/);
  });

  it('preserves the sequential for-loop (bounded concurrency)', () => {
    // The per-photo processing loop is a sequential for-loop.
    expect(clusterSource).toMatch(/for\s*\(\s*let\s+i\s*=\s*0;\s*i\s*<\s*photosToUpload\.length/);
  });

  it('does NOT fan out uploads with an unbounded Promise.all', () => {
    // Guard against a regression that maps uploadMedia over all photos at once.
    expect(clusterSource).not.toMatch(/Promise\.all\([^)]*uploadMedia/);
    expect(clusterSource).not.toMatch(/Promise\.all\([^)]*mutateAsync/);
    expect(clusterSource).not.toMatch(/Promise\.all\(\s*photosToUpload/);
  });
});
