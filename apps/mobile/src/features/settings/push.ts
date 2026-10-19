import { Platform } from 'react-native';
import Constants from 'expo-constants';
import * as Device from 'expo-device';
import * as Notifications from 'expo-notifications';
import { api } from '@/lib/api';

export type PushResult =
  | { ok: true }
  | { ok: false; reason: 'simulator' | 'denied' | 'no_project' | 'unsupported' | 'network'; message: string };

export async function getPushPermission(): Promise<'granted' | 'denied' | 'undetermined'> {
  try {
    const p = await Notifications.getPermissionsAsync();
    return p.granted ? 'granted' : p.canAskAgain === false ? 'denied' : (p.status as 'denied' | 'undetermined');
  } catch {
    return 'undetermined';
  }
}

/** Asks for permission, gets an Expo push token and registers it with POST /devices. */
export async function enablePushNotifications(): Promise<PushResult> {
  if (!Device.isDevice) {
    return { ok: false, reason: 'simulator', message: 'Push notifications need a physical device. In-app notifications still work here.' };
  }
  try {
    if (Platform.OS === 'android') {
      await Notifications.setNotificationChannelAsync('default', {
        name: 'Activity',
        importance: Notifications.AndroidImportance.DEFAULT,
        lightColor: '#146FF4',
      });
    }
    let perm = await Notifications.getPermissionsAsync();
    if (!perm.granted && perm.canAskAgain !== false) perm = await Notifications.requestPermissionsAsync();
    if (!perm.granted) {
      return { ok: false, reason: 'denied', message: 'Notifications are off for Zoko. You can turn them on in your device settings.' };
    }
    const projectId =
      (Constants.expoConfig?.extra as { eas?: { projectId?: string } } | undefined)?.eas?.projectId ?? Constants.easConfig?.projectId;
    if (!projectId) {
      return { ok: false, reason: 'no_project', message: 'Push notifications are not set up for this build yet.' };
    }
    const token = await Notifications.getExpoPushTokenAsync({ projectId });
    try {
      await api<void>('/devices', { method: 'POST', body: { expo_push_token: token.data, platform: Platform.OS === 'ios' ? 'ios' : 'android' } });
    } catch {
      return { ok: false, reason: 'network', message: "We couldn't register this device. Try again." };
    }
    return { ok: true };
  } catch {
    return { ok: false, reason: 'unsupported', message: "Push notifications aren't available in this version of the app." };
  }
}
