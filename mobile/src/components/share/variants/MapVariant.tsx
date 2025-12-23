import React, { memo, useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Image, ImageBackground, StyleSheet, View } from 'react-native';

import { Text } from '@components/ui';
import { colors, withAlpha } from '@constants/colors';
import { fonts } from '@constants/typography';
import { useCountryByCode } from '@hooks/useCountries';
import { classifyTraveler, type TravelerClassificationResponse } from '@services/api';

import { getCountryImage } from '../../../assets/countryImages';
import atlasLogo from '../../../../assets/atlasi-logo.png';
import { CARD_HEIGHT, CARD_WIDTH } from '../constants';
import type { VariantProps } from '../types';

/**
 * Card 3: Vibe - "Your Travel Identity"
 * Full-screen country image with LLM-powered traveler classification.
 * Shows traveler type badge and signature country that represents their travel style.
 */
export const MapVariant = memo(function MapVariant({ context }: VariantProps) {
  const { visitedCountries, totalCountries, motivationTags, personaTags, homeCountry } = context;

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
            home_country: homeCountry,
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
  }, [visitedCountries, interestTags, homeCountry]);

  // Determine signature country - from API or fallback to first visited
  const signatureCountryCode = classification?.signature_country || visitedCountries[0] || 'US';

  // Get country details for the signature country
  const { data: countryData } = useCountryByCode(signatureCountryCode);

  // Get country image
  const countryImage = useMemo(() => getCountryImage(signatureCountryCode), [signatureCountryCode]);

  // Traveler type text
  const travelerType = classification?.traveler_type || 'Global Explorer';

  // Country name
  const countryName = countryData?.name || signatureCountryCode;

  // Scale font size based on country name length
  const countryNameFontSize = useMemo(() => {
    const len = countryName.length;
    if (len <= 6) return 42;
    if (len <= 10) return 36;
    if (len <= 14) return 30;
    if (len <= 18) return 26;
    return 22;
  }, [countryName]);

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
        {/* Top content area - Country info */}
        <View style={styles.topContent}>
          <Text style={styles.signatureLabel}>Your Signature Country</Text>
          <Text
            style={[
              styles.countryName,
              { fontSize: countryNameFontSize, lineHeight: countryNameFontSize + 8 },
            ]}
            numberOfLines={1}
          >
            {countryName.toUpperCase()}
          </Text>
        </View>

        {/* Footer with traveler type + logo */}
        <View style={styles.footer}>
          <Text style={styles.travelerTypeText}>I&apos;m a {travelerType}</Text>
          <View style={styles.logoRow}>
            <Image source={atlasLogo} style={styles.logo} resizeMode="contain" />
            <Text style={styles.tagline}>What&apos;s your country count?</Text>
            <Text style={styles.countNumber}>#{totalCountries}</Text>
          </View>
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
  // Top content area - country info
  topContent: {
    position: 'absolute',
    top: 32,
    left: 0,
    right: 0,
    alignItems: 'center',
    paddingHorizontal: 16,
  },
  signatureLabel: {
    fontFamily: fonts.openSans.semiBold,
    fontSize: 11,
    color: colors.midnightNavy,
    textAlign: 'center',
    letterSpacing: 1.5,
    textTransform: 'uppercase',
    marginBottom: 2,
  },
  countryName: {
    fontFamily: fonts.oswald.bold,
    fontSize: 32,
    color: colors.midnightNavy,
    textAlign: 'center',
    letterSpacing: 2,
  },
  // Footer - warm cream background
  footer: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    backgroundColor: withAlpha(colors.warmCream, 0.98),
    paddingTop: 14,
    paddingBottom: 20,
    paddingHorizontal: 20,
    alignItems: 'center',
  },
  travelerTypeText: {
    fontFamily: fonts.oswald.medium,
    fontSize: 16,
    color: colors.midnightNavy,
    letterSpacing: 0.5,
    marginBottom: 4,
    textAlign: 'center',
  },
  countNumber: {
    fontFamily: fonts.oswald.bold,
    fontSize: 28,
    lineHeight: 32,
    color: colors.midnightNavy,
    marginLeft: 8,
  },
  logoRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
  },
  logo: {
    width: 80,
    height: 24,
  },
  tagline: {
    fontFamily: fonts.oswald.medium,
    fontSize: 12,
    color: colors.midnightNavy,
    letterSpacing: 0.5,
  },
});
