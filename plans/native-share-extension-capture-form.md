# Native iOS Share Extension Capture Form

**Type:** Enhancement
**Priority:** High
**Status:** Planning
**Created:** 2025-01-09

## Overview

Replace the current minimal iOS Share Extension (`ShareViewController.swift`) with a fully-featured native Swift capture form that matches the functionality of the React Native `ShareCaptureScreen.tsx`. The new extension will allow users to complete the entire place-saving flow without opening the main app.

### Current State

The existing share extension (`mobile/plugins/share-extension/ShareViewController.swift`) provides a simple confirmation UI:
- Shows "Saving place..." loading state
- Displays "Place Saved!" success state with provider badge
- Offers "Open Atlasi" button to launch main app
- Saves URL to App Group storage for main app to process

### Target State

A full capture form within the share extension that includes:
- Loading state while fetching URL metadata from `/ingest/social`
- Error states with retry/manual entry/save for later options
- Location selector using **Google Places via new backend `/places/autocomplete` endpoint**
- Trip selector dropdown with trip list and inline trip creation (name + country only)
- Category selector (Place/Food/Stay/Experience)
- Notes input (optional)
- "Save to Trip" button that calls `/ingest/save-to-trip`
- Success confirmation with auto-dismiss
- **Liquid glass visual design** matching ShareCaptureScreen.tsx exactly

**Key Simplifications:**
- No video thumbnail preview (reduces memory, user just saw content)
- Trip creation is name + country only (dates were removed from trips)

## Technical Approach

### Architecture

The share extension will be built using **SwiftUI** hosted in a UIViewController via `UIHostingController`. SwiftUI provides:
- Declarative UI matching the React Native patterns
- Native iOS look and feel
- Efficient memory management
- Modern Swift concurrency support

#### File Structure

```
mobile/plugins/share-extension/
├── ShareViewController.swift          # Entry point, hosts SwiftUI view
├── Views/
│   ├── ShareCaptureView.swift         # Main container view
│   ├── LoadingStateView.swift         # Loading spinner with message
│   ├── ErrorStateView.swift           # Error display with actions
│   ├── CaptureFormView.swift          # The main form
│   ├── LocationSearchView.swift       # Google Places autocomplete via backend
│   ├── TripSelectorView.swift         # Dropdown with trip list
│   ├── InlineTripFormView.swift       # Create new trip modal
│   ├── CategorySelectorView.swift     # Place/Food/Stay/Experience picker
│   └── SuccessStateView.swift         # Confirmation with auto-dismiss
├── ViewModels/
│   ├── ShareCaptureViewModel.swift    # Main state management
│   └── TripSelectorViewModel.swift    # Trip list and creation
├── Services/
│   ├── APIClient.swift                # Network requests to backend
│   ├── AuthService.swift              # Token retrieval from Keychain
│   └── OfflineQueueService.swift      # Save for later functionality
├── Models/
│   ├── IngestResponse.swift           # /ingest/social response model
│   ├── Trip.swift                     # Trip model
│   ├── EntryType.swift                # Place/Food/Stay/Experience enum
│   └── QueuedShare.swift              # Offline queue item model
├── Utilities/
│   ├── KeychainHelper.swift           # Secure token storage access
│   ├── AppGroupStorage.swift          # Shared UserDefaults wrapper
│   └── BrandColors.swift              # Color constants matching React Native
├── Info.plist                         # Extension configuration
└── ShareExtension.entitlements        # App Group + Keychain entitlements
```

### Visual Design Spec (Matching React Native)

#### Colors (from `colors.ts`)
```swift
enum BrandColors {
    static let midnightNavy = Color(red: 23/255, green: 42/255, blue: 58/255)
    static let warmCream = Color(red: 253/255, green: 246/255, blue: 237/255)
    static let sunsetGold = Color(red: 244/255, green: 194/255, blue: 78/255)
    static let adobeBrick = Color(red: 193/255, green: 84/255, blue: 62/255)
    static let mossGreen = Color(red: 84/255, green: 122/255, blue: 95/255)
    static let paperBeige = Color(red: 245/255, green: 236/255, blue: 224/255)
    static let stormGray = Color(red: 102/255, green: 109/255, blue: 122/255)
}
```

#### Liquid Glass Styling (from `glass.ts`)
```swift
struct LiquidGlass {
    // Container: rgba(255,255,255,0.55), 1.5pt white border, 16pt radius
    // FloatingCard: rgba(255,255,255,0.75), 2pt white border, 24pt radius
    // Input: rgba(255,255,255,0.5), 1.5pt border, 12pt radius
    // Shadow: midnightNavy, offset (0,4), opacity 0.12, radius 15
}
```

