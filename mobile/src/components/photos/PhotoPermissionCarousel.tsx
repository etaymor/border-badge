import React, { useEffect, useMemo, useRef, type ReactNode } from 'react';
import {
  AccessibilityInfo,
  FlatList,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
  type ListRenderItem,
  type ViewToken,
} from 'react-native';

import { PhotoPermissionPreheatStack } from '@components/photos/PhotoPermissionPreheatStack';
import { PrivacyLockGlyph } from '@components/photos/PrivacyLockGlyph';
import { Button } from '@components/ui/Button';
import { colors, withAlpha } from '@constants/colors';
import { SCAN_COPY, type PhotoPermissionCarouselDoor } from '@constants/scanCopy';
import { fonts } from '@constants/typography';
import { useReducedMotion } from '@hooks/useReducedMotion';
import { useStableCallback } from '@hooks/useStableCallback';

import type { PhotoPermissionPreheatChoice } from './PhotoPermissionPreheat';

export type PhotoPermissionCarouselStep = 1 | 2 | 3;
export type PhotoPermissionCarouselChangeVia = 'tap' | 'swipe';

export interface PhotoPermissionCarouselProps {
  door: PhotoPermissionCarouselDoor;
  step: PhotoPermissionCarouselStep;
  onBeatChange: (step: PhotoPermissionCarouselStep, via: PhotoPermissionCarouselChangeVia) => void;
  onChoose: (choice: PhotoPermissionPreheatChoice) => void;
  visual?: ReactNode;
  testID?: string;
}

interface CarouselPage {
  step: PhotoPermissionCarouselStep;
  title: string;
  subtitle: string;
}

const TOTAL_STEPS = 3;
const ACTION_BAND_HEIGHT = 164;

function buildPages(door: PhotoPermissionCarouselDoor): CarouselPage[] {
  return [
    {
      step: 1,
      title: SCAN_COPY.permission.carousel.beat1Title,
      subtitle: SCAN_COPY.permission.carousel.beat1Subtitle,
    },
    {
      step: 2,
      title: SCAN_COPY.permission.carousel.beat2Title,
      subtitle: SCAN_COPY.permission.carousel.beat2Subtitle,
    },
    {
      step: 3,
      title: SCAN_COPY.permission.carousel.beat3Title(door),
      subtitle: SCAN_COPY.permission.carousel.beat3Subtitle(door),
    },
  ];
}

function isCarouselStep(value: number): value is PhotoPermissionCarouselStep {
  return value >= 1 && value <= TOTAL_STEPS;
}

