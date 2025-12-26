/**
 * Push notification service for registering and handling notifications.
 *
 * NOTE: expo-notifications and expo-device packages must be installed:
 * npx expo install expo-notifications expo-device expo-constants
 */

import Constants from 'expo-constants';
import * as Device from 'expo-device';
import * as Notifications from 'expo-notifications';
import { Platform } from 'react-native';

import { api } from './api';

// Configure notification handler - determines how notifications are displayed
// when app is in foreground
Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowAlert: true,
    shouldPlaySound: true,
    shouldSetBadge: true,
  }),
});

/**
 * Register for push notifications and save token to backend.
 *
 * @returns The Expo push token, or null if registration failed
 */
export async function registerForPushNotifications(): Promise<string | null> {
  // Only works on physical devices
  if (!Device.isDevice) {
    if (__DEV__) {
      console.warn('Push notifications only work on physical devices');
    }
    return null;
  }

  // Check/request permissions
  const { status: existingStatus } = await Notifications.getPermissionsAsync();
  let finalStatus = existingStatus;

  if (existingStatus !== 'granted') {
    const { status } = await Notifications.requestPermissionsAsync();
    finalStatus = status;
  }

  if (finalStatus !== 'granted') {
    if (__DEV__) {
      console.warn('Push notification permission denied');
    }
    return null;
  }

  // Get project ID from expo config
  const projectId = Constants.expoConfig?.extra?.eas?.projectId;

  if (!projectId) {
    if (__DEV__) {
      console.warn('No projectId configured for push notifications');
    }
    return null;
  }

  try {
    // Get Expo push token
    const tokenData = await Notifications.getExpoPushTokenAsync({
      projectId,
    });
    const token = tokenData.data;

    // Configure Android notification channel
    if (Platform.OS === 'android') {
      await Notifications.setNotificationChannelAsync('default', {
        name: 'Default',
        importance: Notifications.AndroidImportance.MAX,
        vibrationPattern: [0, 250, 250, 250],
        lightColor: '#007AFF',
      });

      // Create a channel for social notifications
      await Notifications.setNotificationChannelAsync('social', {
        name: 'Social',
        description: 'Notifications about followers and friends',
        importance: Notifications.AndroidImportance.HIGH,
      });
    }

    // Register token with backend
    await api.post('/notifications/register', {
      token,
      platform: Platform.OS,
    });

    if (__DEV__) {
      console.log('Push token registered:', token);
    }

    return token;
  } catch (error) {
    console.error('Failed to register push token:', error);
    return null;
  }
}

/**
 * Unregister push notifications (opt out).
 */
export async function unregisterPushNotifications(): Promise<void> {
  try {
    await api.delete('/notifications/unregister');
  } catch (error) {
    console.error('Failed to unregister push notifications:', error);
  }
}

/**
 * Navigation type for deep linking from notifications.
 */
interface NotificationNavigation {
  navigate: (screen: string, params?: Record<string, unknown>) => void;
}

/**
 * Set up notification listeners for handling taps and foreground notifications.
 *
 * @param navigation Navigation object for deep linking
 * @returns Cleanup function to remove listeners
 */
export function setupNotificationListeners(navigation: NotificationNavigation): () => void {
  // Handle notification received while app is in foreground
  const notificationListener = Notifications.addNotificationReceivedListener((notification) => {
    if (__DEV__) {
      console.log('Notification received in foreground:', notification);
    }
  });

  // Handle notification tap (both foreground and background)
  const responseListener = Notifications.addNotificationResponseReceivedListener((response) => {
    const data = response.notification.request.content.data as {
      screen?: string;
      userId?: string;
      username?: string;
      tripId?: string;
    };

    // Deep link navigation based on notification data
    if (data.screen === 'UserProfile' && data.userId && data.username) {
      navigation.navigate('UserProfile', { userId: data.userId, username: data.username });
    } else if (data.screen === 'TripDetail' && data.tripId) {
      navigation.navigate('TripDetail', { tripId: data.tripId });
    } else if (data.screen === 'FollowersList') {
      navigation.navigate('FollowersList');
    }
  });

  // Return cleanup function
  return () => {
    notificationListener.remove();
    responseListener.remove();
  };
}

/**
 * Get the current notification permission status.
 */
export async function getNotificationPermissionStatus(): Promise<string> {
  const { status } = await Notifications.getPermissionsAsync();
  return status;
}

/**
 * Request notification permissions.
 */
export async function requestNotificationPermissions(): Promise<boolean> {
  const { status } = await Notifications.requestPermissionsAsync();
  return status === 'granted';
}