#### Typography (from `typography.ts`)
- **Headers:** Playfair Display Bold (24pt for title)
- **Labels:** Oswald Medium (12pt, uppercase, 1.5pt letter spacing, 0.7 opacity)
- **Body:** Open Sans Regular (16pt)
- **Buttons:** Open Sans SemiBold (16pt)

#### Component Mapping

| React Native | Swift Equivalent |
|-------------|------------------|
| `GlassInput` | Custom TextField with `.background(.ultraThinMaterial)` + white border |
| `Button` (primary) | Custom button with sunsetGold background, midnightNavy text |
| `TripSelector` dropdown | Sheet presentation with glass background |
| `CategorySelector` | HStack of category buttons with icons |
| Section labels | Oswald Medium, 12pt, uppercase, 70% opacity |

### Implementation Phases

#### Phase 1: Foundation (Infrastructure)

**Tasks:**
1. Set up file structure with SwiftUI views and view models
2. Configure Keychain Sharing entitlement for auth token access
3. Implement `AuthService.swift` to read JWT from shared Keychain
4. Implement `APIClient.swift` with async/await networking
5. Add `BrandColors.swift` with all brand colors from React Native
6. Update `ShareViewController.swift` to host SwiftUI via `UIHostingController`

**Files to create:**
- `Services/AuthService.swift`
- `Services/APIClient.swift`
- `Utilities/KeychainHelper.swift`
- `Utilities/BrandColors.swift`

**Success criteria:**
- Extension can read auth token from Keychain
- Extension can make authenticated API request to `/ingest/social`
- Brand colors match React Native constants

---

#### Phase 2: Core Form UI

**Tasks:**
1. Create `ShareCaptureView.swift` as main container with state machine
2. Implement `LoadingStateView.swift` with activity indicator
3. Implement `ErrorStateView.swift` with retry/manual/save-for-later buttons
4. Implement `CaptureFormView.swift` with all form sections
5. Implement `CategorySelectorView.swift` with 4 category buttons
6. Add notes text field with multiline support

**Files to create:**
- `Views/ShareCaptureView.swift`
- `Views/LoadingStateView.swift`
- `Views/ErrorStateView.swift`
- `Views/CaptureFormView.swift`
- `Views/CategorySelectorView.swift`
- `ViewModels/ShareCaptureViewModel.swift`
- `Models/EntryType.swift`

**Success criteria:**
- Form UI renders with all sections
- State transitions between loading/error/form states work
- Category selection updates state
- Notes field captures input

---

#### Phase 3: Trip Selector

**Tasks:**
1. Implement `TripSelectorView.swift` with dropdown presentation
2. Create trip list fetching from `/trips` endpoint
3. Implement `InlineTripFormView.swift` for new trip creation
4. Add country selector using App Group to pass country hint from main app
5. Handle empty trips state (auto-show create form)

**Files to create:**
- `Views/TripSelectorView.swift`
- `Views/InlineTripFormView.swift`
- `ViewModels/TripSelectorViewModel.swift`
- `Models/Trip.swift`

**Success criteria:**
- Trip list loads and displays
- User can select existing trip
- User can create new trip inline
- New trip appears in list after creation

---

#### Phase 4: Location Search (Google Places via Backend)

**Tasks:**
1. **Add backend endpoint** `POST /places/autocomplete` that wraps Google Places API
2. Create `LocationSearchView.swift` with autocomplete dropdown
3. Implement `LocationSearchViewModel.swift` with debounced search (300ms)
4. Handle search errors gracefully
5. Allow manual text entry as fallback
6. Return `google_place_id` with results for dedup/affiliate matching

**Backend endpoint to create:**
```python
# backend/app/api/places.py
@router.post("/autocomplete")
async def autocomplete_places(
    query: str,
    country_code: str | None = None,  # Bias results to detected country
    current_user: CurrentUser = Depends(get_current_user),
) -> list[PlacePrediction]:
    """Google Places autocomplete for share extension."""
```

**Files to create:**
- `Views/LocationSearchView.swift`
- `ViewModels/LocationSearchViewModel.swift`

**Files to modify:**
- `backend/app/api/places.py` - Add autocomplete endpoint
- `backend/app/api/__init__.py` - Register endpoint if new router

