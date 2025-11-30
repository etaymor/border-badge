import { StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { Button } from '@components/ui';
import type { OnboardingStackScreenProps } from '@navigation/types';

type Props = OnboardingStackScreenProps<'Paywall'>;

const PREMIUM_FEATURES = [
  'See where friends overlap',
  'Turn trips into stories',
  'Get smart itineraries',
  'Milestone videos & animated passport',
  'Deep trip journals (photos, notes, spend)',
  'AI destination recommendations',
];

export function PaywallScreen({ navigation }: Props) {
  const handleStartTrial = () => {
    // Placeholder - just navigate to account creation
    navigation.navigate('AccountCreation');
  };

  const handleMaybeLater = () => {
    navigation.navigate('AccountCreation');
  };

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.content}>
        {/* Header */}
        <Text style={styles.headline}>Take your travels further.</Text>

        {/* Feature carousel placeholder */}
        <View style={styles.carouselPlaceholder}>
          <View style={styles.carouselCard}>
            <View style={styles.cardImagePlaceholder} />
            <Text style={styles.cardTitle}>Premium Features</Text>
          </View>
        </View>

        {/* Feature list */}
        <View style={styles.featureList}>
          {PREMIUM_FEATURES.map((feature, index) => (
            <View key={index} style={styles.featureItem}>
              <Text style={styles.featureBullet}>•</Text>
              <Text style={styles.featureText}>{feature}</Text>
            </View>
          ))}
        </View>

        {/* Price module */}
        <View style={styles.priceModule}>
          <View style={styles.trialBadge}>
            <Text style={styles.trialBadgeText}>FREE 7-DAY TRIAL</Text>
          </View>
          <Text style={styles.priceText}>Then $4.99/month</Text>
        </View>
      </View>

      {/* Footer */}
      <View style={styles.footer}>
        <Button
          title="Unlock All Features – Start Free Trial"
          onPress={handleStartTrial}
          style={styles.primaryButton}
        />
        <Button
          title="Maybe later"
          onPress={handleMaybeLater}
          variant="ghost"
          style={styles.secondaryButton}
        />
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
    paddingTop: 40,
  },
  headline: {
    fontSize: 32,
    fontWeight: 'bold',
    color: '#1a1a1a',
    textAlign: 'center',
    marginBottom: 32,
  },
  carouselPlaceholder: {
    alignItems: 'center',
    marginBottom: 32,
  },
  carouselCard: {
    backgroundColor: '#F2F2F7',
    borderRadius: 16,
    padding: 20,
    width: '100%',
    alignItems: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.1,
    shadowRadius: 12,
    elevation: 4,
  },
  cardImagePlaceholder: {
    width: 200,
    height: 120,
    backgroundColor: '#E5E5EA',
    borderRadius: 12,
    marginBottom: 16,
  },
  cardTitle: {
    fontSize: 18,
    fontWeight: '600',
    color: '#1a1a1a',
  },
  featureList: {
    marginBottom: 24,
  },
  featureItem: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    marginBottom: 12,
  },
  featureBullet: {
    fontSize: 16,
    color: '#007AFF',
    marginRight: 8,
    fontWeight: 'bold',
  },
  featureText: {
    fontSize: 16,
    color: '#1a1a1a',
    flex: 1,
  },
  priceModule: {
    alignItems: 'center',
    marginTop: 'auto',
    marginBottom: 24,
  },
  trialBadge: {
    backgroundColor: '#34C759',
    paddingVertical: 8,
    paddingHorizontal: 16,
    borderRadius: 20,
    marginBottom: 8,
  },
  trialBadgeText: {
    color: '#fff',
    fontSize: 12,
    fontWeight: 'bold',
    letterSpacing: 1,
  },
  priceText: {
    fontSize: 14,
    color: '#666',
  },
  footer: {
    paddingHorizontal: 24,
    paddingVertical: 24,
    borderTopWidth: 1,
    borderTopColor: '#F2F2F7',
  },
  primaryButton: {
    width: '100%',
    marginBottom: 12,
  },
  secondaryButton: {
    width: '100%',
  },
});
