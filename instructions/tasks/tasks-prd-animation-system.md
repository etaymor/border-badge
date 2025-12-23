# Tasks: Premium Animation System

Based on [prd-animation-system.md](prd-animation-system.md)

## Relevant Files

### New Files to Create
- `mobile/src/navigation/transitionConfig.ts` - Shared transition configurations, spring presets, timing constants
- `mobile/src/navigation/transitionConfig.test.ts` - Unit tests for transition configurations
- `mobile/src/navigation/interpolators/slideWithScale.ts` - Default screen transition interpolator
- `mobile/src/navigation/interpolators/sharedCountry.ts` - Country grid → detail shared element interpolator
- `mobile/src/navigation/interpolators/sharedTrip.ts` - Trip card → detail shared element interpolator
- `mobile/src/navigation/interpolators/onboarding.ts` - Onboarding-specific transition interpolators
- `mobile/src/navigation/interpolators/index.ts` - Barrel export for all interpolators
- `mobile/src/components/transitions/SharedCountryImage.tsx` - Shared element wrapper for country flags/stamps
- `mobile/src/components/transitions/SharedCountryImage.test.tsx` - Tests for SharedCountryImage
- `mobile/src/components/transitions/SharedTripCard.tsx` - Shared element wrapper for trip cards
- `mobile/src/components/transitions/SharedTripCard.test.tsx` - Tests for SharedTripCard
- `mobile/src/components/transitions/SharedEntryImage.tsx` - Shared element wrapper for entry images
- `mobile/src/components/transitions/SharedEntryImage.test.tsx` - Tests for SharedEntryImage
- `mobile/src/components/transitions/index.ts` - Barrel export for transition components
- `mobile/src/hooks/useAnimatedPress.ts` - Reusable hook for press feedback animations
- `mobile/src/hooks/useAnimatedPress.test.ts` - Tests for useAnimatedPress hook
- `mobile/src/hooks/useStaggeredEntrance.ts` - Reusable hook for staggered list animations
- `mobile/src/hooks/useStaggeredEntrance.test.ts` - Tests for useStaggeredEntrance hook

### Existing Files to Modify
- `mobile/package.json` - Add react-native-screen-transitions dependency
- `mobile/src/navigation/RootNavigator.tsx` - Replace native stack with BlankStack
- `mobile/src/navigation/PassportNavigator.tsx` - Add shared element transition configs
- `mobile/src/navigation/OnboardingNavigator.tsx` - Add custom onboarding transitions
- `mobile/src/navigation/TripsNavigator.tsx` - Add trip/entry shared element configs
- `mobile/src/screens/passport/PassportScreen.tsx` - Wrap country items with SharedCountryImage
- `mobile/src/screens/country/CountryDetailScreen.tsx` - Add shared element hero, enhance scroll animations
- `mobile/src/screens/trips/TripDetailScreen.tsx` - Add shared element header
- `mobile/src/components/ui/TripCard.tsx` - Wrap with SharedTripCard, enhance press feedback
- `mobile/src/components/ui/Button.tsx` - Add press scale animation
- `mobile/src/components/ui/Chip.tsx` - Enhance selection bounce animation
- `mobile/src/components/ui/GlassInput.tsx` - Add focus/error animations
- `mobile/src/components/passport/CountryGridItem.tsx` - Add breathing animation, enhanced press feedback
- `mobile/src/components/passport/StampRow.tsx` - Integrate with shared element system
- `mobile/src/hooks/usePassportAnimations.ts` - Enhance with diagonal wave stagger pattern
- `mobile/src/hooks/useCountrySelectionAnimations.ts` - Extend for new celebration effects

### Existing Files to Reuse (No Modifications)
- `mobile/src/components/passport/AnimatedCardWrapper.tsx` - Reuse for card entrance animations
- `mobile/src/components/onboarding/CelebrationOverlay.tsx` - Reuse for celebration moments
- `mobile/src/components/onboarding/RotatingStampHero.tsx` - Reference for floating animation patterns
- `mobile/src/components/navigation/LiquidGlassTabBar.tsx` - Reference spring constants and press patterns
- `mobile/src/screens/passport/passportConstants.ts` - Use layout constants for animation calculations

### Test Files
- `mobile/src/__tests__/components/RotatingStampHero.test.tsx` - Reference for animation testing patterns
- `mobile/src/__tests__/components/PassportStampCollage.test.tsx` - Reference for stagger/haptic testing
- `mobile/src/__tests__/navigation/transitionConfig.test.ts` - New: Test transition configurations
- `mobile/src/__tests__/hooks/useAnimatedPress.test.ts` - New: Test press animations
- `mobile/src/__tests__/hooks/useStaggeredEntrance.test.ts` - New: Test stagger animations
- `mobile/src/__tests__/integration/sharedElementTransition.test.tsx` - New: Integration test for shared elements

### Notes

