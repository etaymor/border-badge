# feat: Gate Social Features Behind Feature Flag

## Overview

Implement a single environment variable-controlled feature flag (`ENABLE_SOCIAL_FEATURES`) that hides all social functionality (Friends tab, activity feed, follows, blocks, invites, trip tags) from the app and disables corresponding API endpoints. This allows merging the social feature branches into `main` while keeping the features dormant until the flag is enabled.

## Problem Statement

The `social-updates` and `feature/friends-social-phase-1` branches contain fully implemented social features:
- Friends tab with activity feed
- Follow/unfollow functionality
- User search and profiles
- Trip tagging with consent workflow
- Block/unblock users
- Email invites
- Notifications

These features need to be merged into `main` for code stability and easier maintenance, but should not be visible to users until explicitly enabled via an environment variable.

## Proposed Solution

Use a **build-time environment variable** approach for simplicity:
- Mobile: `EXPO_PUBLIC_ENABLE_SOCIAL=true|false`
- Backend: `ENABLE_SOCIAL_FEATURES=true|false`

Both default to `false` for safety. When disabled:
- Mobile: Friends tab hidden, all social UI components not rendered
- Backend: Social API endpoints return 404 (as if they don't exist)

### Key Design Decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| **Flag delivery** | Build-time ENV var | Simpler than runtime config; can change later if needed |
| **Backend error code** | 404 Not Found | Endpoints appear non-existent; security through obscurity |
| **Data retention** | Keep all data | Never delete social data when flag disabled |
| **Scope** | Global (all users) | No per-user rollout for MVP |
| **Deep link handling** | Navigate to Passport home | Silent fallback with no error modal |

## Technical Approach

### Phase 1: Feature Flag Infrastructure

Create the feature flag utilities in both mobile and backend.

#### mobile/src/config/features.ts

Update the existing feature flags file to read from environment:

```typescript
// mobile/src/config/features.ts

import { env, isDevelopment } from './env';

// Helper to check env var
const isEnabled = (envVar: string | undefined): boolean => envVar === 'true';

export const features = {
  // ... existing flags ...

  // Social features - controlled by environment variable
  // When false: Friends tab hidden, no social UI, no social API calls
  enableSocial: isEnabled(process.env.EXPO_PUBLIC_ENABLE_SOCIAL),
} as const;
```

#### backend/app/core/config.py

Add feature flag to Settings class:

```python
# backend/app/core/config.py

class Settings(BaseSettings):
    # ... existing settings ...

    # Feature Flags
    enable_social_features: bool = Field(
        default=False,
        description="Enable social features (friends, feed, follows, blocks, invites)",
    )
```

#### backend/app/core/feature_flags.py

Create a new module for feature flag utilities:

```python
# backend/app/core/feature_flags.py

from fastapi import Depends, HTTPException, status
from app.core.config import get_settings, Settings


def require_social_features(settings: Settings = Depends(get_settings)):
    """
    Dependency that blocks requests when social features are disabled.
    Returns 404 to make endpoints appear non-existent.
    """
    if not settings.enable_social_features:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Not found",
        )
```

---

### Phase 2: Mobile - Gate Navigation & UI

#### Tasks

1. **Conditionally render Friends tab**

```typescript
// mobile/src/navigation/MainTabNavigator.tsx

import { features } from '@config/features';

// In Tab.Navigator:
{features.enableSocial && (
  <Tab.Screen
    name="Friends"
    component={FriendsNavigator}
    options={{ title: 'Friends', tabBarAccessibilityLabel: 'friends-tab' }}
    listeners={({ navigation }) => ({
      tabPress: () => {
        navigation.dispatch(
          CommonActions.reset({
            index: 0,
            routes: [{ name: 'Friends' }],
          })
        );
      },
    })}
  />
)}
```

2. **Gate social elements in trip detail screens** (if any social UI appears there)

3. **Gate social elements in profile screens** (if any social UI appears there)

4. **Ensure hooks don't cause errors when not used**
   - Social hooks (`useFeed`, `useFollows`, etc.) should return empty/null states when social is disabled
   - This prevents React Query from making API calls

#### Files to Modify

| File | Change |
|------|--------|
| `mobile/src/config/features.ts` | Add `enableSocial` flag from env var |
| `mobile/src/navigation/MainTabNavigator.tsx` | Wrap Friends tab in conditional |
| `mobile/src/components/trips/TravelFriendsSection.tsx` | Gate entire component |
| Any screen showing follower counts or social stats | Gate those sections |

---

### Phase 3: Backend - Gate API Endpoints

#### Approach A: Conditional Router Registration (Recommended)

Don't register social routers when flag is disabled:

```python
# backend/app/api/__init__.py

from app.core.config import get_settings

settings = get_settings()

router = APIRouter()

# Always-on routes
router.include_router(public.router, tags=["public"])
router.include_router(countries.router, prefix="/countries", tags=["countries"])
router.include_router(profile.router, prefix="/profile", tags=["profile"])
router.include_router(trips.router, prefix="/trips", tags=["trips"])
router.include_router(entries.router, tags=["entries"])
router.include_router(places.router, prefix="/places", tags=["places"])
router.include_router(media.router, prefix="/media/files", tags=["media"])
router.include_router(lists.router, tags=["lists"])
router.include_router(classification.router, prefix="/classify", tags=["classification"])
router.include_router(ingest.router, tags=["ingest"])
router.include_router(admin.router, tags=["admin"])

# Social features - only registered when enabled
if settings.enable_social_features:
    router.include_router(users.router, prefix="/users", tags=["users"])
    router.include_router(follows.router, prefix="/follows", tags=["follows"])
    router.include_router(feed.router, prefix="/feed", tags=["feed"])
    router.include_router(blocks.router, prefix="/blocks", tags=["blocks"])
    router.include_router(invites.router, prefix="/invites", tags=["invites"])
    router.include_router(notifications.router, prefix="/notifications", tags=["notifications"])

# Trip tags are partially social (consent workflow) - may need to keep for now
router.include_router(trip_tags.router, prefix="/trip-tags", tags=["trip_tags"])
router.include_router(stats.router, prefix="/stats", tags=["stats"])
```

#### Approach B: Dependency-Based Gating (Alternative)

Add the dependency to each social router:

```python
# backend/app/api/feed.py

from app.core.feature_flags import require_social_features

router = APIRouter(dependencies=[Depends(require_social_features)])
```

#### Which to Choose?

**Approach A** (conditional registration) is cleaner and:
- Removes routes from OpenAPI docs when disabled
- No extra dependency injection overhead
- Easier to audit which routes are gated

Use **Approach B** as a backup safety net if needed.

#### Files to Modify

| File | Change |
|------|--------|
| `backend/app/core/config.py` | Add `enable_social_features` setting |
| `backend/app/core/feature_flags.py` | Create new file with `require_social_features` dependency |
| `backend/app/api/__init__.py` | Conditionally register social routers |

---

### Phase 4: Environment Configuration

#### Mobile Environment Files

```bash
# mobile/.env.example
# ... existing vars ...

# Feature Flags
# Set to "true" to enable social features (Friends tab, feed, follows)
# EXPO_PUBLIC_ENABLE_SOCIAL=false

# mobile/.env.local (development)
EXPO_PUBLIC_ENABLE_SOCIAL=true

# mobile/.env.production
EXPO_PUBLIC_ENABLE_SOCIAL=false
```

#### Backend Environment Files

```bash
# backend/.env.example
# ... existing vars ...

# Feature Flags
# Set to true to enable social features (friends, feed, follows, blocks, invites)
ENABLE_SOCIAL_FEATURES=false

# backend/.env (development)
ENABLE_SOCIAL_FEATURES=true

# backend/.env.production
ENABLE_SOCIAL_FEATURES=false
```

---

### Phase 5: Update Documentation

#### CLAUDE.md Updates

Add a new section documenting the feature flag:

```markdown
## Feature Flags

### Social Features (`ENABLE_SOCIAL_FEATURES`)

Controls visibility and availability of all social functionality:

| Component | When Disabled | When Enabled |
|-----------|---------------|--------------|
| Friends Tab | Hidden | Visible |
| Activity Feed | Not rendered | Active |
| Follow/Unfollow | Not available | Working |
| User Search | Not available | Working |
| Blocks | Not available | Working |
| Invites | Not available | Working |
| Notifications | Not generated | Active |
| Trip Tags | Hidden in UI | Visible |

**Mobile:** `EXPO_PUBLIC_ENABLE_SOCIAL=true|false`
**Backend:** `ENABLE_SOCIAL_FEATURES=true|false`

**To enable social features:**
1. Set `EXPO_PUBLIC_ENABLE_SOCIAL=true` in mobile `.env` and rebuild
2. Set `ENABLE_SOCIAL_FEATURES=true` in backend `.env` and restart
3. Both must be enabled for full functionality
```

---

## Acceptance Criteria

### Functional Requirements

- [ ] When `EXPO_PUBLIC_ENABLE_SOCIAL=false`, Friends tab is not visible in MainTabNavigator
- [ ] When `ENABLE_SOCIAL_FEATURES=false`, social API endpoints (`/users`, `/follows`, `/feed`, `/blocks`, `/invites`, `/notifications`) return 404
- [ ] When both flags are `false`, no social UI or API calls are made
- [ ] When both flags are `true`, all social features work exactly as they do now
- [ ] Existing social data in the database is retained regardless of flag state
- [ ] Flag defaults to `false` in both mobile and backend

### Non-Functional Requirements

- [ ] No performance impact when flag is disabled (routes not registered, components not rendered)
- [ ] Feature flag check happens at startup, not on every request
- [ ] Code is easily searchable for flag cleanup later (grep `enableSocial` or `enable_social_features`)

### Quality Gates

- [ ] All existing tests pass with flag enabled
- [ ] New tests verify behavior when flag is disabled
- [ ] ESLint and Ruff pass
- [ ] No TypeScript errors

---

## Success Metrics

1. **Merge safety**: Social branches can be merged to `main` without exposing features to users
2. **Clean toggle**: Changing the env var and rebuilding/restarting enables all features
3. **No data loss**: Social data (follows, feed items, tags) remains intact when flag is disabled

---

## Dependencies & Risks

### Dependencies

- None - this is infrastructure-only, no new libraries needed

### Risks

| Risk | Mitigation |
|------|------------|
| Forgot to gate a component | Search codebase for social imports before finalizing |
| API routes still accessible | Conditional router registration prevents this |
| Env var not set in production | Default to `false` (disabled) is safe |
| Deep links to social screens crash | Will silently fail since routes not registered |

---

## Implementation Checklist

### Backend (estimated 4 files, ~50 lines)

- [ ] Add `enable_social_features: bool = False` to `backend/app/core/config.py`
- [ ] Create `backend/app/core/feature_flags.py` with `require_social_features` dependency
- [ ] Update `backend/app/api/__init__.py` to conditionally register social routers
- [ ] Add `ENABLE_SOCIAL_FEATURES=false` to `backend/.env.example`

### Mobile (estimated 3-4 files, ~20 lines)

- [ ] Update `mobile/src/config/features.ts` to read `EXPO_PUBLIC_ENABLE_SOCIAL`
- [ ] Update `mobile/src/navigation/MainTabNavigator.tsx` to conditionally render Friends tab
- [ ] Audit and gate any social UI in trip/profile screens
- [ ] Add `EXPO_PUBLIC_ENABLE_SOCIAL=false` to `mobile/.env.example`

### Documentation

- [ ] Update `CLAUDE.md` with feature flag documentation
- [ ] Update `.env.example` files with new variables

### Testing

- [ ] Verify Friends tab hidden when flag disabled (manual test)
- [ ] Verify `/users` returns 404 when flag disabled (curl test)
- [ ] Run full test suite with flag enabled
- [ ] Run linters (npm run lint, poetry run ruff check .)

---

## Future Considerations

### Runtime Feature Flags

If gradual rollout is needed later:
1. Add `/config` endpoint that returns enabled features
2. Mobile fetches config on launch, caches in memory
3. Can enable for percentage of users without app store release

### Per-User Feature Flags

If A/B testing is needed:
1. Add `social_enabled: boolean` column to `user_profile`
2. Backend checks user's flag in addition to global flag
3. Mobile receives user's flags in session response

### Cleanup When Permanently Enabled

When ready to remove the flag:
1. Search codebase for `enableSocial` and `enable_social_features`
2. Remove conditional checks
3. Remove feature flag from config
4. Remove from documentation
5. Create PR titled "cleanup: remove social feature flag (permanently enabled)"

---

## References

### Internal

- [MainTabNavigator.tsx](mobile/src/navigation/MainTabNavigator.tsx) - Tab navigation
- [features.ts](mobile/src/config/features.ts) - Existing feature flags
- [config.py](backend/app/core/config.py) - Backend configuration
- [api/__init__.py](backend/app/api/__init__.py) - Router registration

### External

- [Expo Environment Variables](https://docs.expo.dev/guides/environment-variables/)
- [FastAPI Settings](https://fastapi.tiangolo.com/advanced/settings/)
- [Feature Flag Best Practices](https://featureflags.io/feature-flags-cleaning-up/)

---

## Related Work

- Branch: `social-updates` (current)
- Branch: `feature/friends-social-phase-1` (parent)
- Existing pattern: `LAUNCH_SIMPLIFICATION` comments for hidden features

