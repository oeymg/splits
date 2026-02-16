import * as Notifications from 'expo-notifications';
import { Platform } from 'react-native';
import { isSupabaseConfigured, supabase } from './supabase';

const easProjectId = process.env.EXPO_PUBLIC_EAS_PROJECT_ID;

export async function registerDeviceForPush(phone?: string, name?: string) {
  if (!phone) {
    return { ok: false, reason: 'missing_phone' } as const;
  }

  if (Platform.OS === 'android') {
    await Notifications.setNotificationChannelAsync('default', {
      name: 'default',
      importance: Notifications.AndroidImportance.DEFAULT
    });
  }

  const permission = await Notifications.requestPermissionsAsync();
  if (!permission.granted) {
    return { ok: false, reason: 'permission_denied' } as const;
  }

  const tokenResponse = easProjectId
    ? await Notifications.getExpoPushTokenAsync({ projectId: easProjectId })
    : await Notifications.getExpoPushTokenAsync();

  if (!isSupabaseConfigured || !supabase) {
    return { ok: false, reason: 'supabase_not_configured', token: tokenResponse.data } as const;
  }

  const { error } = await supabase.functions.invoke('register-device', {
    body: {
      phone,
      name,
      token: tokenResponse.data,
      platform: Platform.OS
    }
  });

  if (error) {
    return { ok: false, reason: 'register_failed', token: tokenResponse.data } as const;
  }

  return { ok: true, token: tokenResponse.data } as const;
}

export async function sendPushRequests(requests: Array<{ phone: string; title: string; body: string }>) {
  if (!isSupabaseConfigured || !supabase) {
    return { ok: false, reason: 'supabase_not_configured' } as const;
  }

  const { data, error } = await supabase.functions.invoke('send-push', {
    body: { requests }
  });

  if (error) {
    return { ok: false, reason: 'push_failed' } as const;
  }

  return { ok: true, data } as const;
}
