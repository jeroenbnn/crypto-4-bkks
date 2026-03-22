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

const PENDING_TX_MESSAGES: Record<string, (address: string, btc: string) => { title: string; body: string }> = {
  nl: (address, btc) => ({
    title: '⏳ Wachtende betaling ontvangen',
    body: `${btc} BTC wacht op bevestiging op ${address}`,
  }),
  fr: (address, btc) => ({
    title: '⏳ Paiement en attente reçu',
    body: `${btc} BTC en attente de confirmation sur ${address}`,
  }),
  en: (address, btc) => ({
    title: '⏳ Pending payment received',
    body: `${btc} BTC waiting for confirmation on ${address}`,
  }),
};

const CONFIRMED_TX_MESSAGES: Record<string, (address: string, btc: string) => { title: string; body: string }> = {
  nl: (address, btc) => ({
    title: '✅ Betaling bevestigd',
    body: `${btc} BTC bevestigd op ${address}`,
  }),
  fr: (address, btc) => ({
    title: '✅ Paiement confirmé',
    body: `${btc} BTC confirmé sur ${address}`,
  }),
  en: (address, btc) => ({
    title: '✅ Payment confirmed',
    body: `${btc} BTC confirmed on ${address}`,
  }),
};

export async function sendPendingTransactionNotification(
  address: string,
  satoshi: number,
  lang: string
): Promise<void> {
  if (Platform.OS === 'web') return;
  const msgFn = PENDING_TX_MESSAGES[lang] ?? PENDING_TX_MESSAGES.nl;
  const short = `${address.slice(0, 6)}…${address.slice(-6)}`;
  const btc = (satoshi / 1e8).toFixed(8);
  const msg = msgFn(short, btc);
  try {
    await Notifications.scheduleNotificationAsync({
      content: { title: msg.title, body: msg.body, sound: true },
      trigger: null,
    });
    console.log(`[Notifications] Sent pending tx notification for ${address}`);
  } catch (e) {
    console.error('[Notifications] sendPendingTransactionNotification error:', e);
  }
}

export async function sendConfirmedTransactionNotification(
  address: string,
  satoshi: number,
  lang: string
): Promise<void> {
  if (Platform.OS === 'web') return;
  const msgFn = CONFIRMED_TX_MESSAGES[lang] ?? CONFIRMED_TX_MESSAGES.nl;
  const short = `${address.slice(0, 6)}…${address.slice(-6)}`;
  const btc = (satoshi / 1e8).toFixed(8);
  const msg = msgFn(short, btc);
  try {
    await Notifications.scheduleNotificationAsync({
      content: { title: msg.title, body: msg.body, sound: true },
      trigger: null,
    });
    console.log(`[Notifications] Sent confirmed tx notification for ${address}`);
  } catch (e) {
    console.error('[Notifications] sendConfirmedTransactionNotification error:', e);
  }
}

const OUTGOING_CONFIRMED_MESSAGES: Record<string, (address: string, btc: string) => { title: string; body: string }> = {
  nl: (address, btc) => ({
    title: '✅ Uitgaande betaling voltooid',
    body: `${btc} BTC verstuurd vanaf ${address}`,
  }),
  fr: (address, btc) => ({
    title: '✅ Paiement sortant terminé',
    body: `${btc} BTC envoyé depuis ${address}`,
  }),
  en: (address, btc) => ({
    title: '✅ Outgoing payment completed',
    body: `${btc} BTC sent from ${address}`,
  }),
};

export async function sendOutgoingConfirmedNotification(
  address: string,
  satoshi: number,
  lang: string
): Promise<void> {
  if (Platform.OS === 'web') return;
  const msgFn = OUTGOING_CONFIRMED_MESSAGES[lang] ?? OUTGOING_CONFIRMED_MESSAGES.nl;
  const short = `${address.slice(0, 6)}…${address.slice(-6)}`;
  const btc = (satoshi / 1e8).toFixed(8);
  const msg = msgFn(short, btc);
  try {
    await Notifications.scheduleNotificationAsync({
      content: { title: msg.title, body: msg.body, sound: true },
      trigger: null,
    });
    console.log(`[Notifications] Sent outgoing confirmed notification for ${address}`);
  } catch (e) {
    console.error('[Notifications] sendOutgoingConfirmedNotification error:', e);
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