**Success criteria:**
- Location search returns Google Places results (preserves `google_place_id`)
- Country hint biases autocomplete results
- User can select from autocomplete suggestions
- Manual text entry works when search fails

---

#### Phase 5: Save Flow & Offline Queue

**Tasks:**
1. Implement save to trip via `/ingest/save-to-trip` endpoint
2. Create `SuccessStateView.swift` with auto-dismiss (1.5s)
3. Implement `OfflineQueueService.swift` for save-for-later
4. Handle unauthenticated state with queue fallback
5. Add haptic feedback on success

**Files to create:**
- `Views/SuccessStateView.swift`
- `Services/OfflineQueueService.swift`
- `Models/QueuedShare.swift`
- `Utilities/AppGroupStorage.swift`

**Success criteria:**
- Entry saves to trip via API
- Success state shows briefly then dismisses
- Offline queue stores failed saves
- Unauthenticated users can queue for later

---

#### Phase 6: Polish & Edge Cases

**Tasks:**
1. Add memory management (monitor `os_proc_available_memory()`)
2. Implement request timeouts (15s for ingest, 10s for others)
3. Handle token expiration (401 → show re-auth message)
4. Add keyboard avoidance for form inputs
5. Test on various device sizes
6. Add error analytics tracking

**Success criteria:**
- Extension doesn't crash under memory pressure
- Timeouts show appropriate error states
- Keyboard doesn't obscure inputs
- Works on iPhone SE through iPhone 15 Pro Max

## Alternative Approaches Considered

### 1. UIKit Instead of SwiftUI

**Rejected because:**
- More boilerplate code for equivalent functionality
- SwiftUI's `@Published` state management is simpler than UIKit delegates
- SwiftUI's memory efficiency is better for constrained extensions
- Team's React Native experience maps better to SwiftUI's declarative model

### 2. Apple MapKit for Location Search

**Rejected because:**
- Backend uses `google_place_id` for deduplication (prevents duplicate entries)
- Affiliate matching (Booking.com, Tripadvisor, GetYourGuide) requires Google Place IDs
- Social ingest already uses Google Places for place detection
- Photo URLs are constructed from Google photo resources
- Switching to Apple would break existing integrations

**Solution:** Use Google Places via new backend `/places/autocomplete` endpoint - keeps API key server-side while preserving `google_place_id` integration

### 3. Full Thumbnail Preview from Social Media

**Rejected because:**
- Video thumbnails consume significant memory (~5-10MB each)
- Share extensions have ~120MB limit
- Downloading images adds latency
- User just saw the content in TikTok/Instagram, preview adds minimal value
- Removing thumbnail greatly simplifies implementation

### 4. Inline Authentication in Extension

**Rejected because:**
- Apple guidelines discourage sign-in flows in extensions
- Adds significant complexity (OAuth flows, webviews)
- Better UX to redirect to main app for auth
- Token sharing via Keychain solves authenticated user case

## Acceptance Criteria

### Functional Requirements

- [ ] Extension opens when user shares TikTok or Instagram URL
- [ ] Loading state shows while fetching URL metadata
- [ ] Error state displays with retry, manual entry, and save-for-later options
- [ ] Form displays with location, trip, category, and notes fields
- [ ] Location search returns Google Places results (via backend endpoint)
- [ ] Trip selector shows user's existing trips
- [ ] User can create new trip inline
- [ ] Category selector allows Place/Food/Stay/Experience selection
- [ ] Notes field accepts multiline text input
- [ ] Save button creates entry via API
- [ ] Success state shows confirmation before dismissing
- [ ] Unauthenticated users see appropriate message with options
- [ ] Offline users can save URL for later processing

### Non-Functional Requirements

- [ ] Extension launches in under 2 seconds
- [ ] Memory usage stays under 100MB (20MB buffer below limit)
- [ ] API calls timeout after 15 seconds (ingest) / 10 seconds (others)
- [ ] Form is usable on all iPhone screen sizes
- [ ] Keyboard doesn't obscure active input field

### Quality Gates

- [ ] All views compile without warnings
- [ ] Extension runs without crashes on iOS 15+
- [ ] Manual testing on physical device confirms UX
- [ ] Code follows Swift style guide

## Success Metrics

- **Completion rate:** % of share extension opens that result in saved entry
- **Error rate:** % of share extension opens that result in error state
- **Save-for-later rate:** % of saves that go to offline queue
- **Trip creation rate:** % of saves that involve creating new trip

## Dependencies & Prerequisites

