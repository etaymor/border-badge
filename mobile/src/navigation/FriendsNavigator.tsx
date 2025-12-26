import React from 'react';
import { createNativeStackNavigator } from '@react-navigation/native-stack';

import { colors } from '@constants/colors';
import { fonts } from '@constants/typography';
import FriendsScreen from '@screens/friends/FriendsScreen';
import UserProfileScreen from '@screens/friends/UserProfileScreen';
import FollowersListScreen from '@screens/friends/FollowersListScreen';
import type { FriendsStackParamList } from './types';

const Stack = createNativeStackNavigator<FriendsStackParamList>();

export function FriendsNavigator() {
  return (
    <Stack.Navigator
      screenOptions={{
        headerStyle: {
          backgroundColor: colors.background,
        },
        headerTintColor: colors.text,
        headerTitleStyle: {
          fontFamily: fonts.bold,
          fontSize: 18,
        },
        headerShadowVisible: false,
        contentStyle: {
          backgroundColor: colors.background,
        },
      }}
    >
      <Stack.Screen
        name="FriendsHome"
        component={FriendsScreen}
        options={{
          title: 'Friends',
        }}
      />
      <Stack.Screen
        name="UserProfile"
        component={UserProfileScreen}
        options={{
          title: 'Profile',
        }}
      />
      <Stack.Screen
        name="FollowersList"
        component={FollowersListScreen}
        options={({ route }) => ({
          title: route.params.mode === 'following' ? 'Following' : 'Followers',
        })}
      />
    </Stack.Navigator>
  );
}
