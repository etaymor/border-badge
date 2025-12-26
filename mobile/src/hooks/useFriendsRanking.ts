import { useQuery } from '@tanstack/react-query';

import { api } from '@services/api';

export interface FriendsRanking {
  rank: number;
  total_friends: number;
  my_countries: number;
  leader_username: string | null;
  leader_countries: number | null;
}

/**
 * Hook to fetch the current user's rank among friends.
 */
export function useFriendsRanking() {
  return useQuery<FriendsRanking>({
    queryKey: ['stats', 'friends-ranking'],
    queryFn: async () => {
      const response = await api.get<FriendsRanking>('/stats/friends-ranking');
      return response.data;
    },
    staleTime: 1000 * 60 * 5, // 5 minutes
    refetchOnWindowFocus: true,
  });
}