- Unit tests should be placed alongside the code files they test (e.g., `transitionConfig.ts` and `transitionConfig.test.ts`)
- Use `npx jest [optional/path/to/test/file]` to run tests
- All animations must use `useNativeDriver: true` or Reanimated worklets for performance
- Reuse existing spring constants from `LiquidGlassTabBar.tsx`: `SPRING_FRICTION: 8`, `SPRING_TENSION_IN: 400`, `SPRING_TENSION_OUT: 300`
- Reuse stagger patterns from `usePassportAnimations.ts`: 100ms between items, LRU cache approach
- Reference `RotatingStampHero.test.tsx` for animation testing with `jest.useFakeTimers()` and `act()`

---

## Tasks

- [ ] 1.0 Foundation: Install and Configure react-native-screen-transitions
  - [ ] 1.1 Install `react-native-screen-transitions` package via npm and verify compatibility with existing `react-native-screens` and `react-native-reanimated` versions
  - [ ] 1.2 Create `mobile/src/navigation/transitionConfig.ts` with shared spring presets (reuse constants from `LiquidGlassTabBar.tsx`: friction 8, tension 400/300), timing configurations, and easing functions
  - [ ] 1.3 Create `mobile/src/navigation/interpolators/slideWithScale.ts` - default screen interpolator with slide-from-right and 0.95 scale on previous screen
  - [ ] 1.4 Create `mobile/src/navigation/interpolators/index.ts` barrel export for all interpolators
  - [ ] 1.5 Update `mobile/src/navigation/RootNavigator.tsx` to use BlankStack from react-native-screen-transitions instead of createNativeStackNavigator, applying default slideWithScale transition
  - [ ] 1.6 Write unit tests for `transitionConfig.ts` verifying spring configs export correctly and interpolator functions return valid style objects
  - [ ] 1.7 Manually test navigation flow (Auth → Onboarding → Main) to verify transitions work without regressions

- [ ] 2.0 Shared Element System: Country Grid → Country Detail Transition
  - [ ] 2.1 Create `mobile/src/components/transitions/SharedCountryImage.tsx` - wrapper component using `Transition.View` with dynamic `styleId` based on countryId prop
  - [ ] 2.2 Create `mobile/src/navigation/interpolators/sharedCountry.ts` - interpolator that morphs country element from grid position to hero, with other items fading to 0.95 opacity/scale
  - [ ] 2.3 Update `mobile/src/components/passport/StampRow.tsx` to wrap each country stamp with `SharedCountryImage` component, passing countryId
  - [ ] 2.4 Update `mobile/src/components/passport/CountryGridItem.tsx` to wrap with `SharedCountryImage` for unvisited countries
  - [ ] 2.5 Update `mobile/src/screens/country/CountryDetailScreen.tsx` to wrap hero image area with matching `SharedCountryImage` component using same countryId
  - [ ] 2.6 Update `mobile/src/navigation/PassportNavigator.tsx` to apply `sharedCountry` interpolator for CountryDetail screen transitions
  - [ ] 2.7 Write tests for `SharedCountryImage.tsx` verifying correct styleId generation, proper children rendering, and ref forwarding
  - [ ] 2.8 Write integration test simulating navigation from PassportScreen to CountryDetailScreen, verifying shared element is recognized

- [ ] 3.0 Shared Element System: Trip Card → Trip Detail Transition
  - [ ] 3.1 Create `mobile/src/components/transitions/SharedTripCard.tsx` - wrapper using `Transition.View` with `styleId` based on tripId
  - [ ] 3.2 Create `mobile/src/navigation/interpolators/sharedTrip.ts` - interpolator with border-radius morphing (16px → 0px) and shadow fade-out during expansion
  - [ ] 3.3 Update `mobile/src/components/ui/TripCard.tsx` to wrap card content with `SharedTripCard`, passing tripId prop
  - [ ] 3.4 Update `mobile/src/screens/trips/TripDetailScreen.tsx` to wrap header image with matching `SharedTripCard` using same tripId
  - [ ] 3.5 Update `mobile/src/navigation/TripsNavigator.tsx` to apply `sharedTrip` interpolator for TripDetail screen
  - [ ] 3.6 Create `mobile/src/components/transitions/SharedEntryImage.tsx` for entry images with Instagram-style expand (base on `SharedIGImage` preset)
  - [ ] 3.7 Write tests for `SharedTripCard.tsx` and `SharedEntryImage.tsx` components
  - [ ] 3.8 Create `mobile/src/components/transitions/index.ts` barrel export for all shared element components

