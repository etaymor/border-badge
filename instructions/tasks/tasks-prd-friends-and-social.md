# Tasks: Friends & Social System

Based on PRD: `instructions/prd/prd-friends-and-social.md`

---

## Relevant Files

### Database Migrations
- `supabase/migrations/0001_init_schema.sql` - Reference for existing schema patterns
- `supabase/migrations/XXXX_add_username.sql` - New: Username column migration
- `supabase/migrations/XXXX_social_tables.sql` - New: Follow, block, invite tables
- `supabase/migrations/XXXX_activity_feed.sql` - New: Activity feed table + triggers
- `supabase/migrations/XXXX_leaderboard_stats.sql` - New: Stats tables + triggers

### Backend - Existing (Reference)
- `backend/app/api/profile.py` - Profile endpoint patterns to extend
- `backend/app/api/trips.py` - Trip tagging patterns, RLS reference
- `backend/app/api/user_countries.py` - User countries patterns
- `backend/app/schemas/profile.py` - Profile schema to extend
- `backend/app/core/security.py` - Auth patterns (CurrentUser dependency)
- `backend/app/db/session.py` - Supabase client patterns

### Backend - New
- `backend/app/api/follows.py` - New: Follow/unfollow endpoints
- `backend/app/api/users.py` - New: User search, profile view
- `backend/app/api/blocks.py` - New: Block endpoints
- `backend/app/api/invites.py` - New: Email invite endpoints
- `backend/app/api/feed.py` - New: Activity feed endpoint
- `backend/app/api/stats.py` - New: Friends ranking endpoint
- `backend/app/schemas/follows.py` - New: Follow schemas
- `backend/app/schemas/users.py` - New: UserSummary, UserProfile schemas
- `backend/app/schemas/feed.py` - New: FeedItem schema
- `backend/app/core/notifications.py` - Extend with push notifications

### Backend Tests
- `backend/tests/test_follows.py` - New: Follow system tests
- `backend/tests/test_users.py` - New: User search tests
- `backend/tests/test_feed.py` - New: Feed endpoint tests
- `backend/tests/test_blocks.py` - New: Block system tests

### Mobile - Existing (Reuse Patterns)
- `mobile/src/components/passport/PassportSearchBar.tsx` - **REUSE** for UserSearchBar
- `mobile/src/components/passport/PassportStatsGrid.tsx` - **REUSE** for FriendsRankingStats
- `mobile/src/components/passport/StatBox.tsx` - **REUSE** directly for stat display
- `mobile/src/components/entries/EntryCard.tsx` - **REUSE** patterns for FeedItem
- `mobile/src/screens/onboarding/NameEntryScreen.tsx` - Modify for username
- `mobile/src/screens/settings/ProfileSettingsScreen.tsx` - Modify for username edit
- `mobile/src/hooks/useTrips.ts` - React Query patterns to follow
- `mobile/src/hooks/useCountries.ts` - Query patterns reference
- `mobile/src/services/api.ts` - API client to extend
- `mobile/src/navigation/MainTabNavigator.tsx` - Update Friends tab

### Mobile - New Screens
- `mobile/src/screens/friends/FriendsScreen.tsx` - New: Main friends tab
- `mobile/src/screens/friends/UserProfileScreen.tsx` - New: View other user's profile
- `mobile/src/screens/friends/FollowersListScreen.tsx` - New: Followers/following list

### Mobile - New Components
- `mobile/src/components/friends/UserSearchBar.tsx` - New: Based on PassportSearchBar
- `mobile/src/components/friends/UserCard.tsx` - New: User display with follow button
- `mobile/src/components/friends/FollowButton.tsx` - New: Toggle follow state
- `mobile/src/components/friends/FeedList.tsx` - New: Activity feed list
- `mobile/src/components/friends/FeedItem.tsx` - New: Rich entry card
- `mobile/src/components/friends/FriendsRankingStats.tsx` - New: Stats at top
- `mobile/src/components/friends/EmptyFeedState.tsx` - New: Empty state

