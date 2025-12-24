# Atlasi - Application Overview

A comprehensive guide to the Atlasi travel tracking application for AI assistants, marketing, and product development.

---

## Table of Contents

1. [Product Overview](#product-overview)
2. [Target Personas](#target-personas)
3. [Current Features](#current-features-implemented)
4. [User Journeys](#user-journeys)
5. [Value Proposition by Persona](#value-proposition-by-persona)
6. [Technical Architecture](#technical-architecture)
7. [Future Features](#future-features-planned)
8. [Monetization Strategy](#monetization-strategy)

---

## Product Overview

### What is Atlasi?

Atlasi is a **native mobile travel tracking and trip logging app** that helps travelers:

- **Track their travels** with a visual "passport grid" showing visited countries
- **Build wishlists** of dream destinations they want to visit
- **Log rich trip entries** with places, restaurants, hotels, and experiences
- **Capture content from social media** (TikTok/Instagram) directly into trip logs
- **Share curated lists** of recommendations with friends
- **Compare travel maps** with friends via consent-based social features

### Core Philosophy

Atlasi is intentionally **whimsical and celebratory**. It encourages users to:
- Brag about their travel experiences
- Collect "stamps" for countries visited
- Achieve milestones and share accomplishments
- Build a visual travel resume

### App Name & Branding

| Element | Value |
|---------|-------|
| App Name | Atlasi |
| Bundle ID | com.borderbadge.app |
| Deep Link Scheme | `atlasi://` |
| Tagline | "Stamp your passport for every country you visit" |

---

## Target Personas

### Primary Personas

#### 1. Ava the Explorer
| Attribute | Description |
|-----------|-------------|
| **Age** | 28 |
| **Occupation** | Designer, frequent traveler |
| **Travel Style** | 2-3 international trips per year |
| **Pain Point** | Can't elegantly show travels visually; travel stories get lost in social feeds |
| **Goal** | Beautiful passport grid that showcases 17+ visited countries |
| **Success Metric** | Uses the app as her travel resume; tags photos with memories |

#### 2. Ben the Planner
| Attribute | Description |
|-----------|-------------|
| **Age** | 35 |
| **Occupation** | Product manager, detail-oriented |
| **Travel Style** | Research-heavy, curates recommendations |
| **Pain Point** | Forgets good restaurants/hotels when planning return trips; scattered recommendations |
| **Goal** | Curated city lists with photos, notes, links that are easily shareable |
| **Success Metric** | Friends ask for his restaurant lists; reuses lists for repeat visits |

#### 3. Carla the Connector
| Attribute | Description |
|-----------|-------------|
| **Age** | 22 |
| **Occupation** | College grad, memory-focused |
| **Travel Style** | Group trips, shared experiences |
| **Pain Point** | Shared trips fade from memory; hard to revisit what she did with friends |
| **Goal** | Visual proof of shared experiences with trip tagging |
| **Success Metric** | Can browse joint entries with friends and reminisce |

#### 4. Dee the Nomad
| Attribute | Description |
|-----------|-------------|
| **Age** | 25 |
| **Occupation** | E-commerce entrepreneur, location-independent |
| **Travel Style** | Continuous travel while working remotely |
| **Pain Point** | Living abroad means constant travel; hard to track where she's been |
| **Goal** | Passive passport tracking + detailed trip logs to document nomadic lifestyle |
| **Success Metric** | Complete country log she can show friends back home |

### User Access Levels

| Role | Capabilities |
|------|--------------|
| **Guest** | Browse countries, complete onboarding (no persistence) |
| **Registered User** | Full app access with cloud sync |
| **Friend** | See friend maps and approved joint trips |
| **Admin** | Full data management and abuse moderation |

---

## Current Features (Implemented)

### 1. Passport Grid (Core Feature)

**What it does:** Visual grid displaying all countries as collectible "stamps"

**Key capabilities:**
- 227 countries and territories displayed
- Visited countries show as colored stamps
- Unvisited countries shown as cards for discovery
- Search by country name
- Filter by region, status, rarity
- Milestone celebrations with shareable cards
- Haptic feedback on interactions

**User value:** Visual "travel resume" showing everywhere you've been

### 2. Country Tracking

**What it does:** Mark countries as visited or add to wishlist

**Key capabilities:**
- Toggle visited/wishlist status on any country
- Batch updates during onboarding
- View country details (region, subregion, flag)
- See all trips taken to each country
- Track when countries were added

**User value:** Satisfying collection mechanic; goal-setting for future travels

### 3. Trip Management

**What it does:** Create and organize trips by country with dates and cover images

**Key capabilities:**
- Create trips with name, country, dates, cover image
- View trips organized by country
- Edit trip details
- Soft-delete with 30-day restore window
- Share trips via public URLs (`/t/{slug}`)

**User value:** Organized travel history beyond just "visited" status

### 4. Entry Logging (Places, Food, Stays, Experiences)

**What it does:** Rich entries within trips capturing specific memories

**Entry types:**
| Type | Description | Icon |
|------|-------------|------|
| **Place** | Attractions, landmarks, neighborhoods | Pin |
| **Food** | Restaurants, cafes, street food | Fork/knife |
| **Stay** | Hotels, hostels, Airbnbs | Bed |
| **Experience** | Tours, activities, events | Star |

**Key capabilities:**
- Title and notes for each entry
- Google Places integration for location tagging
- Link attachment (external URLs)
- Photo gallery (up to 10 photos per entry)
- Date assignment
- Soft-delete with restore

**User value:** Detailed travel journal; remember specific places visited

### 5. Social Media Ingest (TikTok/Instagram Integration)

**What it does:** Save places from social media content directly into trips

**How it works:**
1. **iOS Share Extension:** Share from TikTok/Instagram → "Save Place" → App opens
2. **Clipboard Detection:** App detects TikTok/Instagram URLs on clipboard
3. **URL Processing:** Backend fetches metadata (thumbnail, author, title)
4. **Place Detection:** AI analyzes caption/metadata to detect location
5. **Confirmation:** User confirms/edits detected place
6. **Save to Trip:** Entry created with source attribution

**Key capabilities:**
- Automatic thumbnail extraction from oEmbed
- Place name detection from captions (confidence scoring)
- Country code detection for filtering
- Retry queue for failed shares (7-day expiry)
- Works even when not authenticated (queues share)
- Manual place entry fallback

**Supported platforms:**
- TikTok (video URLs, share text)
- Instagram (posts, reels)

**User value:** Capture travel inspiration as you discover it on social media

### 6. Google Places Integration

**What it does:** Rich location data for entries

**Key capabilities:**
- Autocomplete search for places
- Address, coordinates, and metadata storage
- Country code extraction
- Duplicate detection (same place in same trip)
- Fallback to manual entry

**User value:** Accurate location tagging; future map visualization

### 7. Photo Upload

**What it does:** Attach photos to trip entries

**How it works:**
1. Request upload URL from backend
2. Upload directly to Supabase Storage
3. Confirm upload status
4. Optional thumbnail generation

**Key capabilities:**
- Up to 10 photos per entry
- HEIC/HEIF support
- Secure storage with signed URLs
- Thumbnail generation

**User value:** Visual memories attached to specific places

### 8. Shareable Lists

**What it does:** Curate and share recommendations from trip entries

**Key capabilities:**
- Create lists from trip entries
- Name and describe lists
- Reorder entries by position
- Public sharing via unique slug (`/l/{slug}`)
- Copy link to clipboard
- Native share dialog integration
- Edit and delete lists

**User value:** Share your best recommendations with friends (e.g., "Best Tacos in CDMX")

### 9. Public Pages

**What it does:** Web-accessible views of shared trips and lists

**Available pages:**
- `/` - Landing page
- `/t/{slug}` - Public trip view
- `/l/{slug}` - Public list view
- SEO-optimized with OG tags for social sharing
- Affiliate link integration for monetization

**User value:** Share travel content beyond the app; receive traffic from social shares

### 10. Consent-Based Social Features

**What it does:** Tag friends on trips with their approval

**How it works:**
1. Trip creator tags a friend
2. Friend receives notification
3. Friend approves or declines
4. If approved, trip appears on both profiles

**Tag statuses:**
- PENDING - Awaiting response
- APPROVED - Friend accepted
- DECLINED - Friend rejected

**User value:** Shared trip memories require consent; no unwanted tagging

### 11. Traveler Classification (AI-Powered)

**What it does:** Analyzes travel patterns to classify user type

**Classifications include:**
- Global Explorer
- Regional Specialist (e.g., "Southeast Asia Specialist")
- Off-the-Beaten-Path Traveler
- Island Hopper
- And more based on patterns

**Key capabilities:**
- LLM-powered analysis (OpenRouter API)
- Fallback to pattern-based classification
- Signature country identification
- Confidence scoring

**User value:** Fun personality insight; shareable classification

### 12. Milestone Celebrations

**What it does:** Celebrate travel achievements with shareable cards

**Milestone types:**
- Countries visited count (10, 25, 50, etc.)
- Continent completion
- Rarity achievements
- First trip to country

**Key capabilities:**
- Animated reveal of achievement
- Multiple share card variants (stamps, stats, map)
- Native share integration

**User value:** Gamification; social bragging rights

### 13. Onboarding Flow (12 Screens)

**What it collects:**
1. Welcome and feature showcase (video backgrounds)
2. Travel motivations (Adventure, Food, Culture, etc.)
3. Persona tags (Explorer, Storyteller, Foodie, etc.)
4. Home country
5. Tracking/privacy preferences
6. Dream destination
7. Visited countries by continent (Africa → Americas → Asia → Europe → Oceania)
8. Antarctica prompt (special case)
9. Progress summary with shareable card
10. Display name
11. Account creation (email/password or social auth)

**User value:** Personalized setup; immediate populated passport grid

### 14. Profile & Settings

**What it includes:**
- Display name editing
- Avatar with initials
- Home country display
- Travel statistics
- Tracking preference management
- Export countries to clipboard
- Clipboard detection toggle
- Restart onboarding option
- Sign out

**User value:** Account management; data control

### 15. Authentication

**Methods supported:**
- Email + Password
- Apple Sign-In (iOS native)
- Google Sign-In (OAuth via browser)

**Features:**
- Progressive disclosure (password appears after valid email)
- Session persistence via secure storage
- Auto-refresh of JWT tokens

---

## User Journeys

### Journey 1: New User - First Launch to Populated Passport

```
Launch App
    ↓
Welcome Carousel (video backgrounds)
    ↓
Feature Showcase (3 slides)
    ↓
Select Travel Motivations
    ↓
Select Traveler Persona
    ↓
Choose Home Country
    ↓
Set Tracking Preferences
    ↓
Select Dream Destination
    ↓
Mark Visited Countries (by continent × 5)
    ↓
Antarctica Special Prompt
    ↓
Progress Summary (shareable achievement card)
    ↓
Enter Display Name
    ↓
Create Account (email/password or social)
    ↓
→ Passport Grid with populated stamps
```

**Time:** ~5-8 minutes
**Result:** User has personalized profile and can immediately see their travel history

### Journey 2: Saving a Place from TikTok

```
Watching TikTok video about restaurant in Tokyo
    ↓
Tap Share → "Save Place" (Atlasi)
    ↓
App opens to Share Capture Screen
    ↓
Loading: Fetches thumbnail, detects place
    ↓
Shows: Thumbnail, detected "Tsukiji Market" with 85% confidence
    ↓
Confirm/Edit place with Google Places search
    ↓
Select trip (or create new "Tokyo 2024" trip)
    ↓
Choose entry type: "Food"
    ↓
Add optional notes
    ↓
Save to Trip
    ↓
→ Navigates to Trip Detail with new entry
```

**Time:** ~30 seconds
**Result:** Travel inspiration captured for future reference

### Journey 3: Creating a Shareable List

```
View Trip Detail for "Mexico City 2023"
    ↓
See list of 12 entries (tacos, museums, bars)
    ↓
Tap "Share" → "Create New List"
    ↓
Enter list name: "Best Tacos in CDMX"
    ↓
Select 4 food entries to include
    ↓
Add description
    ↓
Create List
    ↓
Get public URL: atlasi.com/l/best-tacos-cdmx
    ↓
Share via iMessage/WhatsApp
    ↓
→ Friend opens link in browser, sees curated recommendations
```

**Time:** ~1 minute
**Result:** Professional-looking recommendation list to share

### Journey 4: Returning User - Adding a Trip

```
Open Atlasi
    ↓
Passport Grid shows 17 visited countries
    ↓
Tap on "Japan" (visited)
    ↓
Country Detail Screen shows previous trips
    ↓
Tap "Add Trip"
    ↓
Enter trip name: "Osaka 2024"
    ↓
Select date range
    ↓
Add cover image (optional)
    ↓
Save Trip
    ↓
→ Trip Detail Screen (empty)
    ↓
Add entries for places visited
```

**Time:** ~2 minutes per trip + entries
**Result:** Organized travel log for the country

---

## Value Proposition by Persona

### Ava the Explorer

| Problem | Solution | Value |
|---------|----------|-------|
| Travel photos scattered across apps | Organized by country and trip | Everything in one place |
| Can't easily show travel history | Passport grid visualization | Instant visual proof |
| Achievements not celebrated | Milestone celebrations | Shareable bragging rights |
| Hard to stand out on social | Beautiful share cards | Unique travel content |

**Key features for Ava:**
- Passport grid with stamp aesthetics
- Share card variants (stamps, stats, map)
- Milestone celebrations
- Traveler classification

### Ben the Planner

| Problem | Solution | Value |
|---------|----------|-------|
| Forgets restaurant recommendations | Entry logging with places | Searchable history |
| Recommendations scattered in notes | Organized by trip and type | Easy to find |
| Hard to share lists with friends | Shareable lists with public URLs | Professional recommendations |
| Research gets lost | Google Places integration | Accurate location data |

**Key features for Ben:**
- Entry types (food, stay, place, experience)
- Shareable lists with custom names
- Google Places integration
- Notes and links on entries

### Carla the Connector

| Problem | Solution | Value |
|---------|----------|-------|
| Shared trips fade from memory | Trip entries with photos | Preserved memories |
| No proof of shared experiences | Consent-based trip tagging | Both parties see trip |
| Hard to reminisce with friends | Shared trip views | Browse together |
| Photos don't tell the story | Rich entries with notes | Context preserved |

**Key features for Carla:**
- Photo galleries on entries
- Trip tagging with consent
- Shared trip visibility
- Notes and memories

### Dee the Nomad

| Problem | Solution | Value |
|---------|----------|-------|
| Constant travel is hard to track | Passive country tracking | Automatic passport stamps |
| Living abroad loses novelty | Milestone celebrations | Renewed appreciation |
| Friends don't understand lifestyle | Share cards and public pages | Show the journey |
| Experiences blur together | Detailed trip logging | Remember each place |

**Key features for Dee:**
- Country grid with global progress
- Traveler classification (Digital Nomad)
- Export countries feature
- Detailed entry logging

---

## Technical Architecture

### Tech Stack

| Layer | Technology |
|-------|------------|
| Mobile | React Native 0.81.5, Expo 54, TypeScript |
| State | Zustand (auth), React Query (server state) |
| Backend | FastAPI (Python 3.12+), Uvicorn |
| Database | Supabase (PostgreSQL with Row-Level Security) |
| Storage | Supabase Storage (media files) |
| Auth | Supabase Email/Password + OAuth (Apple, Google) |
| Analytics | PostHog (mobile), Google Analytics (web) |

### Key Integrations

| Integration | Purpose |
|-------------|---------|
| Google Places API | Location autocomplete and metadata |
| TikTok oEmbed | Video thumbnail and metadata extraction |
| Instagram oEmbed | Post thumbnail and metadata extraction |
| OpenRouter API | LLM for traveler classification |
| Skimlinks | Affiliate link wrapping (optional) |

### Data Flow

```
Mobile App (React Native)
    ↓ JWT Authentication
FastAPI Backend
    ↓ Row-Level Security
Supabase (PostgreSQL + Storage)
```

---

## Future Features (Planned)

### Near-Term (Launch Simplification - Ready to Re-enable)

| Feature | Status | Description |
|---------|--------|-------------|
| Tab Bar Navigation | Code exists, hidden | 4-tab layout (Passport, Dreams, Trips, Friends) |
| Dreams Tab | Code exists, hidden | Dedicated wishlist browsing and management |
| Trips List Tab | Code exists, hidden | All trips in one view, not just by country |
| Friends Tab | Code exists, hidden | Social features and friend connections |
| Paywall Screen | Code exists, hidden | Subscription offering during onboarding |
| Welcome Screen | Code exists, hidden | Branded welcome before auth |

### Medium-Term (Post-MVP in PRD)

| Feature | Purpose | Value |
|---------|---------|-------|
| Activity Feed | See friends' recent travels | Social engagement |
| Discover | AI recommendations by persona | Trip planning assistance |
| Friend Invitations | Invite friends to app | Viral growth |
| Friend Overlays | Compare travel maps | Social competition |
| Ratings/Reviews | Rate entries | Community content |

### Long-Term (Roadmap)

| Feature | Purpose |
|---------|---------|
| Offline Mode | Full functionality without network |
| Multi-Language | International user support |
| Import from Google Maps | Bulk import of location history |
| Gamification | Badges, achievements, leaderboards |
| Trip Planning AI | Itinerary suggestions |
| Spending Tracker | Budget tracking per trip |

---

## Monetization Strategy

### Current State

The app is **free** with all core features available. Monetization infrastructure exists but is not active.

### Planned Approach

| Strategy | Implementation | Status |
|----------|----------------|--------|
| Premium Subscription | RevenueCat SDK | Infrastructure ready |
| Paywall Screen | Onboarding integration | Code exists, hidden |
| Affiliate Links | Outbound redirect tracking | Fully implemented |
| Skimlinks | Automatic affiliate wrapping | Integration ready |

### Premium Feature Candidates

| Feature | Free | Premium |
|---------|------|---------|
| Country Tracking | Unlimited | Unlimited |
| Trip Logging | Unlimited | Unlimited |
| Photo Uploads | 3 per entry | 10 per entry |
| Shareable Lists | 3 total | Unlimited |
| Friend Connections | 5 friends | Unlimited |
| Traveler Classification | 1 per month | Unlimited |
| Priority Place Detection | Standard | Enhanced AI |
| Ad-Free Experience | With ads | No ads |

### Affiliate Monetization

Currently implemented:
- Unique link IDs for each entry
- HMAC-signed redirect URLs for security
- Click tracking with attribution
- Skimlinks integration for automatic affiliate wrapping
- Admin dashboard for link management

**Revenue opportunity:** When users click outbound links to hotels, restaurants, or booking sites from public pages, affiliate commission can be earned.

---

## Key Metrics & Success Criteria

### Activation Metrics

| Metric | Target | Description |
|--------|--------|-------------|
| Day-1 Country Mark | ≥60% | Users marking ≥1 country on first day |
| Onboarding Completion | ≥70% | Users completing all onboarding steps |
| First Trip Creation | ≥40% | Users creating a trip in first week |

### Engagement Metrics

| Metric | Target | Description |
|--------|--------|-------------|
| MAU/Registered Ratio | ≥40% | Monthly active user retention |
| Photos per Entry | ≥2 avg | Content depth |
| Entries per Trip | ≥3 avg | Trip detail richness |
| Lists Created | ≥0.5/user | Sharing behavior |

### Growth Metrics

| Metric | Target | Description |
|--------|--------|-------------|
| K-Factor | ≥0.3 | Viral coefficient from shared content |
| Friend Connections | ≥2/user/month | Social network growth |
| Share Rate | ≥20% | Users who share milestones |

---

## Summary

Atlasi is a feature-rich travel tracking app with:

**Implemented Today:**
- Visual passport grid with 227 countries
- Rich trip and entry logging
- Social media content capture (TikTok/Instagram)
- Google Places integration
- Photo uploads
- Shareable public lists and trips
- Consent-based social features
- AI-powered traveler classification
- Comprehensive onboarding
- Multiple authentication methods

**Ready to Enable:**
- Tab-based navigation
- Dedicated Dreams/Wishlist tab
- Paywall/subscription offering
- Enhanced social features

**Planned for Future:**
- Activity feed
- AI recommendations
- Friend comparisons
- Offline mode
- Multi-language support

The app serves travelers who want to track, remember, and share their journeys in a visually appealing, organized, and social way.
