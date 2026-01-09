import { useRef, useEffect, useCallback } from 'react';
import { Animated, Easing } from 'react-native';
import { useReducedMotion } from './useReducedMotion';

export interface CelebrationAnimationRefs {
  selectionScale: Animated.Value;
  selectionOpacity: Animated.Value;
  flagScale: Animated.Value;
  flagRotate: Animated.Value;
  // Enhanced celebration effects
  rippleScale: Animated.Value;
  rippleOpacity: Animated.Value;
  sparkleScale: Animated.Value;
  sparkleRotate: Animated.Value;
}

export interface CountrySelectionAnimationRefs extends CelebrationAnimationRefs {
  titleOpacity: Animated.Value;
  titleTranslate: Animated.Value;
  searchOpacity: Animated.Value;
  searchTranslate: Animated.Value;
  buttonOpacity: Animated.Value;
  backButtonOpacity: Animated.Value;
  dropdownOpacity: Animated.Value;
  dropdownTranslate: Animated.Value;
  // Location pin animations (HomeCountry only)
  pinOpacity: Animated.Value;
  pinScale: Animated.Value;
  pinBounce: Animated.Value;
}

export interface UseCountrySelectionAnimationsOptions {
  hasLocationPin?: boolean;
  hasBackButton?: boolean;
  celebrationHoldDuration?: number;
}

export interface UseCountrySelectionAnimationsReturn {
  refs: CountrySelectionAnimationRefs;
  animateDropdown: (show: boolean) => void;
  playCelebration: (onComplete: () => void) => void;
}

