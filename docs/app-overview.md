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
| Bundle ID | com.atlasi.app |
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
- Delete trips from the trip edit screen with a confirmation dialog (soft-deleted, cascades to entries and media, 30-day restore window)
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

**What it does:** Save places from social media content directly into trips or Saved Places

**How it works:**
1. **iOS Share Extension:** Share from TikTok/Instagram → "Save Place" → App opens (native Swift implementation)
2. **Clipboard Detection:** App detects TikTok/Instagram URLs on clipboard
3. **URL Processing:** Backend fetches metadata (thumbnail, author, title) via oEmbed
4. **LLM Place Detection:** Gemini 2.5 Flash-Lite analyzes caption/metadata to extract place name
5. **Entry Type Classification:** AI automatically suggests entry type (Place, Stay, Food, Experience)
6. **Confirmation:** User confirms/edits detected place with Google Places search
7. **Save:** Create entry in specific trip OR quick-save to Saved Places

**Key capabilities:**
- **LLM-first extraction** with regex fallback for reliability
- Automatic entry type classification (Place, Stay, Food, Experience)
- Automatic thumbnail extraction from oEmbed with caching
- Place name detection with confidence scoring
- Country code detection for filtering
- Retry queue for failed shares (7-day expiry)
- Works even when not authenticated (queues share)
- **Quick Save to Saved Places** for instant capture without trip selection
- Native iOS Share Extension (Swift) for seamless sharing experience

**Supported platforms:**
- TikTok (video URLs, share text)
- Instagram (posts, reels)

**User value:** Capture travel inspiration instantly; AI does the work of identifying places and types

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

**What it does:** Analyzes travel patterns to classify user type with creative, personalized labels

**Classifications include:**
- Global Explorer
- Regional Specialist (e.g., "Southeast Asia Specialist")
- Off-the-Beaten-Path Traveler
- Island Hopper
- Safari Seeker
- Culture Curator
- And many more based on patterns

**Key capabilities:**
- **Gemini 2.5 Flash-Lite** via OpenRouter for creative classification
- Smart pattern-based fallback when LLM unavailable
- Signature country identification (your most defining destination)
- Confidence scoring
- Optional interest tags for personalization
- Excludes home country from signature selection

**User value:** Fun personality insight; shareable classification that captures your travel identity

### 12. Milestone Celebrations

**What it does:** Celebrate travel achievements with shareable cards

**Milestone types:**
- Countries visited count (10, 25, 50, 75, 100, etc.)
- Continent completion
- **Rarity achievements** (visiting rare destinations like Antarctica or Bhutan)
- First trip to country
- Regional completion

**Key capabilities:**
- Animated reveal of achievement
- Multiple share card variants (stamps, stats, map)
- **Rarity score integration** - highlights your rarest country per continent
- Native share integration (iMessage, Instagram Stories, etc.)
- Beautiful card designs optimized for social sharing

**User value:** Gamification; social bragging rights; recognition for unique destinations

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

### 16. Premium Subscription (RevenueCat)

**What it does:** Freemium model with feature gating and subscription management

**Free tier limits:**
| Feature | Limit |
|---------|-------|
| Share Extension Uses | 5 per month |
| Photo Import Trips | 1 (lifetime) |
| Entries per Trip | 10 |

**Premium benefits:**
- Unlimited entries per trip
- Unlimited share extension saves
- Unlimited photo import trips

**Key capabilities:**
- RevenueCat SDK integration for iOS (Android ready)
- Remote paywall UI during onboarding and in-app
- App Group sync for Share Extension subscription status
- Backend webhook processing for subscription events
- Atomic usage tracking with monthly resets
- Timing-safe webhook authentication

**Subscription options:**
- Weekly: $3.99/week
- Monthly: $9.99/month (7-day free trial)
- Annual: $49.99/year (7-day free trial)

**User value:** Core features free forever; power users can unlock unlimited access

### 17. Photo Import (Automatic Trip Discovery)

**What it does:** Scan your photo library to automatically discover and create trips from past travels

**How it works:**
1. **Photo Scan:** Access photo library with permission, extract GPS metadata
2. **Location Clustering:** Group photos by location using geohash (~153m precision)
3. **Trip Discovery:** Organize clusters into potential trips by country and date
4. **Place Suggestions:** AI matches GPS coordinates to real places (restaurants, landmarks, etc.)
5. **Confirmation:** Review and confirm suggested places
6. **Trip Creation:** Create trips with entries and upload photos

**Key capabilities:**
- Multi-phase workflow with progress tracking
- SQLite caching for incremental imports (only scan new photos)
- Photo Trips browser for previously discovered trips
- Concurrent multi-cluster uploads with per-cluster progress
- Country filtering for large photo libraries
- Tiered radius search for place matching (50m → 100m → 200m → 500m)
- **Nearby photo suggestions on the entry form:** when a user picks a place from Google Places autocomplete, the same SQLite photo cache is queried by geohash to surface tappable thumbnails of photos taken near that location. Uses an adaptive radius (500m → 200m → 100m) that narrows automatically in dense areas, and respects the entry's remaining photo slots. If the library has not been scanned yet, a hint prompts the user to run photo import first.

