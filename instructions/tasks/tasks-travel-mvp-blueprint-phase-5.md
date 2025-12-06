## Relevant Files

- `backend/app/api/friends.py` - FastAPI router for friend search, sending requests, accepting/rejecting, and listing friends and pending requests (PRD friend connections `docs/travel-prd.md` L125–135, L281–285, US-013/014 L475–489; `docs/travel-technical-design.md` L575–583).
- `backend/app/schemas/friends.py` - Pydantic models for friend search results, friend request payloads/responses, and friend list items.
- `backend/app/models/friends.sql` or `infra/supabase/migrations/0003_friends.sql` - Supabase migration defining friend graph tables (e.g., `friend_requests` and/or `friends`) consistent with social assumptions in `docs/travel-technical-design.md` L575–583.
- `backend/app/api/trips.py` - Existing trip/tag routes (`/trips`, `/trips/:id`, `/trips/:id/approve`, `/trips/:id/decline`) implementing the consent state machine and visibility rules described in `docs/travel-technical-design.md` L279–360, L472–485, L549–555.
- `backend/app/core/notifications.py` - Notification helper module created in Phase 1; extended here to support notification payloads for friend requests and trip-tag events (`docs/travel-technical-design.md` L499–511).
- `backend/app/api/notifications.py` - New router for listing in-app notifications, marking them as read, and optionally dismissing them (PRD notifications `docs/travel-prd.md` L181–189, US-015 L491–497).
- `backend/app/schemas/notifications.py` - Pydantic models for in-app notification items and update payloads.
- `backend/tests/test_friends.py` - Backend tests covering friend search, sending/accepting/rejecting requests, and enforcing access rules.
- `backend/tests/test_trip_consent_and_visibility.py` - Backend tests covering trip tagging approval/decline flows, consent state transitions, visibility behavior, and notification triggering (`docs/travel-technical-design.md` L472–485, L549–555).
- `backend/tests/test_notifications.py` - Backend tests for notification enqueueing, listing, and marking as read, plus basic error cases for malformed payloads.
- `mobile/src/navigation/index.tsx` - Navigation entry point; will be updated to include friend search/requests screens and the notification center from the Friends tab.
- `mobile/src/navigation/types.ts` - Route and param list types extended for new Phase 5 screens (friend search, friend requests, notification center).
- `mobile/src/screens/Tabs/FriendsScreen.tsx` - Main Friends tab surface providing entry points for friend search, friend list, and friend requests (PRD core experience `docs/travel-prd.md` L281–285).
- `mobile/src/screens/Friends/FriendSearchScreen.tsx` - Screen for searching by username/email and sending friend requests (US-013 `docs/travel-prd.md` L475–481).
- `mobile/src/screens/Friends/FriendRequestsScreen.tsx` - Screen listing incoming and outgoing friend requests with accept/reject actions (US-014 `docs/travel-prd.md` L483–489).
- `mobile/src/screens/Friends/FriendProfileScreen.tsx` - Optional lightweight profile view for a friend with country count and key stats (PRD L133–133).
- `mobile/src/screens/Notifications/NotificationCenterScreen.tsx` - In-app notification center showing friend requests and trip-tag approvals with quick actions (PRD notifications `docs/travel-prd.md` L181–189, US-015 L491–497).
- `mobile/src/api/hooks/useFriends.ts` - React Query hooks for friend search, sending requests, canceling, and accepting/rejecting.
- `mobile/src/api/hooks/useNotifications.ts` - Hooks for listing notifications, marking as read, and updating local cache after actions.
- `mobile/src/api/hooks/useTrips.ts` - Extended to expose trip consent status (from `trip_tags.status`) so the UI can show pending vs approved vs declined trips.
- `mobile/src/state/authStore.ts` - Source of current user ID and auth token used by friend and notification hooks to scope data to the logged-in user.
- `mobile/src/__tests__/flows/FriendsAndConsentFlow.test.tsx` - Integration-style test covering adding a friend, tagging them on a trip, approving the tag, and verifying visibility.
- `mobile/src/__tests__/screens/NotificationCenterScreen.test.tsx` - Tests for displaying notifications, taking approve/reject actions, and ensuring UI updates correctly.

### Notes

- Phase 5 delivers the **social layer, consent workflow, and notifications** described in `docs/travel-mvp-blueprint.md` §9 (L440–488), addressing PRD user stories **US-006/007/013/014/015** (`docs/travel-prd.md` L419–433, L475–497).
- The friend graph schema is not fully specified in the technical design, but should follow the social/consent assumptions in `docs/travel-technical-design.md` L575–583 and respect RLS and privacy constraints (L81–82, L603–607).
- Trip tagging and approval flows must exactly follow the consent state machine and notification notes in `docs/travel-technical-design.md` L121–130, L279–360, L472–485, L499–511.
- Notification delivery will use a **minimal provider integration** (e.g., a single push/email provider) while keeping the abstraction in `backend/app/core/notifications.py` so that future phases can swap or add providers without touching core business logic.

