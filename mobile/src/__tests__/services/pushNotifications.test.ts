/**
 * Tests for push notification registration/unregistration semantics.
 *
 * Push tokens are keyed per device on the backend (one user holds many
 * device tokens), so unregister must name THIS device's token — deleting
 * by user alone would kill delivery to the user's other devices.
 */

import AsyncStorage from '@react-native-async-storage/async-storage';

import { unregisterPushNotifications } from '@services/pushNotifications';

jest.mock('expo-notifications', () => ({
  setNotificationHandler: jest.fn(),
  getPermissionsAsync: jest.fn(),
  requestPermissionsAsync: jest.fn(),
  getExpoPushTokenAsync: jest.fn(),
  setNotificationChannelAsync: jest.fn(),
  addNotificationReceivedListener: jest.fn(),
  addNotificationResponseReceivedListener: jest.fn(),
  AndroidImportance: { MAX: 5, HIGH: 4 },
}));

jest.mock('expo-device', () => ({
  isDevice: false,
}));

jest.mock('@services/api', () => ({
  api: {
    post: jest.fn().mockResolvedValue({ data: {} }),
    delete: jest.fn().mockResolvedValue({ data: {} }),
  },
}));

import { api } from '@services/api';

describe('unregisterPushNotifications', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('sends the stored device token so only this device is unregistered', async () => {
    (AsyncStorage.getItem as jest.Mock).mockResolvedValue('ExponentPushToken[device-a]');

    await unregisterPushNotifications();

    expect(api.delete).toHaveBeenCalledWith('/notifications/unregister', {
      params: { token: 'ExponentPushToken[device-a]' },
    });
    // Stored token cleared after successful unregistration
    expect(AsyncStorage.removeItem).toHaveBeenCalled();
  });

  it('falls back to a tokenless unregister when no token is stored', async () => {
    (AsyncStorage.getItem as jest.Mock).mockResolvedValue(null);

    await unregisterPushNotifications();

    expect(api.delete).toHaveBeenCalledWith('/notifications/unregister', undefined);
  });

  it('swallows errors so sign-out is never blocked', async () => {
    (AsyncStorage.getItem as jest.Mock).mockResolvedValue(null);
    (api.delete as jest.Mock).mockRejectedValue(new Error('network down'));

    await expect(unregisterPushNotifications()).resolves.toBeUndefined();
  });
});
