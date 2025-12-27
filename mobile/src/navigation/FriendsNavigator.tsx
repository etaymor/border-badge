import { createNativeStackNavigator } from '@react-navigation/native-stack';

import {
  BlockedUsersScreen,
  FeedScreen,
  FollowersListScreen,
  FollowingListScreen,
  FriendsScreen,
  UserProfileScreen,
} from '@screens/friends';

import type { FriendsStackParamList } from './types';

const Stack = createNativeStackNavigator<FriendsStackParamList>();

export function FriendsNavigator() {
  return (
    <Stack.Navigator>
      <Stack.Screen name="FriendsHome" component={FriendsScreen} options={{ headerShown: false }} />
      <Stack.Screen name="FeedHome" component={FeedScreen} options={{ headerShown: false }} />
      <Stack.Screen
        name="UserProfile"
        component={UserProfileScreen}
        options={{ headerShown: false }}
      />
      <Stack.Screen
        name="FollowersList"
        component={FollowersListScreen}
        options={{ headerShown: false }}
      />
      <Stack.Screen
        name="FollowingList"
        component={FollowingListScreen}
        options={{ headerShown: false }}
      />
      <Stack.Screen
        name="BlockedUsers"
        component={BlockedUsersScreen}
        options={{ headerShown: false }}
      />
    </Stack.Navigator>
  );
}
