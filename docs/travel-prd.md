# **PRD: Travel tracker & trip logger MVP**

## **1. Product overview**

### **1.1 Document title and version**

- PRD: Travel tracker & trip logger MVP

- Version: 1.0

### **1.2 Product summary**

The tool is a native mobile application built with React Native that lets travelers quickly mark the countries they have visited, build a wishlist of future destinations, and track what they did so they can share with friends and discovery new experiences.

It adds a light social layer: once users create an account they can connect with friends, compare maps, and log trips taken together. Users can also curate city-specific lists (e.g., "kid-friendly CDMX") and share them through public links that encourage recipients to sign up.

The application will be whimsical and encourage people to share by bragging about where they have been, how many countries they have been to and also how they stack up against their friends.

We will build the application on ReactNative, FastAPI and Supabase.

## **2. Goals**

### **2.1 Business goals**

- Capture early-stage travelers and build an engaged core community.

- Drive viral growth via shared lists and friend invitations.

- Validate willingness to use the product consistently and gather product-market-fit signals.

- Keep cloud costs < $200/month for the first 10k users.

- We will add paid features shortly after launch which will include the trip logging, discovery and bucket list functionality.

### **2.2 User goals**

- Track visited countries and see progress visually.

- Store and remember favorite places with rich photos and notes.

- Share curated recommendations with friends through a single link.

- Discover where friends have traveled together.

### **2.3 Non-goals**

- No gamification achievements at launch.

- No ratings/reviews or comments on entries.

- No offline mode in the initial release, fast follow

- No multi-language support in MVP, fast follow

## **3. User personas**

### **3.1 Key user types**

- Social explorer

- Casual trip logger

- Group trip organizer

- Friend follower

### **3.2 Basic persona details**

- **Ava the explorer**: 28‑year‑old designer, travels often, wants an elegant way to show her passport map on social.

- **Ben the planner**: 35‑year‑old product manager, logs restaurants and hotels so he can share lists with friends.

- **Carla the connector**: 22‑year‑old college grad, cares about trips she takes with friends and shared memories.

- **Dee the nomad**: 25‑year‑old ecommerce hustler who works and lives abroad so she can maximize her lived experiences.

### **3.3 Role-based access**

- **Guest**: Can participate in the onboarding experience and list countries, but needs to sign up to save progress or access trips and photos

- **Registered user**: Can add countries, log trips/entries, create lists, upload photos.

- **Friend**: Same as registered, plus can view friends' maps and joint trips (with proper consent).

- **Admin**: Full CRUD on all data, manage abuse reports.

## **4. Functional requirements**

- **Country tracking** (Priority: High)
  - Show big illustrated images what we have created
    - Include country name

    - Flag

    - Region

    - Big buttons to mark visited or add to bucket list

  - Break it down by region

  - Filter / Search
    - Name

    - Region

    - Territory

  - Display stamp grid with counts and flag emoji.

- **Photo upload** (Priority: High)
  - Accept JPEG/HEIC/PNG up to 10 MB each.

  - Resize and store in Supabase Storage with thumbnails.

- **Account & authentication** (Priority: High)
  - Email/password and Google OAuth with Supabase Auth.

  - Session persists via JWT and secure storage

- **Friend connections** (Priority: High)
  - Search by username or phone contacts

  - Send friend requests via push notification and email

  - Accept/reject friend requests through in-app notification center

  - View basic friend profile with country count, other key stats and confirmed trips

- **Social approval system** (Priority: High)
  - When a user tags a friend on a trip, it displays with 'pending confirmation' indicator (shading, icon) on the initiator's profile only

  - Tagged friend receives push notification and email to approve

  - Only after friend approval does the trip appear on both profiles and count toward joint stats/history

  - Default trip privacy is private, with option to generate unique public share link

- **Trip management** (Priority: Med)
  - Create trips
    - Location - City, country, region

    - With whom (friend selection with consent workflow)

    - Cover photo (optional)

    - Dates (optional)

  - Edit title, cover photo, dates, with whom

  - See a list of trips (tap to go into details)

  - Share trips via unique public links

  - Import from Google Maps (Future, low priority)

