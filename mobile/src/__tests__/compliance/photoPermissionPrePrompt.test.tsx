/**
 * App Review Guideline 5.1.1(iv) guard.
 *
 * Build 1.1.0 (1) was rejected because a custom message shown before the
 * photo-library permission request asked the user to press "Enable". Apple's
 * rule for any screen that precedes the system prompt:
 *   - the button that proceeds is neutral ("Continue" / "Next"), never
 *     "Enable", "Allow", "Allow Full Access", etc.;
 *   - the screen does not offer its own permission choices (no fake
 *     "Select Photos" / "Don't Allow" sheet) — the system prompt is the only
 *     place the user decides, so proceeding must always reach it.
 */
import React from 'react';
import type { ReactTestInstance } from 'react-test-renderer';
import { AccessibilityInfo, FlatList } from 'react-native';
import { fireEvent, render, screen } from '@testing-library/react-native';

import { PhotoPermissionCarousel } from '@components/photos/PhotoPermissionCarousel';
import { ProfileInfoSection } from '@screens/profile/components/ProfileInfoSection';

jest.mock('@hooks/useReducedMotion', () => ({
  useReducedMotion: () => false,
}));

const FORBIDDEN_PRE_PROMPT_LABEL = /\b(enable|allow|don'?t allow|select photos|full access)\b/i;

function textOf(node: ReactTestInstance): string {
  return node.children.map((child) => (typeof child === 'string' ? child : textOf(child))).join('');
}

/** Each button's accessibility label and visible text. Body copy is not a CTA. */
function buttonLabels(): string[] {
  return screen
    .queryAllByRole('button')
    .flatMap((node) => [String(node.props.accessibilityLabel ?? ''), textOf(node)])
    .filter(Boolean);
}

describe('Guideline 5.1.1(iv): photo permission pre-prompt carousel', () => {
  let scrollSpy: jest.SpyInstance;
  let announceSpy: jest.SpyInstance;

  beforeEach(() => {
    scrollSpy = jest.spyOn(FlatList.prototype, 'scrollToIndex').mockImplementation(jest.fn());
    announceSpy = jest
      .spyOn(AccessibilityInfo, 'announceForAccessibility')
      .mockImplementation(jest.fn());
  });

  afterEach(() => {
    scrollSpy.mockRestore();
    announceSpy.mockRestore();
  });

  it.each(['trips', 'quiz'] as const)(
    'offers only a neutral Continue on every beat (%s door)',
    (door) => {
      for (const step of [1, 2, 3] as const) {
        const { unmount } = render(
          <PhotoPermissionCarousel
            door={door}
            step={step}
            onBeatChange={jest.fn()}
            onRequestPermission={jest.fn()}
          />
        );

        for (const label of buttonLabels()) {
          expect(label).not.toMatch(FORBIDDEN_PRE_PROMPT_LABEL);
        }
        expect(screen.getByText('Continue')).toBeTruthy();
        unmount();
      }
    }
  );

  it('proceeds straight to the system prompt from the last beat', () => {
    const onRequestPermission = jest.fn();
    render(
      <PhotoPermissionCarousel
        door="trips"
        step={3}
        onBeatChange={jest.fn()}
        onRequestPermission={onRequestPermission}
      />
    );

    fireEvent.press(screen.getByText('Continue'));
    expect(onRequestPermission).toHaveBeenCalledTimes(1);
  });
});

describe('Guideline 5.1.1(iv): profile photo-access row', () => {
  function renderSection(
    photoPermissionStatus: 'undetermined' | 'denied',
    overrides: Partial<React.ComponentProps<typeof ProfileInfoSection>> = {}
  ) {
    return render(
      <ProfileInfoSection
        formattedEmail="a@b.co"
        homeCountryDisplay={null}
        memberSince="2026"
        visitedCount={0}
        clipboardDetectionEnabled
        onOpenExportModal={jest.fn()}
        onToggleClipboardDetection={jest.fn()}
        photoPermissionStatus={photoPermissionStatus}
        onRequestPhotoPermission={jest.fn()}
        onOpenPhotoEnableModal={jest.fn()}
        onOpenPhotoInfoModal={jest.fn()}
        {...overrides}
      />
    );
  }

  it('labels the button that triggers the system prompt Continue, not Enable', () => {
    const onRequestPhotoPermission = jest.fn();
    renderSection('undetermined', { onRequestPhotoPermission });

    expect(screen.queryByText('Enable')).toBeNull();
    for (const label of buttonLabels()) {
      expect(label).not.toMatch(FORBIDDEN_PRE_PROMPT_LABEL);
    }

    fireEvent.press(screen.getByText('Continue'));
    expect(onRequestPhotoPermission).toHaveBeenCalledTimes(1);
  });

  it('sends a denied user to Settings without an Enable button', () => {
    const onOpenPhotoEnableModal = jest.fn();
    renderSection('denied', { onOpenPhotoEnableModal });

    expect(screen.queryByText('Enable')).toBeNull();
    fireEvent.press(screen.getByText('Settings'));
    expect(onOpenPhotoEnableModal).toHaveBeenCalledTimes(1);
  });
});