## Tasks

- [ ] 1.0 Design and implement friend graph schema and backend endpoints (search, request, accept/reject, list)
  - [ ] 1.1 Design the friend model(s) supporting US-013/014 using `docs/travel-technical-design.md` L575–583 as guidance (e.g., `friend_requests` table for pending invites and a `friends` or status-based relationship table), and write a Supabase migration in `infra/supabase/migrations/0003_friends.sql`.
  - [ ] 1.2 Ensure the schema captures at least: requester, recipient, status (`pending`/`accepted`/`declined`), created_at, responded_at, and optional notification metadata (e.g., IDs for sent notifications).
  - [ ] 1.3 Add RLS policies for the friend tables so that only involved users (requester or recipient) can see or modify a given friendship row, and admins retain elevated access for moderation (consistent with RLS principles in `docs/travel-technical-design.md` L81–82, L603–607).
  - [ ] 1.4 Implement `backend/app/schemas/friends.py` with Pydantic models for friend search results, friend request create/response payloads, and friend list items returned by the API.
  - [ ] 1.5 Implement `backend/app/api/friends.py` with routes for:
    - `GET /friends/search?query=` to search by username/email (PRD L127–129).
    - `POST /friends/requests` to send a friend request (US-013 `docs/travel-prd.md` L475–481).
    - `GET /friends/requests` to list incoming and outgoing pending requests.
    - `POST /friends/requests/:id/accept` and `/friends/requests/:id/decline` to accept/reject requests (US-014 L483–489).
    - `GET /friends` to list accepted friends and basic stats (e.g., country count, shared trips).
  - [ ] 1.6 Ensure all friend endpoints return the standard error format from `docs/travel-technical-design.md` L486–495 and respect JWT-based auth from Phase 1 (US-017).

- [ ] 2.0 Build mobile friend UI flows: friend search, requests list, and basic friend profile stats
  - [ ] 2.1 Extend `mobile/src/navigation/types.ts` and `navigation/index.tsx` to include routes for `FriendSearchScreen`, `FriendRequestsScreen`, and (optionally) `FriendProfileScreen` accessible through the Friends tab.
  - [ ] 2.2 Implement `FriendsScreen` as a hub that surfaces: summary of friend count, quick link to search, quick link to requests, and optionally a short list of top friends with their country counts (PRD L133–133).
  - [ ] 2.3 Implement `FriendSearchScreen` UI to search by username/email using `useFriends().search`, show results with a clear “Add friend” button, and handle success/error states consistent with US-013 acceptance criteria.
  - [ ] 2.4 Implement `FriendRequestsScreen` that lists incoming and outgoing friend requests, with clear affordances for accepting or rejecting incoming requests (US-014) and visual states for pending vs accepted vs declined.
  - [ ] 2.5 Implement a minimal `FriendProfileScreen` or inline friend detail panel showing a friend’s basic stats (country count, confirmed trips) using data provided by backend friend endpoints and existing trips/countries hooks.
  - [ ] 2.6 Ensure the Friends flows reuse shared UI primitives (`Screen`, `Text`, `Button`) and feel coherent with the rest of the app, keeping visual polish minimal until Phase 8.

- [ ] 3.0 Complete trip tagging & consent workflow end-to-end on backend and mobile
  - [ ] 3.1 Review trip-tag consent requirements in PRD (social approval system `docs/travel-prd.md` L135–143, L257–263; US-006/007 L419–433) and consent state machine details in `docs/travel-technical-design.md` L121–130, L328–360, L472–485, and sync any gaps with existing Phase 1/4 implementations.
  - [ ] 3.2 Ensure `trip_tags` schema and RLS policies enforce that only the trip owner and the tagged user can view/change consent status, and that only the tagged user can change their own status from `pending` to `approved` or `declined`.
  - [ ] 3.3 In `backend/app/api/trips.py`, verify or implement:
    - Trip creation with `tagged_user_ids` auto-creates `trip_tags` rows with `status = 'pending'` and triggers notification hooks for each tagged user (`docs/travel-technical-design.md` L279–313, L472–483, L499–511).
    - `/trips/:id/approve` and `/trips/:id/decline` update the `trip_tags` row for the current user, set `responded_at`, and return 409 conflicts if the tag was already actioned.
  - [ ] 3.4 Update `useTrips` (and possibly a `useTripTags` helper) to expose consent status for a given trip and to provide hooks for calling the approve/decline endpoints, updating local React Query caches accordingly.
  - [ ] 3.5 Update trip-related UIs (e.g., trip cards in `CountryDetailScreen`, `TripDetailScreen`) to:
    - Show a clear indicator when the current user is tagged and the trip is **pending** their approval.
    - Show an approved state once consent is granted.
    - Hide trips from the tagged user’s lists until they approve, consistent with PRD visibility rules (L137–141, L259–263).
  - [ ] 3.6 Add inline entry points in relevant screens (notification center, trip detail) that allow the tagged user to approve or decline directly, wiring these actions to `useTripTags` update functions.

