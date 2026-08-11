import { useEffect } from 'react';
import { useNavigation } from '@react-navigation/native';

import { useAuthStore } from '@stores/authStore';

/**
 * Consume the one-shot pendingFirstQuizLaunch flag armed by the post-signup
 * FirstQuizOffer accept (U12).
 *
 * Called from inside MainTabNavigator -- i.e. from the root stack's 'Main'
 * screen -- so QuizCreation is pushed ON TOP of Main and backing out of the
 * creation flow lands on home. The flag is cleared before navigating, so the
 * launch fires at most once; existing users (and every later cold start)
 * never have it set -- only the onboarding offer arms it, and signOut clears
 * it.
 */
export function useFirstQuizLaunch() {
  const navigation = useNavigation();
  const pendingFirstQuizLaunch = useAuthStore((s) => s.pendingFirstQuizLaunch);
  const setPendingFirstQuizLaunch = useAuthStore((s) => s.setPendingFirstQuizLaunch);

  useEffect(() => {
    if (!pendingFirstQuizLaunch) return;
    setPendingFirstQuizLaunch(false);
    navigation.navigate('QuizCreation');
  }, [pendingFirstQuizLaunch, setPendingFirstQuizLaunch, navigation]);
}
