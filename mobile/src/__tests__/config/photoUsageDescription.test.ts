/**
 * Guard: Info.plist and expo-media-library must advertise the same Photos
 * purpose string. Divergent copy was shipping two different OS sheet texts.
 */

import appConfig, { PHOTO_LIBRARY_USAGE_DESCRIPTION } from '../../../app.config';

describe('photo library usage description', () => {
  const mediaLibraryPlugin = appConfig.expo.plugins.find(
    (plugin): plugin is [string, { photosPermission: string }] =>
      Array.isArray(plugin) && plugin[0] === 'expo-media-library'
  );

  it('exports one shared string that names trips and Guess Where', () => {
    expect(PHOTO_LIBRARY_USAGE_DESCRIPTION).toMatch(/travel trips/i);
    expect(PHOTO_LIBRARY_USAGE_DESCRIPTION).toMatch(/Guess Where/i);
    expect(PHOTO_LIBRARY_USAGE_DESCRIPTION).toMatch(/on your device/i);
    expect(PHOTO_LIBRARY_USAGE_DESCRIPTION).toMatch(
      /Nothing is uploaded until you save a place or share a challenge/i
    );
    expect(PHOTO_LIBRARY_USAGE_DESCRIPTION).not.toMatch(/never upload/i);
  });

  it('keeps infoPlist and expo-media-library photosPermission identical', () => {
    expect(mediaLibraryPlugin).toBeDefined();
    const pluginPermission = mediaLibraryPlugin![1].photosPermission;
    const plistPermission = appConfig.expo.ios.infoPlist.NSPhotoLibraryUsageDescription;

    expect(plistPermission).toBe(PHOTO_LIBRARY_USAGE_DESCRIPTION);
    expect(pluginPermission).toBe(PHOTO_LIBRARY_USAGE_DESCRIPTION);
    expect(plistPermission).toBe(pluginPermission);
  });

  it('leaves save-to-library permission thin (not full-library preheat scope)', () => {
    expect(mediaLibraryPlugin![1]).toMatchObject({
      savePhotosPermission: 'Allow Atlasi to save photos.',
    });
  });
});
