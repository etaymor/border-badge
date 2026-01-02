# feat: Friends Activity Feed

## Overview

Transform the Friends tab from a static "following" list into a dynamic, visual activity feed showing chronological updates from followed users—countries visited, entries added, and trips created. The feed should be on-brand using country illustrations, entry photos, and trip header images.

## Problem Statement

The current Friends page (`FriendsScreen.tsx`) only displays a list of users you follow with their country counts. It doesn't show **what** those users have been doing—their travel activities. This misses the core social value of the app: seeing friends' travel adventures as they happen.

**Current state:**
- FriendsScreen shows static list of followed users
- FeedScreen exists but is not accessible from the Friends tab
- Backend feed API exists and works for `country_visited` and `entry_added`
- `trip_added` activity type is NOT implemented

## Proposed Solution

Replace the static following list on the Friends tab with the activity feed. The feed will show a chronological mix of activities from all followed users, with rich visual cards featuring:

- **Country visits**: Country illustration as hero image with flag badge
- **Entries added**: Entry photo (or type icon fallback) with place details
- **Trips created**: Trip cover image (or country illustration fallback)

### Architecture Decision

**Option chosen:** Replace `FriendsScreen` content with feed, move "Following" list to profile or secondary view.

This keeps the Friends tab focused on the primary social value (seeing activity) rather than user management.

## Technical Approach

### Phase 1: Backend - Add Trip Activity Type

**Files to modify:**

1. **Database migration** - `supabase/migrations/XXXX_add_trip_activity_type.sql`
   ```sql
   -- Add trips to the activity feed query
   -- Update get_activity_feed function to include trip_created
   ```

2. **Backend schema** - `backend/app/schemas/feed.py`
   ```python
   class ActivityType(str, Enum):
       COUNTRY_VISITED = "country_visited"
       ENTRY_ADDED = "entry_added"
       TRIP_CREATED = "trip_created"  # NEW

   class FeedItemTrip(BaseModel):
       trip_id: str
       trip_name: str
       country_codes: list[str]
       cover_image_url: str | None = None
       start_date: str | None = None
       end_date: str | None = None
   ```

3. **Backend API** - `backend/app/api/feed.py`
   - Update `_build_feed_items()` to handle `trip_created` activity type
   - Include trip cover image in response

### Phase 2: Frontend - Feed Card Enhancements

**Files to modify:**

1. **FeedCard types** - `mobile/src/hooks/useFeed.ts`
   ```typescript
   export type ActivityType = 'country_visited' | 'entry_added' | 'trip_created';

   export interface FeedItemTrip {
     trip_id: string;
     trip_name: string;
     country_codes: string[];
     cover_image_url: string | null;
     start_date: string | null;
     end_date: string | null;
   }

   export interface FeedItem {
     // ... existing fields
     trip?: FeedItemTrip;  // NEW
   }
   ```

2. **FeedCard component** - `mobile/src/components/friends/FeedCard.tsx`
   - Add country illustration support using `getCountryImage()`
   - Add trip card variant with cover image
   - Add fallback logic for missing images
   - Improve visual design with brand typography

3. **New image utility** - `mobile/src/utils/feedImages.ts`
   ```typescript
   export function getFeedItemImage(item: FeedItem): ImageSource {
     switch (item.activity_type) {
       case 'country_visited':
         return getCountryImage(item.country!.country_code);
       case 'entry_added':
         return item.entry?.image_url
           ? { uri: item.entry.image_url }
           : getEntryTypePlaceholder(item.entry?.entry_type);
       case 'trip_created':
         return item.trip?.cover_image_url
           ? { uri: item.trip.cover_image_url }
           : getCountryImage(item.trip?.country_codes[0]);
     }
   }
   ```

### Phase 3: Navigation Integration

**Files to modify:**

1. **FriendsScreen** - `mobile/src/screens/friends/FriendsScreen.tsx`
   - Replace current following list with FeedScreen content
   - OR import and render FeedScreen directly
   - Keep user search/stats accessible via header button

