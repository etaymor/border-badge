/* eslint-disable @typescript-eslint/no-require-imports */
import { Image, ImageSourcePropType, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { Button } from '@components/ui';
import { ALL_REGIONS } from '@constants/regions';
import type { OnboardingStackScreenProps } from '@navigation/types';
import { useOnboardingStore } from '@stores/onboardingStore';

const antarcticaImage: ImageSourcePropType = require('../../../assets/country-images/continents/Antarctica.png');

type Props = OnboardingStackScreenProps<'AntarcticaPrompt'>;

const ANTARCTICA_CODE = 'AQ';

export function AntarcticaPromptScreen({ navigation }: Props) {
  const { addVisitedContinent, toggleCountry, visitedContinents } = useOnboardingStore();

  const handleYes = () => {
    // Add Antarctica as visited continent and select the country
    addVisitedContinent('Antarctica');
    toggleCountry(ANTARCTICA_CODE);
    navigation.navigate('ProgressSummary');
  };

  const handleNo = () => {
    // Just proceed without selecting Antarctica
    navigation.navigate('ProgressSummary');
  };

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.content}>
        {/* Antarctica illustration */}
        <Image source={antarcticaImage} style={styles.illustration} resizeMode="cover" />

        <View style={styles.card}>
          <Text style={styles.title}>Been to Antarctica?</Text>
          <Text style={styles.subtitle}>
            Only ~1% of travelers have visited the frozen continent.
          </Text>

          <View style={styles.buttonContainer}>
            <Button title="Yes" onPress={handleYes} style={styles.yesButton} />
            <Button title="No" onPress={handleNo} variant="outline" style={styles.noButton} />
          </View>
        </View>

        {/* Progress indicator - 6 dots for all regions including Antarctica */}
        <View style={styles.progressContainer}>
          {ALL_REGIONS.map((region, index) => (
            <View
              key={region}
              style={[
                styles.progressDot,
                // Antarctica (index 5) is always active on this screen
                index === 5 && styles.progressDotActive,
                // Previous regions are completed if visited
                index < 5 && visitedContinents.includes(region) && styles.progressDotCompleted,
              ]}
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
  illustration: {
    width: 200,
    height: 150,
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
  progressDotCompleted: {
    backgroundColor: '#34C759',
  },
});
