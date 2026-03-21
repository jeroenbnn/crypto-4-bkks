import React, { useState, useEffect, useRef } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TextInput,
  TouchableOpacity,
  ActivityIndicator,
  Alert,
  Animated,
  KeyboardAvoidingView,
  Platform,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import * as Clipboard from 'expo-clipboard';
import * as Haptics from 'expo-haptics';
import { X, ArrowRight, Zap, Clock, Gauge, Copy, CheckCircle, AlertCircle } from 'lucide-react-native';
import { useWallet } from '@/context/wallet';
import { Colors } from '@/constants/colors';
import {
  gatherAllUTXOs,
  buildSweepEstimate,
  sweepToAddress,
  broadcastTransaction,
  SweepEstimate,
} from '@/utils/sweep';

const FEE_PRESETS = [
  { label: 'Slow', sublabel: '~1h+', value: 2, icon: Clock },
  { label: 'Medium', sublabel: '~30min', value: 10, icon: Gauge },
  { label: 'Fast', sublabel: '~10min', value: 30, icon: Zap },
] as const;

function formatBtc(sats: number): string {
  return (sats / 1e8).toFixed(8);
}

function formatSats(sats: number): string {
  return sats.toLocaleString('en-US');
}

type SweepStep = 'setup' | 'loading' | 'confirm' | 'broadcasting' | 'done';

