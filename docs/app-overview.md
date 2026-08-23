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
- **Challenge friends** to guess where their travel photos were taken

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
| App Store Listing | Track & Share Travels - Atlasi (id 6757568311) |
| Public Web Domain | atlasi.app |
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
| **Admin** | Full data management and abuse moderation |

A **Friend** role (seeing friend maps and approved joint trips) is designed but not shipped — see [Future Features](#future-features-planned).

---

## Current Features (Implemented)

### 1. Passport Grid (Core Feature)

**What it does:** Visual grid displaying all countries as collectible "stamps"

**Key capabilities:**
- 227 countries and territories displayed — every user tracks the full atlas
- Visited countries show as colored stamps
- Unvisited countries shown as cards for discovery
- Search by country name
- Filter by status, continent, subregion, and recognition group (UN member, special status, territory)
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
- Suggested cover photos: when the photo cache holds photos from the trip's country (and date range, if set), the form offers up to 12 ranked candidates from that trip above the system picker — screenshots and burst repeats filtered out. Nothing to suggest means the picker looks exactly as before
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

**What it does:** Web-accessible views of shared trips, lists, and Guess Where challenges

**Available pages:**
- `/` - Landing page
- `/t/{slug}` - Public trip view
- `/l/{slug}` - Public list view
- `/q/{slug}` - Public Guess Where challenge (playable in any browser)
- `/q/{slug}/card.png` - Rendered unfurl card for the challenge link
- `/q/{slug}/install` - Logged App Store redirect from the challenge page
- SEO-optimized with OG tags and JSON-LD structured data for social sharing and rich results
- Affiliate link integration for monetization

**Editorial share layout:** Both `/t/{slug}` and `/l/{slug}` share one editorial template — a full-bleed hero, a byline bar ("Shared by Maya · 31 countries visited", degrading to name-only or nothing when profile/avatar data is missing), sticky category filters, alternating numbered image/text rows, an interactive Google Map with custom colored numbered pins, and an App Store CTA band. The map is driven by per-entry coordinates and requires `GOOGLE_MAPS_BROWSER_API_KEY` + `GOOGLE_MAPS_MAP_ID` (see `docs/environment-setup.md`); it renders without the map when those are unset. Images are served at display size via Supabase render transforms, while OG images keep the full-size original for social scrapers.

**Two different URL philosophies:** `/t/` and `/l/` are built to be *found* — indexed, in the sitemap, rich results. `/q/` is built to be *sent* — the slug is an opaque 32-character string, the page is `noindex` on both the meta tag and the response header, it is excluded from the sitemap, and the owner can revoke it, which deletes the photos.

**User value:** Share travel content beyond the app; receive traffic from social shares

### 10. Traveler Classification (AI-Powered)

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

### 11. Milestone Celebrations

**What it does:** Celebrate travel achievements with shareable cards

**Milestone types (four):**
| Type | Triggers on |
|------|-------------|
| Round number | Reaching 10, 25, 50, or 100 countries |
| New continent | First country marked on a continent |
| New subregion | First country marked in a subregion |
| Region complete | Every country in a region marked visited |

**Key capabilities:**
- Animated reveal of achievement
- Multiple share card variants (stamps, stats, map)
- **Rarity score integration** — the stats card shows the rarest country you have visited on each continent
- Native share integration (iMessage, Instagram Stories, etc.)
- Beautiful card designs optimized for social sharing

**User value:** Gamification; social bragging rights; recognition for unique destinations

### 12. Onboarding Flow

**Before the account exists:**
1. Welcome carousel (video backgrounds)
2. Feature showcase slider
3. "Tell us about you" — travel motivations (Adventure, Food, Culture…) and persona tags (Explorer, Storyteller, Foodie…) on one screen
4. Home country
5. Dream destination
6. Visited countries, continent by continent (Africa → Americas → Asia → Europe → Oceania) — each continent gets an intro screen, and answering "no" skips straight to the next continent instead of showing its country grid
7. Antarctica prompt (special case)
8. Progress summary with a shareable card
9. Display name
10. **Account creation** (email/password, Apple, or Google)

**After the account exists — the post-signup flow:**
11. Emotional hook (memories)
12. Functional hook (saving from social)
13. **Paywall** (RevenueCat remote paywall)
14. First Guess Where challenge offer — accepting opens challenge creation as soon as the app loads; skippable

**Why account creation comes before the paywall:** RevenueCat purchases have to attach to a real Supabase user id. The `needsPostSignupFlow` flag keeps an authenticated user inside the onboarding stack until the final offer resolves, so signing up mid-flow does not drop them into the main app early. See `docs/ONBOARDING_PAYWALL_FIX.md`.

**User value:** Personalized setup; immediate populated passport grid

### 13. Profile & Settings

**What it includes:**
- Display name editing
- Avatar with initials
- Home country display
- Travel statistics
- Export countries to clipboard
- Clipboard detection toggle
- Restart onboarding option
- Sign out

**User value:** Account management; data control

### 14. Authentication

**Methods supported:**
- Email + Password
- Apple Sign-In (iOS native)
- Google Sign-In (OAuth via browser)

**Features:**
- Progressive disclosure (password appears after valid email)
- Session persistence via secure storage
- Auto-refresh of JWT tokens

### 15. Premium Subscription (RevenueCat)

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

**Subscription options** (all three include a 7-day free trial):
- Weekly: $4.99/week
- Monthly: $9.99/month
- Annual: $49.99/year

**User value:** Core features free forever; power users can unlock unlimited access

### 16. Photo Import (Automatic Trip Discovery)

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
- Trip previews lead with the best photo of each segment rather than the newest, so the browser shows the shot worth remembering
- Matching gallery arrives with screenshots and burst repeats pre-deselected (the counter reads "N of M selected"); "Show all" brings them back, and the anchor photo of a cluster is never deselected
- Tiered radius search for place matching (50m → 100m → 200m → 500m)
- **Nearby photo suggestions on the entry form:** when a user picks a place from Google Places autocomplete, the same SQLite photo cache is queried by geohash to surface tappable thumbnails of photos taken near that location. Uses an adaptive radius (500m → 200m → 100m) that narrows automatically in dense areas, and respects the entry's remaining photo slots. If the library has not been scanned yet, a hint prompts the user to run photo import first.

**User value:** Retroactively document years of past travel from your existing photos, and skip hunting through the camera roll when adding photos to a fresh entry

### 16a. Nearby Photo Suggestions (Entry Form)

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

### 17. Saved Places (Quick Save)

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

### 18. Country Rarity System

**What it does:** Scores every country by how rarely it's visited, so share cards can single out the most distinctive places you have been

**Rarity scale (3-10, default 5):**
| Score | Description | Examples |
|-------|-------------|----------|
| 10 | Extremely rare | Antarctica, North Korea, Nauru, Turkmenistan, remote Pacific islands |
| 9 | Very rare | Bhutan, Mongolia, Papua New Guinea, Afghanistan, Yemen |
| 8 | Rare | Off the beaten path |
| 7 | Uncommon | Vietnam |
| 6 | Moderate | Morocco, Croatia, Thailand |
| 5 | Common (default) | Japan, United Kingdom |
| 4 | Very common | USA, France, Spain, Italy, Germany |
| 3 | Microstates | Easy day trips |

**Key capabilities:**
- Explicit scores for 233 country and territory codes; anything unscored falls back to 5
- Identifies the rarest country you have visited on each continent
- Surfaced on the stats share card (as that continent's stamp) and in the onboarding progress summary
- A separate **traveler percentile** estimate ("Top 20%") derived from total country count, not from rarity

**Note:** rarity is a scoring and share-card system. It is not a passport-grid filter and it is not a milestone type — the grid filters on status, continent, subregion, and recognition group.

**User value:** Gamification that celebrates unique travel; bragging rights for rare destinations

### 19. Geographic Subregions

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

### 20. Guess Where (Photo Challenge)

**What it does:** Turns your camera roll into a shareable photo challenge. Friends guess which country each of your travel photos was taken in, their scores land on your leaderboard, and the link works in any browser without the app.

The feature is called **Guess Where** and each individual game is a **challenge**. (Internally the identifiers are `quiz_*` and the public URL space is `/q/`.)

**How it works:**

1. **One tap to build:** From the Guess Where card on the passport home — or Profile, or the offer shown at the end of onboarding — the app assembles a 5–10 photo challenge from the on-device photo library. There is no manual photo picking.
2. **You play it first:** The creator plays their own challenge. Their result becomes the **score to beat** and is shown to every friend who opens the link.
3. **Share the link:** The OS share sheet sends a `/q/{slug}` link with the message "Guess where in the world these 10 photos were taken. I got 7/10 — beat me." Messaging apps unfurl it as a photo card.
4. **Friends play in the browser:** No app, no account, no sign-up. Ten photos, four country options each.
5. **Reveal and leaderboard:** The score lands immediately — "You beat Maya!", "Dead even with Maya", or "Maya keeps the crown" — followed by the leaderboard. Adding a name is optional and comes *after* the reveal, never as a gate in front of it.
6. **Install CTA:** "Think your own trips could stump your friends?" → Get Atlasi. The tap is counted server-side before the App Store redirect.

**How photos are chosen:**

- Only photos whose cached GPS resolves cleanly to a single country qualify — a four-point probe around the coordinate rejects border-ambiguous locations
- Candidates are sampled round-robin across countries and spread across each country's whole history, so one photo-dense trip cannot monopolize a challenge; the home country is deprioritized
- Burst frames and HDR pairs collapse to a single photo
- A challenge never repeats a calendar day or a (country, year) pair unless the library is too thin to fill it
- Remaining candidates pass a vision eligibility gate that rejects indoor shots, food, portraits, and screenshots — the game wants scenery and landmarks
- Target is 10 photos, with 5–9 accepted when the library cannot fill a full game

**Questions and scoring:**

- Four country options per photo, generated server-side when the challenge is finalized, with the correct answer stored server-only — the owner and every guest answer identical questions
- Decoys favor countries the owner has actually visited, padded with **scenic lookalikes** matched on biome, so the wrong answers are plausible rather than random
- Grading happens on the server for owner and guest alike; clients never submit a score
- The score is **country-only**. An earlier "which year was this?" question was removed from the product and the database

**Design decisions worth preserving:**

- **No per-question verdicts**, in the app or on the web. A tapped answer gets a neutral acknowledgment and the next photo; there is exactly one reveal, at the end. This is deliberate, not an oversight
- No maps, no flags, and no dates or years anywhere in the friend-facing experience — every one of those leaks the answer
- User photos are allowed on the unfurl card (it uses the *last* question's photo; photo one stays blurred on the challenge page so the game opens on a mystery)

**Key capabilities:**

- **My Challenges** — every challenge with its state: Draft, Ready to play, Ready to share, Shared, Revoked
- **Swap or remove a photo** before sharing; swapping requires answering the new photo before the link can go out
- **Revoke a shared link** at any time — the page goes to a content-free "packed away" state and the photos are deleted from storage
- **Leaderboard** with the creator's benchmark, one row per name, and the ability to hide an entry
- Resume support on both sides: a killed app resumes at the next ungraded question, and a browser refresh mid-run picks up where the player left off
- **Faster repeat challenges** via on-device pre-tagging and a verdict cache (see 20a)

**Cost and abuse controls:** photo classification spend is bounded twice — a per-challenge budget reserved before any model call, plus a global daily circuit breaker that fails as a service limit rather than as "you don't have enough photos." Creation is rate-limited to 10 drafts per hour and 30 classification batches per hour per user.

**Pricing:** **Free and unlimited, with no premium gate anywhere in the loop.** This is the app's acquisition engine; metering it would defeat its purpose. See [Monetization Strategy](#monetization-strategy).

**Analytics:** the loop spans three tools — PostHog for the owner's funnel, Google Analytics for the anonymous guest, and Postgres counters (`quiz_funnel`) for cross-surface attribution back to the creator. `docs/analytics.md` documents the full event vocabulary.

**User value:** A reason for friends to engage with your travel history instead of just scrolling past it — and the most natural way the app introduces itself to someone who does not have it.

### 20a. On-Device Photo Pre-Tagging

**What it does:** Runs Apple Vision over the photo library in the background so building a challenge is fast and cheap.

**How it works:**

1. After a photo sync completes (never during one, never on app launch), the app tags photos in the same order challenge creation would reach for them
2. Each pass is bounded — roughly 400 photos or 60 seconds, at least 10 minutes apart, and aborted the moment a scan starts
3. Signals captured: scene labels, human/face rectangles, screenshot and utility detection, and an image quality score
4. Interpretation happens in JavaScript rather than native code, so the thresholds can be retuned over the air without re-tagging anything

**Key capabilities:**

- Only day-one certainties are dropped before the paid eligibility gate: screenshots, utility images, and photos where people fill more than 30% of the frame. Indoor and food evidence only ranks a photo *last* — it is never discarded, because a mis-ranked photo still gets its chance while a mis-dropped photo is invisible forever
- **Verdict cache:** both outcomes of every paid eligibility call are stored locally, so a repeat challenge skips photos already known to fail and can skip classification entirely when enough known-good photos are on hand
- Three independent kill switches (tagging, pre-filtering, verdict cache), since each fails differently
- iOS only; Android and older builds fall back to the untagged path with identical results, just slower

**User value:** The first challenge builds in a fraction of the time it otherwise would, and a second one is nearly instant.

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
Select Travel Motivations and Persona Tags
    ↓
Choose Home Country
    ↓
Select Dream Destination
    ↓
Mark Visited Countries (intro + grid, by continent × 5)
    ↓
Antarctica Special Prompt
    ↓
Progress Summary (shareable achievement card)
    ↓
Enter Display Name
    ↓
Create Account (email/password, Apple, or Google)
    ↓
Emotional Hook → Functional Hook
    ↓
Paywall (subscribe, or continue free)
    ↓
First Guess Where Challenge Offer (accept or skip)
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
Get public URL: atlasi.app/l/best-tacos-cdmx
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

### Journey 7: Creating and Sharing a Guess Where Challenge

```
Open Atlasi → Passport → "Guess Where" card
    ↓
Tap "Create Your Challenge"
    ↓
App finds 10 scenic, location-tagged photos (no manual picking)
    ↓
Play your own challenge: 10 × "Where in the world was this?"
    ↓
Results: "Your Challenge - Score to beat: 7/10"
    ↓
[Optional] Swap or remove a photo before sharing
    ↓
Tap "Challenge Your Friends" → share sheet → iMessage
    ↓
--------------- friend's phone, no app installed ---------------
    ↓
Link unfurls as a photo card → opens atlasi.app/q/{slug} in the browser
    ↓
"Maya challenges you" - the score to beat is 7/10 → Play
    ↓
10 photos, four country options each, one reveal at the end
    ↓
"You beat Maya!" 8/10, with the leaderboard
    ↓
[Optional] Add a name to the leaderboard
    ↓
"Share My Score" → the same link goes out again
    ↓
"Get Atlasi" → App Store (tap counted server-side)
    ↓
→ Owner opens the app and sees a new name on their leaderboard
```

**Time:** ~90 seconds to build and play; ~60 seconds for a friend
**Result:** The owner has a game their friends actually engage with, and every friend who plays sees the app before deciding whether to install it

---

## Value Proposition by Persona

### Ava the Explorer

| Problem | Solution | Value |
|---------|----------|-------|
| Travel photos scattered across apps | Organized by country and trip | Everything in one place |
| Can't easily show travel history | Passport grid visualization | Instant visual proof |
| Achievements not celebrated | Milestone celebrations | Shareable bragging rights |
| Hard to stand out on social | Beautiful share cards | Unique travel content |
| Friends scroll past travel posts | Guess Where challenges | Something friends play, not skim |

**Key features for Ava:**
- Passport grid with stamp aesthetics
- Share card variants (stamps, stats, map)
- Milestone celebrations
- Traveler classification
- Guess Where challenges and their leaderboards

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
| No proof of shared experiences | Consent-based trip tagging *(planned)* | Both parties see the trip |
| Hard to reminisce with friends | Shared trip views | Browse together |
| Photos don't tell the story | Rich entries with notes | Context preserved |
| Friends were there but have no artifact | Guess Where challenge from those photos | A shared memory they can play |

**Key features for Carla:**
- Photo galleries on entries
- Shared trip visibility
- Notes and memories
- Guess Where challenges built from group-trip photos

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
| Gemini 2.5 Flash-Lite | Place extraction, entry type classification, traveler classification, Guess Where photo eligibility |
| Skimlinks | Affiliate link wrapping (fallback) |
| Resend | Welcome email drip campaigns |
| RevenueCat | Subscription management and paywall |
| Apple Vision (on-device) | Background photo tagging for Guess Where candidate selection |

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
| Trip Tagging (Consent-Based) | Tag friends on a trip; it appears on both profiles once they approve | Shared memories, never unwanted tagging |
| Activity Feed | See friends' recent travels | Social engagement |
| Discover | AI recommendations by persona | Trip planning assistance |
| Friend Invitations | Invite friends to app | Viral growth |
| Friend Overlays | Compare travel maps side-by-side | Social competition |

**On trip tagging specifically:** the backend is built — `trip_tags` carries PENDING / APPROVED / DECLINED states, the approve and decline endpoints exist, and row-level security already grants an approved taggee access to the trip. What is missing is the entire user-facing half: there is no mobile UI to tag anyone or respond to a tag, and the notification layer is a stub that logs instead of delivering. The **Friend** access level and a Friends tab belong to this same unshipped group.

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

**Subscription Options** (all three include a 7-day free trial):
- Weekly: $4.99/week
- Monthly: $9.99/month
- Annual: $49.99/year

### The Acquisition Loop (Free by Design)

**Guess Where is deliberately outside the freemium model** — unlimited challenges, unlimited shares, unlimited plays, for everyone.

The reasoning: the metered features are things a user does *for themselves*, where a limit creates a natural upgrade moment. Guess Where is the one thing a user does that reaches **people who do not have the app**. Capping it would cap acquisition. Abuse is handled with rate limits and server-side classification budgets instead of a paywall, so the cost ceiling is enforced without ever telling a user they have run out of challenges.

The loop is measurable end to end: `quiz_funnel` counts page views, plays, completions, name submissions, re-shares, and install-CTA taps per challenge, and joins back to the creator — so "challenges created -> guest plays -> installs, by owner cohort" is a single query.

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
| Challenges Shared | TBD | Users who create and share a Guess Where challenge |
| Guest Plays per Challenge | TBD | Friends who open a shared link and finish it |
| Install CTA Taps | TBD | App Store taps from public challenge pages |

Targets for the Guess Where rows are unset pending a first cohort — see `docs/analytics.md` for the funnel's event vocabulary and the reasoning behind each counter.

---

## Summary

Atlasi is a feature-rich travel tracking app with:

**Implemented Today:**
- Visual passport grid with 227 countries and territories
- Rich trip and entry logging (Places, Food, Stays, Experiences)
- **Photo import** - automatically discover trips from your photo library
- **Saved Places** - quick-save system for instant capture
- **Guess Where** - turn your camera roll into a photo challenge friends play in the browser, with leaderboards and an install loop
- Social media content capture (TikTok/Instagram) with **LLM-powered place extraction**
- **AI entry type classification** - automatically suggests Place, Food, Stay, or Experience
- Google Places integration for accurate location tagging
- Photo uploads with multi-cluster concurrent processing
- Shareable public lists and trips with SEO-optimized pages
- AI-powered traveler classification with creative labels
- **Country rarity scoring** (3-10) feeding the stats share card
- **Geographic subregions** for granular filtering
- Milestone celebrations (round numbers, new continent, new subregion, region complete)
- Comprehensive onboarding, with account creation before the paywall
- Multiple authentication methods (Email, Apple, Google)
- Welcome email drip campaign
- Affiliate link monetization infrastructure
- Tab-based navigation (Passport, Dreams, Trips)
- Dedicated Dreams/Wishlist tab with filters and sharing
- Trips List tab for viewing all trips

**Planned for Future:**
- Consent-based trip tagging (backend built, no user-facing surface yet)
- Friends tab for social features
- Activity feed
- AI recommendations
- Friend map comparisons
- Offline mode
- Multi-language support

The app serves travelers who want to track, remember, and share their journeys in a visually appealing, organized, and social way—whether documenting new adventures or importing years of past travels from their photo library.
