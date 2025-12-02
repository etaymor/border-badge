import { StyleSheet, Text, View } from 'react-native';

// Note: Map tab is deferred to a future phase. This screen is a placeholder.
// When Map is added to MainTabParamList, uncomment the Props type.
// import type { MainTabScreenProps } from '@navigation/types';
// type Props = MainTabScreenProps<'Map'>;

export function MapScreen() {
  return (
    <View style={styles.container}>
      <Text style={styles.title}>World Map</Text>
      <Text style={styles.subtitle}>Your visited countries will appear here</Text>
      <Text style={styles.placeholder}>Map component will be added in a future phase</Text>
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
    textAlign: 'center',
  },
  placeholder: {
    fontSize: 14,
    color: '#999',
    fontStyle: 'italic',
  },
});
