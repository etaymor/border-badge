import React, { ReactElement } from 'react';
import { render, RenderOptions, waitFor } from '@testing-library/react-native';
import { NavigationContainer } from '@react-navigation/native';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { ResponsiveProvider } from '@contexts/ResponsiveContext';

/**
 * Creates a fresh QueryClient for each test to avoid state leakage.
 * Configured with no retries and no caching for predictable test behavior.
 */
export const createTestQueryClient = () =>
  new QueryClient({
    defaultOptions: {
      queries: {
        retry: false,
        gcTime: 0, // Don't cache between tests
        staleTime: 0,
      },
      mutations: {
        retry: false,
      },
    },
  });

interface WrapperProps {
  children: React.ReactNode;
}

interface ExtendedRenderOptions extends Omit<RenderOptions, 'wrapper'> {
  queryClient?: QueryClient;
}

/**
 * Creates a wrapper component with all necessary providers.
 */
function createWrapper(queryClient: QueryClient) {
  return function Wrapper({ children }: WrapperProps) {
    return (
      <ResponsiveProvider>
        <QueryClientProvider client={queryClient}>
          <SafeAreaProvider>
            <NavigationContainer>{children}</NavigationContainer>
          </SafeAreaProvider>
        </QueryClientProvider>
      </ResponsiveProvider>
    );
  };
}

/**
 * Custom render function that wraps components with all necessary providers.
 * Returns the render result plus the queryClient for assertions.
 */
const customRender = (ui: ReactElement, options?: ExtendedRenderOptions) => {
  const queryClient = options?.queryClient ?? createTestQueryClient();
  const { queryClient: _, ...renderOptions } = options ?? {};

  return {
    ...render(ui, { wrapper: createWrapper(queryClient), ...renderOptions }),
    queryClient,
  };
};

/**
 * Helper to wait for async operations to complete.
 */
export const waitForQueries = async (timeout = 100) => {
  await waitFor(() => {}, { timeout });
};

/**
 * Helper to mock a successful API response.
 */
export const mockApiSuccess = <T,>(mock: jest.Mock, data: T) => {
  mock.mockResolvedValueOnce({ data });
};

/**
 * Helper to mock an API error response.
 */
export const mockApiError = (mock: jest.Mock, message: string, status = 400) => {
  const error = new Error(message) as Error & {
    response?: { status: number; data: { message: string } };
  };
  error.response = { status, data: { message } };
  mock.mockRejectedValueOnce(error);
};

/**
 * Helper to flush promises in tests.
 */
export const flushPromises = () => new Promise((resolve) => setImmediate(resolve));

/**
 * Helper to advance timers and flush promises.
 * Useful for testing debounced operations.
 */
export const advanceTimersAndFlush = async (ms: number) => {
  jest.advanceTimersByTime(ms);
  await flushPromises();
};

// Re-export everything from testing library
export * from '@testing-library/react-native';

// Override render method
export { customRender as render };
