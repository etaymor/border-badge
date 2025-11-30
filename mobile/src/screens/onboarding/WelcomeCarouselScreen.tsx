import { useCallback, useRef, useState } from 'react';
import {
  Dimensions,
  FlatList,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
  type ListRenderItem,
  type ViewToken,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { Button } from '@components/ui';
import type { OnboardingStackScreenProps } from '@navigation/types';

type Props = OnboardingStackScreenProps<'WelcomeCarousel'>;

interface Slide {
  id: string;
  title: string;
  body: string;
  showCTA: boolean;
}

const SLIDES: Slide[] = [
  {
    id: '1',
    title: 'Hello, Explorer!',
    body: 'Turn your journeys into a living story.',
    showCTA: false,
  },
  {
    id: '2',
    title: 'Track Your Travels',
    body: "Log every country you've set foot in.",
    showCTA: false,
  },
  {
    id: '3',
    title: 'Log Trips + Get Recs',
    body: 'Relive each trip & get AI-powered tips for the next.',
    showCTA: false,
  },
  {
    id: '4',
    title: 'Share & Compare',
    body: "See who's been where.",
    showCTA: true,
  },
];

const { width: SCREEN_WIDTH } = Dimensions.get('window');

export function WelcomeCarouselScreen({ navigation }: Props) {
  const [activeIndex, setActiveIndex] = useState(0);
  const flatListRef = useRef<FlatList<Slide>>(null);

  const handleStartJourney = () => {
    navigation.navigate('Motivation');
  };

  const handleLogin = () => {
    navigation.navigate('Login');
  };

  const onViewableItemsChanged = useCallback(
    ({ viewableItems }: { viewableItems: ViewToken<Slide>[] }) => {
      if (viewableItems.length > 0 && viewableItems[0].index !== null) {
        setActiveIndex(viewableItems[0].index);
      }
    },
    []
  );

  const viewabilityConfig = useRef({
    viewAreaCoveragePercentThreshold: 50,
  }).current;

  const renderSlide: ListRenderItem<Slide> = ({ item }) => (
    <View style={styles.slide}>
      {/* Grey placeholder for illustration */}
      <View style={styles.imagePlaceholder} />

      <Text style={styles.title}>{item.title}</Text>
      <Text style={styles.body}>{item.body}</Text>

      {item.showCTA && (
        <Button title="Start My Journey" onPress={handleStartJourney} style={styles.ctaButton} />
      )}
    </View>
  );

  return (
    <SafeAreaView style={styles.container}>
      {/* Login button in top-right (only on non-CTA slides) */}
      {!SLIDES[activeIndex].showCTA && (
        <TouchableOpacity onPress={handleLogin} style={styles.loginButton}>
          <Text style={styles.loginText}>Login</Text>
        </TouchableOpacity>
      )}

      <FlatList
        ref={flatListRef}
        data={SLIDES}
        renderItem={renderSlide}
        keyExtractor={(item) => item.id}
        horizontal
        pagingEnabled
        showsHorizontalScrollIndicator={false}
        onViewableItemsChanged={onViewableItemsChanged}
        viewabilityConfig={viewabilityConfig}
        bounces={false}
      />

      {/* Dot indicators */}
      <View style={styles.pagination}>
        {SLIDES.map((_, index) => (
          <View key={index} style={[styles.dot, index === activeIndex && styles.dotActive]} />
        ))}
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#fff',
  },
  slide: {
    width: SCREEN_WIDTH,
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 40,
  },
  imagePlaceholder: {
    width: 200,
    height: 200,
    backgroundColor: '#E5E5EA',
    borderRadius: 16,
    marginBottom: 40,
  },
  title: {
    fontSize: 28,
    fontWeight: 'bold',
    color: '#1a1a1a',
    textAlign: 'center',
    marginBottom: 16,
  },
  body: {
    fontSize: 18,
    color: '#666',
    textAlign: 'center',
    lineHeight: 26,
  },
  ctaButton: {
    marginTop: 40,
    width: '100%',
  },
  pagination: {
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    paddingBottom: 20,
  },
  dot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: '#E5E5EA',
    marginHorizontal: 4,
  },
  dotActive: {
    backgroundColor: '#007AFF',
    width: 24,
  },
  loginButton: {
    position: 'absolute',
    top: 60,
    right: 20,
    zIndex: 10,
    paddingVertical: 8,
    paddingHorizontal: 16,
  },
  loginText: {
    fontSize: 16,
    color: '#007AFF',
    fontWeight: '600',
  },
});