- **Entry logging** (Priority: Med)
  - Choose category: place, hotel, restaurant, experience.

  - Autocomplete place/hotel/restaurant via Google Places.

  - Add title, note (Markdown), multiple photos, optional link.

- **Shared lists** (Priority: Med)
  - Select multiple entries within one trip.

  - Name the list, generate public slug link.

  - Public link shows gallery (on the web) and call‑to‑action to download the app

- **Notifications & approvals** (Priority: Med)
  - Push notifications for friend requests and trip tags

  - Email notifications for friend requests and trip tags

  - Simple in-app notification center with approval feed

  - Single feed for all pending approvals (no activity feed at MVP)

- **Feed** (Priority: Low, post MVP)
  - See recent logged entries / trips / countries from friends

- **Discover** (Priority: Low, post MVP)
  - Discover cool places for an upcoming trip or bucket list

  - Use AI and match to type of person they are

  - Show UNESCO sights, Wonders of World, other big things (and generate cool images for them)

- **Analytics & engagement** (Priority: Medium)
  - Track daily active users, list shares, friend requests.

## **5. User experience**

### **5.1 Entry points & first-time user flow**

- Web share link → open public list → CTA "download the app".

- Go to app store and download native React Native app

Each row is an individual screen (or repeating pattern) in the order users will see them.

**#** **Screen Name** **Purpose / Goal** **Key UI Elements & Layout** **Suggested Visuals** **Micro-Copy & Tone** **User Action & Feedback** **Data Captured** **1-A** **Welcome Slide 1 – "Hello, Explorer!"** Spark curiosity, set brand vibe • Full-bleed illustration (passport + whimsical stamps) • Short headline • Dot / bar indicator (4 slides) Illustrated collage of ancient & modern wonders **H1:** "Hello, Explorer!" **Body:** "Turn your journeys into a living story." Swipe / auto-advance (4 s) — **1-B** **Welcome Slide 2 – Track Your Travels** Highlight core free feature • Map mock-up with pins & country count badge Stylised globe w/ pulsing pins **H1:** "Log every country you've set foot in." Swipe / auto-advance — **1-C** **Welcome Slide 3 – Log Trips + Get Recs** Tease depth beyond country log • Phone frame showing sample trip card & AI rec carousel Polaroid-style photos fanning out **H1:** "Relive each trip & get AI-powered tips for the next." Swipe / auto-advance — **1-D** **Welcome Slide 4 – Share & Compare (+ CTA)** Social proof & entry point to flow • Side-by-side friend avatars w/ country counts • Large primary button Minimalist UI mock of "Friends" leaderboard **H1:** "See who's been where." **CTA btn:** **"Start My Journey"** Tap CTA triggers next screen — **2** **Motivation & Personality Tags** _(single consolidated screen)_ Personalise tone & later content without extra steps • Bubble tags in two groups: _Why I Travel_ (Adventure, Food, Culture, Relax, Nature, Nightlife, History) & _I Am A…_ (Explorer, Foodie, Story-Teller, Minimalist, Social Butterfly) • Multi-select; selected bubbles pop w/ haptic tick Clean gradient bg with subtle compass pattern **Title:** "What moves you to explore?" • Inline progress ("Step 1 of 4") Tap bubbles → immediate chip-style selection; "Next" btn at bottom travel_motives\[\], persona_tags\[\] **3** **Current Country (Autocomplete)** Capture first "visited" country & build momentum • Search field w/ flag autocomplete list • Keyboard first-focus Simple compass icon beside field **Q:** "Where do you live today?" Success toast: "Great! USA logged – you're 1 country in." Type/select; on select → confetti burst, auto-save, Btn **"Next"** visited_countries\[\] += \[home_country\] **4** **Dream Destination (Autocomplete)** Add aspirational hook & bucket-list seed • Same UI as #3 with different placeholder • include ability to skip Scenic illustration of fantasy locale **Q:** "Pick one place you dream of visiting." Type/select; preview badge "Added to Bucket List" bucket_list\[\] += \[dream_country\] **5-A** **Continent Intro Modal (loops per continent)** Orient user & chunk task • Card for next continent w/ playful art • Yes / Skip buttons Hand-drawn outline of continent; stamp effect **Title:** "Visited North America?" **Sub:** "Tap 'Yes' to select countries." Tap **Yes** → grid (#5-B) Tap **Skip** → next continent card — ("visited_this_continent" bool) **5-B** **Country Grid Picker (per continent)** Rapid, tactile selection of visited & wishlist countries • Our illustrated graphic for each country with name and flag listed. Alphabetical for that region.

