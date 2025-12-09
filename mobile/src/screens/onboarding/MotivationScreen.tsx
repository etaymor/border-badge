import { ScrollView, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { Button, Chip, Text } from '@components/ui';
import { colors } from '@constants/colors';
import type { OnboardingStackScreenProps } from '@navigation/types';
import { useOnboardingStore } from '@stores/onboardingStore';

type Props = OnboardingStackScreenProps<'Motivation'>;

// "Why I Travel" motivation tags
const MOTIVATION_TAGS = ['Adventure', 'Food', 'Culture', 'Relax', 'Nature', 'Nightlife', 'History'];

// "I Am A..." persona tags
const PERSONA_TAGS = ['Explorer', 'Foodie', 'Story-Teller', 'Minimalist', 'Social Butterfly'];

export function MotivationScreen({ navigation }: Props) {
  const { motivationTags, toggleMotivationTag, personaTags, togglePersonaTag } =
    useOnboardingStore();

  const handleNext = () => {
    navigation.navigate('HomeCountry');
  };

  const handleSkip = () => {
    navigation.navigate('HomeCountry');
  };

  const hasAnySelection = motivationTags.length > 0 || personaTags.length > 0;

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.content}>
        <View style={styles.header}>
          <Text variant="caption" style={styles.step}>Step 1 of 4</Text>
          <Text variant="title" style={styles.title}>What moves you to explore?</Text>
        </View>

        <ScrollView style={styles.scrollContainer} showsVerticalScrollIndicator={false}>
          {/* Why I Travel Section */}
          <View style={styles.section}>
            <Text variant="heading" style={styles.sectionTitle}>Why I Travel</Text>
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
          </View>

          {/* I Am A... Section */}
          <View style={styles.section}>
            <Text variant="heading" style={styles.sectionTitle}>I Am A...</Text>
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
          </View>
        </ScrollView>

        <View style={styles.footer}>
          <Button
            title="Next"
            onPress={handleNext}
            disabled={!hasAnySelection}
            style={styles.button}
          />
          <Button title="Skip" onPress={handleSkip} variant="ghost" style={styles.skipButton} />
        </View>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.warmCream,
  },
  content: {
    flex: 1,
    paddingHorizontal: 24,
    paddingTop: 24,
  },
  header: {
    marginBottom: 32,
  },
  step: {
    color: colors.primary, // Or Adobe Brick for accent
    marginBottom: 8,
    textTransform: 'uppercase',
    letterSpacing: 1,
  },
  title: {
    marginBottom: 8,
  },
  scrollContainer: {
    flex: 1,
  },
  section: {
    marginBottom: 32,
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
  },
  button: {
    width: '100%',
  },
  skipButton: {
    width: '100%',
    marginTop: 8,
  },
});