2. **FriendsNavigator** - `mobile/src/navigation/FriendsNavigator.tsx`
   - Ensure feed item navigation works:
     - Country tap → CountryDetail
     - Entry tap → Entry detail
     - Trip tap → Trip detail
     - User tap → UserProfileScreen

### Phase 4: Visual Polish

1. **Card designs** matching brand:
   - Use Playfair Display for headings
   - Use OpenSans for body text
   - Brand colors: midnightNavy, warmCream, adobeBrick
   - Entry type colors for icons

2. **Empty states**:
   - No followers: "Follow friends to see their travel stories"
   - No activity: "Your friends haven't shared any trips yet"

3. **Loading states**:
   - Skeleton cards during initial load
   - Footer spinner during pagination

## Acceptance Criteria

### Functional Requirements

- [ ] Feed displays chronological activities from followed users
- [ ] Feed shows three activity types: `country_visited`, `entry_added`, `trip_created`
- [ ] Country visits display country illustration as hero image
- [ ] Entry activities show entry photo (or type icon if no photo)
- [ ] Trip activities show cover image (or country illustration fallback)
- [ ] Tapping a feed card navigates to the appropriate detail screen
- [ ] Tapping user avatar/name navigates to UserProfileScreen
- [ ] Pull-to-refresh fetches latest activities
- [ ] Infinite scroll loads more activities when reaching bottom
- [ ] Empty state shows when user has no followers or no activity

### Non-Functional Requirements

- [ ] Feed loads within 2 seconds on average network
- [ ] Smooth 60fps scrolling with 50+ items
- [ ] Images load progressively with placeholders
- [ ] Scroll position maintained when navigating away and back

### Quality Gates

- [ ] All existing feed tests pass
- [ ] New tests added for `trip_created` activity type
- [ ] Backend linting passes (`poetry run ruff check .`)
- [ ] Frontend linting passes (`npm run lint`)
- [ ] Manual testing on iOS simulator

## Implementation Tasks

### Backend Tasks

1. **Create database migration for trip activities**
   - [ ] Add `trip_created` to activity feed query in `get_activity_feed` function
   - [ ] Create composite index for trip feed performance
   - [ ] Test migration locally
   - File: `supabase/migrations/XXXX_trip_activity_feed.sql`

2. **Update feed schema**
   - [ ] Add `TRIP_CREATED` to `ActivityType` enum
   - [ ] Create `FeedItemTrip` Pydantic model
   - [ ] Add `trip` field to `FeedItem` model
   - File: `backend/app/schemas/feed.py`

3. **Update feed API**
   - [ ] Update `_build_feed_items()` to handle trip activities
   - [ ] Include trip cover image in response
   - [ ] Add tests for trip activities
   - File: `backend/app/api/feed.py`

### Frontend Tasks

4. **Update feed hook types**
   - [ ] Add `trip_created` to `ActivityType`
   - [ ] Add `FeedItemTrip` interface
   - [ ] Add `trip` field to `FeedItem`
   - File: `mobile/src/hooks/useFeed.ts`

5. **Create feed image utility**
   - [ ] Create `getFeedItemImage()` function
   - [ ] Handle all three activity types
   - [ ] Provide fallbacks for missing images
   - File: `mobile/src/utils/feedImages.ts`

6. **Enhance FeedCard component**
   - [ ] Import and use `getCountryImage()` for country visits
   - [ ] Add trip card variant
   - [ ] Implement image fallback logic
   - [ ] Improve typography with brand fonts
   - [ ] Add proper accessibility labels
   - File: `mobile/src/components/friends/FeedCard.tsx`

7. **Integrate feed into FriendsScreen**
   - [ ] Replace static following list with feed content
   - [ ] Add header button to access following list
   - [ ] Verify pull-to-refresh works
   - [ ] Verify infinite scroll works
   - File: `mobile/src/screens/friends/FriendsScreen.tsx`

8. **Add empty states**
   - [ ] Create "no followers" empty state component
   - [ ] Create "no activity" empty state component
   - [ ] Add discover friends CTA
   - File: `mobile/src/components/friends/FeedEmptyState.tsx`

