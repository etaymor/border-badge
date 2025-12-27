# feat: Implement Travel Companions Tagging in Trip Form

## Overview

Replace the placeholder "Travel Companions" section in `TripFormScreen.tsx` (lines 275-289) with real functionality that allows users to tag friends when creating or editing trips. The backend API and database schema already fully support this feature - only the mobile UI needs implementation.

## Problem Statement / Motivation

Currently, the TripFormScreen displays a "VISA PENDING" placeholder that teases the travel companions feature as "coming in the next update." However:

1. The database schema (`trip_tags` table) is fully implemented with consent workflow states (pending/approved/declined)
2. The backend API already accepts `tagged_user_ids` in the `TripCreate` schema
3. The friends/social system has reusable components (`UserSearchBar`, `UserAvatar`, `FollowButton`)
4. Users expect to be able to tag travel companions - it's a core social feature

This creates a gap between backend capability and frontend functionality that needs to be closed.

## Proposed Solution

Implement an inline companion selector section that:
1. Shows the user's following list as selectable companions
2. Allows multi-select with visual chip/pill display
3. Passes `tagged_user_ids` to the create/update trip mutations
4. Displays existing tags with their approval status when editing

### UI Pattern: Inline Expandable Section

Based on the existing TripFormScreen patterns and mobile UX best practices, use an **inline section** approach rather than a modal:
- Consistent with other form sections (destination picker, cover photo)
- Avoids modal fatigue on an already form-heavy screen
- Users following list is typically small enough for inline display

## Technical Approach

### Architecture

```
TripFormScreen
└── TravelCompanionsSection (new)
    ├── CompanionChips (horizontal scroll of selected)
    ├── CompanionPicker (expandable list)
    │   ├── SearchInput (filter following list)
    │   └── SelectableUserList
    │       └── SelectableUserItem (UserAvatar + checkbox)
    └── EmptyState (if no follows)
```

### Data Flow

```
┌──────────────────────────────────────────────────────────────────────┐
│ TripFormScreen                                                        │
│                                                                       │
│  State: selectedCompanionIds: Set<string>                            │
│                                                                       │
│  ┌─────────────────────────┐     ┌─────────────────────────────────┐ │
│  │ TravelCompanionsSection │     │ useFollowing() hook             │ │
│  │                         │◄────│ Returns: UserSummary[]          │ │
│  │ - Display chips         │     └─────────────────────────────────┘ │
│  │ - Toggle selection      │                                         │
│  └─────────────────────────┘     ┌─────────────────────────────────┐ │
│                                  │ useTrip() hook (edit mode)      │ │
│                                  │ Returns: Trip with trip_tags?   │ │
│                                  └─────────────────────────────────┘ │
│                                                                       │
│  handleSave():                                                       │
│    createTrip.mutateAsync({                                          │
│      ...tripData,                                                    │
│      tagged_user_ids: Array.from(selectedCompanionIds)               │
│    })                                                                │
└──────────────────────────────────────────────────────────────────────┘
```

### Implementation Phases

#### Phase 1: Component Structure
- Create `TravelCompanionsSection.tsx` component
- Create `CompanionChip.tsx` for selected user display
- Create `SelectableUserItem.tsx` for list items

#### Phase 2: Selection Logic
- Integrate `useFollowing()` hook
- Implement multi-select state management
- Add search/filter functionality

#### Phase 3: Form Integration
- Wire selected companions to form state
- Pass `tagged_user_ids` to mutations
- Handle loading states

#### Phase 4: Edit Mode Support
- Fetch existing trip_tags when editing
- Display approval status badges
- Handle add/remove operations

## Acceptance Criteria

### Functional Requirements

- [ ] User can select companions from their following list when creating a trip
- [ ] Selected companions appear as removable chips above the selection list
- [ ] User can search/filter their following list by username
- [ ] Empty state shown when user has no follows with CTA to Friends tab
- [ ] Selected companion IDs passed to `useCreateTrip` mutation
- [ ] When editing, existing tagged companions shown with status badges
- [ ] User can add new companions to existing trip
- [ ] User can remove companions from existing trip

### Non-Functional Requirements