export function useCountrySelectionAnimations(
  options: UseCountrySelectionAnimationsOptions = {}
): UseCountrySelectionAnimationsReturn {
  const { hasLocationPin = false, hasBackButton = false, celebrationHoldDuration = 600 } = options;

  // Check for reduced motion preference (WCAG 2.1 Level AA)
  const reduceMotion = useReducedMotion();

  // Track mounted state to prevent callbacks after unmount
  const isMountedRef = useRef(true);

  useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
    };
  }, []);

  // Entrance animation refs
  const titleOpacity = useRef(new Animated.Value(0)).current;
  const titleTranslate = useRef(new Animated.Value(20)).current;
  const searchOpacity = useRef(new Animated.Value(0)).current;
  const searchTranslate = useRef(new Animated.Value(20)).current;
  const buttonOpacity = useRef(new Animated.Value(0)).current;
  const backButtonOpacity = useRef(new Animated.Value(0)).current;
  const dropdownOpacity = useRef(new Animated.Value(0)).current;
  const dropdownTranslate = useRef(new Animated.Value(-10)).current;

  // Location pin refs (HomeCountry)
  const pinOpacity = useRef(new Animated.Value(0)).current;
  const pinScale = useRef(new Animated.Value(0.8)).current;
  const pinBounce = useRef(new Animated.Value(0)).current;
  const pinBounceLoopRef = useRef<Animated.CompositeAnimation | null>(null);

  // Celebration animation refs
  const selectionScale = useRef(new Animated.Value(0)).current;
  const selectionOpacity = useRef(new Animated.Value(0)).current;
  const flagScale = useRef(new Animated.Value(0.5)).current;
  const flagRotate = useRef(new Animated.Value(0)).current;

  // Enhanced celebration effects
  const rippleScale = useRef(new Animated.Value(0)).current;
  const rippleOpacity = useRef(new Animated.Value(0)).current;
  const sparkleScale = useRef(new Animated.Value(0)).current;
  const sparkleRotate = useRef(new Animated.Value(0)).current;

  // Entrance animations
  useEffect(() => {
    // If reduce motion is enabled, skip animations and set all values to final state
    if (reduceMotion) {
      if (hasBackButton) backButtonOpacity.setValue(1);
      titleOpacity.setValue(1);
      titleTranslate.setValue(0);
      searchOpacity.setValue(1);
      searchTranslate.setValue(0);
      if (hasLocationPin) {
        pinOpacity.setValue(1);
        pinScale.setValue(1);
      }
      buttonOpacity.setValue(1);
      return;
    }

    const entranceSequence: Animated.CompositeAnimation[] = [];

    // Back button fade in (if present)
    if (hasBackButton) {
      entranceSequence.push(
        Animated.timing(backButtonOpacity, {
          toValue: 1,
          duration: 200,
          useNativeDriver: true,
        })
      );
    }

    // Title fade in + translate
    entranceSequence.push(
      Animated.parallel([
        Animated.timing(titleOpacity, {
          toValue: 1,
          duration: 500,
          useNativeDriver: true,
        }),
        Animated.timing(titleTranslate, {
          toValue: 0,
          duration: 500,
          easing: Easing.out(Easing.cubic),
          useNativeDriver: true,
        }),
      ])
    );

    // Search fade in + translate
    entranceSequence.push(
      Animated.parallel([
        Animated.timing(searchOpacity, {
          toValue: 1,
          duration: 400,
          useNativeDriver: true,
        }),
        Animated.timing(searchTranslate, {
          toValue: 0,
          duration: 400,
          easing: Easing.out(Easing.cubic),
          useNativeDriver: true,
        }),
      ])
    );

    // Location pin animation (if present)
    if (hasLocationPin) {
      entranceSequence.push(
        Animated.parallel([
          Animated.timing(pinOpacity, {
            toValue: 1,
            duration: 600,
            useNativeDriver: true,
          }),
          Animated.spring(pinScale, {
            toValue: 1,
            friction: 6,
            tension: 100,
            useNativeDriver: true,
          }),
        ])
      );
    }

    // Button fade in
    entranceSequence.push(
      Animated.timing(buttonOpacity, {
        toValue: 1,
        duration: 300,
        useNativeDriver: true,
      })
    );

    Animated.sequence(entranceSequence).start();

    // Floating animation for location pin (skip if reduce motion is enabled)
    if (hasLocationPin && !reduceMotion) {
      pinBounceLoopRef.current = Animated.loop(
        Animated.sequence([
          Animated.timing(pinBounce, {
            toValue: -8,
            duration: 2000,
            easing: Easing.inOut(Easing.sin),
            useNativeDriver: true,
          }),
          Animated.timing(pinBounce, {
            toValue: 0,
            duration: 2000,
            easing: Easing.inOut(Easing.sin),
            useNativeDriver: true,
          }),
        ])
      );
      pinBounceLoopRef.current.start();
    }

    // Cleanup loop animation on unmount
    return () => {
      if (pinBounceLoopRef.current) {
        pinBounceLoopRef.current.stop();
        pinBounceLoopRef.current = null;
      }
      pinBounce.setValue(0);
    };
  }, [
    hasBackButton,
    hasLocationPin,
    reduceMotion,
    titleOpacity,
    titleTranslate,
    searchOpacity,
    searchTranslate,
    buttonOpacity,
    backButtonOpacity,
    pinOpacity,
    pinScale,
    pinBounce,
  ]);

  // Dropdown animation
  const animateDropdown = useCallback(
    (show: boolean) => {
      if (reduceMotion) {
        // Skip animation if reduce motion is enabled
        if (show) {
          dropdownOpacity.setValue(1);
          dropdownTranslate.setValue(0);
        } else {
          dropdownOpacity.setValue(0);
          dropdownTranslate.setValue(-10);
        }
        return;
      }

      if (show) {
        Animated.parallel([
          Animated.timing(dropdownOpacity, {
            toValue: 1,
            duration: 200,
            useNativeDriver: true,
          }),
          Animated.timing(dropdownTranslate, {
            toValue: 0,
            duration: 200,
            easing: Easing.out(Easing.cubic),
            useNativeDriver: true,
          }),
        ]).start();
      } else {
        dropdownOpacity.setValue(0);
        dropdownTranslate.setValue(-10);
      }
    },
    [dropdownOpacity, dropdownTranslate, reduceMotion]
  );

  // Celebration animation with enhanced effects
  const playCelebration = useCallback(
    (onComplete: () => void) => {
      // If reduce motion is enabled, skip animation and call onComplete immediately
      if (reduceMotion) {
        if (isMountedRef.current) {
          onComplete();
        }
        return;
      }

      // Reset animation values
      selectionScale.setValue(0);
      selectionOpacity.setValue(0);
      flagScale.setValue(0.5);
      flagRotate.setValue(0);
      rippleScale.setValue(0);
      rippleOpacity.setValue(0.8);
      sparkleScale.setValue(0);
      sparkleRotate.setValue(0);

      Animated.sequence([
        // Fade in backdrop and scale up container with flag animation
        Animated.parallel([
          Animated.timing(selectionOpacity, {
            toValue: 1,
            duration: 200,
            useNativeDriver: true,
          }),
          Animated.spring(selectionScale, {
            toValue: 1,
            friction: 6,
            tension: 100,
            useNativeDriver: true,
          }),
          Animated.spring(flagScale, {
            toValue: 1,
            friction: 4,
            tension: 80,
            useNativeDriver: true,
          }),
          Animated.timing(flagRotate, {
            toValue: 1,
            duration: 400,
            easing: Easing.out(Easing.back(1.5)),
            useNativeDriver: true,
          }),
          // Ripple effect: expands outward and fades
          Animated.parallel([
            Animated.timing(rippleScale, {
              toValue: 3,
              duration: 800,
              easing: Easing.out(Easing.cubic),
              useNativeDriver: true,
            }),
            Animated.timing(rippleOpacity, {
              toValue: 0,
              duration: 800,
              easing: Easing.out(Easing.cubic),
              useNativeDriver: true,
            }),
          ]),
          // Sparkle effect: scales up with rotation
          Animated.parallel([
            Animated.spring(sparkleScale, {
              toValue: 1,
              friction: 5,
              tension: 120,
              useNativeDriver: true,
            }),
            Animated.timing(sparkleRotate, {
              toValue: 1,
              duration: 600,
              easing: Easing.out(Easing.cubic),
              useNativeDriver: true,
            }),
          ]),
        ]),
        // Hold for a moment
        Animated.delay(celebrationHoldDuration),
        // Fade out quickly
        Animated.timing(selectionOpacity, {
          toValue: 0,
          duration: 200,
          useNativeDriver: true,
        }),
      ]).start(() => {
        // Only call onComplete if component is still mounted
        if (isMountedRef.current) {
          onComplete();
        }
      });
    },
    [
      celebrationHoldDuration,
      reduceMotion,
      selectionScale,
      selectionOpacity,
      flagScale,
      flagRotate,
      rippleScale,
      rippleOpacity,
      sparkleScale,
      sparkleRotate,
    ]
  );

  return {
    refs: {
      titleOpacity,
      titleTranslate,
      searchOpacity,
      searchTranslate,
      buttonOpacity,
      backButtonOpacity,
      dropdownOpacity,
      dropdownTranslate,
      pinOpacity,
      pinScale,
      pinBounce,
      selectionScale,
      selectionOpacity,
      flagScale,
      flagRotate,
      rippleScale,
      rippleOpacity,
      sparkleScale,
      sparkleRotate,
    },
    animateDropdown,
    playCelebration,
  };
}
