import { Ionicons } from '@expo/vector-icons';
import { useEffect, useRef } from 'react';
import {
  Animated,
  Easing,
  Image,
  ScrollView,
  StyleSheet,
  TouchableOpacity,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import atlasLogo from '../../../assets/atlasi-logo.png';
import { Chip, Text } from '@components/ui';
import { colors } from '@constants/colors';
import type { OnboardingStackScreenProps } from '@navigation/types';
import { Analytics } from '@services/analytics';
import { useOnboardingStore } from '@stores/onboardingStore';

type Props = OnboardingStackScreenProps<'Motivation'>;

// "Why I Travel" motivation tags
const MOTIVATION_TAGS = ['Adventure', 'Food', 'Culture', 'Relax', 'Nightlife', 'Nature', 'History'];

// "I Am A..." persona tags
const PERSONA_TAGS = ['Explorer', 'Storyteller', 'Foodie', 'Minimalist', 'Social Butterfly'];

// Pre-calculate random rotations for sticker-like placement
const STICKER_ROTATIONS = [
  ...MOTIVATION_TAGS.map((_, i) => (i % 2 === 0 ? 1 : -1) * (2 + ((i * 1.5) % 4))),
  ...PERSONA_TAGS.map((_, i) => (i % 2 === 0 ? -1 : 1) * (1.5 + ((i * 2) % 3))),
];

// Floating sticker animation component for individual chips
interface FloatingChipProps {
  tag: string;
  selected: boolean;
  onPress: () => void;
  index: number;
  delay: number;
}

function FloatingChip({ tag, selected, onPress, index, delay }: FloatingChipProps) {
  const animValue = useRef(new Animated.Value(0)).current;
  const rotation = STICKER_ROTATIONS[index] || 0;

  useEffect(() => {
    // Stagger the animation start based on delay
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

  // Interpolate for floating sticker effect
  const translateY = animValue.interpolate({
    inputRange: [0, 1],
    outputRange: [30, 0],
  });

  const scale = animValue.interpolate({
    inputRange: [0, 0.5, 1],
    outputRange: [0.8, 1.05, 1],
  });

  const opacity = animValue.interpolate({
    inputRange: [0, 0.3, 1],
    outputRange: [0, 0.8, 1],
  });

  const rotate = animValue.interpolate({
    inputRange: [0, 0.5, 1],
    outputRange: [`${rotation * 2}deg`, `${-rotation * 0.5}deg`, `${rotation * 0.3}deg`],
  });

  return (
    <Animated.View
      style={{
        opacity,
        transform: [{ translateY }, { scale }, { rotate }],
      }}
    >
      <Chip label={tag} selected={selected} onPress={onPress} />
    </Animated.View>
  );
}

export function MotivationScreen({ navigation }: Props) {
  const { motivationTags, toggleMotivationTag, personaTags, togglePersonaTag } =
    useOnboardingStore();

  // Section header animations
  const titleOpacity = useRef(new Animated.Value(0)).current;
  const titleTranslate = useRef(new Animated.Value(20)).current;
  const section1Opacity = useRef(new Animated.Value(0)).current;
  const section1Translate = useRef(new Animated.Value(20)).current;
  const section2Opacity = useRef(new Animated.Value(0)).current;
  const section2Translate = useRef(new Animated.Value(20)).current;
  const buttonOpacity = useRef(new Animated.Value(0)).current;

  // Track screen view
  useEffect(() => {
    Analytics.viewOnboardingMotivation();
  }, []);

  useEffect(() => {
    // Staggered entrance for title and section headers
    Animated.sequence([
      // Main title
      Animated.parallel([
        Animated.timing(titleOpacity, {
          toValue: 1,
          duration: 400,
          useNativeDriver: true,
        }),
        Animated.timing(titleTranslate, {
          toValue: 0,
          duration: 400,
          easing: Easing.out(Easing.cubic),
          useNativeDriver: true,
        }),
      ]),
      // Section 1 title and translate
      Animated.parallel([
        Animated.timing(section1Opacity, {
          toValue: 1,
          duration: 300,
          useNativeDriver: true,
        }),
        Animated.timing(section1Translate, {
          toValue: 0,
          duration: 300,
          easing: Easing.out(Easing.cubic),
          useNativeDriver: true,
        }),
      ]),
      // Delay for chips to start floating in (chips animate themselves)
      Animated.delay(400),
      // Section 2 title and translate
      Animated.parallel([
        Animated.timing(section2Opacity, {
          toValue: 1,
          duration: 300,
          useNativeDriver: true,
        }),
        Animated.timing(section2Translate, {
          toValue: 0,
          duration: 300,
          easing: Easing.out(Easing.cubic),
          useNativeDriver: true,
        }),
      ]),
      // Button
      Animated.timing(buttonOpacity, {
        toValue: 1,
        duration: 300,
        useNativeDriver: true,
      }),
    ]).start();
  }, [
    titleOpacity,
    titleTranslate,
    section1Opacity,
    section1Translate,
    section2Opacity,
    section2Translate,
    buttonOpacity,
  ]);

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

      <View style={styles.content}>
        {/* Title - Text component handles responsive sizing */}
        <Animated.View
          style={[
            styles.header,
            {
              opacity: titleOpacity,
              transform: [{ translateY: titleTranslate }],
            },
          ]}
        >
          <Text variant="title" style={styles.title}>
            What kind of traveler are you?
          </Text>
        </Animated.View>

        <ScrollView style={styles.scrollContainer} showsVerticalScrollIndicator={false}>
          {/* Why I Travel Section */}
          <Animated.View
            style={[
              styles.section,
              {
                opacity: section1Opacity,
                transform: [{ translateY: section1Translate }],
              },
            ]}
          >
            <Text variant="accent" style={styles.sectionTitle}>
              Why I Travel
            </Text>
            <View style={styles.chipContainer}>
              {MOTIVATION_TAGS.map((tag, index) => (
                <FloatingChip
                  key={tag}
                  tag={tag}
                  selected={motivationTags.includes(tag)}
                  onPress={() => toggleMotivationTag(tag)}
                  index={index}
                  delay={index * 60}
                />
              ))}
            </View>
          </Animated.View>

          {/* I Am A... Section */}
          <Animated.View
            style={[
              styles.section,
              {
                opacity: section2Opacity,
                transform: [{ translateY: section2Translate }],
              },
            ]}
          >
            <Text variant="accent" style={styles.sectionTitle}>
              I am a . . .
            </Text>
            <View style={styles.chipContainer}>
              {PERSONA_TAGS.map((tag, index) => (
                <FloatingChip
                  key={tag}
                  tag={tag}
                  selected={personaTags.includes(tag)}
                  onPress={() => togglePersonaTag(tag)}
                  index={MOTIVATION_TAGS.length + index}
                  delay={600 + index * 60}
                />
              ))}
            </View>
          </Animated.View>
        </ScrollView>

        {/* Footer with Next button */}
        <Animated.View style={[styles.footer, { opacity: buttonOpacity }]}>
          <TouchableOpacity style={styles.nextButton} onPress={handleNext}>
            <Text variant="label" style={styles.nextButtonText}>
              Next
            </Text>
            <Ionicons name="arrow-forward" size={20} color={colors.midnightNavy} />
          </TouchableOpacity>
        </Animated.View>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.lakeBlue,
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
  content: {
    flex: 1,
    paddingHorizontal: 24,
    paddingTop: 16,
  },
  header: {
    marginBottom: 24,
  },
  title: {
    color: colors.midnightNavy,
  },
  scrollContainer: {
    flex: 1,
    overflow: 'visible',
  },
  section: {
    marginBottom: 28,
    overflow: 'visible',
  },
  sectionTitle: {
    marginBottom: 16,
    color: colors.midnightNavy,
  },
  chipContainer: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    marginLeft: -8,
    paddingLeft: 8,
    overflow: 'visible',
  },
  footer: {
    paddingVertical: 24,
    paddingBottom: 40,
  },
  nextButton: {
    backgroundColor: colors.sunsetGold,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    alignSelf: 'center',
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
  nextButtonText: {
    fontSize: 16,
    color: colors.midnightNavy,
    fontWeight: '600',
  },
});