- [ ] Selection list performs smoothly with 100+ follows (virtualized list)
- [ ] Chips scroll horizontally when many companions selected
- [ ] Follows existing design system (colors, fonts, glass effects)
- [ ] Accessibility: screen reader announces selection changes

### Quality Gates

- [ ] No new ESLint errors introduced
- [ ] Components follow existing code patterns
- [ ] TypeScript types properly defined

## Technical Considerations

### Existing Infrastructure to Reuse

| Component/Hook | Location | Purpose |
|---------------|----------|---------|
| `useFollowing()` | `mobile/src/hooks/useFollows.ts` | Get user's following list |
| `useCreateTrip()` | `mobile/src/hooks/useTrips.ts` | Already accepts `tagged_user_ids` |
| `UserAvatar` | `mobile/src/components/friends/UserAvatar.tsx` | Display user avatars |
| `SearchInput` | `mobile/src/components/ui/SearchInput.tsx` | Debounced search field |
| Glass styling | `TripFormScreen.tsx` | Existing blur/glass effects |

### Type Definitions

```typescript
// Already exists in useTrips.ts
interface CreateTripInput {
  name: string;
  country_code: string;
  cover_image_url?: string;
  tagged_user_ids?: string[];  // <-- This is what we'll populate
}

// From useFollows.ts
interface UserSummary {
  id: string;
  username: string;
  avatar_url: string | null;
  country_count: number;
  is_following: boolean;
}
```

### Database Schema (Already Exists)

```sql
-- From 0001_init_schema.sql
CREATE TYPE trip_tag_status AS ENUM ('pending', 'approved', 'declined');

CREATE TABLE trip_tags (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  trip_id UUID NOT NULL REFERENCES trip(id) ON DELETE CASCADE,
  tagged_user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  status trip_tag_status NOT NULL DEFAULT 'pending',
  initiated_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  notification_id TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  responded_at TIMESTAMPTZ,
  UNIQUE(trip_id, tagged_user_id)
);
```

### Backend API (Already Exists)

- `POST /trips` - Creates trip with `tagged_user_ids`, auto-creates trip_tags
- `PUT /trips/{id}` - Update trip (may need enhancement for tag updates)
- `POST /trips/{id}/approve` - Tagged user approves tag
- `POST /trips/{id}/decline` - Tagged user declines tag

## Dependencies & Risks

### Dependencies

| Dependency | Status | Impact |
|------------|--------|--------|
| `useFollowing()` hook | Implemented | Provides user list for selection |
| Backend `tagged_user_ids` support | Implemented | Handles tag creation |
| `trip_tags` table | Implemented | Stores tag records |
| Notification system | Implemented | Notifies tagged users |

### Risks

| Risk | Likelihood | Mitigation |
|------|-----------|------------|
| Edit mode trip_tags not included in Trip response | Medium | Query `useTrip()` response shape; add separate hook if needed |
| Large following lists cause performance issues | Low | Use FlatList with `getItemLayout`, limit visible items |
| Re-tagging declined users causes confusion | Low | Allow re-tag (user can decline again); consider hiding declined in future |

## MVP

### Files to Create

#### mobile/src/components/trips/TravelCompanionsSection.tsx

