/**
 * ProgressSegments layout contract: the track is a compact, centred bar
 * under the `N OF N` caption - not a full-width strip that starts at the
 * back button and reads as left-offset.
 */

import { StyleSheet } from 'react-native';

import { render, screen } from '../utils/testUtils';

import {
  ProgressSegments,
  PROGRESS_TRACK_MAX_WIDTH,
} from '@screens/quiz/components/ProgressSegments';

function flattenedStyle(testID: string) {
  return StyleSheet.flatten(screen.getByTestId(testID).props.style);
}

describe('ProgressSegments', () => {
  it('centres a capped track under the label', () => {
    render(<ProgressSegments total={10} filled={1} label="1 OF 10" testID="progress" />);

    const container = flattenedStyle('progress');
    expect(container.alignItems).toBe('center');

    const track = flattenedStyle('progress-track');
    expect(track.alignSelf).toBe('center');
    expect(track.maxWidth).toBe(PROGRESS_TRACK_MAX_WIDTH);
    expect(track.width).toBe('100%');
  });

  it('exposes a progressbar value matching filled / total', () => {
    render(<ProgressSegments total={5} filled={2} label="3 OF 5" testID="progress" />);

    const track = screen.getByTestId('progress-track');
    expect(track.props.accessibilityRole).toBe('progressbar');
    expect(track.props.accessibilityValue).toEqual({ min: 0, max: 5, now: 2 });
    expect(screen.getByText('3 OF 5')).toBeTruthy();
  });
});
