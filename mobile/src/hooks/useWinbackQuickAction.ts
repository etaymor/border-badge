/**
 * useWinbackQuickAction - the "Deleting? Get 50% off" home-screen quick action.
 *
 * Long-pressing the app icon (the gesture that leads to "Remove App") shows
 * this action to signed-in free users who haven't used it yet. Tapping it opens
 * the app on the $24.99/yr winback paywall. The action is registered at
 * runtime, so it disappears as soon as the user subscribes, signs out, or uses
 * it once.
 */

import { useEffect, useState } from 'react';
import type { Session } from '@supabase/supabase-js';
import * as QuickActions from 'expo-quick-actions';
import { useQuickActionCallback } from 'expo-quick-actions/hooks';

import { useStableCallback } from '@hooks/useStableCallback';
import { useWinbackOffer } from '@hooks/useWinbackOffer';
import { hasUsedWinback } from '@services/winback';
import { useSubscriptionStore } from '@stores/subscriptionStore';

export const WINBACK_QUICK_ACTION: QuickActions.Action = {
  id: 'winback',
  title: 'Deleting? Get 50% off',
  subtitle: 'One-time offer: $24.99/year',
  icon: null,
};

function clearQuickActions() {
  QuickActions.setItems([]).catch((error) => {
    console.warn('[useWinbackQuickAction] Failed to clear quick actions:', error);
  });
}

export function useWinbackQuickAction(session: Session | null, isAppReady: boolean) {
  const status = useSubscriptionStore((s) => s.status);
  const { presentWinback } = useWinbackOffer('quick_action');
  // Set when the action is tapped; consumed once the app can present a paywall.
  // A cold-start tap arrives before the session is restored.
  const [pending, setPending] = useState(false);
  const userId = session?.user.id ?? null;

  // Register or clear the action to match the user's eligibility.
  useEffect(() => {
    if (status === 'loading') return;
    if (!userId || status !== 'free') {
      clearQuickActions();
      return;
    }

    let cancelled = false;
    hasUsedWinback('quick_action').then((used) => {
      if (cancelled) return;
      if (used) {
        clearQuickActions();
        return;
      }
      QuickActions.setItems([WINBACK_QUICK_ACTION]).catch((error) => {
        console.warn('[useWinbackQuickAction] Failed to set quick actions:', error);
      });
    });
    return () => {
      cancelled = true;
    };
  }, [userId, status]);

  // The library re-runs its effect (and replays the launch action) whenever
  // the callback identity changes, so it must be stable.
  const handleAction = useStableCallback((action: QuickActions.Action) => {
    if (action.id === WINBACK_QUICK_ACTION.id) setPending(true);
  });
  useQuickActionCallback(handleAction);

  useEffect(() => {
    if (!pending || !userId || !isAppReady) return;
    setPending(false);
    presentWinback('quick_action').finally(clearQuickActions);
  }, [pending, userId, isAppReady, presentWinback]);
}