```typescript
import { useState, useMemo } from 'react';
import { View, Text, FlatList, StyleSheet, ScrollView } from 'react-native';
import { BlurView } from 'expo-blur';

import { useFollowing } from '@hooks/useFollows';
import { UserAvatar } from '@components/friends/UserAvatar';
import { SearchInput } from '@components/ui';
import { colors } from '@constants/colors';
import { fonts } from '@constants/typography';

import { CompanionChip } from './CompanionChip';
import { SelectableUserItem } from './SelectableUserItem';

interface TravelCompanionsSectionProps {
  selectedIds: Set<string>;
  onToggleSelection: (userId: string) => void;
  existingTags?: Array<{ user_id: string; status: string; user: { username: string; avatar_url: string | null } }>;
}

export function TravelCompanionsSection({
  selectedIds,
  onToggleSelection,
  existingTags = [],
}: TravelCompanionsSectionProps) {
  const [search, setSearch] = useState('');
  const [isExpanded, setIsExpanded] = useState(false);

  const { data: following = [], isLoading } = useFollowing();

  const filteredFollowing = useMemo(() => {
    if (!search) return following;
    const query = search.toLowerCase();
    return following.filter(user =>
      user.username.toLowerCase().includes(query)
    );
  }, [following, search]);

  // Get selected user objects for chips
  const selectedUsers = useMemo(() => {
    return following.filter(user => selectedIds.has(user.id));
  }, [following, selectedIds]);

  if (following.length === 0 && !isLoading) {
    return <EmptyState />;
  }

  return (
    <View style={styles.container}>
      <Text style={styles.label}>TRAVEL COMPANIONS</Text>

      {/* Selected companions chips */}
      {selectedUsers.length > 0 && (
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          style={styles.chipsContainer}
        >
          {selectedUsers.map(user => (
            <CompanionChip
              key={user.id}
              user={user}
              onRemove={() => onToggleSelection(user.id)}
            />
          ))}
        </ScrollView>
      )}

      {/* Expandable picker */}
      <TouchableOpacity
        style={styles.pickerTrigger}
        onPress={() => setIsExpanded(!isExpanded)}
      >
        <Text style={styles.pickerText}>
          {selectedIds.size === 0
            ? 'Tag friends who traveled with you'
            : `${selectedIds.size} companion${selectedIds.size > 1 ? 's' : ''} selected`}
        </Text>
        <Ionicons
          name={isExpanded ? 'chevron-up' : 'chevron-down'}
          size={20}
          color={colors.textSecondary}
        />
      </TouchableOpacity>

      {isExpanded && (
        <View style={styles.pickerContent}>
          <SearchInput
            value={search}
            onChangeText={setSearch}
            placeholder="Search following..."
          />
          <FlatList
            data={filteredFollowing}
            keyExtractor={item => item.id}
            renderItem={({ item }) => (
              <SelectableUserItem
                user={item}
                isSelected={selectedIds.has(item.id)}
                onToggle={() => onToggleSelection(item.id)}
              />
            )}
            style={styles.list}
            keyboardShouldPersistTaps="handled"
          />
        </View>
      )}
    </View>
  );
}
```

#### mobile/src/components/trips/CompanionChip.tsx

```typescript
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';

import { UserAvatar } from '@components/friends/UserAvatar';
import { colors } from '@constants/colors';
import { fonts } from '@constants/typography';

interface CompanionChipProps {
  user: { id: string; username: string; avatar_url: string | null };
  status?: 'pending' | 'approved' | 'declined';
  onRemove?: () => void;
}

export function CompanionChip({ user, status, onRemove }: CompanionChipProps) {
  return (
    <View style={[styles.chip, status && styles[`chip_${status}`]]}>
      <UserAvatar
        avatarUrl={user.avatar_url}
        username={user.username}
        size={24}
      />
      <Text style={styles.username}>@{user.username}</Text>
      {status && <StatusBadge status={status} />}
      {onRemove && (
        <TouchableOpacity onPress={onRemove} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
          <Ionicons name="close-circle" size={18} color={colors.textSecondary} />
        </TouchableOpacity>
      )}
    </View>
  );
}

function StatusBadge({ status }: { status: string }) {
  const config = {
    pending: { color: colors.sunsetGold, label: 'Pending' },
    approved: { color: colors.mossGreen, label: 'Approved' },
    declined: { color: colors.textSecondary, label: 'Declined' },
  }[status] || { color: colors.textSecondary, label: status };

  return (
    <View style={[styles.badge, { backgroundColor: config.color }]}>
      <Text style={styles.badgeText}>{config.label}</Text>
    </View>
  );
}
```

#### mobile/src/components/trips/SelectableUserItem.tsx

```typescript
import { memo } from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';

import { UserAvatar } from '@components/friends/UserAvatar';
import { colors } from '@constants/colors';
import { fonts } from '@constants/typography';

interface SelectableUserItemProps {
  user: { id: string; username: string; avatar_url: string | null };
  isSelected: boolean;
  onToggle: () => void;
}

export const SelectableUserItem = memo(
  function SelectableUserItem({ user, isSelected, onToggle }: SelectableUserItemProps) {
    return (
      <TouchableOpacity
        style={[styles.item, isSelected && styles.itemSelected]}
        onPress={onToggle}
        activeOpacity={0.7}
      >
        <UserAvatar
          avatarUrl={user.avatar_url}
          username={user.username}
          size={40}
        />
        <Text style={styles.username}>@{user.username}</Text>
        <View style={[styles.checkbox, isSelected && styles.checkboxSelected]}>
          {isSelected && (
            <Ionicons name="checkmark" size={14} color={colors.cloudWhite} />
          )}
        </View>
      </TouchableOpacity>
    );
  },
  (prev, next) => prev.user.id === next.user.id && prev.isSelected === next.isSelected
);
```

