/**
 * PhotoSyncCard - what the passport home shows in the Guess Where slot before
 * the user has ever scanned their camera roll.
 *
 * Guess Where is built entirely out of the user's own photos, so the card that
 * sells it is the wrong card for someone with nothing synced. Photo sync is the
 * gate on two things - trips discovered from the camera roll and Guess Where -
 * so this names both and leads to the import flow instead.
 *
 * The frame is PassportEntryCard, shared with GuessWhereCard: the two swap in
 * the same slot, and the home surface must not shift when they do.
 */

import { PassportEntryCard } from './PassportEntryCard';

/* eslint-disable @typescript-eslint/no-require-imports */
const polaroidsIllustration = require('../../../assets/illustations/polaroids-illustration.png');
/* eslint-enable @typescript-eslint/no-require-imports */

interface PhotoSyncCardProps {
  onPress: () => void;
}

export function PhotoSyncCard({ onPress }: PhotoSyncCardProps) {
  return (
    <PassportEntryCard
      illustration={polaroidsIllustration}
      title="Sync Your Photos"
      subtitle="Unlock trips and Guess Where"
      onPress={onPress}
      accessibilityLabel="Sync your photos"
      accessibilityHint="Scan your camera roll to unlock trips and Guess Where"
      testID="photo-sync-card"
    />
  );
}