- [ ] 4.0 Implement in-app notification center and connect it to friend + trip-tag events
  - [ ] 4.1 Define a simple internal notification model in `backend/app/schemas/notifications.py` (e.g., `type`, `title`, `body`, `entity_type`, `entity_id`, `created_at`, `read_at`), aligning event types with PRD notifications (friend request, trip tagged) and technical design notes (`docs/travel-technical-design.md` L499–511).
  - [ ] 4.2 Extend `backend/app/core/notifications.py` so that friend and trip-tag events enqueue a notification record (e.g., in a `notifications` table) for the relevant user(s), in addition to any push/email delivery.
  - [ ] 4.3 Implement `backend/app/api/notifications.py` with:
    - `GET /notifications` to list notifications for the current user (most recent first).
    - `POST /notifications/:id/read` (or `PATCH`) to mark a notification as read.
    - Optional bulk mark-as-read endpoint for all notifications.
  - [ ] 4.4 Implement `useNotifications` hooks on the mobile side for fetching notifications, marking them as read, and keeping the list up to date via React Query (polling or refetch on focus).
  - [ ] 4.5 Implement `NotificationCenterScreen` to:
    - Display a list of notifications grouped by type (friend requests, trip tags).
    - Provide in-line actions where appropriate (e.g., approve/decline friend request or trip tag) that call the relevant friend/trip endpoints.
    - Provide basic empty/error states when there are no notifications or when fetch fails.
  - [ ] 4.6 Add notification badges or indicators in the tab bar (Friends or a dedicated Notifications icon) to show when the user has unread notifications, using data from `useNotifications`.

- [ ] 5.0 Wire push/email notification delivery using existing notification hooks and a minimal provider integration
  - [ ] 5.1 Choose a minimal push notification provider (e.g., Expo push notifications for mobile) and a basic transactional email provider (e.g., SendGrid, Postmark), consistent with integration notes in `docs/travel-prd.md` L181–189 and `docs/travel-technical-design.md` L499–511.
  - [ ] 5.2 Extend `backend/app/core/notifications.py` with provider-specific clients or adapters that can send:
    - Push notifications for friend requests and trip tags.
    - Emails for the same events, using templates that match PRD expectations (L181–189, L259–263, L281–285).
  - [ ] 5.3 Update friend and trip-tag endpoints so they call the notification helper with enough context (recipient user ID/email, type, entity reference) to construct clear messages without leaking private data.
  - [ ] 5.4 Implement basic error handling and logging in the notification helper so that transient provider failures are recorded but do not break the main request flow (e.g., friend request still creates successfully even if email fails).
  - [ ] 5.5 Add configuration options (env flags) to enable/disable push/email sending per environment (dev/staging/prod), and document how to test notifications locally and in a staging environment.

- [ ] 6.0 Enforce privacy and visibility rules for trips and entries across backend and mobile UIs, with tests
  - [ ] 6.1 Review privacy and visibility requirements from PRD (default private trips, consent-based visibility `docs/travel-prd.md` L135–143, L249–263) and security/scoping requirements from the technical design (`docs/travel-technical-design.md` L81–82, L603–607).
  - [ ] 6.2 Ensure that all trip/entry queries on the backend (e.g., `/trips`, `/trips/:id`, `/trips/:trip_id/entries`) enforce that:
    - Only the trip owner or approved tagged users can view a trip and its entries.
    - Pending or declined tags do not reveal full trip details to tagged users (only owner sees pending).
  - [ ] 6.3 Update any existing Supabase RLS policies or views as needed to enforce these rules at the data layer and not just in application logic.
  - [ ] 6.4 Implement or update `backend/tests/test_trip_consent_and_visibility.py` to cover edge cases:
    - Attempting to view a trip when tagged but still `pending`.
    - Viewing a declined trip as the tagged user.
    - Ensuring that joint stats and shared views only count approved trips.
  - [ ] 6.5 Implement or update `backend/tests/test_notifications.py` to assert that notifications are only created and delivered to relevant users, and that sensitive trip details are not over-exposed in notification payloads.
  - [ ] 6.6 Implement mobile tests in `FriendsAndConsentFlow.test.tsx` to simulate:
    - Sending a friend request and accepting it.
    - Creating a trip, tagging the friend, and seeing pending/approved states in the UI.
    - Confirming that before approval, the tagged user does not see the trip in their own lists, and after approval, it appears as expected.
  - [ ] 6.7 Run backend and mobile test suites to ensure all new social/consent/notification logic is covered and does not break existing flows from earlier phases.
