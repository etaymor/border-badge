# Design System Styleguide

## Introduction

This styleguide defines the visual identity for the Border Badge application. The design philosophy aims to evoke the feeling of "A field guide from a lost explorer, lovingly restored for the modern wanderer." It mixes analog warmth with crisp, delightful interactivity.

## Color System

### Primary Colors

| Name          | Hex       | Usage                                 |
| ------------- | --------- | ------------------------------------- |
| Midnight Navy | `#172A3A` | Backgrounds, headers, dark containers |
| Warm Cream    | `#FDF6ED` | Background paper feel, base layer     |
| Sunset Gold   | `#FFC636` | Highlight buttons, call to actions    |
| Adobe Brick   | `#C1543E` | Accent, icons, “visited” mark         |
| Lake Blue     | `#A0CDEB` | Sky/illustration tie-in, neutral tint |
| Moss Green    | `#547A5F` | Secondary accents, tags               |

### Secondary Colors

| Name        | Hex       | Usage                        |
| ----------- | --------- | ---------------------------- |
| Paper Beige | `#F5ECE0` | Card backgrounds             |
| Dusty Coral | `#F39B8B` | Badge variants, hover states |
| Storm Gray  | `#666D7A` | Secondary text               |
| Cloud White | `#FFFFFF` | Text on dark backgrounds     |

## Typography

### Primary Title Font

- **Font Family**: Playfair Display
- **Weight**: 600-700
- **Letter Spacing**: -2%
- **Style**: Elegant serif with soft curves
- **Usage**: Screen titles, country names, headers

### Body Font

- **Font Family**: Open Sans
- **Weight**: 400 for body, 600 for labels
- **Size**: 16pt base, 14pt for secondary text
- **Line Height**: 1.5x
- **Style**: Rounded, readable sans-serif

### Accent/Decorative Font

- **Font Family**: "Dawning of a New Day"
- **Usage**: Playful callouts, onboarding moments

## Components

### Cards

- **Corner Radius**: 20px
- **Background**: Paper Beige (`#F5ECE0`)
- **Shadow**: Soft drop shadow (offset 0, 4px)

### CTA Buttons

- **Shape**: Fully rounded
- **Padding**: 14px vertical, 28px horizontal
- **Corner Radius**: Fully rounded (pill)
- **Font**: Open Sans SemiBold (600), Title Case
- **Background Color**: Sunset Gold
- **Text Color**: Midnight Navy
- **Hover/Pressed**: Slight darkening (`#e0aa2e`)

## Animation System

The app uses spring-based animations throughout to create a premium, tactile feel. All animations respect the user's "Reduce Motion" accessibility setting (WCAG 2.1 Level AA).

### Spring Physics

| Config  | Stiffness | Damping | Mass | Usage                       |
| ------- | --------- | ------- | ---- | --------------------------- |
| Default | 1000      | 500     | 1.5  | Standard screen transitions |
| Gentle  | 800       | 600     | 3    | Subtle, organic animations  |
| Bouncy  | 900       | 300     | 2    | Celebration moments         |

### Animation Constants

| Constant              | Value      | Usage                                |
| --------------------- | ---------- | ------------------------------------ |
| Press Scale           | 0.96       | Button/element press feedback        |
| Previous Screen Scale | 0.95       | Background screen during transitions |
| Stagger Delay         | 50ms       | Delay between list item animations   |
| Breathing Scale       | 1.0 → 1.01 | Subtle idle animation for stamps     |

### Micro-Interactions

Press feedback uses spring animations with scale transforms. Interactive elements should scale down slightly on press (0.96) and spring back on release. The `useAnimatedPress` hook provides this behavior with configurable presets: default (0.96), subtle (0.98), strong (0.94), and tabBar (0.9).

### Shared Element Transitions

Country stamps, trip cards, and entry images use shared element transitions to create seamless morphing effects between screens. Elements are tagged with consistent identifiers (e.g., `country-US`) to enable the transition system to match source and destination elements.

### Staggered Entrances

List items animate in with a staggered delay, fading in and sliding up from below. The default configuration uses 50ms delay between items with a 20px slide distance. Presets include fast (30ms, 15px), dramatic (80ms, 30px), and subtle (40ms, 10px).

## Design Philosophy

- **Atmosphere**: Analog warmth, tactile visual identity.
- **Layout**: Clear visual rhythm, ample space for content to breathe.
- **Interactivity**: Crisp and delightful with spring-based animations.
- **Imagery**: Illustration and user photos should complement each other without crowding.
- **Accessibility**: All animations respect user preferences for reduced motion.
