import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Alert } from 'react-native';

import { supabase } from '@services/supabase';
import {
  DISPLAY_NAME_MAX_LENGTH,
  DISPLAY_NAME_MIN_LENGTH,
  validateDisplayName,
} from '@utils/displayNameValidation';

const PROFILE_QUERY_KEY = ['profile'];

/**
 * Hook to update the user's display name via Supabase RPC.
 * Validates the name client-side before sending to the server.
 */
export function useUpdateDisplayName() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (newDisplayName: string) => {
      // Validate display name before sending to database
      const validation = validateDisplayName(newDisplayName);
      if (!validation.isValid) {
        throw new Error(validation.error);
      }

      // Use database function to update display name
      const { error } = await supabase.rpc('update_display_name', {
        new_display_name: validation.trimmedValue,
      });

      if (error) {
        // Provide specific error messages based on known error patterns from DB
        if (error.message.includes('at least 2 characters')) {
          throw new Error(
            `Name is too short. Please enter at least ${DISPLAY_NAME_MIN_LENGTH} characters.`
          );
        }
        if (error.message.includes('50 characters')) {
          throw new Error(
            `Name is too long. Please use ${DISPLAY_NAME_MAX_LENGTH} characters or less.`
          );
        }
        throw new Error('Failed to update your name. Please try again.');
      }

      return validation.trimmedValue;
    },
    onSuccess: () => {
      // Invalidate profile query to refetch with new display name
      queryClient.invalidateQueries({ queryKey: PROFILE_QUERY_KEY });
    },
    onError: (error) => {
      const message = error instanceof Error ? error.message : 'Failed to update name';
      Alert.alert('Error', message);
    },
  });
}
