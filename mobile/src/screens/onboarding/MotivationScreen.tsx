import { Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import { useEffect, useRef } from 'react';
import { Animated, Image, ScrollView, StyleSheet, TouchableOpacity, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import atlasLogo from '../../../assets/atlasi-logo.png';
import { Chip, Text } from '@components/ui';
import { colors } from '@constants/colors';
import { fonts } from '@constants/typography';
import { useScreenEntrance } from '@hooks/useScreenEntrance';
import type { OnboardingStackScreenProps } from '@navigation/types';
import { Analytics } from '@services/analytics';
import {
  useOnboardingStore,
  selectMotivationTags,
  selectPersonaTags,
} from '@stores/onboardingStore';

type Props = OnboardingStackScreenProps<'Motivation'>;

// What draws you to travel
const MOTIVATION_TAGS = [
  'Adventure',
  'Food',
  'Culture',
  'Relaxation',
  'Nightlife',
  'Nature',
  'History',
];

// How you see yourself
const PERSONA_TAGS = ['Explorer', 'Storyteller', 'Foodie', 'Minimalist', 'Social Butterfly'];

// Floating chip animation component
interface FloatingChipProps {
  tag: string;
  selected: boolean;
  onPress: () => void;
  delay: number;
}

function FloatingChip({ tag, selected, onPress, delay }: FloatingChipProps) {
  const animValue = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    const timeoutId = setTimeout(() => {
      Animated.spring(animValue, {
        toValue: 1,
        friction: 6,
        tension: 80,
        useNativeDriver: true,
      }).start();
    }, delay);

    return () => clearTimeout(timeoutId);
  }, [animValue, delay]);

  const translateY = animValue.interpolate({
    inputRange: [0, 1],
    outputRange: [20, 0],
  });

  const opacity = animValue.interpolate({
    inputRange: [0, 0.3, 1],
    outputRange: [0, 0.8, 1],
  });

  return (
    <Animated.View
      style={{
        opacity,
        transform: [{ translateY }],
      }}
    >
      <Chip label={tag} selected={selected} onPress={onPress} />
    </Animated.View>
  );
}

export function MotivationScreen({ navigation }: Props) {
  const motivationTags = useOnboardingStore(selectMotivationTags);
  const personaTags = useOnboardingStore(selectPersonaTags);
  const toggleMotivationTag = useOnboardingStore((s) => s.toggleMotivationTag);
  const togglePersonaTag = useOnboardingStore((s) => s.togglePersonaTag);

  // Premium entrance animation for screen structure
  const { getAnimatedStyle, getButtonStyle } = useScreenEntrance({ elementCount: 4 });

  // Track screen view
  useEffect(() => {
    Analytics.viewOnboardingMotivation();
  }, []);

  const handleNext = () => {
    navigation.navigate('HomeCountry');
  };

  const handleLogin = () => {
    Analytics.skipToLogin('Motivation');
    navigation.navigate('Auth', { screen: 'Login' });
  };

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      {/* Header with logo and login */}
      <View style={styles.headerRow}>
        <Image source={atlasLogo} style={styles.logo} resizeMode="contain" />
        <TouchableOpacity onPress={handleLogin} style={styles.loginButton}>
          <Text variant="label" style={styles.loginText}>
            Login
          </Text>
        </TouchableOpacity>
      </View>

      <ScrollView
        style={styles.scrollContainer}
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
      >
        {/* Title */}
        <Animated.View style={[styles.header, getAnimatedStyle(0)]}>
          <Text variant="title" style={styles.title}>
            Tell us about you
          </Text>
        </Animated.View>

        {/* Why I Travel Section */}
        <Animated.View style={[styles.section, getAnimatedStyle(1)]}>
          <Text style={styles.sectionTitle}>I travel for...</Text>
          <View style={styles.chipContainer}>
            {MOTIVATION_TAGS.map((tag, index) => (
              <FloatingChip
                key={tag}
                tag={tag}
                selected={motivationTags.includes(tag)}
                onPress={() => {
                  Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                  toggleMotivationTag(tag);
                }}
                delay={300 + index * 60}
              />
            ))}
          </View>
        </Animated.View>

        {/* I Am A... Section */}
        <Animated.View style={[styles.section, getAnimatedStyle(2)]}>
          <Text style={styles.sectionTitle}>I am a...</Text>
          <View style={styles.chipContainer}>
            {PERSONA_TAGS.map((tag, index) => (
              <FloatingChip
                key={tag}
                tag={tag}
                selected={personaTags.includes(tag)}
                onPress={() => {
                  Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                  togglePersonaTag(tag);
                }}
                delay={700 + index * 60}
              />
            ))}
          </View>
        </Animated.View>
      </ScrollView>

      {/* Footer with Next button */}
      <Animated.View style={[styles.footer, getButtonStyle(3)]}>
        <TouchableOpacity style={styles.nextButton} onPress={handleNext}>
          <Text variant="label" style={styles.nextButtonText}>
            Continue
          </Text>
          <Ionicons name="arrow-forward" size={20} color={colors.midnightNavy} />
        </TouchableOpacity>
      </Animated.View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.warmCream,
  },
  headerRow: {
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 20,
    paddingTop: 8,
    paddingBottom: 4,
  },
  logo: {
    width: 140,
    height: 40,
  },
  loginButton: {
    position: 'absolute',
    right: 20,
    paddingVertical: 8,
    paddingHorizontal: 16,
  },
  loginText: {
    color: colors.midnightNavy,
  },
  scrollContainer: {
    flex: 1,
  },
  scrollContent: {
    paddingTop: 32,
    paddingBottom: 24,
  },
  header: {
    marginBottom: 40,
    paddingHorizontal: 28,
  },
  title: {
    color: colors.midnightNavy,
  },
  section: {
    marginBottom: 44,
  },
  sectionTitle: {
    fontFamily: fonts.dawning.regular,
    fontSize: 34,
    lineHeight: 44,
    color: colors.adobeBrick,
    marginBottom: 20,
    paddingHorizontal: 28,
  },
  chipContainer: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 14,
    paddingHorizontal: 28,
  },
  footer: {
    paddingTop: 16,
    paddingBottom: 40,
    paddingHorizontal: 28,
  },
  nextButton: {
    backgroundColor: colors.sunsetGold,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    alignSelf: 'center',
    paddingVertical: 16,
    paddingHorizontal: 56,
    borderRadius: 9999,
    gap: 8,
    minWidth: 260,
    shadowColor: colors.shadow,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.2,
    shadowRadius: 8,
    elevation: 4,
  },
  nextButtonText: {
    fontSize: 16,
    color: colors.midnightNavy,
    fontWeight: '600',
  },
});