export default function SweepScreen() {
  const { addresses, getSeed } = useWallet();
  const [step, setStep] = useState<SweepStep>('setup');
  const [destination, setDestination] = useState('');
  const [selectedFee, setSelectedFee] = useState<number>(10);
  const [estimate, setEstimate] = useState<SweepEstimate | null>(null);
  const [txid, setTxid] = useState<string>('');
  const [errorMsg, setErrorMsg] = useState<string>('');
  const [txidCopied, setTxidCopied] = useState(false);

  const fadeAnim = useRef(new Animated.Value(0)).current;
  const successScale = useRef(new Animated.Value(0.6)).current;

  useEffect(() => {
    Animated.timing(fadeAnim, {
      toValue: 1,
      duration: 300,
      useNativeDriver: true,
    }).start();
  }, [fadeAnim]);

  useEffect(() => {
    if (step === 'done') {
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      Animated.spring(successScale, {
        toValue: 1,
        tension: 60,
        friction: 7,
        useNativeDriver: true,
      }).start();
    }
  }, [step, successScale]);

  const isValidBtcAddress = (addr: string): boolean => {
    return /^[13][a-km-zA-HJ-NP-Z1-9]{25,34}$/.test(addr) ||
      /^bc1[a-z0-9]{39,59}$/.test(addr);
  };

  const handleFetchAndEstimate = async () => {
    const trimmed = destination.trim();
    if (!isValidBtcAddress(trimmed)) {
      setErrorMsg('Please enter a valid Bitcoin address.');
      return;
    }
    setErrorMsg('');
    setStep('loading');
    try {
      console.log('[Sweep] Gathering UTXOs for all addresses...');
      const allUTXOs = await gatherAllUTXOs(addresses);
      if (allUTXOs.length === 0) {
        setStep('setup');
        setErrorMsg('No funds found across any of your addresses.');
        return;
      }
      const est = buildSweepEstimate(allUTXOs, selectedFee);
      if (est.netSats <= 546) {
        setStep('setup');
        setErrorMsg('Insufficient funds to cover network fee.');
        return;
      }
      setEstimate(est);
      setStep('confirm');
    } catch (e) {
      console.error('[Sweep] Estimate error:', e);
      setStep('setup');
      setErrorMsg('Failed to fetch balances. Try again.');
    }
  };

  const handleConfirmSweep = async () => {
    const seed = getSeed();
    if (!seed || !estimate) return;
    setStep('broadcasting');
    try {
      const txHex = await sweepToAddress(seed, estimate.addressesWithFunds, destination.trim(), selectedFee);
      const broadcastedTxid = await broadcastTransaction(txHex);
      setTxid(broadcastedTxid);
      setStep('done');
    } catch (e: unknown) {
      console.error('[Sweep] Sweep error:', e);
      const msg = e instanceof Error ? e.message : 'Unknown error';
      Alert.alert('Sweep Failed', msg, [{ text: 'OK', onPress: () => setStep('confirm') }]);
    }
  };

  const handleCopyTxid = async () => {
    await Clipboard.setStringAsync(txid);
    setTxidCopied(true);
    setTimeout(() => setTxidCopied(false), 2500);
  };

  const handlePaste = async () => {
    const text = await Clipboard.getStringAsync();
    if (text) setDestination(text.trim());
  };

  return (
    <View style={styles.container}>
      <SafeAreaView style={styles.safeArea} edges={['top', 'bottom']}>
        <View style={styles.header}>
          <View style={styles.headerLeft}>
            <View style={styles.headerIcon}>
              <Text style={styles.headerIconText}>₿</Text>
            </View>
            <View>
              <Text style={styles.headerTitle}>Sweep Funds</Text>
              <Text style={styles.headerSub}>Consolidate all to one address</Text>
            </View>
          </View>
          {step !== 'broadcasting' && (
            <TouchableOpacity style={styles.closeBtn} onPress={() => router.back()} testID="close-sweep-btn">
              <X size={17} color={Colors.textSecondary} />
            </TouchableOpacity>
          )}
        </View>

        <Animated.View style={[{ flex: 1 }, { opacity: fadeAnim }]}>
          {(step === 'setup' || step === 'loading') && (
            <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
              <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">

                <View style={styles.infoCard}>
                  <View style={styles.infoRow}>
                    <View style={styles.infoIconWrap}>
                      <ArrowRight size={14} color={Colors.bitcoin} />
                    </View>
                    <Text style={styles.infoText}>
                      Sends all funds from <Text style={{ color: Colors.bitcoin, fontWeight: '700' }}>{addresses.length} addresses</Text> to a single destination address in one transaction.
                    </Text>
                  </View>
                </View>

                <View style={styles.sectionCard}>
                  <Text style={styles.sectionLabel}>DESTINATION ADDRESS</Text>
                  <View style={styles.inputRow}>
                    <TextInput
                      style={styles.input}
                      value={destination}
                      onChangeText={(t) => { setDestination(t); setErrorMsg(''); }}
                      placeholder="bc1q... or 1... or 3..."
                      placeholderTextColor={Colors.textTertiary}
                      autoCapitalize="none"
                      autoCorrect={false}
                      testID="destination-input"
                    />
                    <TouchableOpacity style={styles.pasteBtn} onPress={handlePaste}>
                      <Copy size={14} color={Colors.bitcoin} />
                      <Text style={styles.pasteBtnText}>Paste</Text>
                    </TouchableOpacity>
                  </View>
                  {errorMsg ? (
                    <View style={styles.errorRow}>
                      <AlertCircle size={13} color={Colors.error} />
                      <Text style={styles.errorText}>{errorMsg}</Text>
                    </View>
                  ) : null}
                </View>

                <View style={styles.sectionCard}>
                  <Text style={styles.sectionLabel}>NETWORK FEE</Text>
                  <View style={styles.feeGrid}>
                    {FEE_PRESETS.map((preset) => {
                      const Icon = preset.icon;
                      const selected = selectedFee === preset.value;
                      return (
                        <TouchableOpacity
                          key={preset.value}
                          style={[styles.feeOption, selected && styles.feeOptionSelected]}
                          onPress={() => setSelectedFee(preset.value)}
                          testID={`fee-${preset.label.toLowerCase()}`}
                        >
                          <Icon size={16} color={selected ? Colors.bitcoin : Colors.textTertiary} />
                          <Text style={[styles.feeLabel, selected && styles.feeLabelSelected]}>{preset.label}</Text>
                          <Text style={[styles.feeSub, selected && styles.feeSubSelected]}>{preset.sublabel}</Text>
                          <Text style={[styles.feeRate, selected && styles.feeRateSelected]}>{preset.value} sat/vB</Text>
                        </TouchableOpacity>
                      );
                    })}
                  </View>
                </View>

                <TouchableOpacity
                  style={[styles.primaryBtn, step === 'loading' && styles.primaryBtnDisabled]}
                  onPress={handleFetchAndEstimate}
                  disabled={step === 'loading'}
                  activeOpacity={0.85}
                  testID="estimate-btn"
                >
                  {step === 'loading' ? (
                    <View style={styles.btnInner}>
                      <ActivityIndicator size="small" color="#FFF" />
                      <Text style={styles.primaryBtnText}>Scanning balances…</Text>
                    </View>
                  ) : (
                    <View style={styles.btnInner}>
                      <Gauge size={17} color="#FFF" />
                      <Text style={styles.primaryBtnText}>Preview Sweep</Text>
                    </View>
                  )}
                </TouchableOpacity>
              </ScrollView>
            </KeyboardAvoidingView>
          )}

          {step === 'confirm' && estimate && (
            <ScrollView contentContainerStyle={styles.content}>
              <View style={styles.summaryHero}>
                <Text style={styles.summaryHeroLabel}>SENDING</Text>
                <Text style={styles.summaryHeroAmount}>{formatBtc(estimate.netSats)}</Text>
                <Text style={styles.summaryHeroUnit}>BTC</Text>
              </View>

              <View style={styles.sectionCard}>
                <Text style={styles.sectionLabel}>TRANSACTION DETAILS</Text>
                <View style={styles.detailRow}>
                  <Text style={styles.detailKey}>Total balance</Text>
                  <Text style={styles.detailVal}>{formatSats(estimate.totalSats)} sat</Text>
                </View>
                <View style={styles.detailDivider} />
                <View style={styles.detailRow}>
                  <Text style={styles.detailKey}>Network fee</Text>
                  <Text style={[styles.detailVal, { color: Colors.warning }]}>−{formatSats(estimate.feeSats)} sat</Text>
                </View>
                <View style={styles.detailDivider} />
                <View style={styles.detailRow}>
                  <Text style={[styles.detailKey, { color: Colors.text, fontWeight: '700' }]}>You receive</Text>
                  <Text style={[styles.detailVal, { color: Colors.success, fontWeight: '700' }]}>{formatSats(estimate.netSats)} sat</Text>
                </View>
                <View style={styles.detailDivider} />
                <View style={styles.detailRow}>
                  <Text style={styles.detailKey}>Inputs</Text>
                  <Text style={styles.detailVal}>{estimate.numInputs} UTXOs from {estimate.addressesWithFunds.length} addresses</Text>
                </View>
              </View>

              <View style={styles.sectionCard}>
                <Text style={styles.sectionLabel}>DESTINATION</Text>
                <Text style={styles.destAddr} selectable>{destination.trim()}</Text>
              </View>

              <View style={styles.sourceCard}>
                <Text style={styles.sectionLabel}>ADDRESSES WITH FUNDS</Text>
                {estimate.addressesWithFunds.map(({ address, total }) => (
                  <View key={address.address} style={styles.sourceRow}>
                    <View style={styles.sourceLeft}>
                      <View style={styles.sourceDot} />
                      <Text style={styles.sourceLabel}>{address.alias || address.label}</Text>
                    </View>
                    <Text style={styles.sourceAmount}>{formatBtc(total)} BTC</Text>
                  </View>
                ))}
              </View>

              <View style={styles.warningCard}>
                <Text style={styles.warningText}>
                  ⚠️ This action is irreversible. Double-check the destination address before confirming.
                </Text>
              </View>

              <View style={styles.confirmBtns}>
                <TouchableOpacity
                  style={styles.cancelBtn}
                  onPress={() => setStep('setup')}
                  activeOpacity={0.8}
                >
                  <Text style={styles.cancelBtnText}>Back</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[styles.primaryBtn, { flex: 1, marginTop: 0 }]}
                  onPress={handleConfirmSweep}
                  activeOpacity={0.85}
                  testID="confirm-sweep-btn"
                >
                  <View style={styles.btnInner}>
                    <ArrowRight size={17} color="#FFF" />
                    <Text style={styles.primaryBtnText}>Confirm Sweep</Text>
                  </View>
                </TouchableOpacity>
              </View>
            </ScrollView>
          )}

          {step === 'broadcasting' && (
            <View style={styles.centerState}>
              <ActivityIndicator size="large" color={Colors.bitcoin} />
              <Text style={styles.centerTitle}>Broadcasting…</Text>
              <Text style={styles.centerSub}>Signing and sending your transaction to the Bitcoin network</Text>
            </View>
          )}

          {step === 'done' && (
            <ScrollView contentContainerStyle={styles.content}>
              <Animated.View style={[styles.successHero, { transform: [{ scale: successScale }] }]}>
                <CheckCircle size={64} color={Colors.success} strokeWidth={1.5} />
                <Text style={styles.successTitle}>Sweep Complete!</Text>
                <Text style={styles.successSub}>
                  {formatBtc(estimate?.netSats ?? 0)} BTC sent successfully
                </Text>
              </Animated.View>

              <View style={styles.sectionCard}>
                <Text style={styles.sectionLabel}>TRANSACTION ID</Text>
                <Text style={styles.txidText} selectable numberOfLines={3}>{txid}</Text>
                <TouchableOpacity
                  style={[styles.copyTxidBtn, txidCopied && styles.copyTxidBtnSuccess]}
                  onPress={handleCopyTxid}
                  testID="copy-txid-btn"
                >
                  {txidCopied ? (
                    <>
                      <CheckCircle size={14} color={Colors.success} />
                      <Text style={[styles.copyTxidText, { color: Colors.success }]}>Copied!</Text>
                    </>
                  ) : (
                    <>
                      <Copy size={14} color={Colors.bitcoin} />
                      <Text style={styles.copyTxidText}>Copy TXID</Text>
                    </>
                  )}
                </TouchableOpacity>
              </View>

              <View style={styles.sectionCard}>
                <Text style={styles.sectionLabel}>VIEW ON EXPLORER</Text>
                <Text style={styles.explorerNote}>
                  mempool.space/tx/{txid.slice(0, 12)}…
                </Text>
              </View>

              <TouchableOpacity
                style={styles.primaryBtn}
                onPress={() => router.back()}
                activeOpacity={0.85}
                testID="done-btn"
              >
                <View style={styles.btnInner}>
                  <Text style={styles.primaryBtnText}>Done</Text>
                </View>
              </TouchableOpacity>
            </ScrollView>
          )}
        </Animated.View>
      </SafeAreaView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.background },
  safeArea: { flex: 1 },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    paddingVertical: 16,
    borderBottomWidth: 1,
    borderBottomColor: Colors.border,
  },
  headerLeft: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  headerIcon: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: Colors.bitcoin,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: Colors.bitcoin,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.4,
    shadowRadius: 8,
    elevation: 6,
  },
  headerIconText: { fontSize: 16, color: '#FFF', fontWeight: '800' },
  headerTitle: { fontSize: 17, fontWeight: '700', color: Colors.text },
  headerSub: { fontSize: 11, color: Colors.textTertiary, marginTop: 1 },
  closeBtn: {
    width: 34,
    height: 34,
    borderRadius: 17,
    backgroundColor: Colors.surface,
    borderWidth: 1,
    borderColor: Colors.border,
    alignItems: 'center',
    justifyContent: 'center',
  },
  content: { padding: 20, gap: 14, paddingBottom: 40 },
  infoCard: {
    backgroundColor: 'rgba(247,147,26,0.06)',
    borderRadius: 14,
    borderWidth: 1,
    borderColor: 'rgba(247,147,26,0.18)',
    padding: 14,
  },
  infoRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 10 },
  infoIconWrap: {
    width: 26,
    height: 26,
    borderRadius: 13,
    backgroundColor: 'rgba(247,147,26,0.15)',
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 1,
  },
  infoText: { flex: 1, fontSize: 13, color: Colors.textSecondary, lineHeight: 20 },
  sectionCard: {
    backgroundColor: Colors.surface,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: Colors.border,
    padding: 16,
    gap: 12,
  },
  sectionLabel: {
    fontSize: 10,
    fontWeight: '700',
    color: Colors.textTertiary,
    letterSpacing: 1.1,
  },
  inputRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  input: {
    flex: 1,
    backgroundColor: Colors.background,
    borderRadius: 10,
    borderWidth: 1.5,
    borderColor: Colors.border,
    paddingHorizontal: 12,
    paddingVertical: 10,
    color: Colors.text,
    fontSize: 13,
    fontFamily: 'monospace',
  },
  pasteBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    backgroundColor: 'rgba(247,147,26,0.1)',
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 10,
  },
  pasteBtnText: { fontSize: 12, fontWeight: '700', color: Colors.bitcoin },
  errorRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  errorText: { fontSize: 12, color: Colors.error, fontWeight: '500' },
  feeGrid: { flexDirection: 'row', gap: 8 },
  feeOption: {
    flex: 1,
    backgroundColor: Colors.background,
    borderRadius: 12,
    borderWidth: 1.5,
    borderColor: Colors.border,
    padding: 12,
    alignItems: 'center',
    gap: 4,
  },
  feeOptionSelected: {
    borderColor: Colors.bitcoin,
    backgroundColor: 'rgba(247,147,26,0.08)',
  },
  feeLabel: { fontSize: 13, fontWeight: '700', color: Colors.textSecondary },
  feeLabelSelected: { color: Colors.bitcoin },
  feeSub: { fontSize: 10, color: Colors.textTertiary },
  feeSubSelected: { color: Colors.bitcoinLight },
  feeRate: { fontSize: 10, color: Colors.textTertiary, fontFamily: 'monospace' },
  feeRateSelected: { color: Colors.bitcoin },
  primaryBtn: {
    backgroundColor: Colors.bitcoin,
    borderRadius: 16,
    paddingVertical: 16,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 6,
    shadowColor: Colors.bitcoin,
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.35,
    shadowRadius: 12,
    elevation: 8,
  },
  primaryBtnDisabled: { opacity: 0.6 },
  btnInner: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  primaryBtnText: { fontSize: 16, fontWeight: '800', color: '#FFF', letterSpacing: -0.2 },
  summaryHero: {
    alignItems: 'center',
    paddingVertical: 28,
    gap: 4,
  },
  summaryHeroLabel: {
    fontSize: 11,
    fontWeight: '700',
    color: Colors.textTertiary,
    letterSpacing: 1.5,
  },
  summaryHeroAmount: {
    fontSize: 40,
    fontWeight: '900',
    color: Colors.text,
    letterSpacing: -1.5,
    fontFamily: 'monospace',
  },
  summaryHeroUnit: {
    fontSize: 16,
    fontWeight: '700',
    color: Colors.bitcoin,
    letterSpacing: 1,
  },
  detailRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  detailDivider: { height: 1, backgroundColor: Colors.border },
  detailKey: { fontSize: 13, color: Colors.textSecondary },
  detailVal: { fontSize: 13, color: Colors.text, fontFamily: 'monospace', fontWeight: '600' },
  destAddr: {
    fontSize: 13,
    color: Colors.textSecondary,
    fontFamily: 'monospace',
    lineHeight: 20,
  },
  sourceCard: {
    backgroundColor: Colors.surface,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: Colors.border,
    padding: 16,
    gap: 10,
  },
  sourceRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  sourceLeft: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  sourceDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: Colors.bitcoin,
  },
  sourceLabel: { fontSize: 13, color: Colors.text, fontWeight: '600' },
  sourceAmount: { fontSize: 12, color: Colors.textSecondary, fontFamily: 'monospace' },
  warningCard: {
    backgroundColor: 'rgba(255,59,48,0.06)',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: 'rgba(255,59,48,0.18)',
    padding: 14,
  },
  warningText: { fontSize: 13, color: Colors.error, lineHeight: 20 },
  confirmBtns: { flexDirection: 'row', gap: 10, marginTop: 6 },
  cancelBtn: {
    paddingVertical: 16,
    paddingHorizontal: 22,
    borderRadius: 16,
    borderWidth: 1.5,
    borderColor: Colors.border,
    alignItems: 'center',
    justifyContent: 'center',
  },
  cancelBtnText: { fontSize: 15, fontWeight: '700', color: Colors.textSecondary },
  centerState: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 20,
    paddingHorizontal: 40,
  },
  centerTitle: { fontSize: 22, fontWeight: '800', color: Colors.text, letterSpacing: -0.5 },
  centerSub: { fontSize: 14, color: Colors.textSecondary, textAlign: 'center', lineHeight: 22 },
  successHero: {
    alignItems: 'center',
    paddingVertical: 36,
    gap: 12,
  },
  successTitle: { fontSize: 26, fontWeight: '900', color: Colors.text, letterSpacing: -0.5 },
  successSub: { fontSize: 14, color: Colors.textSecondary, fontWeight: '500' },
  txidText: {
    fontSize: 12,
    color: Colors.textSecondary,
    fontFamily: 'monospace',
    lineHeight: 19,
  },
  copyTxidBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: 'rgba(247,147,26,0.1)',
    borderRadius: 8,
    paddingVertical: 8,
    paddingHorizontal: 12,
    alignSelf: 'flex-start',
  },
  copyTxidBtnSuccess: { backgroundColor: 'rgba(52,199,89,0.1)' },
  copyTxidText: { fontSize: 12, fontWeight: '700', color: Colors.bitcoin },
  explorerNote: {
    fontSize: 12,
    color: Colors.textTertiary,
    fontFamily: 'monospace',
  },
});
