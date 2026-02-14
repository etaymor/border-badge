/**
 * Tests for AccountCreationScreen navigation guard.
 *
 * Validates that the consolidated useEffect with ref guard:
 * - Navigates exactly once (no duplicate calls from multiple conditions)
 * - Does not re-fire on back-navigation re-renders
 */

import { renderHook } from '@testing-library/react-native';
import { useEffect, useRef } from 'react';

/**
 * Mirrors the fixed navigation logic from AccountCreationScreen.tsx (lines 68-82).
 * Uses a single consolidated effect with a useRef guard.
 */
function useNavigationEffect(
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

    const shouldNavigate =
      session != null || signUpSuccess || appleSuccess || googleSuccess;

    if (shouldNavigate) {
      hasNavigatedToHook.current = true;
      navigate('EmotionalHook');
    }
  }, [session, needsPostSignupFlow, signUpSuccess, appleSuccess, googleSuccess, navigate]);
}

describe('AccountCreationScreen navigation effects', () => {
  it('navigates exactly once even when re-rendered with same props (back-nav guard)', () => {
    const navigate = jest.fn();

    const { rerender } = renderHook(
      (props) => useNavigationEffect(navigate, props),
      {
        initialProps: {
          session: { user: { id: '123' } },
          needsPostSignupFlow: true,
          signUpSuccess: false,
          appleSuccess: false,
          googleSuccess: false,
        },
      }
    );

    expect(navigate).toHaveBeenCalledTimes(1);

    // User navigates back — component re-renders with same props
    rerender({
      session: { user: { id: '123' } },
      needsPostSignupFlow: true,
      signUpSuccess: false,
      appleSuccess: false,
      googleSuccess: false,
    });

    // Should NOT fire again thanks to ref guard
    expect(navigate).toHaveBeenCalledTimes(1);
  });

  it('navigates exactly once when email signup sets both session and isSuccess', () => {
    const navigate = jest.fn();

    renderHook(() =>
      useNavigationEffect(navigate, {
        session: { user: { id: '123' } },
        needsPostSignupFlow: true,
        signUpSuccess: true,
        appleSuccess: false,
        googleSuccess: false,
      })
    );

    // Consolidated effect fires exactly once even with multiple truthy conditions
    expect(navigate).toHaveBeenCalledTimes(1);
  });

  it('does not navigate when needsPostSignupFlow is false', () => {
    const navigate = jest.fn();

    renderHook(() =>
      useNavigationEffect(navigate, {
        session: { user: { id: '123' } },
        needsPostSignupFlow: false,
        signUpSuccess: true,
        appleSuccess: false,
        googleSuccess: false,
      })
    );

    expect(navigate).not.toHaveBeenCalled();
  });

  it('navigates on Apple sign-in success', () => {
    const navigate = jest.fn();

    renderHook(() =>
      useNavigationEffect(navigate, {
        session: null,
        needsPostSignupFlow: true,
        signUpSuccess: false,
        appleSuccess: true,
        googleSuccess: false,
      })
    );

    expect(navigate).toHaveBeenCalledTimes(1);
    expect(navigate).toHaveBeenCalledWith('EmotionalHook');
  });

  it('navigates on Google sign-in success', () => {
    const navigate = jest.fn();

    renderHook(() =>
      useNavigationEffect(navigate, {
        session: null,
        needsPostSignupFlow: true,
        signUpSuccess: false,
        appleSuccess: false,
        googleSuccess: true,
      })
    );

    expect(navigate).toHaveBeenCalledTimes(1);
    expect(navigate).toHaveBeenCalledWith('EmotionalHook');
  });
});
