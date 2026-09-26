import type { IntroBeatKey } from './introMotion';

export interface IntroBeatCopy {
  key: IntroBeatKey;
  /** Small caps line above the headline (hero beat only). */
  kicker?: string;
  headline: string;
  subtext: string;
}

/** The intro story, in order. Beat 1 is the hook: rediscovering places you forgot. */
export const INTRO_BEATS: readonly IntroBeatCopy[] = [
  {
    key: 'trips',
    kicker: 'THE WORLD IS WAITING',
    headline: 'Find the places you forgot',
    subtext: 'Atlasi scans your camera roll, rebuilds your trips, and names the spots you loved.',
  },
  {
    key: 'share',
    headline: 'Seen it? Saved it.',
    subtext: 'Share any post from Instagram or TikTok and Atlasi saves the place to your trip.',
  },
  {
    key: 'passport',
    headline: 'Collect the whole world',
    subtext: 'Every country becomes a stamp. Watch your passport fill up.',
  },
  {
    key: 'guess_where',
    headline: "Guess where I've been",
    subtext: 'Turn your trip photos into a quiz and challenge your friends.',
  },
];

export function introAnnouncement(index: number, total: number, headline: string): string {
  return `Step ${index + 1} of ${total}. ${headline}`;
}

/** Props every beat visual receives from the intro page. */
export interface IntroBeatProps {
  /** This beat's page is the settled page. */
  isActive: boolean;
  /** The screen is focused and the splash has gone. */
  canPlay: boolean;
  reduceMotion: boolean;
  /** Stage size in points. */
  width: number;
  height: number;
}
