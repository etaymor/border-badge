import { useQuery } from '@tanstack/react-query';

import { api } from '@services/api';

export interface UserProfile {
  id: string;
  user_id: string;
  username: string;
  display_name: string;
  avatar_url: string | null;
  country_count: number;
  follower_count: number;
  following_count: number;
  is_following: boolean;
  is_blocked: boolean;
}

/**
 * Hook to fetch a user's public profile by username.
 */
export function useUserProfile(username: string) {
  return useQuery<UserProfile>({
    queryKey: ['user', username, 'profile'],
    queryFn: async () => {
      const response = await api.get<UserProfile>(`/users/${username}/profile`);
      return response.data;
    },
    enabled: !!username,
    staleTime: 1000 * 60, // 1 minute
  });
}
