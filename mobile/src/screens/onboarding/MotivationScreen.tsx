import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { Button, Chip } from '@components/ui';
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
          <Text style={styles.step}>Step 1 of 4</Text>
          <Text style={styles.title}>What moves you to explore?</Text>
        </View>

        <ScrollView style={styles.scrollContainer} showsVerticalScrollIndicator={false}>
          {/* Why I Travel Section */}
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Why I Travel</Text>
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
            <Text style={styles.sectionTitle}>I Am A...</Text>
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
    backgroundColor: '#fff',
  },
  content: {
    flex: 1,
    paddingHorizontal: 24,
    paddingTop: 24,
  },
  header: {
    marginBottom: 24,
  },
  step: {
    fontSize: 14,
    color: '#007AFF',
    fontWeight: '600',
    marginBottom: 8,
  },
  title: {
    fontSize: 28,
    fontWeight: 'bold',
    color: '#1a1a1a',
  },
  scrollContainer: {
    flex: 1,
  },
  section: {
    marginBottom: 24,
  },
  sectionTitle: {
    fontSize: 18,
    fontWeight: '600',
    color: '#1a1a1a',
    marginBottom: 16,
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