- [ ] 4.0 Passport Grid Animation Enhancements
  - [ ] 4.1 Update `mobile/src/hooks/usePassportAnimations.ts` to implement diagonal wave stagger pattern (top-left to bottom-right) with 50ms stagger, max 1.5s total duration
  - [ ] 4.2 Add "first load only" flag to `usePassportAnimations` to prevent re-animation on every screen return (persist in component state or ref)
  - [ ] 4.3 Create `mobile/src/hooks/useAnimatedPress.ts` - reusable hook returning scale animation value and press handlers (pressIn: 0.96 scale, pressOut: spring back to 1.0)
  - [ ] 4.4 Update `mobile/src/components/passport/CountryGridItem.tsx` to use `useAnimatedPress` hook for press feedback, add subtle breathing animation for visited stamps (scale 1.0 ↔ 1.01 over 3s loop)
  - [ ] 4.5 Add state change animations to passport grid: stamp appearance with scale bounce (0 → 1.1 → 1.0) and haptic feedback when marking country as visited
  - [ ] 4.6 Add wishlist toggle animation: heart/star icon scale spring + brief glow effect on card
  - [ ] 4.7 Write tests for `useAnimatedPress` hook verifying animation values change correctly on press events
  - [ ] 4.8 Write tests for diagonal wave stagger calculation logic

- [ ] 5.0 Micro-Interactions: Button, Input, and Chip Animations
  - [ ] 5.1 Update `mobile/src/components/ui/Button.tsx` to add press animation using `useAnimatedPress` (scale 0.97, slight opacity reduction), add loading state pulse animation
  - [ ] 5.2 Update `mobile/src/components/ui/GlassInput.tsx` to add focus animation (border color transition, subtle 1.01 scale), error shake animation (3 cycles, 10px amplitude), success glow effect
  - [ ] 5.3 Update `mobile/src/components/ui/Chip.tsx` to enhance selection bounce (0.95 → 1.05 → 1.0 spring), add deselection shrink animation
  - [ ] 5.4 Create `mobile/src/hooks/useStaggeredEntrance.ts` - reusable hook for staggering list item entrances with configurable delay (default 50ms) and spring config
  - [ ] 5.5 Add empty state animations: content fade-in with upward motion, illustrations with subtle floating animation (reference `RotatingStampHero` float pattern)
  - [ ] 5.6 Write tests for `useStaggeredEntrance` hook verifying correct delay calculations and animation value sequencing
  - [ ] 5.7 Test all micro-interactions manually on device to verify 60fps performance and satisfying feel

- [ ] 6.0 Onboarding Transition Redesign
  - [ ] 6.1 Create `mobile/src/navigation/interpolators/onboarding.ts` with unique interpolators for each onboarding transition (parallax slide, zoom reveal, sparkle lead, globe rotation patterns)
  - [ ] 6.2 Implement WelcomeCarousel → OnboardingSlider transition: parallax slide with video cross-dissolve effect
  - [ ] 6.3 Implement OnboardingSlider → Motivation transition: zoom-out reveal with 3D card stack feel
  - [ ] 6.4 Implement Motivation → HomeCountry transition: slide with location pin leading motion (coordinate with existing pin animations)
  - [ ] 6.5 Implement DreamDestination → ContinentIntro transition: globe rotation / continent zoom effect
  - [ ] 6.6 Implement AntarcticaPrompt → ProgressSummary transition: dramatic reveal with stamps flying in effect
  - [ ] 6.7 Implement ProgressSummary → NameEntry transition: stamps collecting into passport animation
  - [ ] 6.8 Update `mobile/src/navigation/OnboardingNavigator.tsx` to apply screen-specific interpolators from `onboarding.ts`
  - [ ] 6.9 Enhance celebration moments: add ripple effect to HomeCountry pin drop, sparkle burst for DreamDestination, region illumination for continent completion
  - [ ] 6.10 Extend `mobile/src/hooks/useCountrySelectionAnimations.ts` with new celebration effect animations (ripple, sparkle burst, region glow)
  - [ ] 6.11 Update `mobile/src/components/onboarding/MotivationScreen.tsx` to animate tags floating in like travel stickers
  - [ ] 6.12 Test complete onboarding flow end-to-end verifying narrative cohesion and emotional impact

- [ ] 7.0 Performance Optimization and Testing
  - [ ] 7.1 Audit all new animations to verify `useNativeDriver: true` is used for all transform/opacity animations
  - [ ] 7.2 Implement animation value cleanup on component unmount for all new hooks and components (prevent memory leaks)
  - [ ] 7.3 Add shared element measurement caching in transition components to avoid recalculation during navigation
  - [ ] 7.4 Profile animations on mid-range device (iPhone 11 / Pixel 4 equivalent) using React Native performance monitor, target 60fps
  - [ ] 7.5 Create `mobile/src/__tests__/integration/sharedElementTransition.test.tsx` integration tests for shared element flows (country and trip)
  - [ ] 7.6 Add edge case handling: fallback behavior if shared element source is removed during transition
  - [ ] 7.7 Verify bundle size increase is under 50KB target by comparing before/after builds
  - [ ] 7.8 Run full test suite (`npx jest`) and fix any failing tests
  - [ ] 7.9 Final QA pass: test all animations across iOS simulator and physical device, document any remaining issues
