/**
 * Centralized query keys for social features.
 *
 * Every social hook (and the social-home prefetch in App.tsx) derives its
 * query keys from this module so mutations can surgically target the caches
 * users actually see instead of firing broad invalidation storms.
 */
export const socialKeys = {
  /** Root of all follow-related queries. */
  follows: ['follows'] as const,
  /** Users the current user follows (all pages). */
  following: ['follows', 'following'] as const,
  followingPage: (limit: number, offset: number) =>
    ['follows', 'following', { limit, offset }] as const,
  /** Infinite offset-paged following list (one cache for all pages). */
  followingInfinite: (limit: number) => ['follows', 'following', 'infinite', { limit }] as const,
  /** Users following the current user (all pages). */
  followers: ['follows', 'followers'] as const,
  followersPage: (limit: number, offset: number) =>
    ['follows', 'followers', { limit, offset }] as const,
  /** Infinite offset-paged followers list (one cache for all pages). */
  followersInfinite: (limit: number) => ['follows', 'followers', 'infinite', { limit }] as const,

  /** Combined social-home payload (feed + stats + ranking + pending badge). */
  socialHome: ['social-home'] as const,
  socialHomePage: (limit: number) => ['social-home', { limit }] as const,

  /** A specific user's activity feed. */
  userFeed: (userId: string) => ['user-feed', userId] as const,
  userFeedPage: (userId: string, limit: number) => ['user-feed', userId, { limit }] as const,

  /** A user's public profile, keyed by username. */
  userProfile: (username: string) => ['user', username, 'profile'] as const,

  /** Username-prefix search (all cached queries). */
  userSearch: ['users', 'search'] as const,
  userSearchQuery: (query: string, limit: number) => ['users', 'search', query, limit] as const,
  /** Lookup a user by exact email. */
  userLookupByEmail: (email: string) => ['users', 'lookup-by-email', email] as const,

  /** Blocked users. */
  blocks: ['blocks'] as const,
  blocksPage: (limit: number, offset: number) => ['blocks', { limit, offset }] as const,

  /** Pending trip-tag invitations (list). */
  pendingTags: ['trip-tags', 'pending'] as const,
  /** Pending trip-tag badge count. */
  pendingTagCount: ['trip-tags', 'pending', 'count'] as const,

  /** Invites. */
  invites: ['invites'] as const,
  pendingInvites: (limit: number, offset: number) =>
    ['invites', 'pending', { limit, offset }] as const,
  tripInvites: (tripId: string | undefined) => ['invites', 'trip', tripId] as const,
};
