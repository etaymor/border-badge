# PRD: Premium Animation System

## Introduction/Overview

Border Badge needs a comprehensive animation overhaul to transform the app from functional to **premium**—the kind of polished experience that justifies a premium price point and creates word-of-mouth buzz.

Currently, the app has solid foundational animations (staggered stamp reveals, celebration overlays, spring-based press feedback) but lacks **cohesive screen-to-screen transitions** and **shared element magic** that makes apps like Instagram, Apple Music, and X feel connected and alive.

This PRD defines a thoughtful animation system using the `react-native-screen-transitions` library that will:
- Create visual continuity through shared element transitions
- Make the passport grid feel like a living collection
- Transform onboarding into an emotionally resonant journey
- Add satisfying micro-interactions throughout daily use

**Design Philosophy:** "Every animation should earn its place—either guiding the user's attention, providing feedback, or creating emotional resonance. No animation for animation's sake."

---

## Goals

1. **Perceived Premium Quality** - Animations should make users feel they're using a $100+/year app
2. **Emotional Journey** - Onboarding animations should build anticipation and celebrate milestones
3. **Spatial Continuity** - Shared elements create the illusion of one cohesive space, not disconnected screens
4. **Satisfying Feedback** - Every tap, scroll, and state change feels responsive and intentional
5. **Performance** - All animations run at 60fps on mid-range devices (no jank)

---

## User Stories

1. **As a new user**, I want the onboarding to feel like an exciting journey so that I'm emotionally invested before I even create an account

2. **As a passport viewer**, I want my collection to feel alive and satisfying to browse so that I return to admire it frequently

3. **As a country explorer**, I want tapping a country to feel like opening that country's chapter in my travel story

4. **As a trip documenter**, I want adding entries to feel rewarding so that I'm motivated to log more memories

5. **As a daily user**, I want every interaction to feel responsive and polished so that using the app is a joy, not a chore

---

## Functional Requirements

### 1. Screen Transition System (react-native-screen-transitions)

**1.1 Navigation Stack Configuration**
- Replace current React Navigation stack with `BlankStack` from react-native-screen-transitions
- Configure global transition specs for consistent timing across the app
- Establish base interpolators that can be extended per-screen

**1.2 Default Transition Presets**
| Context | Transition Style | Rationale |
|---------|-----------------|-----------|
| Forward navigation | Slide from right with subtle scale on previous screen (0.95) | Standard iOS feel, depth perception |
| Back navigation | Reverse of forward | Spatial consistency |
| Modal presentation | Slide from bottom with overlay darkening | Clear hierarchy distinction |
| Tab switches | Cross-fade (200ms) | Quick, non-distracting |

### 2. Shared Element Transitions

**2.1 Country Flag/Stamp Morphing**
- When tapping a country in the passport grid, the flag/stamp should:
  - Scale up from its grid position
  - Morph into the hero image position on CountryDetailScreen
  - Maintain aspect ratio throughout transition
  - Other grid items should subtly fade/scale back (0.95 opacity/scale)

- Implementation using `Transition.View` with `styleId`:
  ```
  Passport Grid: <Transition.View styleId={`country-${countryId}`}>
  Country Detail: <Transition.View styleId={`country-${countryId}`}>
  ```

**2.2 Trip Card Morphing**
- Trip cards in CountryDetailScreen should morph to TripDetailScreen header
- Card border radius should interpolate from rounded (16px) to square (0px) as it expands
- Card shadow should fade out during expansion

**2.3 Entry/Media Image Morphing**
- Entry images should expand from thumbnail to full-screen detail view
- Use Instagram-style shared image transition (`SharedIGImage` preset as base)
- Include gesture-to-dismiss from detail view (vertical drag)

### 3. Onboarding Animation Redesign

**3.1 Screen-to-Screen Narrative Flow**
Each transition should feel like turning pages in a story:

| From → To | Transition | Emotional Intent |
|-----------|------------|------------------|
| WelcomeCarousel → OnboardingSlider | Parallax slide, video cross-dissolve | "Let's begin your journey" |
| OnboardingSlider → Motivation | Zoom out to reveal, 3D card stack feel | "Step back and reflect" |
| Motivation → HomeCountry | Slide with location pin leading the motion | "Let's place you on the map" |
| HomeCountry → TrackingPreference | Gentle slide, continuation | "A quick preference" |
| TrackingPreference → DreamDestination | Sparkle particles lead transition | "Now for something exciting" |
| DreamDestination → ContinentIntro | Globe rotation / continent zoom | "Let's explore where you've been" |
| ContinentIntro → ContinentCountryGrid | Map unfolds into grid | "Let's get specific" |
| ContinentCountryGrid → Next Continent | Slide with progress bar animation | "Onwards!" |
| AntarcticaPrompt → ProgressSummary | Dramatic reveal, stamps fly in | "Look at your collection!" |
| ProgressSummary → NameEntry | Stamps collect into passport | "Make it official" |
| NameEntry → AccountCreation | Passport stamp animation | "Seal the deal" |

