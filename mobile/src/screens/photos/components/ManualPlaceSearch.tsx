/**
 * ManualPlaceSearch - Modal component for manual place search
 * when a user rejects an AI-suggested place.
 */

import { useState } from 'react';
import { Modal, ScrollView, Text, TouchableOpacity, View } from 'react-native';
import { Image } from 'expo-image';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Button } from '@components/ui';
import { PlacesAutocomplete, type SelectedPlace } from '@components/places';
import { CategorySelector } from '@components/entries';
import type { LocationCluster } from '@services/photoImport';
import type { EntryType } from '@navigation/types';
import { styles } from '../photoImportStyles';

export interface ManualPlaceSearchProps {
  cluster: LocationCluster;
  countryCode?: string;
  onSelect: (place: SelectedPlace, category: EntryType) => void;
  onCancel: () => void;
}

export function ManualPlaceSearch({
  cluster,
  countryCode,
  onSelect,
  onCancel,
}: ManualPlaceSearchProps) {
  const insets = useSafeAreaInsets();
  const [selectedPlace, setSelectedPlace] = useState<SelectedPlace | null>(null);
  const [selectedCategory, setSelectedCategory] = useState<EntryType | null>(null);
  const [hasSelectedType, setHasSelectedType] = useState(false);

  const handleConfirm = () => {
    if (selectedPlace && selectedCategory) {
      onSelect(selectedPlace, selectedCategory);
    }
  };

  const handleTypeSelect = (type: EntryType) => {
    setSelectedCategory(type);
    setHasSelectedType(true);
  };

  return (
    <Modal animationType="slide" visible={true} onRequestClose={onCancel}>
      <View style={[styles.manualSearchContainer, { paddingTop: insets.top }]}>
        <View style={styles.manualSearchHeader}>
          <Text style={styles.manualSearchTitle}>Find the right place</Text>
          <TouchableOpacity onPress={onCancel}>
            <Text style={styles.manualSearchCancel}>Cancel</Text>
          </TouchableOpacity>
        </View>

        {/* Show photo thumbnails for context */}
        <ScrollView horizontal style={styles.photoRow} showsHorizontalScrollIndicator={false}>
          {cluster.photos.slice(0, 5).map((photo) => (
            <Image
              key={photo.id}
              source={{ uri: photo.uri }}
              style={styles.contextThumb}
              contentFit="cover"
            />
          ))}
        </ScrollView>

        {/* PlacesAutocomplete - focused on cluster location */}
        <View style={styles.autocompleteSection}>
          <Text style={styles.sectionLabel}>SEARCH FOR A PLACE</Text>
          <PlacesAutocomplete
            value={selectedPlace}
            onSelect={setSelectedPlace}
            placeholder="Search for a place..."
            countryCode={countryCode}
          />
        </View>

        {/* Category selection - shown after place is selected */}
        {selectedPlace && (
          <View style={styles.categorySection}>
            <CategorySelector
              entryType={selectedCategory}
              hasSelectedType={hasSelectedType}
              onTypeSelect={handleTypeSelect}
              onChangeType={() => setHasSelectedType(false)}
            />
          </View>
        )}

        {/* Confirm button - enabled when both place and category selected */}
        {selectedPlace && selectedCategory && (
          <View style={styles.confirmSection}>
            <Button title="Add Entry" onPress={handleConfirm} />
          </View>
        )}
      </View>
    </Modal>
  );
}
