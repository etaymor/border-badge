import * as Haptics from 'expo-haptics';
import { useEffect, useMemo, useRef } from 'react';
import {
  Animated,
  Image,
  ScrollView,
  StyleSheet,
  TouchableOpacity,
  useWindowDimensions,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { Text } from '@components/ui';
import { colors } from '@constants/colors';
import { fonts } from '@constants/typography';
import type { OnboardingStackScreenProps } from '@navigation/types';
import { useOnboardingStore } from '@stores/onboardingStore';

import { getStampImage } from '../../assets/stampImages';

type Props = OnboardingStackScreenProps<'ProgressSummary'>;

const TOTAL_COUNTRIES = 198;

// Stamp layout calculation - clean grid with slight rotation
function calculateStampPositions(count: number, containerWidth: number) {
  const cols = count <= 4 ? 2 : count <= 9 ? 3 : 4;
  const gap = 12;
  const stampSize = (containerWidth - (cols - 1) * gap) / cols;
  const positions: { x: number; y: number; rotation: number; size: number }[] = [];

  // Seeded random for consistent rotations
  const seededRandom = (seed: number) => {
    const x = Math.sin(seed) * 10000;
    return x - Math.floor(x);
  };

  for (let i = 0; i < count; i++) {
    const col = i % cols;
    const row = Math.floor(i / cols);
    const rotation = (seededRandom(i * 17) - 0.5) * 8; // -4 to +4 degrees

    positions.push({
      x: col * (stampSize + gap),
      y: row * (stampSize + gap),
      rotation,
      size: stampSize,
    });
  }

  return positions;
}

export function ProgressSummaryScreen({ navigation }: Props) {
  const { width: screenWidth } = useWindowDimensions();
  const { selectedCountries, homeCountry } = useOnboardingStore();

  // Animation refs
  const contentOpacity = useRef(new Animated.Value(0)).current;
  const stampAnimations = useRef<Animated.Value[]>([]);

  // Include home country in visited count if set
  const allVisitedCountries = useMemo(() => {
    const countries = new Set(selectedCountries);
    if (homeCountry) countries.add(homeCountry);
    return Array.from(countries);
  }, [selectedCountries, homeCountry]);

  const visitedCount = allVisitedCountries.length;
  const visibleStamps = allVisitedCountries;

  const containerWidth = screenWidth - 32; // 16px padding on each side
  const stampPositions = useMemo(
    () => calculateStampPositions(visibleStamps.length, containerWidth),
    [visibleStamps.length, containerWidth]
  );

  // Calculate stamp grid height
  const gridHeight = useMemo(() => {
    if (stampPositions.length === 0) return 200;
    const lastPos = stampPositions[stampPositions.length - 1];
    return lastPos.y + lastPos.size + 16;
  }, [stampPositions]);

  // Initialize stamp animations when stamp count changes
  useEffect(() => {
    stampAnimations.current = [];
    for (let i = 0; i < visibleStamps.length; i++) {
      stampAnimations.current.push(new Animated.Value(0));
    }
  }, [visibleStamps.length]);

  // Run animations with cleanup
  useEffect(() => {
    const timeoutIds: ReturnType<typeof setTimeout>[] = [];

    // Fade in content
    Animated.timing(contentOpacity, {
      toValue: 1,
      duration: 400,
      useNativeDriver: true,
    }).start();

    // Stagger stamp animations
    const stampDelay = 500;
    const staggerDelay = 80;

    visibleStamps.forEach((_, index) => {
      const timeoutId = setTimeout(
        () => {
          if (stampAnimations.current[index]) {
            Animated.spring(stampAnimations.current[index], {
              toValue: 1,
              friction: 8,
              tension: 100,
              useNativeDriver: true,
            }).start();

            Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
          }
        },
        stampDelay + index * staggerDelay
      );
      timeoutIds.push(timeoutId);
    });

    return () => {
      timeoutIds.forEach(clearTimeout);
    };
  }, [visibleStamps, contentOpacity]);

  const handleContinue = () => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    navigation.navigate('Paywall');
  };

  return (
    <View style={styles.container}>
      <SafeAreaView style={styles.safeArea} edges={['top', 'left', 'right']}>
        <Animated.View style={[styles.content, { opacity: contentOpacity }]}>
          <ScrollView
            contentContainerStyle={styles.scrollContent}
            showsVerticalScrollIndicator={false}
          >
            {/* Header */}
            <View style={styles.header}>
              <Text style={styles.headerTitle}>Look at those stamps!</Text>
              <Text style={styles.headerSubtitle}>
                You&apos;ve explored {visitedCount} of {TOTAL_COUNTRIES} countries!
              </Text>
            </View>

            {/* Stamp Grid */}
            <View style={styles.stampSection}>
              {visibleStamps.length > 0 ? (
                <View style={[styles.stampGrid, { height: gridHeight }]}>
                  {visibleStamps.map((code, index) => {
                    const stampImage = getStampImage(code);
                    const pos = stampPositions[index];
                    const animValue = stampAnimations.current[index] || new Animated.Value(1);

                    if (!stampImage || !pos) return null;

                    return (
                      <Animated.View
                        key={code}
                        style={[
                          styles.stampWrapper,
                          {
                            left: pos.x,
                            top: pos.y,
                            width: pos.size,
                            height: pos.size,
                            transform: [
                              { rotate: `${pos.rotation}deg` },
                              {
                                scale: animValue.interpolate({
                                  inputRange: [0, 1],
                                  outputRange: [0.5, 1],
                                }),
                              },
                            ],
                            opacity: animValue,
                          },
                        ]}
                      >
                        <Image source={stampImage} style={styles.stampImage} resizeMode="contain" />
                      </Animated.View>
                    );
                  })}
                </View>
              ) : (
                <View style={styles.emptyState}>
                  <Text style={styles.emptyText}>Your passport awaits its first stamp</Text>
                </View>
              )}
            </View>
          </ScrollView>
        </Animated.View>

        {/* Footer Button - fixed position matching other onboarding screens */}
        <View style={styles.bottomContainer}>
          <TouchableOpacity
            style={styles.continueButton}
            onPress={handleContinue}
            activeOpacity={0.9}
          >
            <Text style={styles.continueButtonText}>Save Progress</Text>
          </TouchableOpacity>
        </View>
      </SafeAreaView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.warmCream,
  },
  safeArea: {
    flex: 1,
  },
  content: {
    flex: 1,
  },
  scrollContent: {
    flexGrow: 1,
    paddingBottom: 120,
  },
  // Header
  header: {
    paddingHorizontal: 16,
    paddingTop: 16,
    paddingBottom: 24,
    alignItems: 'center',
  },
  headerTitle: {
    fontFamily: fonts.playfair.bold,
    fontSize: 28,
    color: colors.midnightNavy,
    textAlign: 'center',
    marginBottom: 8,
  },
  headerSubtitle: {
    fontFamily: fonts.openSans.regular,
    fontSize: 16,
    color: colors.stormGray,
    textAlign: 'center',
  },
  // Stamp Section
  stampSection: {
    flex: 1,
    paddingHorizontal: 16,
  },
  stampGrid: {
    width: '100%',
    position: 'relative',
  },
  stampWrapper: {
    position: 'absolute',
  },
  stampImage: {
    width: '100%',
    height: '100%',
  },
  emptyState: {
    paddingVertical: 60,
    alignItems: 'center',
  },
  emptyText: {
    fontFamily: fonts.dawning.regular,
    fontSize: 24,
    color: colors.stormGray,
    textAlign: 'center',
  },
  // Footer - matching CountrySelectionScreen
  bottomContainer: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    paddingHorizontal: 24,
    paddingVertical: 24,
    paddingBottom: 40,
    alignItems: 'center',
  },
  continueButton: {
    backgroundColor: colors.sunsetGold,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 16,
    paddingHorizontal: 56,
    borderRadius: 12,
    gap: 8,
    minWidth: 260,
    shadowColor: colors.shadow,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.2,
    shadowRadius: 8,
    elevation: 4,
  },
  continueButtonText: {
    fontSize: 16,
    fontWeight: '600',
    color: colors.midnightNavy,
  },
});
