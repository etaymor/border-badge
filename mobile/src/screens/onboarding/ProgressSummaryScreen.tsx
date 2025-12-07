import { useMemo } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { Button } from '@components/ui';
import type { OnboardingStackScreenProps } from '@navigation/types';
import { useOnboardingStore } from '@stores/onboardingStore';

type Props = OnboardingStackScreenProps<'ProgressSummary'>;

const TOTAL_COUNTRIES = 198; // 197 countries + Antarctica

// Helper to get flag emoji from country code
function getFlagEmoji(countryCode: string): string {
  const codePoints = countryCode
    .toUpperCase()
    .split('')
    .map((char) => 127397 + char.charCodeAt(0));
  return String.fromCodePoint(...codePoints);
}

// Get celebratory copy based on count
function getCelebratoryText(count: number): string {
  if (count === 0) return 'Ready to start your journey?';
  if (count <= 3) return "You're just getting started!";
  if (count <= 10) return "You're an emerging explorer!";
  if (count <= 25) return "You're a seasoned traveler!";
  if (count <= 50) return "Impressive! You're a world wanderer!";
  if (count <= 100) return "Amazing! You're a global explorer!";
  return "Legendary! You've seen the world!";
}

// Get percentage rank (placeholder - would be real data in production)
function getPercentileRank(count: number): number {
  if (count === 0) return 100;
  if (count <= 3) return 60;
  if (count <= 10) return 35;
  if (count <= 25) return 20;
  if (count <= 50) return 10;
  return 5;
}

export function ProgressSummaryScreen({ navigation }: Props) {
  const { selectedCountries, homeCountry } = useOnboardingStore();

  // Include home country in visited count if set
  const allVisitedCountries = useMemo(() => {
    const countries = new Set(selectedCountries);
    if (homeCountry) countries.add(homeCountry);
    return Array.from(countries);
  }, [selectedCountries, homeCountry]);

  const visitedCount = allVisitedCountries.length;
  const visitedPercentage = Math.round((visitedCount / TOTAL_COUNTRIES) * 100);
  const percentileRank = getPercentileRank(visitedCount);

  const handleContinue = () => {
    navigation.navigate('Paywall');
  };

  return (
    <SafeAreaView style={styles.container}>
      <ScrollView contentContainerStyle={styles.scrollContent} showsVerticalScrollIndicator={false}>
        <View style={styles.content}>
          {/* Header */}
          <Text style={styles.title}>Look at those stamps!</Text>
          <Text style={styles.celebratoryText}>{getCelebratoryText(visitedCount)}</Text>

          {/* Flag grid */}
          {allVisitedCountries.length > 0 && (
            <View style={styles.flagGrid}>
              {allVisitedCountries.map((code) => (
                <Text key={code} style={styles.flagEmoji}>
                  {getFlagEmoji(code)}
                </Text>
              ))}
            </View>
          )}

          {/* Stats card */}
          <View style={styles.statsCard}>
            <Text style={styles.mainStat}>
              You&apos;ve explored{' '}
              <Text style={styles.statHighlight}>
                {visitedCount} / {TOTAL_COUNTRIES}
              </Text>{' '}
              places!
            </Text>

            <View style={styles.progressBar}>
              <View style={[styles.progressFill, { width: `${visitedPercentage}%` }]} />
            </View>

            <Text style={styles.percentileText}>Top {percentileRank}% of explorers</Text>
          </View>

          {/* Empty state */}
          {visitedCount === 0 && (
            <View style={styles.emptyState}>
              <View style={styles.emptyPlaceholder} />
              <Text style={styles.emptyText}>No countries logged yet. Your adventure awaits!</Text>
            </View>
          )}
        </View>
      </ScrollView>

      {/* Footer */}
      <View style={styles.footer}>
        <Button title="Continue" onPress={handleContinue} style={styles.continueButton} />
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#fff',
  },
  scrollContent: {
    flexGrow: 1,
  },
  content: {
    flex: 1,
    paddingHorizontal: 24,
    paddingTop: 40,
    alignItems: 'center',
  },
  title: {
    fontSize: 32,
    fontWeight: 'bold',
    color: '#1a1a1a',
    textAlign: 'center',
    marginBottom: 8,
  },
  celebratoryText: {
    fontSize: 18,
    color: '#666',
    textAlign: 'center',
    marginBottom: 32,
  },
  flagGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'center',
    gap: 8,
    marginBottom: 32,
    maxWidth: 320,
  },
  flagEmoji: {
    fontSize: 32,
  },
  statsCard: {
    backgroundColor: '#F2F2F7',
    borderRadius: 20,
    padding: 24,
    width: '100%',
    alignItems: 'center',
  },
  mainStat: {
    fontSize: 20,
    color: '#1a1a1a',
    textAlign: 'center',
    marginBottom: 16,
  },
  statHighlight: {
    fontWeight: 'bold',
    color: '#007AFF',
  },
  progressBar: {
    height: 12,
    backgroundColor: '#E5E5EA',
    borderRadius: 6,
    overflow: 'hidden',
    width: '100%',
    marginBottom: 12,
  },
  progressFill: {
    height: '100%',
    backgroundColor: '#007AFF',
    borderRadius: 6,
    minWidth: 12,
  },
  percentileText: {
    fontSize: 14,
    color: '#34C759',
    fontWeight: '600',
  },
  emptyState: {
    alignItems: 'center',
    marginTop: 32,
  },
  emptyPlaceholder: {
    width: 120,
    height: 120,
    backgroundColor: '#E5E5EA',
    borderRadius: 60,
    marginBottom: 16,
  },
  emptyText: {
    fontSize: 16,
    color: '#666',
    textAlign: 'center',
  },
  footer: {
    paddingHorizontal: 24,
    paddingVertical: 24,
    borderTopWidth: 1,
    borderTopColor: '#F2F2F7',
  },
  continueButton: {
    width: '100%',
  },
});
