import { Animated } from 'react-native';

import { render, screen } from '../utils/testUtils';

import CountryHero from '@components/country/CountryHero';
import { getCountryImage } from '../../assets/countryImages';

const EXPO_IMAGE_HOST = 'ViewManagerAdapter_ExpoImage';

function makeInterpolation() {
  return new Animated.Value(0).interpolate({ inputRange: [0, 1], outputRange: [0, 1] });
}

const baseProps = {
  countryCode: 'JP',
  displayName: 'Japan',
  subregion: 'Eastern Asia',
  flagEmoji: '🇯🇵',
  heroHeight: 400,
  insetTop: 44,
  imageScale: makeInterpolation(),
  imageTranslateY: makeInterpolation(),
  titleScale: makeInterpolation(),
  titleOpacity: makeInterpolation(),
};

describe('CountryHero', () => {
  it('renders the hero image as an expo-image with contentFit cover and a sized style', () => {
    render(<CountryHero {...baseProps} countryImage={getCountryImage('JP')} />);

    const image = screen.getByTestId('country-hero-image');
    expect(image.type).toBe(EXPO_IMAGE_HOST);
    expect(image.props.contentFit).toBe('cover');
    expect(image.props.style).toEqual(expect.objectContaining({ width: '100%', height: '100%' }));
  });

  // U3 nav-regression fix: the hero must repaint from the memory cache on
  // remount (back-nav) instead of re-decoding, and keep a stable identity
  // across recycles keyed by the country code.
  it('renders the hero image with cachePolicy memory-disk and a country-code recyclingKey', () => {
    render(<CountryHero {...baseProps} countryCode="FR" countryImage={getCountryImage('FR')} />);

    const image = screen.getByTestId('country-hero-image');
    expect(image.props.cachePolicy).toBe('memory-disk');
    expect(image.props.recyclingKey).toBe('FR');
  });

  it('renders a solid fallback (no image) when countryImage is null', () => {
    render(<CountryHero {...baseProps} countryImage={null} />);

    expect(screen.queryByTestId('country-hero-image')).toBeNull();
    // Title still renders.
    expect(screen.getByText('Japan')).toBeTruthy();
  });
});