1. **Keychain Sharing entitlement** must be configured in main app and extension
2. **App Group** `group.com.atlasi.app` already configured (existing)
3. **Backend API** endpoints:
   - `POST /ingest/social` - Process URL (existing)
   - `POST /ingest/save-to-trip` - Save entry (existing)
   - `GET /trips` - List user's trips (existing)
   - `POST /trips` - Create new trip (existing)
   - `GET /countries` - List countries for trip creation (existing)
   - **`POST /places/autocomplete` - Google Places search (NEW - must be added)**
4. **Custom fonts** bundled in extension: Playfair Display, Oswald, Open Sans

## Risk Analysis & Mitigation

| Risk | Likelihood | Impact | Mitigation |
|------|------------|--------|------------|
| Memory limit exceeded | Medium | High (crash) | Monitor memory, downsample images, test thoroughly |
| iOS kills extension (timeout) | Medium | Medium (data loss) | Aggressive timeouts, queue before long operations |
| Token not accessible | Low | High (blocks all) | Verify Keychain sharing early, fallback to queue |
| Backend autocomplete unavailable | Low | Medium | Allow manual text entry as fallback |
| User confusion (new UX) | Low | Low | Match main app design language closely |

## Resource Requirements

- **Development time:** 3-5 days for experienced iOS developer
- **Testing:** 1-2 days manual testing across devices
- **Dependencies:** None (uses native iOS frameworks only)

## Future Considerations

1. **Smart trip defaults:** Pre-select trip based on detected location
2. **Location auto-population:** Parse location from URL metadata if available
3. **Multiple URL handling:** Queue multiple shares in one session
4. **Photo attachment:** Allow adding photos from gallery
5. **Offline sync indicator:** Show pending queue count in main app

## References & Research

### Internal References

- Current share extension: [ShareViewController.swift](mobile/plugins/share-extension/ShareViewController.swift)
- React Native capture screen: [ShareCaptureScreen.tsx](mobile/src/screens/share/ShareCaptureScreen.tsx)
- State management hook: [useShareCapture.ts](mobile/src/screens/share/useShareCapture.ts)
- Trip selector component: [TripSelector.tsx](mobile/src/components/share/TripSelector.tsx)
- Category selector: [CategorySelector.tsx](mobile/src/components/entries/CategorySelector.tsx)
- Colors: [colors.ts](mobile/src/constants/colors.ts)
- Typography: [typography.ts](mobile/src/constants/typography.ts)
- Entry types: [entryTypes.ts](mobile/src/constants/entryTypes.ts)
- API hooks: [useSocialIngest.ts](mobile/src/hooks/useSocialIngest.ts)
- Share extension bridge: [shareExtensionBridge.ts](mobile/src/services/shareExtensionBridge.ts)
- Share extension docs: [ios-share-extension.md](docs/ios-share-extension.md)

### External References

