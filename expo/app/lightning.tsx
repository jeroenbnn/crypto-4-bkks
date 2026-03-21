import React, { useState, useRef, useEffect, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  TextInput,
  ActivityIndicator,
  Alert,
  Animated,
  ScrollView,
  Platform,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { LinearGradient } from 'expo-linear-gradient';
import { router } from 'expo-router';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { X, Zap, Copy, RefreshCcw, CheckCircle, AlertCircle, ChevronDown } from 'lucide-react-native';
import * as Clipboard from 'expo-clipboard';
import { QRCodeDisplay } from '@/components/QRCodeDisplay';
import { Colors } from '@/constants/colors';

const ALBY_TOKEN = process.env.EXPO_PUBLIC_ALBY_TOKEN ?? '';
const ALBY_BASE = 'https://api.getalby.com';

interface AlbyInvoice {
  payment_hash: string;
  payment_request: string;
  amount: number;
  memo: string;
  settled: boolean;
  expires_at: string;
}

async function createLightningInvoice(amountSats: number, description: string): Promise<AlbyInvoice> {
  console.log(`[Lightning] Creating Alby invoice for ${amountSats} sats...`);
  const res = await fetch(`${ALBY_BASE}/invoices`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${ALBY_TOKEN}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ amount: amountSats, memo: description }),
  });
  if (!res.ok) {
    const err = await res.text();
    console.error('[Lightning] Create invoice error:', err);
    throw new Error(`Factuur aanmaken mislukt: ${res.status}`);
  }
  const json = (await res.json()) as AlbyInvoice;
  console.log('[Lightning] Invoice created:', json.payment_hash);
  return json;
}

async function checkInvoiceStatus(paymentHash: string): Promise<AlbyInvoice> {
  const res = await fetch(`${ALBY_BASE}/invoices/${paymentHash}`, {
    headers: { Authorization: `Bearer ${ALBY_TOKEN}` },
  });
  if (!res.ok) throw new Error('Status ophalen mislukt');
  return (await res.json()) as AlbyInvoice;
}

function useBtcEurPrice() {
  return useQuery({
    queryKey: ['btc-price-eur'],
    queryFn: async () => {
      const res = await fetch('https://api.coinbase.com/v2/prices/BTC-EUR/spot');
      if (!res.ok) return null;
      const json = (await res.json()) as { data: { amount: string } };
      return parseFloat(json.data.amount);
    },
    staleTime: 60_000,
    refetchInterval: 60_000,
  });
}

type AmountUnit = 'EUR' | 'SATS';

function formatSats(sats: number): string {
  return sats.toLocaleString('nl-NL');
}

function formatTimeLeft(expiresAt: number): string {
  const left = Math.max(0, expiresAt * 1000 - Date.now());
  const m = Math.floor(left / 60_000);
  const s = Math.floor((left % 60_000) / 1000);
  return `${m}:${s.toString().padStart(2, '0')}`;
}

