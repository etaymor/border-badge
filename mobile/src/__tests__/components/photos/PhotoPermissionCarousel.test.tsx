import React, { useState } from 'react';
import { AccessibilityInfo, FlatList, StyleSheet, View } from 'react-native';
import { fireEvent, render, screen } from '@testing-library/react-native';

import { PhotoPermissionCarousel } from '@components/photos/PhotoPermissionCarousel';
import type { PhotoPermissionPreheatChoice } from '@components/photos/PhotoPermissionPreheat';
import { SCAN_COPY } from '@constants/scanCopy';

const mockUseReducedMotion = jest.fn(() => false);

jest.mock('@hooks/useReducedMotion', () => ({
  useReducedMotion: () => mockUseReducedMotion(),
}));

interface HarnessProps {
  initialStep?: 1 | 2 | 3;
  onBeatChange?: jest.Mock;
  onChoose?: jest.Mock;
  visual?: React.ReactNode;
}

function CarouselHarness({
  initialStep = 1,
  onBeatChange = jest.fn(),
  onChoose = jest.fn(),
  visual,
}: HarnessProps) {
  const [step, setStep] = useState<1 | 2 | 3>(initialStep);

  return (
    <PhotoPermissionCarousel
      door="trips"
      step={step}
      onBeatChange={(nextStep, via) => {
        onBeatChange(nextStep, via);
        setStep(nextStep);
      }}
      onChoose={onChoose}
      visual={visual}
    />
  );
}

function reportVisibleIndex(index: number): void {
  const pager = screen.getByTestId('photo-permission-carousel-pager');
  fireEvent(pager, 'viewableItemsChanged', {
    viewableItems: [{ index, isViewable: true, item: { step: index + 1 } }],
    changed: [],
  });
}

