## Relevant Files

- `mobile/src/theme/colors.ts` - Current neutral palette; will be expanded into a full color system (primary, secondary, semantic colors, backgrounds, borders).
- `mobile/src/theme/typography.ts` - New or existing module defining font families, sizes, weights, and line heights for the app’s typographic scale.
- `mobile/src/theme/tokens.ts` (or `theme/index.ts`) - Central design tokens file exporting colors, spacing, radii, shadows, and animation durations (`docs/travel-mvp-blueprint.md` L585–590).
- `mobile/src/components/layout/Screen.tsx` - Base screen wrapper; key integration point for background colors, padding system, and status bar handling.
- `mobile/src/components/ui/Text.tsx` - Text component that will enforce the global typographic scale and color usage (PRD accessibility `docs/travel-prd.md` L223–231).
- `mobile/src/components/ui/Button.tsx` - Buttons to receive updated styles (primary/secondary/ghost, disabled, loading) driven by design tokens.
- `mobile/src/components/ui/Input.tsx` - Inputs to be updated with consistent borders, focus states, error visuals, and spacing.
- `mobile/src/components/ui/Chip.tsx` or `Tag.tsx` - Component for motivation/personality tags and other pill-like UI (PRD onboarding `docs/travel-prd.md` L217–221).
- `mobile/src/components/media/EntryMediaGallery.tsx` - Entry gallery component whose layout, spacing, and image presentation will be updated for final visuals.
- `mobile/src/components/passport/CountryTile.tsx` - New or existing component representing a country tile in the passport grid (illustration, flag, stamp states).
- `mobile/src/components/passport/StampGrid.tsx` - Optional layout component for the passport grid that handles spacing, responsive sizing, and animations (`docs/travel-mvp-blueprint.md` L595–603).
- `mobile/src/components/animation/Confetti.tsx` - Simple confetti/celebration animation component used for key milestones (PRD animation notes `docs/travel-prd.md` L229–230).
- `mobile/src/screens/Tabs/PassportScreen.tsx` - Main passport grid screen where upgraded visuals, stamps, and confetti will be applied.
- `mobile/src/screens/Onboarding/**` - Welcome slides, motivation tags, country selection, and progress summary screens receiving final art, typography, and micro-animations (`docs/travel-prd.md` L209–231).
- `mobile/src/screens/Paywall/PaywallScreen.tsx` - Paywall screen to receive visual polish, layout refinements, and CRO-ready structure (`docs/travel-prd.md` L217–231, L349–359; `docs/travel-mvp-blueprint.md` L605–610). **[DEFERRED: requires paywall implementation]**
- `web/` components (if present) - Shared visual hooks for public list/trip views (colors, typography) to match the mobile brand where appropriate (`docs/travel-mvp-blueprint.md` L620–639).
- `mobile/src/__tests__/**` - Snapshot and component tests that may need updates once visuals and structure are refined.

### Notes

- Phase 8 implements **Visual Polish & Brand Layer** as described in `docs/travel-mvp-blueprint.md` §12 (L580–617), focusing on visuals and motion on top of already stable flows.
- Visual work is driven by PRD visual, accessibility, and animation notes (`docs/travel-prd.md` L223–231, L229–230) and should not break underlying data or navigation flows from earlier phases.
- The goal is to centralize visual decisions in **design tokens and primitives**, so future tweaks and experiments (e.g., paywall CRO tests) can be done with minimal code churn.

## Tasks

- [ ] 1.0 Define a cohesive visual language and design tokens

  - [ ] 1.1 Review PRD visual and animation guidance (`docs/travel-prd.md` L223–231, L229–230) and any existing brand references to extract requirements for colors, typography, spacing, and motion.
  - [ ] 1.2 Extend `mobile/src/theme/colors.ts` into a full color system:
    - Core brand colors (primary, secondary, accent).
    - Semantic colors (success, warning, error, info).
    - Backgrounds (app, surfaces, cards), borders, and text colors with sufficient contrast.
  - [ ] 1.3 Create or refine `mobile/src/theme/typography.ts` with a clear typographic scale (e.g., display, heading, title, body, caption) and map these to font sizes, weights, and line heights.
  - [ ] 1.4 Create `mobile/src/theme/tokens.ts` (or an equivalent index) that exports:
    - Color tokens (from `colors.ts`).
    - Spacing scale (e.g., 4/8/12/16/24/32).
    - Radii (e.g., small/medium/large).
    - Shadows/elevations.
    - Animation durations/easings for standard interactions (button presses, tile selection, confetti).
  - [ ] 1.5 Document token usage in comments or a short markdown note (e.g., `docs/design-tokens.md`) so future contributors know how to apply them consistently.