### Files to Modify

#### mobile/src/screens/trips/TripFormScreen.tsx

**Changes Required:**

1. Add imports for new components and hooks
2. Add state for `selectedCompanionIds: Set<string>`
3. Replace placeholder section (lines 275-289) with `TravelCompanionsSection`
4. Pass `tagged_user_ids` to `createTrip.mutateAsync()`

```typescript
// Add to imports
import { TravelCompanionsSection } from '@components/trips/TravelCompanionsSection';

// Add to state (after line 45)
const [selectedCompanionIds, setSelectedCompanionIds] = useState<Set<string>>(new Set());

// Add handler
const handleToggleCompanion = (userId: string) => {
  setSelectedCompanionIds(prev => {
    const next = new Set(prev);
    if (next.has(userId)) {
      next.delete(userId);
    } else {
      next.add(userId);
    }
    return next;
  });
};

// Update handleSave (line 132-136)
const newTrip = await createTrip.mutateAsync({
  name: name.trim(),
  country_code: selectedCountryCode!,
  cover_image_url: coverImageUrl.trim() || undefined,
  tagged_user_ids: Array.from(selectedCompanionIds),  // <-- Add this
});

// Replace lines 275-289 with:
<TravelCompanionsSection
  selectedIds={selectedCompanionIds}
  onToggleSelection={handleToggleCompanion}
/>
```

#### mobile/src/components/trips/index.ts (create if not exists)

```typescript
export { TravelCompanionsSection } from './TravelCompanionsSection';
export { CompanionChip } from './CompanionChip';
export { SelectableUserItem } from './SelectableUserItem';
```

## Success Metrics

| Metric | Target | How to Measure |
|--------|--------|---------------|
| Feature adoption | 30% of trips have companions | Analytics: trips with >0 tagged_user_ids |
| Tag approval rate | >70% | Ratio of approved to (approved + declined) |
| Selection completion | <30 seconds | Time from section open to form submit |

## Future Considerations

1. **Real-time status updates**: Subscribe to Supabase Realtime for trip_tags changes
2. **Re-tagging behavior**: Consider hiding permanently declined users
3. **Suggested companions**: Based on previous trips to same country
4. **Mutual follow filter**: Option to only tag mutual follows
5. **Companion limits**: Add max companions per trip if needed for performance

## References & Research

### Internal References

- Database schema: `supabase/migrations/0001_init_schema.sql:84-98` (trip_tags table)
- RLS policies: `supabase/migrations/0002_rls_policies.sql:119-146` (trip_tags policies)
- Backend API: `backend/app/api/trips.py:49-52` (TripCreate with tagged_user_ids)
- Consent workflow: `backend/app/api/trips.py:328-347` (approve/decline endpoints)
- Following hook: `mobile/src/hooks/useFollows.ts` (useFollowing)
- UserAvatar: `mobile/src/components/friends/UserAvatar.tsx`
- UserSearchBar: `mobile/src/components/friends/UserSearchBar.tsx`
- Trip mutations: `mobile/src/hooks/useTrips.ts:91-114` (useCreateTrip)

### External References

- [Instagram Tag Approval Settings](https://help.instagram.com/496738090375985)
- [React Query Optimistic Updates](https://tanstack.com/query/v5/docs/framework/react/guides/optimistic-updates)
- [Privacy by Design Principles](https://www.onetrust.com/blog/principles-of-privacy-by-design/)
- [Mobile UX Best Practices 2025](https://www.thinkroom.com/mobile-ux-best-practices/)

### Related Work

- Friends & Social System Phase 1: `plans/feat-friends-social-phase-1-revised.md`
- Social tables migration: `supabase/migrations/0033_social_tables.sql`