### Mobile - New Hooks
- `mobile/src/hooks/useFollows.ts` - New: Follow/unfollow mutations
- `mobile/src/hooks/useUserSearch.ts` - New: Debounced user search
- `mobile/src/hooks/useFeed.ts` - New: Infinite scroll feed
- `mobile/src/hooks/useFriendsRanking.ts` - New: Ranking stats
- `mobile/src/hooks/useUserProfile.ts` - New: Other user's profile

### Mobile Tests
- `mobile/src/__tests__/hooks/useFollows.test.ts` - New: Follow hook tests
- `mobile/src/__tests__/hooks/useUserSearch.test.ts` - New: Search hook tests
- `mobile/src/__tests__/components/FollowButton.test.tsx` - New: Button tests

### Notes

- Unit tests should be placed alongside the code files they are testing
- Mobile tests: `npm test` in `/mobile`
- Backend tests: `poetry run pytest` in `/backend`
- Always run linting before committing: `npm run lint` (mobile), `poetry run ruff check .` (backend)
- **Reuse patterns**: PassportSearchBar → UserSearchBar, StatBox → FriendsRankingStats, EntryCard → FeedItem

---

## Tasks

- [ ] 1.0 **Username System & Validation** - Add unique `username` column replacing legacy `display_name`, with validation and uniqueness checks in onboarding and profile settings
  - [ ] 1.1 Create migration `XXXX_add_username.sql`: Add `username` column to `user_profile`, case-insensitive unique index, format check constraint (`^[a-zA-Z0-9_]{3,30}$`), NOT NULL
  - [ ] 1.2 Create backend endpoint `GET /users/check-username?username={name}` in `backend/app/api/users.py` to check availability (case-insensitive)
  - [ ] 1.3 Add `UsernameCheckResponse` schema in `backend/app/schemas/users.py` with `available: bool` and `suggestion: Optional[str]`
  - [ ] 1.4 Update `mobile/src/screens/onboarding/NameEntryScreen.tsx`: Replace display name input with username input, add real-time availability check with 300ms debounce, show validation errors (3-30 chars, no spaces, letters/numbers/underscores only)
  - [ ] 1.5 Create `mobile/src/hooks/useUsernameCheck.ts` hook with debounced API call for availability check
  - [ ] 1.6 Update `mobile/src/screens/settings/ProfileSettingsScreen.tsx`: Add username editing with same validation and uniqueness check
  - [ ] 1.7 Update `backend/app/api/profile.py` to validate username uniqueness on profile update
  - [ ] 1.8 Write test `backend/tests/test_users.py::test_username_availability_check` - verify case-insensitive check works
  - [ ] 1.9 Write test for username validation regex in mobile (valid/invalid inputs)

- [ ] 2.0 **Database Schema & Migrations** - Create new tables (`user_follow`, `user_block`, `pending_invite`, `activity_feed`, `leaderboard_stats`, `country_stats`) with RLS policies and triggers
  - [ ] 2.1 Create migration `XXXX_social_tables.sql`: `user_follow` table with `follower_id`, `following_id`, unique constraint, indexes on both columns
  - [ ] 2.2 Add `user_block` table in same migration with `blocker_id`, `blocked_id`, unique constraint, bidirectional indexes
  - [ ] 2.3 Add `pending_invite` table with `inviter_id`, `email`, `invite_type`, `trip_id`, unique constraint using COALESCE for NULL trip_id
  - [ ] 2.4 Create RLS policies for `user_follow`: SELECT where user is follower OR following, INSERT/DELETE where user is follower, check block doesn't exist
  - [ ] 2.5 Create RLS policies for `user_block`: SELECT/INSERT/DELETE where user is blocker only
  - [ ] 2.6 Create helper function `is_blocked(p_user_id UUID)` as SECURITY DEFINER checking both directions
  - [ ] 2.7 Create helper function `is_following(p_user_id UUID)` as SECURITY DEFINER
  - [ ] 2.8 Create migration `XXXX_activity_feed.sql`: `activity_feed` table with `user_id`, `activity_type`, `country_id`, `trip_id`, `entry_id`, index on `(user_id, created_at DESC)`
  - [ ] 2.9 Add trigger on `user_countries` INSERT to create `country_visited` activity
  - [ ] 2.10 Add trigger on `entry` INSERT to create `entry_added` activity
  - [ ] 2.11 Create migration `XXXX_leaderboard_stats.sql`: `leaderboard_stats` table with `total_countries`, `region_counts`, `rarity_score`, `recent_activity_score`, `computed_at`
  - [ ] 2.12 Add `country_stats` table with `visitor_count`, `computed_at` for rarity calculation
  - [ ] 2.13 Create trigger on `user_countries` INSERT/DELETE to update user's `leaderboard_stats`
  - [ ] 2.14 Create trigger to increment/decrement `country_stats.visitor_count` on `user_countries` changes
  - [ ] 2.15 Add `push_token` column to `user_profile` for push notifications
  - [ ] 2.16 Remove `date_range` column from `trip` table (FR-07)

