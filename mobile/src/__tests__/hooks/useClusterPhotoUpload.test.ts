/**
 * Structural guards for the cluster photo-upload path (U8 / R12 upload-half).
 *
 * The cluster upload path (`useClusterPhotoUpload`) uploads photos in a
 * sequential `for` loop, giving it naturally bounded concurrency. The U8 resize
 * change inserts a single awaited `resizeImageForUpload(localFile)` call inside
 * that loop body. These tests guard the two invariants that matter and are
 * costly to regress:
 *
 *   1. Resize is applied to each converted photo before it is uploaded.
 *   2. Uploads remain sequential — NO unbounded `Promise.all` fan-out over the
 *      per-photo upload calls.
 *
 * We assert this at the source level rather than spinning up the full native
 * module stack (expo-media-library, expo-file-system/legacy, image manipulator,
 * React Query), which would add fragile mocking for no additional signal on
 * these particular invariants.
 */

import { readFileSync } from 'fs';
import { join } from 'path';

const source = readFileSync(join(__dirname, '../../hooks/useClusterPhotoUpload.ts'), 'utf8');

describe('useClusterPhotoUpload resize + bounded concurrency', () => {
  it('resizes each converted photo before upload', () => {
    // Imports the shared resize helper from the media-upload service.
    expect(source).toMatch(
      /import\s+\{\s*resizeImageForUpload\s*\}\s+from\s+['"]@services\/mediaUpload['"]/
    );
    // Applies the resize to the converted localFile.
    expect(source).toMatch(/resizeImageForUpload\(\s*localFile\s*\)/);
  });

  it('uploads the resized file (not the raw original)', () => {
    // The upload uses the resized file produced by resizeImageForUpload.
    expect(source).toMatch(/const\s+uploadFile\s*=\s*await\s+resizeImageForUpload/);
    expect(source).toMatch(/file:\s*uploadFile/);
  });

  it('preserves the sequential for-loop (bounded concurrency)', () => {
    // The per-photo processing loop is a sequential for-loop.
    expect(source).toMatch(/for\s*\(\s*let\s+i\s*=\s*0;\s*i\s*<\s*photosToUpload\.length/);
  });

  it('does NOT fan out uploads with an unbounded Promise.all', () => {
    // Guard against a regression that maps uploadMedia over all photos at once.
    expect(source).not.toMatch(/Promise\.all\([^)]*uploadMedia/);
    expect(source).not.toMatch(/Promise\.all\([^)]*mutateAsync/);
    expect(source).not.toMatch(/Promise\.all\(\s*photosToUpload/);
  });
});