**3.2 Enhanced In-Screen Animations**
- **MotivationScreen**: Tags should float in like travel stickers being placed
- **ContinentIntroScreen**: Video should have parallax depth, buttons pulse subtly
- **ProgressSummaryScreen**: Stamps should cascade in with physics-based bounces

**3.3 Celebration Moments**
- HomeCountry selection: Location pin drops with bounce + ripple effect
- DreamDestination selection: Stars/sparkles burst from selection
- Each continent completion: Map region illuminates
- Final summary: Confetti + haptic celebration sequence

### 4. Passport Grid Animations

**4.1 Initial Load**
- Grid items should stagger in on first view (not every return)
- Stagger pattern: top-left to bottom-right diagonal wave
- Each item: scale from 0.8 → 1.0 with spring, opacity 0 → 1
- Timing: 50ms stagger between items, max 1.5s for full grid

**4.2 Scroll Behavior**
- Items entering viewport should have subtle fade-in (already partially implemented)
- Visited countries with stamps should have very subtle "breathing" animation (scale 1.0 ↔ 1.01 over 3s)
- Parallax effect on header as user scrolls

**4.3 State Changes**
- When marking a country as visited:
  - Stamp should "appear" with scale bounce (0 → 1.1 → 1.0)
  - Satisfying haptic feedback (medium impact)
  - Subtle ripple effect on the card
- When adding to wishlist:
  - Heart/star icon should scale with spring
  - Card should have brief glow effect

**4.4 Press Feedback**
- On press down: scale to 0.96, shadow reduces
- On press up: spring back to 1.0
- On long press: scale to 0.94, subtle vibration

### 5. Country Detail Animations

**5.1 Entry Transition**
- Shared element: Flag/stamp morphs from grid position to hero
- Background: Blur + darken previous screen
- Content: Stagger in from bottom (title → stats → trips)

**5.2 Scroll Interactions**
- Hero image parallax (already implemented, enhance)
- Sticky header appearance with blur
- Trip cards should have subtle parallax (move slightly slower than scroll)

**5.3 Exit Transition**
- Reverse of entry
- If user scrolled, hero should still animate back to grid position

### 6. Trip & Entry Animations

**6.1 Trip Detail Entry**
- Trip card morphs to header image
- Content staggers in below
- Map (if present) should have subtle zoom-in reveal

**6.2 Entry List**
- Entries should stagger in with slight scale
- Timeline connector should "draw" itself

**6.3 Entry Creation**
- Form fields should stagger in
- On save: Entry should "fly" into its position in the list
- Success celebration: subtle confetti + haptic

### 7. Micro-Interactions (App-Wide)

**7.1 Buttons**
- Press: scale 0.97, slight darken
- Release: spring back
- Loading state: pulse animation

**7.2 Inputs**
- Focus: border color animates, subtle scale (1.01)
- Error: shake animation (3 cycles, 10px amplitude)
- Success: brief green glow

**7.3 Chips/Tags**
- Selection: scale bounce (0.95 → 1.05 → 1.0) with spring
- Deselection: shrink slightly then return

**7.4 Cards**
- Hover/focus: subtle lift (shadow increase, -2px translateY)
- Press: press down effect

**7.5 Tab Bar**
- Icon change: morph/cross-fade icons
- Badge updates: bounce animation

**7.6 Pull-to-Refresh**
- Custom animation: passport stamp rotates/bounces while loading

**7.7 Empty States**
- Content should fade in with slight upward motion
- Illustrations should have subtle floating animation

### 8. Performance Requirements

**8.1 Technical Constraints**
- All animations must use `useNativeDriver: true` or Reanimated worklets
- Shared element measurements must be cached
- Animation values should be cleaned up on unmount
- No animation should block the JS thread

**8.2 Testing Criteria**
- 60fps on iPhone 11 / Pixel 4 equivalents
- No dropped frames during shared element transitions
- Memory usage should not increase with repeated navigation

---

## Non-Goals (Out of Scope)