export function PhotoPermissionCarousel({
  door,
  step,
  onBeatChange,
  onChoose,
  visual,
  testID = 'photo-permission-carousel',
}: PhotoPermissionCarouselProps) {
  const { width } = useWindowDimensions();
  const reduceMotion = useReducedMotion();
  const pagerRef = useRef<FlatList<CarouselPage>>(null);
  const reportedStepRef = useRef<PhotoPermissionCarouselStep>(step);
  const announcedStepRef = useRef<PhotoPermissionCarouselStep>(step);
  const pages = useMemo(() => buildPages(door), [door]);
  const viewabilityConfig = useMemo(() => ({ viewAreaCoveragePercentThreshold: 50 }), []);

  useEffect(() => {
    reportedStepRef.current = step;
  }, [step]);

  useEffect(() => {
    if (announcedStepRef.current === step) {
      return;
    }

    announcedStepRef.current = step;
    AccessibilityInfo.announceForAccessibility(
      SCAN_COPY.permission.carousel.stepAnnouncement(step, TOTAL_STEPS, pages[step - 1].title)
    );
  }, [pages, step]);

  const reportBeatChange = useStableCallback(
    (nextStep: PhotoPermissionCarouselStep, via: PhotoPermissionCarouselChangeVia) => {
      if (reportedStepRef.current === nextStep) {
        return;
      }

      reportedStepRef.current = nextStep;
      onBeatChange(nextStep, via);
    }
  );

  const handleContinue = useStableCallback(() => {
    const nextStep = step + 1;
    if (!isCarouselStep(nextStep)) {
      return;
    }

    reportBeatChange(nextStep, 'tap');
    pagerRef.current?.scrollToIndex({
      index: nextStep - 1,
      animated: !reduceMotion,
    });
  });

  const handleViewableItemsChanged = useStableCallback(
    ({ viewableItems }: { viewableItems: ViewToken<CarouselPage>[] }) => {
      const index = viewableItems.find((item) => item.isViewable && item.index !== null)?.index;
      if (index === null || index === undefined) {
        return;
      }

      const nextStep = index + 1;
      if (isCarouselStep(nextStep)) {
        reportBeatChange(nextStep, 'swipe');
      }
    }
  );

  const renderPage: ListRenderItem<CarouselPage> = ({ item }) => (
    <View style={[styles.page, { width }]} testID={`photo-permission-carousel-page-${item.step}`}>
      <Text style={styles.title}>{item.title}</Text>
      <Text style={styles.subtitle}>{item.subtitle}</Text>
    </View>
  );

  return (
    <View style={styles.container} testID={testID}>
      {visual ? (
        <View
          style={styles.visual}
          accessibilityElementsHidden
          importantForAccessibility="no-hide-descendants"
          testID="photo-permission-carousel-visual"
        >
          {visual}
        </View>
      ) : null}

      <FlatList
        ref={pagerRef}
        data={pages}
        renderItem={renderPage}
        keyExtractor={(item) => String(item.step)}
        horizontal
        pagingEnabled
        bounces={false}
        showsHorizontalScrollIndicator={false}
        initialScrollIndex={step - 1}
        getItemLayout={(_data, index) => ({
          length: width,
          offset: width * index,
          index,
        })}
        onViewableItemsChanged={handleViewableItemsChanged}
        viewabilityConfig={viewabilityConfig}
        style={styles.pager}
        testID="photo-permission-carousel-pager"
      />

      <View
        style={styles.dots}
        accessible={false}
        importantForAccessibility="no"
        testID="photo-permission-carousel-dots"
      >
        {pages.map((page) => (
          <View
            key={page.step}
            style={[styles.dot, page.step === step && styles.activeDot]}
            testID={`photo-permission-carousel-dot-${page.step}`}
          />
        ))}
      </View>

      <View style={styles.actionBand} testID="photo-permission-carousel-action-band">
        {step < TOTAL_STEPS ? (
          <Button
            title={SCAN_COPY.permission.carousel.continueCta}
            onPress={handleContinue}
            style={styles.continueButton}
            testID="photo-permission-carousel-continue"
          />
        ) : (
          <PhotoPermissionPreheatStack onChoose={onChoose} />
        )}
      </View>

      <View style={styles.footer} testID="photo-permission-carousel-footer">
        <PrivacyLockGlyph testID="photo-permission-carousel-lock" />
        <Text style={styles.footerText}>{SCAN_COPY.permission.carousel.footerNotice}</Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    alignSelf: 'stretch',
    overflow: 'hidden',
    gap: 12,
  },
  visual: {
    alignSelf: 'stretch',
  },
  pager: {
    flexGrow: 0,
  },
  page: {
    paddingHorizontal: 4,
    alignItems: 'center',
    gap: 8,
  },
  title: {
    fontFamily: fonts.playfair.bold,
    fontSize: 26,
    color: colors.midnightNavy,
    textAlign: 'center',
  },
  subtitle: {
    fontFamily: fonts.openSans.regular,
    fontSize: 15,
    lineHeight: 22,
    color: colors.stormGray,
    textAlign: 'center',
  },
  dots: {
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    gap: 8,
  },
  dot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: withAlpha(colors.stormGray, 0.35),
  },
  activeDot: {
    width: 24,
    backgroundColor: colors.midnightNavy,
  },
  actionBand: {
    height: ACTION_BAND_HEIGHT,
    justifyContent: 'center',
    alignSelf: 'stretch',
  },
  continueButton: {
    minWidth: 220,
    alignSelf: 'center',
  },
  footer: {
    minHeight: 24,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 7,
  },
  footerText: {
    flexShrink: 1,
    fontFamily: fonts.openSans.regular,
    fontSize: 12,
    lineHeight: 18,
    color: withAlpha(colors.stormGray, 0.95),
    textAlign: 'center',
  },
});

export default PhotoPermissionCarousel;