- Small stamp icon marks you have been there (first country show the words then hide over time)

- Small bucket list icon toggle on tile corner → marks Bucket List • Floating count badge ("3 selected") • "Save & Continue" btn top & bottom | Tile hover glow; haptic tick on selection | **Header:** Continent name + progress ("3/23 logged") | Tap flags toggles visited; star icon toggles bucket list; Btn → next continent intro | Append to visited_countries\[\] & bucket_list\[\] | | **6** | **Progress Summary + Map Reveal** | Deliver payoff & segue to paywall | • Dynamic grid of flags • Large counter: "You've explored 12 / 249 places!" • Secondary metric: "Top 14 % of users" | Very visual with big numbers - Encourage a share at this point | **Title:** "Look at those stamps!" **Body:** micro-copy praising progress | Big Share your accomplishments CTA – or give option to "Continue" btn | — | | **7** | **Premium Upsell / Paywall (not at launch but fast follow)** | Convert users at highest dopamine moment | • Carousel of premium features: – Social leaderboard & friend overlays – Deep trip journals (photos, notes, spend) – AI destination recommendations – Milestone videos / animated passport • Sticky price module with FREE 7-day trial badge • Primary btn: **"Unlock All Features – Start Free Trial"** • Secondary: "Continue with Free Plan" (less prominent) • Trust footnote: "Cancel anytime • 4.8★ rated by explorers" | Light card stack with drop-shadow; accent color button | Headline: "Take your travels further." Bullets: "• See where friends overlap • Turn trips into stories • Get smart itineraries" | Tap primary → in-app purchase flow; Tap secondary → skip | Conversion; capture pricing_choice | | **8** | **Account Creation** | Persist data & enable sync | • Apple / Google / Email buttons | Minimal clean form | Title: "Save your passport." | Tap provider; auth flow | user_id | | **9** | **Soft Invite Friends (post-onboarding modal)** | Light social seed without paywall leak | • Modal w/ 3 avatar placeholders + "Add from Contacts" btn | Friend avatar collage | **Body:** "See where friends overlap?" Options: "Invite", "Maybe later" | Optional invite flow | — | | **10** | **Home Dashboard (Onboarding Complete)** | Land users in value | • Map header, stats widgets, "Add Trip" FAB | Real app UI | — | — | — |

### **Copy / Visual Notes**

See our larger visualization information

- **Accessibility:** Enforce baseline mobile accessibility per Apple's native app requirements—44px touch targets, scalable text, VoiceOver compatibility, alt text on images, and UI structure supporting screen readers.

- **Animation:** Sub-200 ms tile check-mark tween; 400 ms confetti for key wins.

- **Paywall CRO Tweaks to A/B test:** trial length (7 vs 14 days), countdown ribbon ("Offer ends in 2 h"), testimonial placement.

### **5.2 Core experience**

- **Add a country**: User taps "+" and searches; flag appears in passport grid.
  - They also see a list with our cool illustrated images broken down by region

  - Ability to filter as well

  - Keep search latency under 300 ms for perceived speed.

- **Country view**
  - Flag, region, illustration we created

  - Big buttons to mark as visited / bucket list

  - Mark who you traveled to that country with (triggers consent workflow)

  - Easy create trip CTA

- **Create a trip**: Inside the trips tab or from a country view,
  - Name, cover image (optional), month/year (optional), with whom (optional, triggers consent workflow)

- **Tag friends on trips**:
  - When adding friends to a trip, trip shows with pending indicator on initiator's profile only

  - Tagged friends receive push notification and email

  - Trip only appears on both profiles after friend approval

- **Add entries**:
  - User taps category chip (eat/place/stay/experience)

  - If eat/place/stay use Google Places autocomplete

  - Optional link field

  - Add photos

  - Add notes / reviews (simple text field)

- **View passport**: Grid shows visited, wishlist, progress bar.
  - Tap a country to dive into trips list with cover images.