9. **Verify navigation**
   - [ ] Test country tap → CountryDetail navigation
   - [ ] Test entry tap → Entry detail navigation
   - [ ] Test trip tap → Trip detail navigation
   - [ ] Test user tap → UserProfileScreen navigation
   - [ ] Verify scroll position maintained on back navigation
   - Files: `mobile/src/screens/friends/FeedScreen.tsx`, `mobile/src/navigation/FriendsNavigator.tsx`

### Testing Tasks

10. **Backend tests**
    - [ ] Add test for `trip_created` in feed response
    - [ ] Test pagination with mixed activity types
    - [ ] Test empty feed response
    - File: `backend/tests/api/test_feed.py`

11. **Frontend tests**
    - [ ] Update `useFeed.test.tsx` for trip activities
    - [ ] Add tests for `getFeedItemImage()` utility
    - File: `mobile/src/__tests__/hooks/useFeed.test.tsx`

## Dependencies & Risks

### Dependencies
- Supabase migration must be applied before backend changes
- Backend API must be deployed before mobile can use trip activities
- Country illustrations must exist for all destination countries

### Risks

| Risk | Likelihood | Impact | Mitigation |
|------|------------|--------|------------|
| Performance issues with large feeds | Medium | High | Use FlashList if needed, implement virtualization |
| Missing country illustrations | Low | Medium | Fall back to flag emoji + solid color |
| Database migration failure | Low | High | Test migration in staging first |

## Success Metrics

- Feed engagement: Users scrolling through 10+ items
- Navigation: Users tapping on feed items to view details
- Retention: Users returning to Friends tab daily

## References

### Internal Files

- [FeedScreen.tsx](mobile/src/screens/friends/FeedScreen.tsx) - Existing feed UI implementation
- [FeedCard.tsx](mobile/src/components/friends/FeedCard.tsx) - Feed card component
- [useFeed.ts](mobile/src/hooks/useFeed.ts) - Feed data fetching hook
- [feed.py](backend/app/api/feed.py) - Backend feed API
- [feed.py](backend/app/schemas/feed.py) - Backend feed schemas
- [0045_feed_performance_optimizations.sql](supabase/migrations/0045_feed_performance_optimizations.sql) - Feed database function
- [countryImages.ts](mobile/src/assets/countryImages.ts) - Country illustration assets
- [colors.ts](mobile/src/constants/colors.ts) - Brand colors

### External References

- [TanStack Query Infinite Queries](https://tanstack.com/query/latest/docs/framework/react/guides/infinite-queries)
- [React Native FlatList Optimization](https://reactnative.dev/docs/optimizing-flatlist-configuration)
- [expo-image Documentation](https://docs.expo.dev/versions/latest/sdk/image/)

## ERD: Feed Data Model

```mermaid
erDiagram
    user_profile ||--o{ user_follow : "follows"
    user_profile ||--o{ trip : "creates"
    user_profile ||--o{ user_countries : "visits"
    trip ||--o{ entry : "contains"
    entry }o--|| country : "located_in"
    user_countries }o--|| country : "references"

    user_profile {
        uuid id PK
        string username
        string avatar_url
    }

    user_follow {
        uuid follower_id FK
        uuid following_id FK
        timestamp created_at
    }

    trip {
        uuid id PK
        uuid user_id FK
        string trip_name
        string cover_image_url
        date start_date
        date end_date
        timestamp created_at
    }

    entry {
        uuid id PK
        uuid trip_id FK
        string entry_type
        string image_url
        timestamp created_at
    }

    user_countries {
        uuid id PK
        uuid user_id FK
        string country_code FK
        string status
        timestamp created_at
    }

    country {
        string code PK
        string name
    }
```

## Open Questions (Resolved)

| Question | Decision |
|----------|----------|
| Navigation pattern? | Replace FriendsScreen content with feed |
| Show user's own activities? | No, feed only shows followed users |
| Time grouping? | No grouping in V1, flat chronological list |
| Activity filtering? | No filtering in V1 |
| Timestamp format? | Relative (2h ago) up to 7 days, then "Dec 25" |
