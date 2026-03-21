import * as Notifications from 'expo-notifications';
import { Platform } from 'react-native';

Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowAlert: true,
    shouldPlaySound: true,
    shouldSetBadge: false,
    shouldShowBanner: true,
    shouldShowList: true,
  }),
});

export async function requestNotificationPermissions(): Promise<boolean> {
  if (Platform.OS === 'web') return false;
  try {
    const { status } = await Notifications.requestPermissionsAsync();
    console.log('[Notifications] Permission status:', status);
    return status === 'granted';
  } catch (e) {
    console.error('[Notifications] requestPermissions error:', e);
    return false;
  }
}

const LOW_UNUSED_MESSAGES: Record<string, (count: number) => { title: string; body: string }> = {
  nl: (count) => ({
    title: 'Bitcoin Wallet',
    body: `Nog maar ${count} ongebruikte adressen beschikbaar. Voeg nieuwe adressen toe.`,
  }),
  fr: (count) => ({
    title: 'Bitcoin Wallet',
    body: `Plus que ${count} adresses inutilisées disponibles. Ajoutez de nouvelles adresses.`,
  }),
  en: (count) => ({
    title: 'Bitcoin Wallet',
    body: `Only ${count} unused addresses left. Add more addresses.`,
  }),
};

export async function sendLowUnusedAddressNotification(unusedCount: number, lang: string): Promise<void> {
  if (Platform.OS === 'web') return;
  const msgFn = LOW_UNUSED_MESSAGES[lang] ?? LOW_UNUSED_MESSAGES.nl;
  const msg = msgFn(unusedCount);
  try {
    await Notifications.scheduleNotificationAsync({
      content: {
        title: msg.title,
        body: msg.body,
        sound: true,
      },
      trigger: null,
    });
    console.log(`[Notifications] Sent low unused address notification (${unusedCount} left)`);
  } catch (e) {
    console.error('[Notifications] sendLowUnusedAddressNotification error:', e);
  }
}
