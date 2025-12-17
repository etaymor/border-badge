import React, { memo, useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Image, ImageBackground, StyleSheet, View } from 'react-native';
import { BlurView } from 'expo-blur';

import { Text } from '@components/ui';
import { colors, withAlpha } from '@constants/colors';
import { fonts } from '@constants/typography';
import { useCountryByCode } from '@hooks/useCountries';
import { classifyTraveler, type TravelerClassificationResponse } from '@services/api';
import { getFlagEmoji } from '@utils/flags';

import { getCountryImage } from '../../../assets/countryImages';
import atlasLogo from '../../../../assets/atlasi-logo.png';
import { CARD_HEIGHT, CARD_WIDTH, SCALE } from '../constants';
import type { VariantProps } from '../types';

/**
 * Card 3: Signature Country - "Your Travel Identity"
 * Full-screen country image with LLM-powered traveler classification.
 * Shows traveler type badge and signature country that represents their travel style.
 */
export const MapVariant = memo(function MapVariant({ context }: VariantProps) {
  const { visitedCountries, totalCountries, motivationTags, personaTags } = context;

  const [classification, setClassification] = useState<TravelerClassificationResponse | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [_error, setError] = useState(false);

  // AbortController ref for cancelling in-flight requests
  const abortControllerRef = useRef<AbortController | null>(null);

  // Combine motivation and persona tags for classification
  const interestTags = useMemo(
    () => [...motivationTags, ...personaTags],
    [motivationTags, personaTags]
  );

  // Call classification API on mount or when dependencies change
  useEffect(() => {
    // Abort any in-flight request before starting a new one
    abortControllerRef.current?.abort();
    abortControllerRef.current = new AbortController();
    const signal = abortControllerRef.current.signal;

    async function fetchClassification() {
      if (visitedCountries.length === 0) {
        setIsLoading(false);
        setError(true);
        return;
      }

      // Reset state for new request
      setIsLoading(true);
      setError(false);

      try {
        const result = await classifyTraveler(
          {
            countries_visited: visitedCountries,
            interest_tags: interestTags,
          },
          signal
        );

        // Only update state if this request wasn't aborted
        if (!signal.aborted) {
          setClassification(result);
          setIsLoading(false);
        }
      } catch (e) {
        // Ignore abort errors - they're expected during cleanup
        const error = e as Error;
        if (error.name === 'AbortError' || error.name === 'CanceledError') {
          return;
        }
        console.error('Classification failed:', e);
        if (!signal.aborted) {
          setError(true);
          setIsLoading(false);
        }
      }
    }

    fetchClassification();

    // Cleanup: abort request on unmount or before next effect run
    return () => {
      abortControllerRef.current?.abort();
    };
  }, [visitedCountries, interestTags]);

  // Determine signature country - from API or fallback to first visited
  const signatureCountryCode = classification?.signature_country || visitedCountries[0] || 'US';

  // Get country details for the signature country
  const { data: countryData } = useCountryByCode(signatureCountryCode);

  // Get country image
  const countryImage = useMemo(() => getCountryImage(signatureCountryCode), [signatureCountryCode]);

  // Traveler type text
  const travelerType = classification?.traveler_type || 'Global Explorer';

  // Flag emoji
  const flagEmoji = getFlagEmoji(signatureCountryCode);

  // Country name
  const countryName = countryData?.name || signatureCountryCode;

  // Loading state
  if (isLoading) {
    return (
      <View style={[styles.container, styles.loadingContainer]}>
        <ActivityIndicator size="large" color={colors.sunsetGold} />
        <Text style={styles.loadingText}>Analyzing your travels...</Text>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      {/* Full-screen country image */}
      <ImageBackground
        source={countryImage || undefined}
        style={styles.backgroundImage}
        resizeMode="cover"
      >
        {/* Dark overlay for better text readability */}
        <View style={styles.darkOverlay} />

        {/* Traveler Type Badge - Top */}
        <View style={styles.topBadgeContainer}>
          <BlurView intensity={60} tint="dark" style={styles.travelerTypeBadge}>
            <Text style={styles.travelerTypeLabel}>I&apos;m a</Text>
            <Text style={styles.travelerTypeText}>{travelerType}</Text>
          </BlurView>
        </View>

        {/* Bottom Content Overlay */}
        <View style={styles.bottomOverlay}>
          <BlurView intensity={80} tint="dark" style={styles.bottomBlurContainer}>
            {/* Country Name + Flag */}
            <View style={styles.countryRow}>
              <Text style={styles.flagEmoji}>{flagEmoji}</Text>
              <Text style={styles.countryName} numberOfLines={1}>
                {countryName.toUpperCase()}
              </Text>
            </View>

            {/* Country Count */}
            <View style={styles.countRow}>
              <Text style={styles.countNumber}>{totalCountries}</Text>
              <Text style={styles.countLabel}>COUNTRIES</Text>
            </View>

            {/* Logo + Tagline */}
            <View style={styles.logoRow}>
              <Image source={atlasLogo} style={styles.logo} resizeMode="contain" />
              <Text style={styles.tagline}>What&apos;s your country count?</Text>
            </View>
          </BlurView>
        </View>
      </ImageBackground>
    </View>
  );
});

const styles = StyleSheet.create({
  container: {
    flex: 1,
    width: CARD_WIDTH,
    height: CARD_HEIGHT,
  },
  loadingContainer: {
    backgroundColor: colors.midnightNavy,
    justifyContent: 'center',
    alignItems: 'center',
  },
  loadingText: {
    marginTop: 16,
    fontFamily: fonts.openSans.regular,
    fontSize: 14,
    color: withAlpha(colors.white, 0.8),
  },
  backgroundImage: {
    flex: 1,
    width: '100%',
    height: '100%',
  },
  darkOverlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: withAlpha(colors.midnightNavy, 0.3),
  },
  // Top Badge
  topBadgeContainer: {
    position: 'absolute',
    top: 60 * SCALE,
    left: 0,
    right: 0,
    alignItems: 'center',
  },
  travelerTypeBadge: {
    paddingHorizontal: 24 * SCALE,
    paddingVertical: 12 * SCALE,
    borderRadius: 16 * SCALE,
    overflow: 'hidden',
    backgroundColor: withAlpha(colors.midnightNavy, 0.4),
    borderWidth: 1,
    borderColor: withAlpha(colors.white, 0.2),
  },
  travelerTypeLabel: {
    fontFamily: fonts.openSans.regular,
    fontSize: 12 * SCALE,
    color: withAlpha(colors.white, 0.8),
    textAlign: 'center',
    letterSpacing: 1,
    textTransform: 'uppercase',
  },
  travelerTypeText: {
    fontFamily: fonts.oswald.bold,
    fontSize: 28 * SCALE,
    color: colors.white,
    textAlign: 'center',
    letterSpacing: 1,
    marginTop: 2,
    textShadowColor: withAlpha(colors.midnightNavy, 0.5),
    textShadowOffset: { width: 0, height: 2 },
    textShadowRadius: 4,
  },
  // Bottom Overlay
  bottomOverlay: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
  },
  bottomBlurContainer: {
    paddingTop: 24 * SCALE,
    paddingBottom: 40 * SCALE,
    paddingHorizontal: 24 * SCALE,
    overflow: 'hidden',
    backgroundColor: withAlpha(colors.midnightNavy, 0.5),
    borderTopWidth: 1,
    borderTopColor: withAlpha(colors.white, 0.1),
  },
  // Country Row
  countryRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 12 * SCALE,
    marginBottom: 16 * SCALE,
  },
  flagEmoji: {
    fontSize: 32 * SCALE,
  },
  countryName: {
    fontFamily: fonts.oswald.bold,
    fontSize: 28 * SCALE,
    color: colors.white,
    letterSpacing: 2,
    textShadowColor: withAlpha(colors.midnightNavy, 0.5),
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 4,
  },
  // Count Row
  countRow: {
    flexDirection: 'row',
    alignItems: 'baseline',
    justifyContent: 'center',
    gap: 8 * SCALE,
    marginBottom: 20 * SCALE,
  },
  countNumber: {
    fontFamily: fonts.oswald.bold,
    fontSize: 48 * SCALE,
    color: colors.sunsetGold,
    lineHeight: 52 * SCALE,
  },
  countLabel: {
    fontFamily: fonts.openSans.semiBold,
    fontSize: 14 * SCALE,
    color: withAlpha(colors.white, 0.7),
    letterSpacing: 2,
  },
  // Logo Row
  logoRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8 * SCALE,
  },
  logo: {
    width: 80 * SCALE,
    height: 24 * SCALE,
    tintColor: colors.white,
    opacity: 0.9,
  },
  tagline: {
    fontFamily: fonts.oswald.medium,
    fontSize: 12 * SCALE,
    color: withAlpha(colors.white, 0.8),
    letterSpacing: 0.5,
  },
});
