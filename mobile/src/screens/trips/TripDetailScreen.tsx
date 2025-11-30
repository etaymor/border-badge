import { StyleSheet, Text, View } from 'react-native';

import type { TripsStackScreenProps } from '@navigation/types';

type Props = TripsStackScreenProps<'TripDetail'>;

export function TripDetailScreen({ route, navigation }: Props) {
  const { tripId } = route.params;

  return (
    <View style={styles.container}>
      <Text style={styles.title}>Trip Details</Text>
      <Text style={styles.subtitle}>Trip ID: {tripId}</Text>
      <Text style={styles.link} onPress={() => navigation.navigate('TripForm', { tripId })}>
        Edit Trip
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#fff',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 24,
  },
  title: {
    fontSize: 24,
    fontWeight: 'bold',
    marginBottom: 8,
    color: '#1a1a1a',
  },
  subtitle: {
    fontSize: 16,
    color: '#666',
    marginBottom: 24,
  },
  link: {
    fontSize: 16,
    color: '#007AFF',
    fontWeight: '600',
    minHeight: 44,
    textAlignVertical: 'center',
  },
});