- [ ] 2.0 Apply the design token system to core mobile UI primitives

  - [ ] 2.1 Update `Screen.tsx` to:
    - Use token-based padding, background colors, and safe-area handling.
    - Provide optional variants (e.g., default, fullscreen, scrollable) where helpful.
  - [ ] 2.2 Update `Text.tsx` to:
    - Accept a `variant` prop (e.g., `heading`, `title`, `body`, `caption`) that maps to the typographic scale.
    - Apply text colors from tokens, including semantic colors for error/success states.
    - Ensure accessibility (minimum font sizes, support for dynamic type where possible).
  - [ ] 2.3 Update `Button.tsx` to:
    - Use token-based colors, radii, and spacing for primary/secondary/ghost variants.
    - Provide consistent hover/press/disabled states and loading indicators.
    - Respect minimum touch-size guidelines from PRD (`docs/travel-prd.md` L223–231).
  - [ ] 2.4 Update `Input.tsx` to:
    - Use consistent paddings and border radii.
    - Apply focus/error states using semantic tokens.
    - Ensure labels and helper/error text use the new typography tokens.
  - [ ] 2.5 Ensure all major screens (onboarding, passport, trips, entries) are refactored to use only these primitives (and any new token-aware components) instead of ad hoc styles. **[DEFERRED: friends screen, paywall screen - requires Phase 5 social layer and paywall]**

- [ ] 3.0 Upgrade passport grid and country visuals

  - [ ] 3.1 Extract or create `CountryTile` and `StampGrid` components to encapsulate passport grid visuals:
    - Country illustration, flag, and name.
    - States for `visited`, `wishlist`, and `not set`.
    - Support for overlaying stamps/badges per status (`docs/travel-mvp-blueprint.md` L595–603; `docs/travel-prd.md` L89–111, L277–279).
  - [ ] 3.2 Apply design tokens to passport tiles:
    - Use consistent spacing and alignments across grid rows.
    - Ensure sufficient visual differentiation between visited and wishlist states (color, icon, or overlay).
  - [ ] 3.3 Implement stamp/badge animations:
    - When a country is marked visited or wishlist, animate the stamp appearing (e.g., scale/rotate tween under 200 ms as per PRD L229–230).
    - Ensure animations do not interfere with tap responsiveness or accessibility.
  - [ ] 3.4 Implement confetti/celebration animation:
    - Triggered on key milestones (e.g., first country added, hitting certain thresholds) using a dedicated `Confetti` component.
    - Keep performance in mind (limit particle count, duration).
  - [ ] 3.5 Validate that the passport grid still performs well (scrolling and interaction) on target devices and meets P75 performance goals from PRD (`docs/travel-prd.md` L317–323).

- [ ] 4.0 Polish onboarding experiences **[DEFERRED: paywall experiences - requires paywall implementation]**

  - [ ] 4.1 Update onboarding welcome slides (screens 1-A to 1-D in `docs/travel-prd.md` L217–221) to:
    - Use final illustrations and colors consistent with the token system.
    - Apply a consistent layout grid and typography.
    - Implement simple, performant transitions between slides (e.g., fades/slide transitions).
  - [ ] 4.2 Update the motivation/personality tags screen:
    - Use a `Chip`/tag component styled via design tokens.
    - Provide strong visual differentiation between selected vs unselected tags.
  - [ ] 4.3 Polish the country selection and progress summary screens:
    - Ensure continent cards and grids align visually with the passport grid.
    - Use consistent iconography and spacing.
    - Integrate small, non-distracting animations on progress reveal.
  - [ ] **[DEFERRED]** 4.4 Apply the visual system to `PaywallScreen` *(requires paywall implementation)*:
    - Align typography, spacing, and colors with the new design tokens.
    - Ensure layout works well on different device sizes.
    - Leave room for future CRO experiments (trial-length ribbons, testimonials) without hardcoding them yet (`docs/travel-prd.md` L229–231, L349–359).
  - [ ] 4.5 Re-check accessibility across onboarding:
    - Contrast ratios.
    - Font sizes and touch targets.
    - VoiceOver/readability of critical labels and CTAs.
    - **[DEFERRED: paywall accessibility - requires paywall implementation]**

- [ ] 5.0 Run a visual QA & design-debt sweep

  - [ ] 5.1 Audit all major screens and flows (onboarding, passport, country detail, trip detail, entry flows, and public web views if present) for: **[DEFERRED: friends, notifications, paywall screens - requires Phase 5 social layer and paywall]**
    - Inconsistent spacing, alignment, or typography.
    - Inconsistent button or input variants.
    - Unpolished error/empty states.
  - [ ] 5.2 Capture a short list of visual/design-debt issues and group them by severity, then address the most visible/impactful ones within this phase.
  - [ ] 5.3 Update any snapshot or component tests impacted by visual refactors (e.g., `Text`/`Button` snapshots) and ensure tests continue to assert structural consistency without overfitting on minor visual changes.
  - [ ] 5.4 Sanity-check the experience on a range of device sizes and orientations (small phones, large phones) and adjust layouts where necessary (e.g., avoiding cramped or overflowing content).
  - [ ] 5.5 Coordinate final sign-off with design/PM stakeholders (or self-review if solo) and mark any remaining design improvements as post-MVP enhancements for future iterations.


