/**
 * Tripwire: onboarding screens must not render their own header.
 *
 * The header (back + ATLASI logo + Login) is rendered once by the onboarding
 * stack's `layout` (see components/onboarding/OnboardingHeader.tsx), above the
 * screen transition containers. A screen that paints its own copy brings the
 * bug back: that copy slides with the screen on every push/pop.
 *
 * Screens reserve the header's space with <OnboardingHeaderSpacer /> instead.
 * OnboardingSliderScreen is deliberately excluded (its white logo sits on the
 * intro artwork) and so is ContinentCountryGridScreen (region title header).
 */

import { readFileSync } from 'fs';
import { join } from 'path';

const SRC = join(__dirname, '..', '..', '..');

const SCREENS = [
  'screens/onboarding/MotivationScreen.tsx',
  'screens/onboarding/TrackingPreferenceScreen.tsx',
  'screens/onboarding/NameEntryScreen.tsx',
  'screens/onboarding/ContinentIntroScreen.tsx',
  'screens/onboarding/AntarcticaPromptScreen.tsx',
  'screens/onboarding/ProgressSummaryScreen.tsx',
  'screens/onboarding/AccountCreationScreen.tsx',
  'screens/onboarding/EmotionalHookScreen.tsx',
  'screens/onboarding/FunctionalHookScreen.tsx',
  'components/onboarding/CountrySelectionScreen.tsx',
];

describe.each(SCREENS)('%s', (file) => {
  const source = readFileSync(join(SRC, file), 'utf8');

  it('does not paint its own ATLASI logo', () => {
    expect(source).not.toMatch(/atlasi-navy-logo/);
  });

  it('does not render its own header back button or header component', () => {
    expect(source).not.toMatch(/GlassBackButton/);
    expect(source).not.toMatch(/OnboardingHookHeader/);
  });

  it('reserves the shared header space', () => {
    expect(source).toMatch(/<OnboardingHeaderSpacer\s*\/>/);
  });
});