export default function LightningScreen() {
  const queryClient = useQueryClient();
  const { data: btcEurPrice } = useBtcEurPrice();

  const [amount, setAmount] = useState('');
  const [unit, setUnit] = useState<AmountUnit>('EUR');
  const [description, setDescription] = useState('');
  const [charge, setCharge] = useState<AlbyInvoice | null>(null);
  const [timeLeft, setTimeLeft] = useState('');
  const [copied, setCopied] = useState(false);

  const successAnim = useRef(new Animated.Value(0)).current;
  const pulseAnim = useRef(new Animated.Value(1)).current;
  const pollingRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const isPaid = charge?.settled === true;
  const isExpired = charge ? !charge.settled && new Date(charge.expires_at).getTime() < Date.now() : false;

  const amountSats = useCallback((): number => {
    const val = parseFloat(amount.replace(',', '.'));
    if (isNaN(val) || val <= 0) return 0;
    if (unit === 'SATS') return Math.round(val);
    if (!btcEurPrice) return 0;
    return Math.round((val / btcEurPrice) * 1e8);
  }, [amount, unit, btcEurPrice]);

  const eurValue = useCallback((): number | null => {
    const sats = amountSats();
    if (!btcEurPrice || sats === 0) return null;
    return (sats / 1e8) * btcEurPrice;
  }, [amountSats, btcEurPrice]);

  const startPolling = useCallback((paymentHash: string) => {
    if (pollingRef.current) clearInterval(pollingRef.current);
    pollingRef.current = setInterval(async () => {
      try {
        const updated = await checkInvoiceStatus(paymentHash);
        console.log(`[Lightning] Settled: ${updated.settled}`);
        setCharge(updated);
        if (updated.settled) {
          if (pollingRef.current) clearInterval(pollingRef.current);
          if (timerRef.current) clearInterval(timerRef.current);
          Animated.sequence([
            Animated.timing(successAnim, { toValue: 1, duration: 400, useNativeDriver: true }),
          ]).start();
          void queryClient.invalidateQueries({ queryKey: ['main-address-balance'] });
        } else if (new Date(updated.expires_at).getTime() < Date.now()) {
          if (pollingRef.current) clearInterval(pollingRef.current);
          if (timerRef.current) clearInterval(timerRef.current);
        }
      } catch (e) {
        console.error('[Lightning] Poll error:', e);
      }
    }, 5000);
  }, [successAnim, queryClient]);

  const startTimer = useCallback((expiresAt: string) => {
    const expiresTs = Math.floor(new Date(expiresAt).getTime() / 1000);
    if (timerRef.current) clearInterval(timerRef.current);
    setTimeLeft(formatTimeLeft(expiresTs));
    timerRef.current = setInterval(() => {
      setTimeLeft(formatTimeLeft(expiresTs));
    }, 1000);
  }, []);

  useEffect(() => {
    if (!charge || isPaid || isExpired) return;
    Animated.loop(
      Animated.sequence([
        Animated.timing(pulseAnim, { toValue: 1.04, duration: 1000, useNativeDriver: true }),
        Animated.timing(pulseAnim, { toValue: 1, duration: 1000, useNativeDriver: true }),
      ])
    ).start();
  }, [charge, isPaid, isExpired, pulseAnim]);

  useEffect(() => {
    return () => {
      if (pollingRef.current) clearInterval(pollingRef.current);
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, []);

  const createMutation = useMutation({
    mutationFn: async () => {
      if (!ALBY_TOKEN) throw new Error('Geen Alby API token geconfigureerd.');
      const sats = amountSats();
      if (sats < 1) throw new Error('Vul een geldig bedrag in.');
      const desc = description.trim() || 'BKKS Lightning Storting';
      return createLightningInvoice(sats, desc);
    },
    onSuccess: (data) => {
      setCharge(data);
      startPolling(data.payment_hash);
      startTimer(data.expires_at);
    },
    onError: (e: Error) => {
      Alert.alert('Fout', e.message);
    },
  });

  const handleCopy = useCallback(async () => {
    if (!charge) return;
    await Clipboard.setStringAsync(charge.payment_request);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }, [charge]);

  const handleReset = useCallback(() => {
    if (pollingRef.current) clearInterval(pollingRef.current);
    if (timerRef.current) clearInterval(timerRef.current);
    setCharge(null);
    setAmount('');
    setDescription('');
    setTimeLeft('');
    setCopied(false);
    successAnim.setValue(0);
    pulseAnim.setValue(1);
  }, [successAnim, pulseAnim]);

  const toggleUnit = useCallback(() => {
    setUnit((u) => {
      const next: AmountUnit = u === 'EUR' ? 'SATS' : 'EUR';
      if (amount && btcEurPrice) {
        const val = parseFloat(amount.replace(',', '.'));
        if (!isNaN(val) && val > 0) {
          if (u === 'EUR') {
            const sats = Math.round((val / btcEurPrice) * 1e8);
            setAmount(String(sats));
          } else {
            const eur = (val / 1e8) * btcEurPrice;
            setAmount(eur.toFixed(2));
          }
        }
      }
      return next;
    });
  }, [amount, btcEurPrice]);

  const sats = amountSats();
  const eur = eurValue();
  const payreq = charge?.payment_request ?? '';
  const qrValue = payreq ? `lightning:${payreq.toUpperCase()}` : '';

  return (
    <View style={styles.root}>
      <SafeAreaView style={styles.safe} edges={['top', 'bottom']}>
        <LinearGradient colors={['#0D0D1A', '#0A0A0F']} style={StyleSheet.absoluteFill} />

        <View style={styles.navbar}>
          <View style={styles.navLeft}>
            <View style={styles.zapBadge}>
              <Zap size={14} color="#F7C948" fill="#F7C948" />
            </View>
            <Text style={styles.navTitle}>Lightning Storting</Text>
          </View>
          <TouchableOpacity style={styles.closeBtn} onPress={() => router.back()} testID="close-btn">
            <X size={18} color={Colors.textSecondary} />
          </TouchableOpacity>
        </View>

        <ScrollView
          style={styles.scroll}
          contentContainerStyle={styles.scrollContent}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          {!charge ? (
            <View style={styles.formSection}>
              <View style={styles.inputCard}>
                <Text style={styles.inputLabel}>BEDRAG</Text>
                <View style={styles.amountRow}>
                  <TextInput
                    style={styles.amountInput}
                    value={amount}
                    onChangeText={setAmount}
                    placeholder={unit === 'EUR' ? '0,00' : '0'}
                    placeholderTextColor="rgba(255,255,255,0.2)"
                    keyboardType="decimal-pad"
                    autoFocus
                    testID="amount-input"
                  />
                  <TouchableOpacity style={styles.unitToggle} onPress={toggleUnit} testID="unit-toggle">
                    <Text style={styles.unitText}>{unit}</Text>
                    <ChevronDown size={12} color="#F7C948" />
                  </TouchableOpacity>
                </View>
                {sats > 0 && (
                  <View style={styles.conversionRow}>
                    {unit === 'EUR' ? (
                      <Text style={styles.conversionText}>≈ {formatSats(sats)} sats</Text>
                    ) : eur !== null ? (
                      <Text style={styles.conversionText}>
                        ≈ €{eur.toLocaleString('nl-NL', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                      </Text>
                    ) : null}
                  </View>
                )}
              </View>

              <View style={styles.inputCard}>
                <Text style={styles.inputLabel}>OMSCHRIJVING (OPTIONEEL)</Text>
                <TextInput
                  style={styles.descInput}
                  value={description}
                  onChangeText={setDescription}
                  placeholder="bijv. Bestelling #1234"
                  placeholderTextColor="rgba(255,255,255,0.2)"
                  maxLength={60}
                  returnKeyType="done"
                  testID="desc-input"
                />
              </View>

              <View style={styles.infoBox}>
                <Zap size={13} color="#F7C948" />
                <Text style={styles.infoText}>
                  Lightning facturen verlopen na 10 minuten. De betaling komt direct aan via het Lightning netwerk.
                </Text>
              </View>

              <TouchableOpacity
                style={[styles.generateBtn, (sats < 1 || createMutation.isPending) && styles.generateBtnDisabled]}
                onPress={() => createMutation.mutate()}
                disabled={sats < 1 || createMutation.isPending}
                activeOpacity={0.85}
                testID="generate-btn"
              >
                {createMutation.isPending ? (
                  <ActivityIndicator size="small" color="#000" />
                ) : (
                  <>
                    <Zap size={17} color="#000" fill="#000" />
                    <Text style={styles.generateBtnText}>Genereer factuur</Text>
                  </>
                )}
              </TouchableOpacity>
            </View>
          ) : isPaid ? (
            <Animated.View style={[styles.paidSection, { opacity: successAnim }]}>
              <View style={styles.paidIconWrap}>
                <CheckCircle size={64} color="#34C759" />
              </View>
              <Text style={styles.paidTitle}>Betaling ontvangen!</Text>
              <Text style={styles.paidAmount}>
                {formatSats(charge.amount)} sats
              </Text>
              {btcEurPrice && (
                <Text style={styles.paidEur}>
                  ≈ €{((charge.amount / 1e8) * btcEurPrice).toLocaleString('nl-NL', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                </Text>
              )}
              <Text style={styles.paidSub}>
                De betaling is bevestigd via het Lightning netwerk.
              </Text>
              <TouchableOpacity style={styles.newInvoiceBtn} onPress={handleReset} testID="new-invoice-btn">
                <RefreshCcw size={15} color="#F7C948" />
                <Text style={styles.newInvoiceBtnText}>Nieuwe factuur</Text>
              </TouchableOpacity>
            </Animated.View>
          ) : isExpired ? (
            <View style={styles.expiredSection}>
              <AlertCircle size={48} color={Colors.textTertiary} />
              <Text style={styles.expiredTitle}>Factuur verlopen</Text>
              <Text style={styles.expiredSub}>De betalingstermijn is verstreken. Maak een nieuwe factuur aan.</Text>
              <TouchableOpacity style={styles.newInvoiceBtn} onPress={handleReset} testID="retry-btn">
                <RefreshCcw size={15} color="#F7C948" />
                <Text style={styles.newInvoiceBtnText}>Opnieuw proberen</Text>
              </TouchableOpacity>
            </View>
          ) : (
            <View style={styles.invoiceSection}>
              <View style={styles.invoiceHeaderRow}>
                <View style={styles.amountBadge}>
                  <Zap size={12} color="#F7C948" fill="#F7C948" />
                  <Text style={styles.amountBadgeText}>{formatSats(charge.amount)} sats</Text>
                </View>
                {timeLeft ? (
                  <View style={styles.timerBadge}>
                    <Text style={styles.timerText}>⏱ {timeLeft}</Text>
                  </View>
                ) : null}
              </View>

              <Animated.View style={[styles.qrWrap, { transform: [{ scale: pulseAnim }] }]}>
                <View style={styles.qrInner}>
                  <QRCodeDisplay
                    value={qrValue}
                    size={220}
                    bgColor="#FFFFFF"
                    fgColor="#000000"
                  />
                  <View style={styles.qrZapOverlay}>
                    <View style={styles.qrZapBadge}>
                      <Zap size={16} color="#F7C948" fill="#F7C948" />
                    </View>
                  </View>
                </View>
              </Animated.View>

              <Text style={styles.scanHint}>Scan met een Lightning wallet</Text>

              <View style={styles.invoiceBox}>
                <Text style={styles.invoiceText} numberOfLines={3} ellipsizeMode="middle">
                  {payreq}
                </Text>
              </View>

              <TouchableOpacity
                style={[styles.copyBtn, copied && styles.copyBtnCopied]}
                onPress={handleCopy}
                activeOpacity={0.8}
                testID="copy-btn"
              >
                <Copy size={15} color={copied ? '#34C759' : '#F7C948'} />
                <Text style={[styles.copyBtnText, copied && styles.copyBtnTextCopied]}>
                  {copied ? 'Gekopieerd!' : 'Kopieer factuur'}
                </Text>
              </TouchableOpacity>

              <View style={styles.pollingRow}>
                <ActivityIndicator size="small" color="rgba(247,201,72,0.5)" />
                <Text style={styles.pollingText}>Wachten op betaling…</Text>
              </View>

              <TouchableOpacity style={styles.cancelLink} onPress={handleReset} testID="cancel-invoice-btn">
                <Text style={styles.cancelLinkText}>Annuleren</Text>
              </TouchableOpacity>
            </View>
          )}
        </ScrollView>
      </SafeAreaView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#0A0A0F' },
  safe: { flex: 1 },
  navbar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    paddingTop: 12,
    paddingBottom: 16,
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(255,255,255,0.06)',
  },
  navLeft: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  zapBadge: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: 'rgba(247,201,72,0.15)',
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: 'rgba(247,201,72,0.3)',
  },
  navTitle: { fontSize: 16, fontWeight: '800', color: Colors.text, letterSpacing: -0.3 },
  closeBtn: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: Colors.surface,
    borderWidth: 1,
    borderColor: Colors.border,
    alignItems: 'center',
    justifyContent: 'center',
  },
  scroll: { flex: 1 },
  scrollContent: { paddingHorizontal: 20, paddingTop: 24, paddingBottom: 40 },

  formSection: { gap: 14 },
  inputCard: {
    backgroundColor: Colors.surface,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: Colors.border,
    padding: 16,
    gap: 8,
  },
  inputLabel: {
    fontSize: 10,
    fontWeight: '700',
    color: Colors.textTertiary,
    letterSpacing: 1,
  },
  amountRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  amountInput: {
    flex: 1,
    fontSize: 32,
    fontWeight: '800',
    color: Colors.text,
    letterSpacing: -0.5,
    padding: 0,
    ...(Platform.OS === 'web' ? { outlineStyle: 'none' } as object : {}),
  },
  unitToggle: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: 'rgba(247,201,72,0.12)',
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: 'rgba(247,201,72,0.25)',
  },
  unitText: { fontSize: 13, fontWeight: '800', color: '#F7C948' },
  conversionRow: { marginTop: 2 },
  conversionText: { fontSize: 13, color: Colors.textTertiary, fontWeight: '500' },

  descInput: {
    fontSize: 15,
    color: Colors.text,
    padding: 0,
    ...(Platform.OS === 'web' ? { outlineStyle: 'none' } as object : {}),
  },

  infoBox: {
    flexDirection: 'row',
    gap: 10,
    backgroundColor: 'rgba(247,201,72,0.06)',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: 'rgba(247,201,72,0.15)',
    padding: 13,
    alignItems: 'flex-start',
  },
  infoText: { flex: 1, fontSize: 12, color: Colors.textSecondary, lineHeight: 18 },

  generateBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    backgroundColor: '#F7C948',
    borderRadius: 16,
    paddingVertical: 17,
    shadowColor: '#F7C948',
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.35,
    shadowRadius: 14,
    elevation: 8,
  },
  generateBtnDisabled: { opacity: 0.4, shadowOpacity: 0 },
  generateBtnText: { fontSize: 16, fontWeight: '800', color: '#000' },

  invoiceSection: { alignItems: 'center', gap: 16 },
  invoiceHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    width: '100%',
  },
  amountBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: 'rgba(247,201,72,0.12)',
    borderRadius: 20,
    paddingHorizontal: 14,
    paddingVertical: 7,
    borderWidth: 1,
    borderColor: 'rgba(247,201,72,0.25)',
  },
  amountBadgeText: { fontSize: 14, fontWeight: '800', color: '#F7C948' },
  timerBadge: {
    backgroundColor: Colors.surface,
    borderRadius: 20,
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  timerText: { fontSize: 13, fontWeight: '700', color: Colors.textSecondary, fontFamily: 'monospace' },

  qrWrap: { marginVertical: 8 },
  qrInner: {
    padding: 14,
    backgroundColor: '#FFF',
    borderRadius: 20,
    shadowColor: '#F7C948',
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.18,
    shadowRadius: 20,
    elevation: 10,
    position: 'relative',
  },
  qrZapOverlay: {
    position: 'absolute',
    bottom: -14,
    alignSelf: 'center',
    left: 0,
    right: 0,
    alignItems: 'center',
  },
  qrZapBadge: {
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: '#0A0A0F',
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 2,
    borderColor: 'rgba(247,201,72,0.4)',
  },

  scanHint: {
    marginTop: 8,
    fontSize: 13,
    color: Colors.textTertiary,
    fontWeight: '500',
  },

  invoiceBox: {
    width: '100%',
    backgroundColor: Colors.surface,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: Colors.border,
    padding: 12,
  },
  invoiceText: {
    fontSize: 10,
    color: Colors.textTertiary,
    fontFamily: 'monospace',
    lineHeight: 16,
  },

  copyBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: 'rgba(247,201,72,0.1)',
    borderRadius: 14,
    paddingVertical: 13,
    paddingHorizontal: 24,
    borderWidth: 1.5,
    borderColor: 'rgba(247,201,72,0.3)',
    width: '100%',
    justifyContent: 'center',
  },
  copyBtnCopied: {
    backgroundColor: 'rgba(52,199,89,0.1)',
    borderColor: 'rgba(52,199,89,0.3)',
  },
  copyBtnText: { fontSize: 14, fontWeight: '700', color: '#F7C948' },
  copyBtnTextCopied: { color: '#34C759' },

  pollingRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    opacity: 0.7,
  },
  pollingText: { fontSize: 12, color: Colors.textTertiary, fontWeight: '500' },

  cancelLink: { paddingVertical: 8 },
  cancelLinkText: { fontSize: 13, color: Colors.textTertiary, textDecorationLine: 'underline' },

  paidSection: { alignItems: 'center', gap: 12, paddingTop: 40 },
  paidIconWrap: {
    width: 100,
    height: 100,
    borderRadius: 50,
    backgroundColor: 'rgba(52,199,89,0.1)',
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: 'rgba(52,199,89,0.25)',
    marginBottom: 8,
  },
  paidTitle: { fontSize: 24, fontWeight: '800', color: Colors.text, letterSpacing: -0.5 },
  paidAmount: { fontSize: 20, fontWeight: '700', color: '#F7C948' },
  paidEur: { fontSize: 14, color: Colors.textSecondary, fontWeight: '500' },
  paidSub: {
    fontSize: 13,
    color: Colors.textTertiary,
    textAlign: 'center',
    lineHeight: 20,
    marginTop: 8,
    paddingHorizontal: 20,
  },

  expiredSection: { alignItems: 'center', gap: 12, paddingTop: 40 },
  expiredTitle: { fontSize: 20, fontWeight: '800', color: Colors.textSecondary },
  expiredSub: {
    fontSize: 13,
    color: Colors.textTertiary,
    textAlign: 'center',
    lineHeight: 20,
    paddingHorizontal: 20,
  },

  newInvoiceBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginTop: 16,
    backgroundColor: 'rgba(247,201,72,0.1)',
    borderRadius: 14,
    paddingVertical: 14,
    paddingHorizontal: 28,
    borderWidth: 1.5,
    borderColor: 'rgba(247,201,72,0.3)',
  },
  newInvoiceBtnText: { fontSize: 14, fontWeight: '700', color: '#F7C948' },
});