**User value:** Retroactively document years of past travel from your existing photos, and skip hunting through the camera roll when adding photos to a fresh entry

### 17a. Nearby Photo Suggestions (Entry Form)

**What it does:** While creating or editing an entry, surfaces photos from the user's device library that were taken near the place they just selected so they can add them with a single tap.

**How it works:**
1. User selects a place from Google Places autocomplete on the entry form
2. The app queries the local SQLite photo cache (`cached_photos`) for photos whose GPS coordinates are near the selected place
3. Results are found via geohash prefix matching (precision 6, ~1.2km cells plus neighbours) and post-filtered with a haversine distance check
4. An adaptive radius (500m → 200m → 100m) narrows results in dense urban areas to avoid noise and keeps results in sparse areas
5. Matches are rendered as a horizontal thumbnail strip between the Location and Photos sections; tapping a thumbnail adds that photo into the entry's media gallery (respecting `MAX_PHOTOS_PER_ENTRY`)

**Key capabilities:**
- Works entirely from the on-device photo cache — no new network requests are made to surface suggestions
- Only appears when the photo cache has content; silently hidden for users who have not run a photo import
- Reactive to place changes: switching the selected place re-queries and discards stale results via a request-id guard
- Respects the entry photo limit, with graceful handling when the gallery is full

**User value:** Turns a freshly added entry into a rich, illustrated memory without forcing the user to dig through their camera roll.

### 18. Saved Places (Quick Save)

**What it does:** Instantly save places without assigning them to a trip

**How it works:**
1. Share from TikTok/Instagram or add manually
2. Place is saved to "Saved Places" (system-managed trip)
3. Organize later by moving to specific trips

**Key capabilities:**
- Automatic lazy creation per user
- Move single entry or bulk-move multiple entries
- Works with social media ingest and manual entry
- Entries appear in dedicated Saved Places section

**User value:** Capture travel inspiration immediately; organize when you have time

### 19. Country Rarity System

**What it does:** Scores countries by how rarely they're visited, enabling rarity-based achievements

**Rarity scale (1-10):**
| Score | Description | Examples |
|-------|-------------|----------|
| 10 | Extremely rare | Antarctica, North Korea, war zones |
| 9 | Very rare | Bhutan, Turkmenistan, Nauru |
| 7-8 | Uncommon | Mongolia, Papua New Guinea |
| 5-6 | Moderate | Morocco, Vietnam, Croatia |
| 3-4 | Common | UK, Germany, Japan |
| 1-2 | Very common | USA, France, Spain |

**Key capabilities:**
- Rarity score for all 227 countries/territories
- Highlights "rarest" country visited per continent
- Integrated into shareable achievement cards
- Filter passport grid by rarity

**User value:** Gamification that celebrates unique travel; bragging rights for rare destinations

### 20. Tracking Preferences (Country Universe)

**What it does:** Let users choose which "universe" of countries to track

**Options:**
| Preference | Countries Included |
|------------|-------------------|
| **Classic** | 193 UN member states only |
| **UN Complete** | + 2 UN observers (Vatican, Palestine) |
| **Explorer Plus** | + 5 disputed territories (Kosovo, Taiwan, Western Sahara, etc.) |
| **Full Atlas** | + All territories, special regions, and constituent countries |

**Key capabilities:**
- Set during onboarding
- Change anytime in settings
- Affects passport grid display and country count
- Supports territories like Hong Kong, Puerto Rico, Scotland

**User value:** Flexibility for different travel tracking philosophies; credit for visiting territories

### 21. Geographic Subregions

**What it does:** Organizes countries into subregions for more granular geographic filtering

**Subregions include:**
- Northern Africa, Sub-Saharan Africa
- Central America, Caribbean, South America
- Southeast Asia, East Asia, Central Asia
- Northern Europe, Southern Europe, Eastern Europe
- Polynesia, Melanesia, Micronesia
- And more...

**Key capabilities:**
- Filter passport grid by subregion
- Group countries in onboarding flow
- More specific regional statistics

**User value:** Better organization for travelers who focus on specific regions

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

**Result:** Organized travel log for the country

### Journey 5: Importing Trips from Photo Library

```
Open Atlasi → Profile → Import from Photos
    ↓
Grant photo library access
    ↓
App scans for GPS-tagged photos (progress shown)
    ↓
View discovered trip candidates by country and date
    ↓
Select "Japan - March 2024" (15 location clusters found)
    ↓
AI suggests places: "Senso-ji Temple", "Shibuya Crossing", "Tsukiji Outer Market"
    ↓
Review suggestions, confirm or edit each
    ↓
Select photos to upload for each location
    ↓
Create trip with all entries
    ↓
→ Complete trip with rich entries from past travels
```

**Result:** Years of past travel documented from existing photos with minimal effort

