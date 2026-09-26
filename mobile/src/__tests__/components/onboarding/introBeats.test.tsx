import { render, screen } from '@testing-library/react-native';
import { useAnimatedReaction } from 'react-native-reanimated';

import GuessWhereBeat from '@components/onboarding/introBeats/GuessWhereBeat';
import IntroBeatPage from '@components/onboarding/introBeats/IntroBeatPage';
import { PASSPORT_CODES } from '@components/onboarding/introBeats/introBeatAssets';
import { INTRO_BEATS, type IntroBeatProps } from '@components/onboarding/introBeats/introBeats';
import PassportFillBeat from '@components/onboarding/introBeats/PassportFillBeat';
import PhotoTripsBeat from '@components/onboarding/introBeats/PhotoTripsBeat';
import SocialSaveBeat from '@components/onboarding/introBeats/SocialSaveBeat';

const stillProps: IntroBeatProps = {
  isActive: true,
  canPlay: true,
  reduceMotion: true,
  width: 343,
  height: 420,
};

const { useVideoPlayer } = jest.requireMock('expo-video');

describe('intro beats (final frame under Reduce Motion)', () => {
  beforeEach(() => jest.clearAllMocks());

  it('beat 1 ends on the rebuilt trip with its found places and a share pill', () => {
    render(<PhotoTripsBeat {...stillProps} />);
    expect(screen.getByTestId('intro-trip-card')).toBeTruthy();
    expect(screen.getByText('Japan')).toBeTruthy();
    for (let i = 0; i < 3; i++) {
      expect(screen.getByTestId(`intro-trip-place-${i}`)).toBeTruthy();
    }
    expect(screen.getAllByText('Shibuya Yokocho').length).toBeGreaterThan(0);
    expect(screen.getByTestId('intro-trip-share')).toBeTruthy();
    // Beat 1 is about trips and places, not stamps.
    expect(screen.queryByText(/stamp/i)).toBeNull();
  });

  it('beat 2 shares a real Instagram/TikTok post into Atlasi and saves it to a trip', () => {
    render(<SocialSaveBeat {...stillProps} />);
    expect(screen.getByTestId('intro-share-instagram')).toBeTruthy();
    expect(screen.getByTestId('intro-share-tiktok')).toBeTruthy();
    expect(screen.getByText('Instagram')).toBeTruthy();
    expect(screen.getByText('TikTok')).toBeTruthy();
    expect(screen.getByTestId('intro-share-saved')).toBeTruthy();
    expect(screen.getByText('Saved to Faroe Islands trip')).toBeTruthy();
    // There is no map feature; nothing should claim one.
    expect(screen.queryByText(/map/i)).toBeNull();
  });

  it('beat 3 fills all nine passport stamps and the counters', () => {
    render(<PassportFillBeat {...stillProps} />);
    for (const code of PASSPORT_CODES) {
      expect(screen.getByTestId(`intro-passport-stamp-${code}`)).toBeTruthy();
    }
    expect(screen.getByLabelText('24')).toBeTruthy();
    expect(screen.getByLabelText('11')).toBeTruthy();
  });

  it('beat 4 shows four options, the correct reveal, and the friend score', () => {
    render(<GuessWhereBeat {...stillProps} />);
    for (let i = 0; i < 4; i++) {
      expect(screen.getByTestId(`intro-guess-option-${i}`)).toBeTruthy();
    }
    expect(screen.getByTestId('intro-guess-correct')).toBeTruthy();
    expect(screen.getByText('Maya scored')).toBeTruthy();
  });

  it('no beat creates a video player', () => {
    render(<PhotoTripsBeat {...stillProps} />);
    render(<SocialSaveBeat {...stillProps} />);
    render(<PassportFillBeat {...stillProps} />);
    render(<GuessWhereBeat {...stillProps} />);
    expect(useVideoPlayer).not.toHaveBeenCalled();
  });

  it('haptic cues only arm while the beat is actually playing', () => {
    const reaction = useAnimatedReaction as jest.Mock;
    render(<PhotoTripsBeat {...stillProps} reduceMotion={false} canPlay={false} />);
    const deps = reaction.mock.calls[reaction.mock.calls.length - 1][2] as unknown[];
    // [atMs, enabled, onCue]
    expect(deps[1]).toBe(false);

    reaction.mockClear();
    render(<PhotoTripsBeat {...stillProps} reduceMotion={false} />);
    const liveDeps = reaction.mock.calls[reaction.mock.calls.length - 1][2] as unknown[];
    expect(liveDeps[1]).toBe(true);
  });
});

describe('IntroBeatPage', () => {
  const scrollX = { value: 0 } as never;

  it('hides the stage from screen readers and marks the headline as a header', () => {
    render(
      <IntroBeatPage
        beat={INTRO_BEATS[0]}
        index={0}
        pageWidth={375}
        heroHeight={420}
        textHeight={158}
        scrollX={scrollX}
        isActive
        canPlay
        reduceMotion
        showVisual
      />
    );
    const stage = screen.getByTestId('intro-stage-trips', { includeHiddenElements: true });
    expect(stage.props.importantForAccessibility).toBe('no-hide-descendants');
    expect(stage.props.accessibilityElementsHidden).toBe(true);
    expect(screen.getByRole('header')).toBeTruthy();
    expect(screen.getByText('Find the places you forgot')).toBeTruthy();
  });

  it('renders copy but no visual when the page is out of the mount window', () => {
    render(
      <IntroBeatPage
        beat={INTRO_BEATS[3]}
        index={3}
        pageWidth={375}
        heroHeight={420}
        textHeight={158}
        scrollX={scrollX}
        isActive={false}
        canPlay
        reduceMotion={false}
        showVisual={false}
      />
    );
    expect(screen.getByText("Guess where I've been")).toBeTruthy();
    expect(screen.queryByTestId('intro-beat-guess_where')).toBeNull();
  });
});
