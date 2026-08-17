import { Animated } from 'react-native';

import { render, screen } from '../utils/testUtils';

import CelebrationOverlay from '@components/onboarding/CelebrationOverlay';
import type { CelebrationAnimationRefs } from '@hooks/useCountrySelectionAnimations';

const EXPO_IMAGE_HOST = 'ViewManagerAdapter_ExpoImage';

function makeAnimationRefs(): CelebrationAnimationRefs {
  return {
    selectionScale: new Animated.Value(1),
    selectionOpacity: new Animated.Value(1),
    flagScale: new Animated.Value(1),
    flagRotate: new Animated.Value(0),
    rippleScale: new Animated.Value(0),
    rippleOpacity: new Animated.Value(0),
    sparkleScale: new Animated.Value(0),
    sparkleRotate: new Animated.Value(0),
  };
}

describe('CelebrationOverlay', () => {
  it('renders the celebration image as an expo-image with explicit dimensions', () => {
    render(
      <CelebrationOverlay
        visible
        countryCode="JP"
        countryName="Japan"
        type="home"
        animationRefs={makeAnimationRefs()}
      />
    );

    const image = screen.getByTestId('celebration-image');
    expect(image.type).toBe(EXPO_IMAGE_HOST);
    expect(image.props.contentFit).toBe('contain');
    expect(image.props.recyclingKey).toBe('JP');
    expect(image.props.cachePolicy).toBe('memory-disk');
    // Style is an array; the last entry carries the explicit numeric width/height.
    const flat = Array.isArray(image.props.style)
      ? Object.assign({}, ...image.props.style.filter(Boolean))
      : image.props.style;
    expect(typeof flat.width).toBe('number');
    expect(typeof flat.height).toBe('number');
  });

  it('renders nothing when not visible', () => {
    render(
      <CelebrationOverlay
        visible={false}
        countryCode="JP"
        countryName="Japan"
        type="home"
        animationRefs={makeAnimationRefs()}
      />
    );

    expect(screen.queryByTestId('celebration-image')).toBeNull();
  });
});
