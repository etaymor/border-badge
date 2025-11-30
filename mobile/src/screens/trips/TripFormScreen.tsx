import { StyleSheet, Text, View } from 'react-native';

import type { TripsStackScreenProps } from '@navigation/types';

type Props = TripsStackScreenProps<'TripForm'>;

export function TripFormScreen({ route }: Props) {
  const tripId = route.params?.tripId;
  const isEditing = !!tripId;

  return (
    <View style={styles.container}>
      <Text style={styles.title}>{isEditing ? 'Edit Trip' : 'New Trip'}</Text>
      <Text style={styles.subtitle}>
        {isEditing ? `Editing trip: ${tripId}` : 'Create a new trip'}
      </Text>
      <Text style={styles.placeholder}>Form fields will go here</Text>
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
  placeholder: {
    fontSize: 14,
    color: '#999',
    fontStyle: 'italic',
  },
});
