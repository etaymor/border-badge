import { useEffect, useRef } from 'react';

/**
 * Consolidated navigation guard for post-signup flow.
 * Navigates to 'EmotionalHook' exactly once when any auth method succeeds
 * and needsPostSignupFlow is true. The useRef guard prevents duplicate
 * navigations and back-nav re-fires.
 */
export function usePostSignupNavigation(
  navigate: (screen: string) => void,
  {
    session,
    needsPostSignupFlow,
    signUpSuccess,
    appleSuccess,
    googleSuccess,
  }: {
    session: object | null;
    needsPostSignupFlow: boolean;
    signUpSuccess: boolean;
    appleSuccess: boolean;
    googleSuccess: boolean;
  }
) {
  const hasNavigatedToHook = useRef(false);

  useEffect(() => {
    if (hasNavigatedToHook.current) return;
    if (!needsPostSignupFlow) return;

    const shouldNavigate = session != null || signUpSuccess || appleSuccess || googleSuccess;

    if (shouldNavigate) {
      hasNavigatedToHook.current = true;
      navigate('EmotionalHook');
    }
  }, [session, needsPostSignupFlow, signUpSuccess, appleSuccess, googleSuccess, navigate]);
}
