import { useRef, useEffect, useCallback } from 'react';
import { Animated, Easing } from 'react-native';

export interface CelebrationAnimationRefs {
  selectionScale: Animated.Value;
  selectionOpacity: Animated.Value;
  flagScale: Animated.Value;
  flagRotate: Animated.Value;
  checkmarkScale: Animated.Value;
  checkmarkOpacity: Animated.Value;
  confettiOpacity: Animated.Value;
  starScale: Animated.Value;
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
  hasStars?: boolean;
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
  const {
    hasLocationPin = false,
    hasBackButton = false,
    hasStars = false,
    celebrationHoldDuration = 600,
  } = options;

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

  // Celebration animation refs
  const selectionScale = useRef(new Animated.Value(0)).current;
  const selectionOpacity = useRef(new Animated.Value(0)).current;
  const flagScale = useRef(new Animated.Value(0.5)).current;
  const flagRotate = useRef(new Animated.Value(0)).current;
  const checkmarkScale = useRef(new Animated.Value(0)).current;
  const checkmarkOpacity = useRef(new Animated.Value(0)).current;
  const confettiOpacity = useRef(new Animated.Value(0)).current;
  const starScale = useRef(new Animated.Value(0)).current;

  // Entrance animations
  useEffect(() => {
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

    // Floating animation for location pin
    if (hasLocationPin) {
      Animated.loop(
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
      ).start();
    }
  }, [
    hasBackButton,
    hasLocationPin,
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
    [dropdownOpacity, dropdownTranslate]
  );

  // Celebration animation
  const playCelebration = useCallback(
    (onComplete: () => void) => {
      // Reset animation values
      selectionScale.setValue(0);
      selectionOpacity.setValue(0);
      flagScale.setValue(0.5);
      flagRotate.setValue(0);
      checkmarkScale.setValue(0);
      checkmarkOpacity.setValue(0);
      confettiOpacity.setValue(0);
      starScale.setValue(0);

      // Build celebration sequence
      const flagAnimations: Animated.CompositeAnimation[] = [
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
        Animated.timing(confettiOpacity, {
          toValue: 1,
          duration: 300,
          useNativeDriver: true,
        }),
      ];

      // Add star animation if enabled
      if (hasStars) {
        flagAnimations.push(
          Animated.spring(starScale, {
            toValue: 1,
            friction: 5,
            tension: 100,
            useNativeDriver: true,
          })
        );
      }

      Animated.sequence([
        // Fade in backdrop and scale up container
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
        ]),
        // Bounce in flag with rotation (and stars if enabled)
        Animated.parallel(flagAnimations),
        // Pop in checkmark
        Animated.parallel([
          Animated.spring(checkmarkScale, {
            toValue: 1,
            friction: 5,
            tension: 120,
            useNativeDriver: true,
          }),
          Animated.timing(checkmarkOpacity, {
            toValue: 1,
            duration: 200,
            useNativeDriver: true,
          }),
        ]),
        // Hold for a moment
        Animated.delay(celebrationHoldDuration),
        // Fade out
        Animated.timing(selectionOpacity, {
          toValue: 0,
          duration: 300,
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
      hasStars,
      celebrationHoldDuration,
      selectionScale,
      selectionOpacity,
      flagScale,
      flagRotate,
      checkmarkScale,
      checkmarkOpacity,
      confettiOpacity,
      starScale,
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
      checkmarkScale,
      checkmarkOpacity,
      confettiOpacity,
      starScale,
    },
    animateDropdown,
    playCelebration,
  };
}
