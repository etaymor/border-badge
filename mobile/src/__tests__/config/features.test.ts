import { features, isFeatureEnabled } from '@config/features';

describe('features', () => {
  it('has expected feature flags defined', () => {
    expect(features).toHaveProperty('enableInteractiveMap');
    expect(features).toHaveProperty('enableMapClustering');
    expect(features).toHaveProperty('enableTripPhotos');
    expect(features).toHaveProperty('enableTripSharing');
  });

  it('isFeatureEnabled returns correct values', () => {
    // These features are enabled by default
    expect(isFeatureEnabled('enableInteractiveMap')).toBe(true);
    expect(isFeatureEnabled('enableMapClustering')).toBe(true);

    // These features are disabled by default (future phases)
    expect(isFeatureEnabled('enableTripPhotos')).toBe(false);
    expect(isFeatureEnabled('enableTripSharing')).toBe(false);
    expect(isFeatureEnabled('enableFriends')).toBe(false);
  });
});
