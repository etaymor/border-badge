import { Ionicons } from '@expo/vector-icons';
import { useEffect, useRef } from 'react';
import { Animated, Image, ScrollView, StyleSheet, TouchableOpacity, View } from 'react-native';
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

export function MotivationScreen({ navigation }: Props) {
  const { motivationTags, toggleMotivationTag, personaTags, togglePersonaTag } =
    useOnboardingStore();

  // Staggered fade-in animations
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
    // Staggered entrance animations
    Animated.sequence([
      Animated.parallel([
        Animated.timing(titleOpacity, {
          toValue: 1,
          duration: 400,
          useNativeDriver: true,
        }),
        Animated.timing(titleTranslate, {
          toValue: 0,
          duration: 400,
          useNativeDriver: true,
        }),
      ]),
      Animated.parallel([
        Animated.timing(section1Opacity, {
          toValue: 1,
          duration: 400,
          useNativeDriver: true,
        }),
        Animated.timing(section1Translate, {
          toValue: 0,
          duration: 400,
          useNativeDriver: true,
        }),
      ]),
      Animated.parallel([
        Animated.timing(section2Opacity, {
          toValue: 1,
          duration: 400,
          useNativeDriver: true,
        }),
        Animated.timing(section2Translate, {
          toValue: 0,
          duration: 400,
          useNativeDriver: true,
        }),
      ]),
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
    navigation.navigate('Auth', { screen: 'Auth' });
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
        {/* Title */}
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
              {MOTIVATION_TAGS.map((tag) => (
                <Chip
                  key={tag}
                  label={tag}
                  selected={motivationTags.includes(tag)}
                  onPress={() => toggleMotivationTag(tag)}
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
              {PERSONA_TAGS.map((tag) => (
                <Chip
                  key={tag}
                  label={tag}
                  selected={personaTags.includes(tag)}
                  onPress={() => togglePersonaTag(tag)}
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
    marginBottom: 32,
  },
  title: {
    fontSize: 32,
    lineHeight: 40,
    color: colors.midnightNavy,
  },
  scrollContainer: {
    flex: 1,
  },
  section: {
    marginBottom: 28,
  },
  sectionTitle: {
    marginBottom: 16,
    color: colors.midnightNavy,
  },
  chipContainer: {
    flexDirection: 'row',
    flexWrap: 'wrap',
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
