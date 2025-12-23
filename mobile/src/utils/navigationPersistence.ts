import type { NavigationState } from '@react-navigation/native';

// Navigation state expires after 24 hours to prevent stale data
export const NAVIGATION_STATE_TTL_MS = 24 * 60 * 60 * 1000;

// Screens that should not have their params persisted (contain sensitive data)
export const SENSITIVE_SCREENS = ['ShareCapture'];

// Current schema version - increment when navigation structure changes
export const NAVIGATION_STATE_VERSION = 1;

// Type for persisted navigation state with metadata
export type PersistedNavigationState = {
  state: NavigationState;
  timestamp: number;
  version: number;
};

/**
 * Recursively strips sensitive params from navigation state routes.
 * This prevents persisting URLs, user data, or other sensitive info.
 */
export function sanitizeNavigationState(state: NavigationState): NavigationState {
  const sanitizeRoutes = (routes: NavigationState['routes']): NavigationState['routes'] => {
    return routes.map((route) => {
      const sanitizedRoute = { ...route };

      // Strip params from sensitive screens
      if (SENSITIVE_SCREENS.includes(route.name)) {
        delete sanitizedRoute.params;
      }

      // Recursively sanitize nested state
      if (sanitizedRoute.state) {
        sanitizedRoute.state = sanitizeNavigationState(
          sanitizedRoute.state as NavigationState
        ) as typeof sanitizedRoute.state;
      }

      return sanitizedRoute;
    });
  };

  return {
    ...state,
    routes: sanitizeRoutes(state.routes),
  };
}

/**
 * Validates that a navigation state has the expected structure.
 * Returns false if the state is malformed or from an incompatible version.
 */
export function isValidNavigationState(state: unknown): state is NavigationState {
  if (!state || typeof state !== 'object') return false;
  const s = state as Record<string, unknown>;
  if (!Array.isArray(s.routes)) return false;
  if (s.routes.length === 0) return false;
  // Check that routes have required 'key' and 'name' properties
  return s.routes.every(
    (route) =>
      route &&
      typeof route === 'object' &&
      typeof route.key === 'string' &&
      typeof route.name === 'string'
  );
}

/**
 * Checks if a persisted navigation state is still valid based on version and TTL.
 * Returns the navigation state if valid, or null if it should be discarded.
 */
export function validatePersistedState(
  persisted: PersistedNavigationState | null
): NavigationState | null {
  if (!persisted) return null;

  // Check version compatibility
  if (persisted.version !== NAVIGATION_STATE_VERSION) {
    return null;
  }

  // Check TTL expiration
  const age = Date.now() - persisted.timestamp;
  if (age > NAVIGATION_STATE_TTL_MS) {
    return null;
  }

  // Validate state structure
  if (!isValidNavigationState(persisted.state)) {
    return null;
  }

  return persisted.state;
}
