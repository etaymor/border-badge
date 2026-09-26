/**
 * Guard: Info.plist and expo-media-library must advertise the same Photos
 * purpose string. Divergent copy was shipping two different OS sheet texts.
 */

import appConfig, { PHOTO_LIBRARY_USAGE_DESCRIPTION } from '../../../app.config';

function mediaLibraryConfig(): { photosPermission: string; savePhotosPermission?: string } | null {
  for (const plugin of appConfig.expo.plugins) {
    if (!Array.isArray(plugin) || plugin[0] !== 'expo-media-library') continue;
    const config = plugin[1];
    if (
      config &&
      typeof config === 'object' &&
      'photosPermission' in config &&
      typeof config.photosPermission === 'string'
    ) {
      return config;
    }
  }
  return null;
}

describe('photo library usage description', () => {
  const pluginConfig = mediaLibraryConfig();

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
    expect(pluginConfig).toBeDefined();
    const pluginPermission = pluginConfig?.photosPermission;
    const plistPermission = appConfig.expo.ios.infoPlist.NSPhotoLibraryUsageDescription;

    expect(plistPermission).toBe(PHOTO_LIBRARY_USAGE_DESCRIPTION);
    expect(pluginPermission).toBe(PHOTO_LIBRARY_USAGE_DESCRIPTION);
    expect(plistPermission).toBe(pluginPermission);
  });

  it('leaves save-to-library permission thin (not full-library preheat scope)', () => {
    expect(pluginConfig).toMatchObject({
      savePhotosPermission: 'Allow Atlasi to save photos.',
    });
  });
});