- [Apple: Share Extensions](https://developer.apple.com/library/archive/documentation/General/Conceptual/ExtensibilityPG/Share.html)
- [Apple: App Groups](https://developer.apple.com/documentation/xcode/configuring-app-groups)
- [Apple: Keychain Sharing](https://developer.apple.com/documentation/security/keychain_services/keychain_items/sharing_access_to_keychain_items_among_a_collection_of_apps)
- [SwiftUI in App Extensions](https://developer.apple.com/documentation/swiftui/app-extensions)
- [Google Places Autocomplete API](https://developers.google.com/maps/documentation/places/web-service/autocomplete)

---

## Clarification Decisions

The following decisions were made during planning:

| Question | Decision |
|----------|----------|
| SwiftUI vs UIKit? | **SwiftUI** - Better matches React Native patterns, more memory efficient |
| Location search provider? | **Google Places via backend** - Preserves `google_place_id` for dedup/affiliate matching |
| Show video thumbnail? | **No** - Reduces memory pressure, user just saw content |
| Auth in extension? | **No** - Use Keychain sharing, redirect to app if needed |
| Trip creation scope? | **Minimal** - Name + country only (dates were removed from trips) |
| Category default? | **Place** - Most common, reduces required taps |
| Success auto-dismiss? | **Yes** - 1.5 seconds with haptic feedback |
| Offline queue storage? | **App Group UserDefaults** - Simple, existing pattern |

---

## Appendix: API Contracts

### POST /ingest/social

**Request:**
```json
{
  "url": "https://www.tiktok.com/@user/video/123",
  "caption": "optional caption text"
}
```

**Response:**
```json
{
  "provider": "tiktok",
  "canonical_url": "https://www.tiktok.com/@user/video/123",
  "thumbnail_url": "https://...",
  "author_handle": "user",
  "title": "Video title",
  "detected_place": {
    "google_place_id": "ChIJ...",
    "name": "Place Name",
    "address": "123 Street, City",
    "latitude": 40.7128,
    "longitude": -74.0060,
    "country_code": "US",
    "primary_type": "restaurant",
    "types": ["restaurant", "food"],
    "confidence": 0.85
  },
  "detected_country": {
    "country_code": "US",
    "country_name": "United States"
  }
}
```

### POST /ingest/save-to-trip

**Request:**
```json
{
  "trip_id": "uuid",
  "provider": "tiktok",
  "canonical_url": "https://...",
  "thumbnail_url": "https://...",
  "author_handle": "user",
  "title": "Video title",
  "place": {
    "google_place_id": "ChIJ...",
    "name": "Place Name",
    "address": "123 Street",
    "latitude": 40.7128,
    "longitude": -74.0060,
    "country_code": "US",
    "confidence": 1.0
  },
  "entry_type": "food",
  "notes": "Optional notes"
}
```

**Response:**
```json
{
  "id": "entry-uuid",
  "trip_id": "trip-uuid",
  "type": "food",
  "title": "Place Name",
  "notes": "Optional notes",
  "created_at": "2025-01-09T..."
}
```

### GET /trips

**Response:**
```json
[
  {
    "id": "uuid",
    "name": "Summer in Italy",
    "country_code": "IT",
    "created_at": "2025-01-01T..."
  }
]
```

### POST /trips

**Request:**
```json
{
  "name": "Trip Name",
  "country_code": "IT"
}
```

**Response:**
```json
{
  "id": "new-trip-uuid",
  "name": "Trip Name",
  "country_code": "IT",
  "created_at": "2025-01-09T..."
}
```

### POST /places/autocomplete (NEW)

**Request:**
```json
{
  "query": "blue bottle coffee",
  "country_code": "US"
}
```

**Response:**
```json
[
  {
    "place_id": "ChIJAQAAAP2HhYARIdrZmXm0YYA",
    "main_text": "Blue Bottle Coffee",
    "secondary_text": "300 S Broadway, Los Angeles, CA, USA",
    "types": ["cafe", "food", "point_of_interest"]
  }
]
```

### GET /countries

**Response:**
```json
[
  {
    "code": "US",
    "name": "United States",
    "flag_emoji": "🇺🇸"
  },
  {
    "code": "IT",
    "name": "Italy",
    "flag_emoji": "🇮🇹"
  }
]
```

---

## Appendix: Brand Colors (Swift)

```swift
// BrandColors.swift
import SwiftUI

enum BrandColors {
    // Primary brand colors
    static let midnightNavy = Color(red: 23/255, green: 42/255, blue: 58/255)
    static let warmCream = Color(red: 253/255, green: 246/255, blue: 237/255)
    static let sunsetGold = Color(red: 244/255, green: 194/255, blue: 78/255)
    static let adobeBrick = Color(red: 193/255, green: 84/255, blue: 62/255)
    static let lakeBlue = Color(red: 160/255, green: 205/255, blue: 235/255)
    static let mossGreen = Color(red: 84/255, green: 122/255, blue: 95/255)

    // Secondary colors
    static let paperBeige = Color(red: 245/255, green: 236/255, blue: 224/255)
    static let stormGray = Color(red: 102/255, green: 109/255, blue: 122/255)

    // Entry type colors
    static let entryPlace = adobeBrick
    static let entryFood = sunsetGold
    static let entryStay = mossGreen
    static let entryExperience = midnightNavy
}
```

---

## Appendix: Entry Types (Swift)

```swift
// EntryType.swift
import SwiftUI

enum EntryType: String, CaseIterable {
    case place
    case food
    case stay
    case experience

    var label: String {
        switch self {
        case .place: return "Place"
        case .food: return "Food"
        case .stay: return "Stay"
        case .experience: return "Experience"
        }
    }

    var icon: String {
        switch self {
        case .place: return "mappin.circle.fill"
        case .food: return "fork.knife"
        case .stay: return "bed.double.fill"
        case .experience: return "star.fill"
        }
    }

    var color: Color {
        switch self {
        case .place: return BrandColors.adobeBrick
        case .food: return BrandColors.sunsetGold
        case .stay: return BrandColors.mossGreen
        case .experience: return BrandColors.midnightNavy
        }
    }
}
```
