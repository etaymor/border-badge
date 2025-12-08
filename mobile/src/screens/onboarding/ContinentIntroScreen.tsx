import { ResizeMode, Video } from 'expo-av';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { Button } from '@components/ui';
import { colors } from '@constants/colors';
import { ALL_REGIONS, REGIONS } from '@constants/regions';
import type { OnboardingStackScreenProps } from '@navigation/types';
import { useOnboardingStore } from '@stores/onboardingStore';
import { getContinentVideo } from '../../assets/continentVideos';

type Props = OnboardingStackScreenProps<'ContinentIntro'>;

export function ContinentIntroScreen({ navigation, route }: Props) {
  const { region, regionIndex } = route.params;
  const { addVisitedContinent } = useOnboardingStore();

  const canGoBack = navigation.canGoBack();
  const continentVideo = getContinentVideo(region);

  const handleYes = () => {
    addVisitedContinent(region);
    navigation.navigate('ContinentCountryGrid', { region });
  };

  const handleNo = () => {
    // Move to next continent or Antarctica prompt
    const nextIndex = regionIndex + 1;
    if (nextIndex < REGIONS.length) {
      navigation.navigate('ContinentIntro', {
        region: REGIONS[nextIndex],
        regionIndex: nextIndex,
      });
    } else {
      // After Oceania, show Antarctica prompt
      navigation.navigate('AntarcticaPrompt');
    }
  };

  return (
    <SafeAreaView style={styles.container}>
      {/* Back button */}
      {canGoBack && (
        <TouchableOpacity onPress={() => navigation.goBack()} style={styles.backButton}>
          <Text style={styles.backIcon}>‹</Text>
        </TouchableOpacity>
      )}

      <View style={styles.content}>
        {/* Continent video */}
        {continentVideo ? (
          <Video
            source={continentVideo}
            style={styles.video}
            resizeMode={ResizeMode.COVER}
            shouldPlay
            isLooping
            isMuted
          />
        ) : (
          <View style={styles.illustrationPlaceholder} />
        )}

        <View style={styles.card}>
          <Text style={styles.title}>Visited {region}?</Text>
          <Text style={styles.subtitle}>Tap &apos;Yes&apos; to select countries.</Text>

          <View style={styles.buttonContainer}>
            <Button title="Yes" onPress={handleYes} style={styles.yesButton} />
            <Button title="No" onPress={handleNo} variant="outline" style={styles.noButton} />
          </View>
        </View>

        {/* Progress indicator - 6 dots for all regions including Antarctica */}
        <View style={styles.progressContainer}>
          {ALL_REGIONS.map((_, index) => (
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
  backButton: {
    position: 'absolute',
    top: 60,
    left: 16,
    zIndex: 10,
    padding: 8,
  },
  backIcon: {
    fontSize: 32,
    color: colors.textPrimary,
    fontWeight: '300',
  },
  content: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 24,
  },
  video: {
    width: 200,
    height: 150,
    borderRadius: 16,
    marginBottom: 40,
    overflow: 'hidden',
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