describe('PhotoPermissionCarousel', () => {
  let scrollToIndexSpy: jest.SpyInstance;
  let announcementSpy: jest.SpyInstance;

  beforeEach(() => {
    mockUseReducedMotion.mockReturnValue(false);
    scrollToIndexSpy = jest
      .spyOn(FlatList.prototype, 'scrollToIndex')
      .mockImplementation(jest.fn());
    announcementSpy = jest
      .spyOn(AccessibilityInfo, 'announceForAccessibility')
      .mockImplementation(jest.fn());
  });

  afterEach(() => {
    scrollToIndexSpy.mockRestore();
    announcementSpy.mockRestore();
  });

  it('starts on beat 1 with Continue and keeps the permission stack hidden', () => {
    render(<CarouselHarness />);

    expect(screen.getByText(SCAN_COPY.permission.carousel.beat1Title)).toBeTruthy();
    expect(screen.getByText(SCAN_COPY.permission.carousel.beat1Subtitle)).toBeTruthy();
    expect(screen.getByText(SCAN_COPY.permission.carousel.continueCta)).toBeTruthy();
    expect(screen.queryByTestId('photo-permission-preheat-buttons')).toBeNull();
  });

  it('advances by tap and exposes the unchanged stack only on beat 3', () => {
    const onBeatChange = jest.fn();
    render(<CarouselHarness onBeatChange={onBeatChange} />);

    fireEvent.press(screen.getByTestId('photo-permission-carousel-continue'));
    fireEvent.press(screen.getByTestId('photo-permission-carousel-continue'));

    expect(onBeatChange).toHaveBeenNthCalledWith(1, 2, 'tap');
    expect(onBeatChange).toHaveBeenNthCalledWith(2, 3, 'tap');
    expect(screen.getByTestId('photo-permission-preheat-select')).toBeTruthy();
    expect(screen.getByTestId('photo-permission-preheat-full-access')).toBeTruthy();
    expect(screen.getByTestId('photo-permission-preheat-dont-allow')).toBeTruthy();
  });

  it('reports forward and backward viewability changes as swipes without duplicates', () => {
    const onBeatChange = jest.fn();
    render(<CarouselHarness onBeatChange={onBeatChange} />);

    reportVisibleIndex(1);
    reportVisibleIndex(1);
    reportVisibleIndex(0);

    expect(onBeatChange).toHaveBeenNthCalledWith(1, 2, 'swipe');
    expect(onBeatChange).toHaveBeenNthCalledWith(2, 1, 'swipe');
    expect(onBeatChange).toHaveBeenCalledTimes(2);
  });

  it.each<[string, PhotoPermissionPreheatChoice]>([
    ['photo-permission-preheat-select', 'select-photos'],
    ['photo-permission-preheat-full-access', 'full-access'],
    ['photo-permission-preheat-dont-allow', 'dont-allow'],
  ])('forwards %s only when the stack is visible', (testID, expectedChoice) => {
    const onChoose = jest.fn();
    const { rerender } = render(
      <PhotoPermissionCarousel door="quiz" step={1} onBeatChange={jest.fn()} onChoose={onChoose} />
    );

    expect(screen.queryByTestId(testID)).toBeNull();
    expect(onChoose).not.toHaveBeenCalled();

    rerender(
      <PhotoPermissionCarousel door="quiz" step={3} onBeatChange={jest.fn()} onChoose={onChoose} />
    );
    fireEvent.press(screen.getByTestId(testID));
    expect(onChoose).toHaveBeenCalledWith(expectedChoice);
  });

  it('persists the privacy footer and custom lock glyph on every beat', () => {
    const { rerender } = render(
      <PhotoPermissionCarousel
        door="trips"
        step={1}
        onBeatChange={jest.fn()}
        onChoose={jest.fn()}
      />
    );

    for (const step of [1, 2, 3] as const) {
      rerender(
        <PhotoPermissionCarousel
          door="trips"
          step={step}
          onBeatChange={jest.fn()}
          onChoose={jest.fn()}
        />
      );
      expect(screen.getByText(SCAN_COPY.permission.carousel.footerNotice)).toBeTruthy();
      expect(screen.getByTestId('photo-permission-carousel-lock')).toBeTruthy();
    }
  });

  it('uses one fixed action-band height for Continue and the stack', () => {
    const { rerender } = render(
      <PhotoPermissionCarousel
        door="trips"
        step={1}
        onBeatChange={jest.fn()}
        onChoose={jest.fn()}
      />
    );
    const continueHeight = StyleSheet.flatten(
      screen.getByTestId('photo-permission-carousel-action-band').props.style
    ).height;

    rerender(
      <PhotoPermissionCarousel
        door="trips"
        step={3}
        onBeatChange={jest.fn()}
        onChoose={jest.fn()}
      />
    );
    const stackHeight = StyleSheet.flatten(
      screen.getByTestId('photo-permission-carousel-action-band').props.style
    ).height;

    expect(continueHeight).toBeGreaterThan(0);
    expect(stackHeight).toBe(continueHeight);
  });

  it.each([
    [true, false],
    [false, true],
  ])('uses Reduce Motion %s with animated %s', (reduceMotion, animated) => {
    mockUseReducedMotion.mockReturnValue(reduceMotion);
    render(<CarouselHarness />);

    fireEvent.press(screen.getByTestId('photo-permission-carousel-continue'));

    expect(scrollToIndexSpy).toHaveBeenCalledWith({ index: 1, animated });
  });

  it('announces the exact step and title after the controlled step changes', () => {
    render(<CarouselHarness />);

    fireEvent.press(screen.getByTestId('photo-permission-carousel-continue'));

    expect(announcementSpy).toHaveBeenCalledWith(
      SCAN_COPY.permission.carousel.stepAnnouncement(2, 3, SCAN_COPY.permission.carousel.beat2Title)
    );
  });

  it('hides an optional decorative visual and pagination dots from accessibility', () => {
    render(<CarouselHarness visual={<View testID="permission-beat-visual" />} />);

    expect(
      screen.getByTestId('photo-permission-carousel-visual', {
        includeHiddenElements: true,
      }).props
    ).toMatchObject({
      accessibilityElementsHidden: true,
      importantForAccessibility: 'no-hide-descendants',
    });
    expect(screen.getByTestId('photo-permission-carousel-dots').props).toMatchObject({
      accessible: false,
      importantForAccessibility: 'no',
    });
  });
});