- **Invite a friend**: After sign‑up, "friends" tab offers search and invite.
  - Send friend requests via push and email notifications

  - Pending requests appear in notification center with accept/reject buttons.

### **5.3 Advanced features & edge cases**

- If Places API quota exceeded show fallback manual entry form.

- Handle duplicate trip names by appending "(2)".

- Allow deleting photos and entries with undo snack bar.

## **6. Narrative**

Ava is a frequent traveler who wants an elegant, visual way to record and share her journeys. She discovers this native app, adds the 17 countries she has visited without signing up, and instantly sees a vibrant passport grid. When she starts planning a Mexico City trip she signs up with Google, logs restaurants and museums, and creates a "CDMX for foodies" list to share with friends. When she tags her friend Ben on the trip, he receives a push notification to approve, and only then does the joint trip appear on both their profiles. The effortless visuals, consent-based social features, and simple sharing make the app her go‑to travel diary.

## **7. Success metrics**

### **7.1 User-centric metrics**

- Day‑1 activation rate (visited ≥ 1 country): ≥ 60 %.

- Monthly active users / registered users: ≥ 40 %.

- Average photos per entry: ≥ 2.

### **7.2 Business metrics**

- Virality (K‑factor via shared list sign‑ups): ≥ 0.3.

- Friend connections per active user per month: ≥ 2.

- Infrastructure cost per active user: ≤ $0.02.

### **7.3 Technical metrics**

- P75 page load time on mobile: < 2.5 s.

- API error rate: < 1 %.

- Image upload success rate: 99 %.

## **8. Technical considerations**

### **8.1 Integration points**

- Google Places API (autocomplete, place details).

- Supabase Auth, Postgres, Storage.

- Cloudflare Images (optional) for resizing CDN.

- Simple web experience for landing page and also for trips sharing

- Google Analytics and PostHog for mobile analytics

- RevenueCat for monetization tracking

### **8.2 Analytics & metrics requirements**

- **Google Analytics**: Core web vitals, user journeys, conversion funnels

- **PostHog**: Mobile-specific analytics, feature usage, cohort analysis

- **RevenueCat**: Subscription management, paywall performance, revenue tracking

- **Key events to instrument**:
  - Onboarding started and completed

  - Country/trip added

  - Friend request sent and accepted

  - Trip confirmation/approval by tagged friend

  - Standard product engagement metrics (DAU, MAU, retention)

### **8.3 Data storage & privacy**

- PII (email, display name) stored encrypted at rest in Supabase.

- Images stored private; public links expose only selected entries via signed URL.

- GDPR‑compliant deletion endpoint.

### **8.4 Scalability & performance**

- Use Supabase Row Level Security to isolate user data.

- Vercel/Cloudflare Pages edge caching for public list payloads.

- Background task queue for image resizing.

## **10. User stories**

### **10.1. Add a visited country**

- **ID**: US-001

- **Description**: As a new visitor, I want to mark a country as visited without signing up so that I can see my passport grid immediately.

- **Acceptance criteria**: Country search returns correct results; selected country appears in grid with "visited" status saved locally and to account if user later signs up.

### **10.2. Add a wishlist country**

- **ID**: US-002

- **Description**: As a user, I want to add countries to my wishlist so that I can plan future trips.

- **Acceptance criteria**: Wishlist countries display a different color; total wishlist count updates in real time.

### **10.3. Sign up with Google**

- **ID**: US-003

- **Description**: As a user, I want to register with Google so that I can access cloud sync and social features securely.

- **Acceptance criteria**: OAuth flow completes; JWT stored securely; user profile created; existing local countries migrate to account.

### **10.4. Sign up with email and password**

- **ID**: US-004

- **Description**: As a user, I want to create an account with email and password so that I can log in on any device.

- **Acceptance criteria**: Email verification sent; password policy enforced; login succeeds; countries sync.

### **10.5. Create a trip**

- **ID**: US-005

- **Description**: As a registered user, I want to create a trip within a country so that I can group related entries.

- **Acceptance criteria**: City autocomplete works; title required; trip appears in country detail list.

### **10.6. Tag friends on a trip with consent workflow**

- **ID**: US-006

