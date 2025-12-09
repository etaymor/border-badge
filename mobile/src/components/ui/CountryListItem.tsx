import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';

import type { Country } from '@hooks/useCountries';

interface CountryListItemProps {
  country: Country;
  selected: boolean;
  onPress: () => void;
}

// Map country codes to flag emojis
function getFlagEmoji(countryCode: string): string {
  const codePoints = countryCode
    .toUpperCase()
    .split('')
    .map((char) => 127397 + char.charCodeAt(0));
  return String.fromCodePoint(...codePoints);
}

export function CountryListItem({ country, selected, onPress }: CountryListItemProps) {
  return (
    <TouchableOpacity
      style={styles.container}
      onPress={onPress}
      activeOpacity={0.7}
      accessibilityRole="checkbox"
      accessibilityLabel={country.name}
      accessibilityState={{ checked: selected }}
    >
      <Text style={styles.flag}>{getFlagEmoji(country.code)}</Text>
      <Text style={styles.name} numberOfLines={1}>
        {country.name}
      </Text>
      <View
        style={[styles.checkbox, selected && styles.checkboxSelected]}
        importantForAccessibility="no-hide-descendants"
      >
        {selected && <Text style={styles.checkmark}>✓</Text>}
      </View>
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 12,
    paddingHorizontal: 16,
    backgroundColor: '#fff',
  },
  flag: {
    fontSize: 24,
    marginRight: 12,
  },
  name: {
    flex: 1,
    fontSize: 16,
    color: '#1a1a1a',
  },
  checkbox: {
    width: 24,
    height: 24,
    borderRadius: 12,
    borderWidth: 2,
    borderColor: '#E5E5EA',
    alignItems: 'center',
    justifyContent: 'center',
  },
  checkboxSelected: {
    backgroundColor: '#007AFF',
    borderColor: '#007AFF',
  },
  checkmark: {
    color: '#fff',
    fontSize: 14,
    fontWeight: 'bold',
  },
});
