/**
 * Dev-only tag diagnostic.
 *
 * The single highest-value check in the pre-tagging feature: thresholds can
 * only really be judged by looking at which photos they sort into which bucket
 * on a REAL library. This renders the coverage counters plus a sample grid per
 * tier, so a wrong threshold shows up as a recognizably wrong photo rather than
 * as a number.
 *
 * Rendered only when `features.showDebugInfo` is on (development builds with
 * EXPO_PUBLIC_ENABLE_DEV_TOOLS=true). Deliberately does not use console.log:
 * production strips it, and this needs to be readable on device either way.
 */

import { useCallback, useState } from 'react';
import {
  ActivityIndicator,
  Image,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';

import { features } from '@config/features';
import { getAllCachedPhotos } from '@services/photoImport/photoCacheDb';
import { getTagCoverageStats, getTagsForIds } from '@services/photoImport/photoTagDb';
import type { TagCoverageStats } from '@services/photoImport/photoTagDb';
import { classifyPrefilter, deriveSignals } from '@services/quiz/tagSignals';
import type { PrefilterTier } from '@services/quiz/tagSignals';
import { colors } from '@constants/colors';
import { fonts } from '@constants/typography';

/** Photos shown per tier. Enough to judge a threshold, few enough to scroll. */
const SAMPLES_PER_TIER = 8;

/** How deep into the library to look for samples. */
const SAMPLE_SCAN_LIMIT = 600;

interface Sample {
  id: string;
  uri: string;
  quality: number;
  people: number;
}

type Buckets = Record<PrefilterTier, Sample[]>;

const emptyBuckets = (): Buckets => ({ drop: [], likely: [], unknown: [], marginal: [] });

const TIER_ORDER: PrefilterTier[] = ['likely', 'unknown', 'marginal', 'drop'];

export function PhotoTagDiagnostic() {
  const [loading, setLoading] = useState(false);
  const [coverage, setCoverage] = useState<TagCoverageStats | null>(null);
  const [buckets, setBuckets] = useState<Buckets>(emptyBuckets);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [stats, cached] = await Promise.all([getTagCoverageStats(), getAllCachedPhotos()]);
      setCoverage(stats);

      const slice = cached.slice(0, SAMPLE_SCAN_LIMIT);
      const tags = await getTagsForIds(slice.map((photo) => photo.id));
      const next = emptyBuckets();
      for (const photo of slice) {
        const row = tags.get(photo.id);
        if (!row) continue;
        const signals = deriveSignals(row);
        const tier = classifyPrefilter(signals);
        if (next[tier].length >= SAMPLES_PER_TIER) continue;
        next[tier].push({
          id: photo.id,
          uri: photo.uri,
          quality: signals.qualityScore,
          people: signals.peopleProminence,
        });
      }
      setBuckets(next);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : String(loadError));
    } finally {
      setLoading(false);
    }
  }, []);

  if (!features.showDebugInfo) return null;

  return (
    <View style={styles.container}>
      <Text style={styles.heading}>Photo tag diagnostic</Text>

      <Pressable onPress={load} style={styles.button} accessibilityRole="button">
        <Text style={styles.buttonText}>{loading ? 'Loading…' : 'Load tag sample'}</Text>
      </Pressable>

      {loading ? <ActivityIndicator style={styles.spinner} /> : null}
      {error ? <Text style={styles.error}>{error}</Text> : null}

      {coverage ? (
        <Text style={styles.stats}>
          {`tagged ${coverage.currentVersion}/${coverage.total}` +
            Object.entries(coverage.byStatus)
              .map(([status, count]) => `\n${status}: ${count}`)
              .join('')}
        </Text>
      ) : null}

      {TIER_ORDER.map((tier) =>
        buckets[tier].length > 0 ? (
          <View key={tier} style={styles.tierBlock}>
            <Text style={styles.tierLabel}>
              {tier}
              {tier === 'drop' ? ' (never sent to the gate)' : ''}
            </Text>
            <ScrollView horizontal showsHorizontalScrollIndicator={false}>
              {buckets[tier].map((sample) => (
                <View key={sample.id} style={styles.sample}>
                  <Image source={{ uri: sample.uri }} style={styles.thumb} />
                  <Text style={styles.sampleMeta}>
                    {`q ${sample.quality.toFixed(2)}\np ${sample.people.toFixed(2)}`}
                  </Text>
                </View>
              ))}
            </ScrollView>
          </View>
        ) : null
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    paddingHorizontal: 20,
    paddingVertical: 12,
  },
  heading: {
    color: colors.textPrimary,
    fontFamily: fonts.body.semiBold,
    fontSize: 15,
    marginBottom: 8,
  },
  button: {
    alignSelf: 'flex-start',
    borderColor: colors.border,
    borderRadius: 8,
    borderWidth: 1,
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  buttonText: {
    color: colors.textPrimary,
    fontFamily: fonts.body.regular,
    fontSize: 13,
  },
  spinner: {
    marginTop: 8,
  },
  error: {
    color: colors.error,
    fontFamily: fonts.body.regular,
    fontSize: 12,
    marginTop: 8,
  },
  stats: {
    color: colors.textSecondary,
    fontFamily: fonts.body.regular,
    fontSize: 12,
    marginTop: 8,
  },
  tierBlock: {
    marginTop: 12,
  },
  tierLabel: {
    color: colors.textPrimary,
    fontFamily: fonts.body.semiBold,
    fontSize: 12,
    marginBottom: 4,
  },
  sample: {
    marginRight: 8,
  },
  thumb: {
    backgroundColor: colors.backgroundPlaceholder,
    borderRadius: 6,
    height: 72,
    width: 72,
  },
  sampleMeta: {
    color: colors.textSecondary,
    fontFamily: fonts.body.regular,
    fontSize: 10,
  },
});

export default PhotoTagDiagnostic;