### Journey 6: Quick Save from TikTok to Saved Places

```
Watching TikTok video about Blue Lagoon in Iceland
    ↓
Tap Share → "Save Place" (Atlasi)
    ↓
App opens, AI detects "Blue Lagoon, Iceland" (90% confidence)
    ↓
AI suggests entry type: "Experience"
    ↓
Tap "Save to Saved Places" (no trip selection needed)
    ↓
→ Entry instantly saved
    ↓
[Later] Open Saved Places in app
    ↓
Select entry → "Move to Trip"
    ↓
Choose "Iceland 2025" trip
    ↓
→ Entry organized into specific trip
```

**Result:** Instant capture of travel inspiration; organize when convenient

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
| Need to save quickly while browsing | Saved Places quick-save | Capture now, organize later |

**Key features for Ben:**
- Entry types (food, stay, place, experience)
- Shareable lists with custom names
- Google Places integration
- Notes and links on entries
- Saved Places for rapid capture

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
| Past trips never documented | Photo import from library | Retroactive trip logging |

**Key features for Dee:**
- Country grid with global progress
- Traveler classification (Digital Nomad)
- Export countries feature
- Detailed entry logging
- Photo import for documenting past travels

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
| Google Places API | Location autocomplete, metadata, and place matching |
| TikTok oEmbed | Video thumbnail and metadata extraction |
| Instagram oEmbed | Post thumbnail and metadata extraction |
| OpenRouter API | LLM gateway for AI features |
| Gemini 2.5 Flash-Lite | Place extraction, entry type classification, traveler classification |
| Skimlinks | Affiliate link wrapping (fallback) |
| Resend | Welcome email drip campaigns |
| RevenueCat | Subscription management and paywall |

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

### Medium-Term (Post-Launch)

| Feature | Purpose | Value |
|---------|---------|-------|
| Activity Feed | See friends' recent travels | Social engagement |
| Discover | AI recommendations by persona | Trip planning assistance |
| Friend Invitations | Invite friends to app | Viral growth |
| Friend Overlays | Compare travel maps side-by-side | Social competition |

### Long-Term (Roadmap)

| Feature | Purpose |
|---------|---------|
| Offline Mode | Full functionality without network |
| Multi-Language | International user support |
| Import from Google Maps | Bulk import of Google location history |
| Enhanced Gamification | Badges, achievements, leaderboards |
| Trip Planning AI | Itinerary suggestions based on preferences |
| Spending Tracker | Budget tracking per trip |

---

## Monetization Strategy

### Freemium Model

The app uses a **freemium model** powered by RevenueCat with the following free tier limits:

| Feature | Free Tier Limit |
|---------|-----------------|
| Share Extension Uses | 5 per month |
| Photo Import Trips | 1 (lifetime) |
| Entries per Trip | 10 |

Premium subscribers get unlimited access to all features.

**Subscription Options:**
- Weekly: $3.99/week
- Monthly: $9.99/month (7-day free trial)
- Annual: $49.99/year (7-day free trial)

### Affiliate Monetization

Additionally implemented:
- Unique link IDs for each entry on public pages
- HMAC-signed redirect URLs for security
- Click tracking with attribution and analytics
- Partner integrations (Booking.com, TripAdvisor, GetYourGuide)
- Skimlinks integration for automatic affiliate wrapping
- Admin dashboard for link management

**Revenue opportunity:** When users share trips or lists publicly, outbound links to hotels, restaurants, or booking sites can earn affiliate commission.

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
- Visual passport grid with 227 countries and territories
- Rich trip and entry logging (Places, Food, Stays, Experiences)
- **Photo import** - automatically discover trips from your photo library
- **Saved Places** - quick-save system for instant capture
- Social media content capture (TikTok/Instagram) with **LLM-powered place extraction**
- **AI entry type classification** - automatically suggests Place, Food, Stay, or Experience
- Google Places integration for accurate location tagging
- Photo uploads with multi-cluster concurrent processing
- Shareable public lists and trips with SEO-optimized pages
- Consent-based social features (trip tagging)
- AI-powered traveler classification with creative labels
- **Country rarity scoring** (1-10) for gamification
- **Tracking preferences** - choose your country universe (193 to 227+ countries)
- **Geographic subregions** for granular filtering
- Milestone celebrations with rarity-based achievements
- Comprehensive 12-screen onboarding
- Multiple authentication methods (Email, Apple, Google)
- Welcome email drip campaign
- Affiliate link monetization infrastructure
- Tab-based navigation (Passport, Dreams, Trips)
- Dedicated Dreams/Wishlist tab with filters and sharing
- Trips List tab for viewing all trips

**Planned for Future:**
- Friends tab for social features
- Activity feed
- AI recommendations
- Friend map comparisons
- Offline mode
- Multi-language support

The app serves travelers who want to track, remember, and share their journeys in a visually appealing, organized, and social way—whether documenting new adventures or importing years of past travels from their photo library.
