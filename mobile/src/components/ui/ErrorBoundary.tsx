/**
 * Error boundary component to catch and handle React rendering errors.
 * Prevents crashes from propagating and displays a fallback UI.
 */

import { Component, ReactNode } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { colors } from '@constants/colors';
import { logger } from '@utils/logger';

import { Text } from './Text';

interface ErrorBoundaryProps {
  children: ReactNode;
  /** Optional fallback component to render on error */
  fallback?: ReactNode;
  /** Custom fallback render function that receives resetError callback */
  fallbackRender?: (props: { error: Error | null; resetError: () => void }) => ReactNode;
  /** Called when an error is caught */
  onError?: (error: Error, errorInfo: React.ErrorInfo) => void;
  /** Called when error state is reset */
  onReset?: () => void;
}

interface ErrorBoundaryState {
  hasError: boolean;
  error: Error | null;
}

class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  constructor(props: ErrorBoundaryProps) {
    super(props);
    this.state = { hasError: false, error: null };
    this.resetError = this.resetError.bind(this);
  }

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: React.ErrorInfo): void {
    logger.error('ErrorBoundary caught error:', error, errorInfo.componentStack);
    this.props.onError?.(error, errorInfo);
  }

  /**
   * Reset the error state to allow re-rendering children.
   * Call this to recover from an error and try rendering again.
   */
  resetError(): void {
    this.props.onReset?.();
    this.setState({ hasError: false, error: null });
  }

  render(): ReactNode {
    if (this.state.hasError) {
      // Use fallbackRender if provided (allows access to resetError)
      if (this.props.fallbackRender) {
        return this.props.fallbackRender({
          error: this.state.error,
          resetError: this.resetError,
        });
      }

      // Use static fallback if provided
      if (this.props.fallback) {
        return this.props.fallback;
      }

      // Default fallback with retry button
      return (
        <View style={styles.container}>
          <Text style={styles.text}>Something went wrong</Text>
          <Pressable style={styles.retryButton} onPress={this.resetError}>
            <Text style={styles.retryText}>Try Again</Text>
          </Pressable>
        </View>
      );
    }

    return this.props.children;
  }
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 24,
  },
  text: {
    fontSize: 14,
    color: colors.stormGray,
    textAlign: 'center',
  },
  retryButton: {
    marginTop: 16,
    paddingVertical: 10,
    paddingHorizontal: 20,
    backgroundColor: colors.primary,
    borderRadius: 8,
  },
  retryText: {
    fontSize: 14,
    color: colors.white,
    fontWeight: '600',
  },
});

export default ErrorBoundary;
