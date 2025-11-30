import { StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { Button } from '@components/ui';
import type { OnboardingStackScreenProps } from '@navigation/types';
import { useOnboardingStore } from '@stores/onboardingStore';

type Props = OnboardingStackScreenProps<'ContinentIntro'>;

// Regions in order for continent loop
const REGIONS = ['Africa', 'Americas', 'Asia', 'Europe', 'Oceania'];

export function ContinentIntroScreen({ navigation, route }: Props) {
  const { region, regionIndex } = route.params;
  const { addVisitedContinent } = useOnboardingStore();

  const handleYes = () => {
    addVisitedContinent(region);
    navigation.navigate('ContinentCountryGrid', { region });
  };

  const handleNo = () => {
    // Move to next continent or progress summary
    const nextIndex = regionIndex + 1;
    if (nextIndex < REGIONS.length) {
      navigation.navigate('ContinentIntro', {
        region: REGIONS[nextIndex],
        regionIndex: nextIndex,
      });
    } else {
      navigation.navigate('ProgressSummary');
    }
  };

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.content}>
        {/* Grey placeholder for continent illustration */}
        <View style={styles.illustrationPlaceholder} />

        <View style={styles.card}>
          <Text style={styles.title}>Visited {region}?</Text>
          <Text style={styles.subtitle}>Tap &apos;Yes&apos; to select countries.</Text>

          <View style={styles.buttonContainer}>
            <Button title="Yes" onPress={handleYes} style={styles.yesButton} />
            <Button title="No" onPress={handleNo} variant="outline" style={styles.noButton} />
          </View>
        </View>

        {/* Progress indicator */}
        <View style={styles.progressContainer}>
          {REGIONS.map((_, index) => (
            <View
              key={index}
              style={[styles.progressDot, index === regionIndex && styles.progressDotActive]}
            />
          ))}
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
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 24,
  },
  illustrationPlaceholder: {
    width: 200,
    height: 150,
    backgroundColor: '#E5E5EA',
    borderRadius: 16,
    marginBottom: 40,
  },
  card: {
    backgroundColor: '#F2F2F7',
    borderRadius: 20,
    paddingVertical: 32,
    paddingHorizontal: 24,
    width: '100%',
    alignItems: 'center',
  },
  title: {
    fontSize: 28,
    fontWeight: 'bold',
    color: '#1a1a1a',
    marginBottom: 8,
    textAlign: 'center',
  },
  subtitle: {
    fontSize: 16,
    color: '#666',
    marginBottom: 24,
    textAlign: 'center',
  },
  buttonContainer: {
    flexDirection: 'row',
    gap: 12,
    width: '100%',
  },
  yesButton: {
    flex: 1,
  },
  noButton: {
    flex: 1,
  },
  progressContainer: {
    flexDirection: 'row',
    marginTop: 40,
    gap: 8,
  },
  progressDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: '#E5E5EA',
  },
  progressDotActive: {
    backgroundColor: '#007AFF',
    width: 24,
  },
});
