/**
 * Tab-bar visibility per focused leaf screen.
 *
 * Regression: the "Shared Lists" screen (`TripLists`, opened from a trip's
 * share icon once the trip has lists) left the tab bar up, and the floating
 * bar covered the Share buttons on the bottom list rows.
 */
import { getTabBarStyle } from '../../navigation/MainTabNavigator';

type AnyRoute = Parameters<typeof getTabBarStyle>[0];

function stack(routes: string[], nested?: { at: string; state: unknown }) {
  return {
    index: routes.length - 1,
    routes: routes.map((name) => ({
      key: `${name}-key`,
      name,
      ...(nested && nested.at === name ? { state: nested.state } : {}),
    })),
  };
}

/** Passport tab → PassportHome → Trips (TripsNavigator) → ...tripsRoutes */
function passportTabWithTrips(tripsRoutes: string[]): AnyRoute {
  return {
    key: 'Passport-tab',
    name: 'Passport',
    state: stack(['PassportHome', 'Trips'], { at: 'Trips', state: stack(tripsRoutes) }),
  } as unknown as AnyRoute;
}

/** Trips tab → ...tripsRoutes */
function tripsTab(tripsRoutes: string[]): AnyRoute {
  return { key: 'Trips-tab', name: 'Trips', state: stack(tripsRoutes) } as unknown as AnyRoute;
}

describe('getTabBarStyle', () => {
  it.each([
    ['Passport tab', passportTabWithTrips(['TripsList', 'TripDetail', 'TripLists'])],
    ['Trips tab', tripsTab(['TripsList', 'TripDetail', 'TripLists'])],
  ])('hides the tab bar on the Shared Lists (TripLists) screen via the %s', (_label, route) => {
    expect(getTabBarStyle(route)).toEqual({ display: 'none' });
  });

  it('still hides the tab bar on ListCreate (share with no lists yet)', () => {
    expect(getTabBarStyle(tripsTab(['TripsList', 'TripDetail', 'ListCreate']))).toEqual({
      display: 'none',
    });
  });

  it('keeps the tab bar visible on TripDetail', () => {
    expect(getTabBarStyle(tripsTab(['TripsList', 'TripDetail']))).toBeUndefined();
    expect(getTabBarStyle(passportTabWithTrips(['TripsList', 'TripDetail']))).toBeUndefined();
  });
});
