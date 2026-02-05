/**
 * Error boundary wrapper for ShareCaptureScreen.
 *
 * When the screen crashes, this ensures the App Group share is completed
 * (marked as processed + App Group cleared) so the URL doesn't get stuck
 * in processing state and block future shares.
 */

import type { ReactNode } from 'react';

import ErrorBoundary from '@components/ui/ErrorBoundary';
import { completeAppGroupShare } from '@services/shareExtensionBridge';

interface Props {
  url: string;
  source?: string;
  onError?: () => void;
  children: ReactNode;
}

export function ShareCaptureErrorBoundary({ url, source, onError, children }: Props) {
  const handleError = () => {
    if (source === 'share_extension') {
      void completeAppGroupShare(url);
    }
    onError?.();
  };

  return <ErrorBoundary onError={handleError}>{children}</ErrorBoundary>;
}