- **Description**: As a user, I want to tag friends on trips, but they should approve before it appears on their profile.

- **Acceptance criteria**: Tagged trip shows with pending indicator on my profile only; friend receives push and email notification; trip appears on both profiles only after friend approval.

### **10.7. Approve a trip tag**

- **ID**: US-007

- **Description**: As a user, I want to approve or reject when friends tag me on trips so I control what appears on my profile.

- **Acceptance criteria**: Notification appears in in-app notification center; I can approve/reject; approved trips appear on both profiles and count toward joint stats.

### **10.8. Add a restaurant entry**

- **ID**: US-008

- **Description**: As a user, I want to log a restaurant I visited so that I remember where to eat next time.

- **Acceptance criteria**: Google Places search returns matching restaurant; user can add title, note, photos; entry saved.

### **10.9. Add an experience entry without Places API**

- **ID**: US-009

- **Description**: As a user, I want to log an experience that isn't in Google Places so that I can include unique activities.

- **Acceptance criteria**: Manual name and optional link fields allowed; entry saved with null place_id.

### **10.10. Upload multiple photos**

- **ID**: US-010

- **Description**: As a user, I want to upload multiple photos for an entry so that I capture the full experience.

- **Acceptance criteria**: User selects up to 10 photos; thumbnails show; files > 10 MB rejected; upload progress displayed.

### **10.11. Create a shared list for a city**

- **ID**: US-011

- **Description**: As a user, I want to curate a selection of my entries into a named list so that I can share recommendations.

- **Acceptance criteria**: User selects entries, names list, public slug generated, list accessible without login.

### **10.12. View a shared list via public link**

- **ID**: US-012

- **Description**: As a guest, I want to open a shared list link so that I can browse recommendations.

- **Acceptance criteria**: List shows entry cards with photos and notes; CTA invites to download native app; page loads under 2 s P75.

### **10.13. Send a friend request**

- **ID**: US-013

- **Description**: As a user, I want to connect with friends by username or email so that we can see each other's maps.

- **Acceptance criteria**: Search returns matched users; request sent via push and email notification; status shows pending.

### **10.14. Accept a friend request**

- **ID**: US-014

- **Description**: As a user, I want to accept a friend request so that my friend and I can view shared trips.

- **Acceptance criteria**: Accept updates status to accepted; friend appears in list; joint trips become visible.

### **10.15. Receive notifications for social interactions**

- **ID**: US-015

- **Description**: As a user, I want to receive push notifications and emails for friend requests and trip tags so I can respond promptly.

- **Acceptance criteria**: Push notifications appear on device; emails sent to registered address; notifications appear in in-app notification center.

### **10.16. Delete an entry**

- **ID**: US-016

- **Description**: As a user, I want to delete an entry if I made a mistake so that my log stays accurate.

- **Acceptance criteria**: Confirmation modal appears; entry removed; undo option available for 10 s.

### **10.17. Secure API access**

- **ID**: US-017

- **Description**: As the system, I need to ensure all write operations require a valid JWT so that user data remains secure.

- **Acceptance criteria**: Unauthorized requests return 401; tokens validated on every API call; RLS prevents cross‑user access.

### **10.18. Handle Places API quota error**

- **ID**: US-018

- **Description**: As a user, I want to still add places manually if autocomplete fails so that I'm not blocked by API limits.

- **Acceptance criteria**: On 429 or 403 from Places API, manual entry form appears automatically.

### **10.19. View passport progress**

- **ID**: US-019

- **Description**: As a user, I want to see how many countries I've visited out of 195 so that I know my travel progress.

- **Acceptance criteria**: Progress bar shows visited count and percentage; wishlist count separate.

### **10.20. Reset my account and data**

- **ID**: US-020

- **Description**: As a user, I want to delete my account and all data to comply with privacy regulations.

- **Acceptance criteria**: GDPR delete flow confirms; all DB rows and images removed; confirmation email sent.

### **10.21. Track key analytics events**

- **ID**: US-021

- **Description**: As the business, I need to track user behavior and engagement to optimize the product.

- **Acceptance criteria**: Google Analytics and PostHog events fire for onboarding, country additions, friend interactions, trip approvals, paywall views, and premium conversions; RevenueCat tracks subscription metrics.