- [ ] 3.0 **Follow System Backend** - Implement follow/unfollow API endpoints, user search, and user profile viewing with block filtering
  - [ ] 3.1 Create `backend/app/schemas/users.py` with `UserSummary` (id, username, avatar_url, country_count, is_following) and `UserProfile` (extends with trips, stats)
  - [ ] 3.2 Create `backend/app/schemas/follows.py` with `FollowStats` (following_count, followers_count)
  - [ ] 3.3 Create `backend/app/api/follows.py` with router, register in `backend/app/api/__init__.py`
  - [ ] 3.4 Implement `POST /follows/{user_id}` - create follow record, return 201 or 409 if exists, check block first
  - [ ] 3.5 Implement `DELETE /follows/{user_id}` - delete follow record, return 204
  - [ ] 3.6 Implement `GET /follows/following` - list users current user follows with pagination (limit/offset), include pending invites
  - [ ] 3.7 Implement `GET /follows/followers` - list users who follow current user with pagination
  - [ ] 3.8 Implement `GET /follows/stats` - return following_count and followers_count
  - [ ] 3.9 Create `backend/app/api/users.py` with router, register in `backend/app/api/__init__.py`
  - [ ] 3.10 Implement `GET /users/search?q={query}` - prefix match on username OR exact email match, exclude blocked users, rate limit 30/min
  - [ ] 3.11 Implement `GET /users/{username}/profile` - return full profile with stats, countries, trips, 404 if blocked
  - [ ] 3.12 Write tests `backend/tests/test_follows.py`: test follow, unfollow, follow counts, blocked user cannot follow
  - [ ] 3.13 Write tests `backend/tests/test_users.py`: test search by username, search by email, blocked user excluded

- [ ] 4.0 **Follow System Mobile** - Build FriendsScreen with user search (reusing PassportSearchBar pattern), UserCard component, and follow/unfollow functionality
  - [ ] 4.1 Create `mobile/src/hooks/useFollows.ts` with `useFollowing()`, `useFollowers()`, `useFollowStats()`, `useFollowMutation()`, `useUnfollowMutation()` using React Query patterns from `useTrips.ts`
  - [ ] 4.2 Create `mobile/src/hooks/useUserSearch.ts` with 300ms debounce, returns `UserSummary[]`, uses `useQuery` with `enabled: query.length >= 2`
  - [ ] 4.3 Create `mobile/src/components/friends/FollowButton.tsx` - takes `userId`, `isFollowing`, shows "Follow" (primary) or "Following" (outlined), handles optimistic update
  - [ ] 4.4 Create `mobile/src/components/friends/UserCard.tsx` - avatar (reuse existing avatar component), username, country count, FollowButton, onPress navigates to profile
  - [ ] 4.5 Create `mobile/src/components/friends/UserSearchBar.tsx` - **copy PassportSearchBar pattern**, adapt for user search, show UserCard results
  - [ ] 4.6 Create `mobile/src/screens/friends/FriendsScreen.tsx` - layout: FriendsRankingStats (top), UserSearchBar, FeedList (main content)
  - [ ] 4.7 Create `mobile/src/screens/friends/UserProfileScreen.tsx` - header with avatar/username/stats, passport grid (reuse existing), trip list (reuse TripCard)
  - [ ] 4.8 Create `mobile/src/screens/friends/FollowersListScreen.tsx` - tabs for Following/Followers, list of UserCards
  - [ ] 4.9 Update `mobile/src/navigation/MainTabNavigator.tsx` - point Friends tab to FriendsScreen
  - [ ] 4.10 Add navigation types for new screens in `mobile/src/navigation/types.ts`
  - [ ] 4.11 Write test `mobile/src/__tests__/components/FollowButton.test.tsx` - test toggle states, optimistic update