1. **Custom gesture navigation** - No swipe-to-go-back customization, standard navigation gestures only
2. **Lottie/complex vector animations** - Stick to transform-based animations
3. **3D transforms** - Keep to 2D transforms for performance and simplicity
4. **Sound effects** - Audio is out of scope (haptics are in scope)
5. **Accessibility motion preferences** - Will be addressed in a follow-up (respect `prefers-reduced-motion`)
6. **Android-specific transitions** - Focus on iOS-first, Android parity later

---

## Design Considerations

### Visual Language Alignment
- Animations should reinforce the **warm, travel-journal aesthetic**
- Motion should feel **organic, not mechanical** (springs > linear timing)
- Celebrations should feel **genuine, not gamified** (tasteful confetti, not slot-machine effects)

### Timing Guidelines
| Animation Type | Duration | Easing |
|----------------|----------|--------|
| Screen transitions | 300-400ms | Spring (friction: 8, tension: 100) |
| Micro-interactions | 150-250ms | Spring (friction: 6, tension: 200) |
| Celebrations | 600-1000ms | Spring with decay |
| Stagger delays | 30-80ms | N/A |
| Shared elements | 350ms | Custom bezier |

### Color in Motion
- Use Sunset Gold (#F4C24E) for celebration accents
- Lake Blue (#A0CDEB) for loading/progress states
- Moss Green (#547A5F) for success confirmations

---

## Technical Considerations

### Library Integration
- Install `react-native-screen-transitions` via npm
- Replace navigation stack in `RootNavigator.tsx`
- Create shared `transitionConfig.ts` for reusable interpolators
- Wrap morphing elements with `Transition.View`

### File Structure
```
mobile/src/
├── navigation/
│   ├── transitionConfig.ts     # Shared transition configurations
│   ├── interpolators/          # Custom screen interpolators
│   │   ├── slideWithScale.ts
│   │   ├── sharedCountry.ts
│   │   └── onboarding.ts
├── components/
│   ├── transitions/            # Shared element wrapper components
│   │   ├── SharedCountryImage.tsx
│   │   ├── SharedTripCard.tsx
│   │   └── SharedEntryImage.tsx
```

### Migration Strategy
1. Install library and set up BlankStack alongside existing navigation
2. Migrate one flow at a time (start with Country Grid → Detail)
3. Add shared elements incrementally
4. Enhance onboarding last (most complex)

### Dependencies
- `react-native-screen-transitions` (new)
- `react-native-reanimated` (likely already installed, verify version)
- `react-native-screens` (already installed)

---

## Success Metrics

1. **Qualitative**
   - User testing feedback: "feels premium" / "feels polished"
   - App Store reviews mentioning smooth/beautiful experience
   - Reduced perception of load times due to animation distraction

2. **Quantitative**
   - Animation frame rate: 60fps (measured via React Native performance monitor)
   - No increase in app crash rate
   - No significant increase in bundle size (target: < 50KB added)

3. **Engagement Proxies**
   - Increase in onboarding completion rate (animation delight reduces drop-off)
   - Increase in countries marked/trips logged (satisfying feedback encourages action)

---

## Open Questions

1. **Accessibility**: How should we handle `prefers-reduced-motion`? Disable all animations, or provide simplified versions?

2. **Onboarding video assets**: Current videos may need re-encoding for smoother transitions. Are we open to asset changes?

3. **Performance profiling**: Do we have baseline performance metrics to compare against?

4. **Shared element edge cases**: What happens if a country is deleted while the detail screen is open? Need to define fallback behavior.

5. **Tab bar (future)**: When MainTabNavigator is re-enabled, should tab switches have custom animations?

---

## Implementation Phases

### Phase 1: Foundation (Week 1)
- Install and configure react-native-screen-transitions
- Create base transition configurations
- Implement Country Grid → Country Detail shared element

### Phase 2: Core Flows (Week 2)
- Trip Card → Trip Detail shared element
- Entry image shared elements
- Polish screen-to-screen transitions app-wide

### Phase 3: Micro-Interactions (Week 3)
- Button, input, chip animations
- State change animations (visited, wishlist)
- Pull-to-refresh customization

### Phase 4: Onboarding Redesign (Week 4)
- Screen-to-screen narrative transitions
- Enhanced celebration moments
- Polish and testing

### Phase 5: Polish & Performance (Week 5)
- Performance optimization
- Edge case handling
- Accessibility considerations
- Final QA

---

*Generated following create-prd.mdc guidelines*