- [ ] 5.0 **Activity Feed Backend** - Create feed generation triggers and paginated feed API endpoint
  - [ ] 5.1 Create `backend/app/schemas/feed.py` with `FeedItem` (id, user: UserSummary, activity_type, country, entry, trip_id, created_at)
  - [ ] 5.2 Create `backend/app/api/feed.py` with router, register in `__init__.py`
  - [ ] 5.3 Implement `GET /feed?before={timestamp}&limit=20` - cursor-based pagination, join with `user_follow` to get activities from followed users, exclude blocked
  - [ ] 5.4 For `entry_added` activities, join with `entry` table to get full entry details (photo, name, location, type)
  - [ ] 5.5 For `country_visited` activities, join with `country` table to get country details
  - [ ] 5.6 Write test `backend/tests/test_feed.py`: test pagination, test only followed users appear, test blocked users excluded

- [ ] 6.0 **Activity Feed Mobile** - Build FeedList and FeedItem components (reusing entry card patterns) with infinite scroll
  - [ ] 6.1 Create `mobile/src/hooks/useFeed.ts` with `useInfiniteQuery` pattern, cursor-based pagination using `created_at`, refetch on pull-to-refresh
  - [ ] 6.2 Create `mobile/src/components/friends/FeedItem.tsx` - **reuse EntryCard patterns**: user avatar+username (small, top), entry photo (large), entry name, location, type indicator, tappable to navigate
  - [ ] 6.3 Create `mobile/src/components/friends/FeedList.tsx` - FlatList with `onEndReached` for infinite scroll, `refreshControl` for pull-to-refresh, keyExtractor using feed item id
  - [ ] 6.4 Create `mobile/src/components/friends/EmptyFeedState.tsx` - friendly message when no activity or not following anyone
  - [ ] 6.5 Integrate FeedList into FriendsScreen below search bar
  - [ ] 6.6 Handle navigation from FeedItem tap to entry/trip detail (read-only mode for other users' content)

- [ ] 7.0 **Friends Ranking Stats** - Implement stats computation trigger and on-demand ranking API, plus stats display at top of Friends screen (reusing StatBox pattern)
  - [ ] 7.1 Verify trigger from 2.13 correctly computes `total_countries` on `user_countries` changes
  - [ ] 7.2 Implement rarity score computation in trigger: `SUM(1.0 / NULLIF(cs.visitor_count, 0))` joining `country_stats`
  - [ ] 7.3 Create `backend/app/api/stats.py` with router, register in `__init__.py`
  - [ ] 7.4 Implement `GET /stats/friends-ranking` - compute rank among users current user follows: query `leaderboard_stats` for followed users, rank by `total_countries`, return `{rank, total_friends, total_countries, rarity_score}`
  - [ ] 7.5 Create `mobile/src/hooks/useFriendsRanking.ts` using `useQuery`, refetch on focus
  - [ ] 7.6 Create `mobile/src/components/friends/FriendsRankingStats.tsx` - **reuse StatBox component directly**, display: rank among friends, total countries, rarity score
  - [ ] 7.7 Integrate FriendsRankingStats at top of FriendsScreen (before search bar)
  - [ ] 7.8 Handle empty state when user follows nobody

- [ ] 8.0 **Blocking System** - Add block/unblock API endpoints and mobile UI in user profile overflow menu
  - [ ] 8.1 Create `backend/app/api/blocks.py` with router, register in `__init__.py`
  - [ ] 8.2 Implement `POST /blocks/{user_id}` - create block, also DELETE any follow relationships (both directions), return 201
  - [ ] 8.3 Implement `DELETE /blocks/{user_id}` - remove block, return 204
  - [ ] 8.4 Implement `GET /blocks` - list blocked users with pagination
  - [ ] 8.5 Create `mobile/src/hooks/useBlocks.ts` with `useBlockMutation()`, `useUnblockMutation()`, `useBlockedUsers()`
  - [ ] 8.6 Add block option to UserProfileScreen overflow menu (three dots icon), show confirmation dialog
  - [ ] 8.7 Add blocked users list to ProfileSettingsScreen under privacy section
  - [ ] 8.8 Write test `backend/tests/test_blocks.py`: test block removes follows, blocked user can't search blocker

- [ ] 9.0 **Email Invites** - Implement pending invite system with Resend integration via Supabase Edge Functions
  - [ ] 9.1 Create `backend/app/api/invites.py` with router, register in `__init__.py`
  - [ ] 9.2 Implement `POST /invites` - create pending_invite record, rate limit 10/hour
  - [ ] 9.3 Implement `GET /invites/pending` - list pending invites sent by current user
  - [ ] 9.4 Create Supabase Edge Function `send-invite-email` that calls Resend API with branded template
  - [ ] 9.5 Trigger Edge Function from backend after creating pending_invite (use pg_notify or direct call)
  - [ ] 9.6 Create Supabase Edge Function `process-signup-invites` triggered on new user signup - check pending_invites by email, auto-create follows
  - [ ] 9.7 Update mobile: when email search returns no user, show "Invite" button that calls `POST /invites`
  - [ ] 9.8 Show pending invites in Following list with "Pending" badge

- [ ] 10.0 **Push Notifications** - Integrate Expo Push Notifications for new follower and trip tag events
  - [ ] 10.1 Add `expo-notifications` to mobile app if not already present
  - [ ] 10.2 Create `mobile/src/services/pushNotifications.ts` - register for push token, save to backend
  - [ ] 10.3 Create `backend/app/api/notifications.py` endpoint `POST /notifications/register` to save push token to `user_profile.push_token`
  - [ ] 10.4 Create Supabase Edge Function `send-push-notification` using Expo Push API
  - [ ] 10.5 Trigger push notification on new follow: call Edge Function from `POST /follows/{user_id}` (or use pg_notify trigger)
  - [ ] 10.6 Trigger push notification on trip tag: extend existing trip tag logic
  - [ ] 10.7 Handle notification tap in mobile app - deep link to follower profile or trip detail
  - [ ] 10.8 Add notification permission request during onboarding

- [ ] 11.0 **Trip Visibility & Tagging Integration** - Update trip RLS for follower access, implement auto-follow on trip tag acceptance
  - [ ] 11.1 Update trip RLS policy: trips visible to owner OR approved trip_tags OR any follower (check `user_follow` table)
  - [ ] 11.2 Update entry RLS policy: same visibility rules as parent trip
  - [ ] 11.3 Modify trip tag acceptance logic (`backend/app/api/trips.py`): when user accepts trip tag, auto-create follow relationship (tagged user → tagger)
  - [ ] 11.4 Send notification to tagged user that they now follow the tagger
  - [ ] 11.5 Update `POST /invites` with `invite_type: 'trip_tag'` to create both pending_invite and pending trip tag
  - [ ] 11.6 On signup, process both pending follows and pending trip tags (trip tags still need approval)
  - [ ] 11.7 Write test: verify follower can view trip after following, verify auto-follow on trip tag acceptance

