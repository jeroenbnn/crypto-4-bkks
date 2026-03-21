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
import { X, ArrowUpRight, Zap, Clock, Gauge, Copy, CheckCircle, AlertCircle, Wallet } from 'lucide-react-native';
import { useWallet } from '@/context/wallet';
import { Colors } from '@/constants/colors';
import { MAIN_ADDRESS } from '@/utils/bitcoin';
import {
  gatherAllUTXOs,
  buildPartialSendEstimate,
  sendPartialAmount,
  broadcastTransaction,
  SendEstimate,
} from '@/utils/sweep';

const FEE_PRESETS = [
  { label: 'Traag', sublabel: '~1u+', value: 2, icon: Clock },
  { label: 'Normaal', sublabel: '~30min', value: 10, icon: Gauge },
  { label: 'Snel', sublabel: '~10min', value: 30, icon: Zap },
] as const;

function formatBtc(sats: number): string {
  return (sats / 1e8).toFixed(8);
}

function formatSats(sats: number): string {
  return sats.toLocaleString('nl-NL');
}

function formatAddress(addr: string): string {
  return `${addr.slice(0, 8)}···${addr.slice(-8)}`;
}

type SendStep = 'setup' | 'loading' | 'confirm' | 'broadcasting' | 'done';

export default function SendScreen() {
  const { addresses, getSeed } = useWallet();
  const [step, setStep] = useState<SendStep>('setup');
  const [destination, setDestination] = useState('');
  const [amountBtc, setAmountBtc] = useState('');
  const [selectedFee, setSelectedFee] = useState<number>(10);
  const [estimate, setEstimate] = useState<SendEstimate | null>(null);
  const [totalAvailable, setTotalAvailable] = useState(0);
  const [txid, setTxid] = useState<string>('');
  const [errorMsg, setErrorMsg] = useState<string>('');
  const [txidCopied, setTxidCopied] = useState(false);

  const fadeAnim = useRef(new Animated.Value(0)).current;
  const successScale = useRef(new Animated.Value(0.6)).current;

  useEffect(() => {
    Animated.timing(fadeAnim, { toValue: 1, duration: 300, useNativeDriver: true }).start();
  }, [fadeAnim]);

  useEffect(() => {
    if (step === 'done') {
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      Animated.spring(successScale, { toValue: 1, tension: 60, friction: 7, useNativeDriver: true }).start();
    }
  }, [step, successScale]);

  const isValidBtcAddress = (addr: string): boolean =>
    /^[13][a-km-zA-HJ-NP-Z1-9]{25,34}$/.test(addr) || /^bc1[a-z0-9]{39,59}$/.test(addr);

  const parsedAmountSats = Math.round(parseFloat(amountBtc || '0') * 1e8);

  const handleSetMax = () => {
    if (totalAvailable > 0) {
      const maxSats = totalAvailable;
      setAmountBtc((maxSats / 1e8).toFixed(8));
    }
  };

  const handleFetchAndEstimate = async () => {
    const trimmedDest = destination.trim();
    if (!isValidBtcAddress(trimmedDest)) {
      setErrorMsg('Voer een geldig Bitcoin-adres in.');
      return;
    }
    if (!parsedAmountSats || parsedAmountSats < 546) {
      setErrorMsg('Voer een bedrag in van minimaal 546 satoshi.');
      return;
    }
    setErrorMsg('');
    setStep('loading');

    try {
      console.log('[Send] Gathering UTXOs...');
      const allUTXOs = await gatherAllUTXOs(addresses);
      const available = allUTXOs.reduce((s, a) => s + a.total, 0);
      setTotalAvailable(available);

      if (allUTXOs.length === 0 || available === 0) {
        setStep('setup');
        setErrorMsg('Geen fondsen gevonden in de wallet.');
        return;
      }

      if (parsedAmountSats > available) {
        setStep('setup');
        setErrorMsg(`Onvoldoende saldo. Beschikbaar: ${formatBtc(available)} BTC`);
        return;
      }

      const changeAddress = addresses[0];
      const est = buildPartialSendEstimate(allUTXOs, parsedAmountSats, selectedFee, changeAddress);

      if (est.sendSats <= 546) {
        setStep('setup');
        setErrorMsg('Bedrag te laag na aftrek van networkkosten.');
        return;
      }

      setEstimate(est);
      setStep('confirm');
    } catch (e) {
      console.error('[Send] Estimate error:', e);
      setStep('setup');
      setErrorMsg('Ophalen van saldo mislukt. Probeer opnieuw.');
    }
  };

  const handleConfirmSend = async () => {
    const seed = getSeed();
    if (!seed || !estimate) return;
    setStep('broadcasting');
    try {
      const txHex = await sendPartialAmount(seed, estimate, destination.trim());
      const broadcastedTxid = await broadcastTransaction(txHex);
      setTxid(broadcastedTxid);
      setStep('done');
    } catch (e: unknown) {
      console.error('[Send] Send error:', e);
      const msg = e instanceof Error ? e.message : 'Onbekende fout';
      Alert.alert('Betaling mislukt', msg, [{ text: 'OK', onPress: () => setStep('confirm') }]);
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
              <ArrowUpRight size={18} color="#FFF" strokeWidth={2.5} />
            </View>
            <View>
              <Text style={styles.headerTitle}>Betalen</Text>
              <Text style={styles.headerSub}>Vanuit BKKS Wallet</Text>
            </View>
          </View>
          {step !== 'broadcasting' && (
            <TouchableOpacity style={styles.closeBtn} onPress={() => router.back()} testID="close-send-btn">
              <X size={17} color={Colors.textSecondary} />
            </TouchableOpacity>
          )}
        </View>

        <Animated.View style={[{ flex: 1 }, { opacity: fadeAnim }]}>
          {(step === 'setup' || step === 'loading') && (
            <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
              <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">

                <View style={styles.fromCard}>
                  <Wallet size={14} color={Colors.bitcoin} />
                  <Text style={styles.fromText}>
                    Van: <Text style={{ color: Colors.bitcoin, fontWeight: '700' }}>BKKS Wallet</Text>
                    {'  '}
                    <Text style={{ fontFamily: 'monospace', color: Colors.textTertiary, fontSize: 11 }}>
                      {formatAddress(MAIN_ADDRESS)}
                    </Text>
                  </Text>
                </View>

                <View style={styles.sectionCard}>
                  <Text style={styles.sectionLabel}>ONTVANGSTADRES</Text>
                  <View style={styles.inputRow}>
                    <TextInput
                      style={styles.input}
                      value={destination}
                      onChangeText={(t) => { setDestination(t); setErrorMsg(''); }}
                      placeholder="bc1q... of 1... of 3..."
                      placeholderTextColor={Colors.textTertiary}
                      autoCapitalize="none"
                      autoCorrect={false}
                      testID="destination-input"
                    />
                    <TouchableOpacity style={styles.pasteBtn} onPress={handlePaste}>
                      <Copy size={14} color={Colors.bitcoin} />
                      <Text style={styles.pasteBtnText}>Plak</Text>
                    </TouchableOpacity>
                  </View>
                </View>

                <View style={styles.sectionCard}>
                  <Text style={styles.sectionLabel}>BEDRAG</Text>
                  <View style={styles.inputRow}>
                    <View style={styles.amountInputWrap}>
                      <TextInput
                        style={styles.amountInput}
                        value={amountBtc}
                        onChangeText={(t) => { setAmountBtc(t.replace(',', '.')); setErrorMsg(''); }}
                        placeholder="0.00000000"
                        placeholderTextColor={Colors.textTertiary}
                        keyboardType="decimal-pad"
                        autoCorrect={false}
                        testID="amount-input"
                      />
                      <Text style={styles.amountUnit}>BTC</Text>
                    </View>
                    <TouchableOpacity style={styles.maxBtn} onPress={handleSetMax}>
                      <Text style={styles.maxBtnText}>MAX</Text>
                    </TouchableOpacity>
                  </View>
                  {parsedAmountSats > 0 && (
                    <Text style={styles.satHint}>{formatSats(parsedAmountSats)} satoshi</Text>
                  )}
                  {errorMsg ? (
                    <View style={styles.errorRow}>
                      <AlertCircle size={13} color={Colors.error} />
                      <Text style={styles.errorText}>{errorMsg}</Text>
                    </View>
                  ) : null}
                </View>

                <View style={styles.sectionCard}>
                  <Text style={styles.sectionLabel}>NETWORKKOSTEN</Text>
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
                  testID="preview-btn"
                >
                  {step === 'loading' ? (
                    <View style={styles.btnInner}>
                      <ActivityIndicator size="small" color="#FFF" />
                      <Text style={styles.primaryBtnText}>Berekening…</Text>
                    </View>
                  ) : (
                    <View style={styles.btnInner}>
                      <Gauge size={17} color="#FFF" />
                      <Text style={styles.primaryBtnText}>Voorbeeld betaling</Text>
                    </View>
                  )}
                </TouchableOpacity>
              </ScrollView>
            </KeyboardAvoidingView>
          )}

          {step === 'confirm' && estimate && (
            <ScrollView contentContainerStyle={styles.content}>
              <View style={styles.summaryHero}>
                <Text style={styles.summaryHeroLabel}>TE BETALEN</Text>
                <Text style={styles.summaryHeroAmount}>{formatBtc(estimate.sendSats)}</Text>
                <Text style={styles.summaryHeroUnit}>BTC</Text>
              </View>

              <View style={styles.sectionCard}>
                <Text style={styles.sectionLabel}>TRANSACTIEDETAILS</Text>
                <View style={styles.detailRow}>
                  <Text style={styles.detailKey}>Beschikbaar saldo</Text>
                  <Text style={styles.detailVal}>{formatSats(estimate.totalAvailableSats)} sat</Text>
                </View>
                <View style={styles.detailDivider} />
                <View style={styles.detailRow}>
                  <Text style={styles.detailKey}>Te betalen</Text>
                  <Text style={[styles.detailVal, { color: Colors.text, fontWeight: '700' }]}>{formatSats(estimate.sendSats)} sat</Text>
                </View>
                <View style={styles.detailDivider} />
                <View style={styles.detailRow}>
                  <Text style={styles.detailKey}>Networkkosten</Text>
                  <Text style={[styles.detailVal, { color: Colors.warning }]}>−{formatSats(estimate.feeSats)} sat</Text>
                </View>
                {estimate.changeSats > 0 && (
                  <>
                    <View style={styles.detailDivider} />
                    <View style={styles.detailRow}>
                      <Text style={styles.detailKey}>Wisselgeld</Text>
                      <Text style={[styles.detailVal, { color: Colors.success }]}>{formatSats(estimate.changeSats)} sat</Text>
                    </View>
                  </>
                )}
                <View style={styles.detailDivider} />
                <View style={styles.detailRow}>
                  <Text style={styles.detailKey}>Inputs</Text>
                  <Text style={styles.detailVal}>{estimate.numInputs} UTXOs uit {estimate.selectedUTXOs.length} adressen</Text>
                </View>
              </View>

              <View style={styles.sectionCard}>
                <Text style={styles.sectionLabel}>NAAR</Text>
                <Text style={styles.destAddr} selectable>{destination.trim()}</Text>
              </View>

              {estimate.changeSats > 0 && (
                <View style={styles.sectionCard}>
                  <Text style={styles.sectionLabel}>WISSELGELD NAAR</Text>
                  <Text style={styles.destAddr} selectable>{estimate.changeAddress.address}</Text>
                  <Text style={styles.changeNote}>{estimate.changeAddress.label} (HD-adres)</Text>
                </View>
              )}

              <View style={styles.warningCard}>
                <Text style={styles.warningText}>
                  ⚠️ Deze actie is onomkeerbaar. Controleer het ontvangstadres voor bevestiging.
                </Text>
              </View>

              <View style={styles.confirmBtns}>
                <TouchableOpacity style={styles.cancelBtn} onPress={() => setStep('setup')} activeOpacity={0.8}>
                  <Text style={styles.cancelBtnText}>Terug</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[styles.primaryBtn, { flex: 1, marginTop: 0 }]}
                  onPress={handleConfirmSend}
                  activeOpacity={0.85}
                  testID="confirm-send-btn"
                >
                  <View style={styles.btnInner}>
                    <ArrowUpRight size={17} color="#FFF" />
                    <Text style={styles.primaryBtnText}>Bevestig betaling</Text>
                  </View>
                </TouchableOpacity>
              </View>
            </ScrollView>
          )}

          {step === 'broadcasting' && (
            <View style={styles.centerState}>
              <ActivityIndicator size="large" color={Colors.bitcoin} />
              <Text style={styles.centerTitle}>Versturen…</Text>
              <Text style={styles.centerSub}>Transactie wordt ondertekend en verzonden naar het Bitcoin-netwerk</Text>
            </View>
          )}

          {step === 'done' && (
            <ScrollView contentContainerStyle={styles.content}>
              <Animated.View style={[styles.successHero, { transform: [{ scale: successScale }] }]}>
                <CheckCircle size={64} color={Colors.success} strokeWidth={1.5} />
                <Text style={styles.successTitle}>Betaling Geslaagd!</Text>
                <Text style={styles.successSub}>
                  {formatBtc(estimate?.sendSats ?? 0)} BTC succesvol verstuurd
                </Text>
              </Animated.View>

              <View style={styles.sectionCard}>
                <Text style={styles.sectionLabel}>TRANSACTIE-ID</Text>
                <Text style={styles.txidText} selectable numberOfLines={3}>{txid}</Text>
                <TouchableOpacity
                  style={[styles.copyTxidBtn, txidCopied && styles.copyTxidBtnSuccess]}
                  onPress={handleCopyTxid}
                  testID="copy-txid-btn"
                >
                  {txidCopied ? (
                    <>
                      <CheckCircle size={14} color={Colors.success} />
                      <Text style={[styles.copyTxidText, { color: Colors.success }]}>Gekopieerd!</Text>
                    </>
                  ) : (
                    <>
                      <Copy size={14} color={Colors.bitcoin} />
                      <Text style={styles.copyTxidText}>Kopieer TXID</Text>
                    </>
                  )}
                </TouchableOpacity>
              </View>

              <View style={styles.sectionCard}>
                <Text style={styles.sectionLabel}>BEKIJK OP EXPLORER</Text>
                <Text style={styles.explorerNote}>mempool.space/tx/{txid.slice(0, 12)}…</Text>
              </View>

              <TouchableOpacity style={styles.primaryBtn} onPress={() => router.back()} activeOpacity={0.85} testID="done-btn">
                <View style={styles.btnInner}>
                  <Text style={styles.primaryBtnText}>Klaar</Text>
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
  fromCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: 'rgba(247,147,26,0.06)',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: 'rgba(247,147,26,0.18)',
    paddingHorizontal: 14,
    paddingVertical: 10,
  },
  fromText: { fontSize: 13, color: Colors.textSecondary, flex: 1 },
  content: { padding: 20, gap: 14, paddingBottom: 40 },
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
  amountInputWrap: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: Colors.background,
    borderRadius: 10,
    borderWidth: 1.5,
    borderColor: Colors.border,
    paddingHorizontal: 12,
  },
  amountInput: {
    flex: 1,
    color: Colors.text,
    fontSize: 18,
    fontWeight: '700',
    fontFamily: 'monospace',
    paddingVertical: 10,
  },
  amountUnit: {
    fontSize: 13,
    fontWeight: '700',
    color: Colors.bitcoin,
    marginLeft: 6,
  },
  satHint: {
    fontSize: 11,
    color: Colors.textTertiary,
    fontFamily: 'monospace',
  },
  maxBtn: {
    backgroundColor: 'rgba(247,147,26,0.12)',
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderWidth: 1,
    borderColor: 'rgba(247,147,26,0.25)',
  },
  maxBtnText: { fontSize: 12, fontWeight: '800', color: Colors.bitcoin, letterSpacing: 0.5 },
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
  changeNote: {
    fontSize: 11,
    color: Colors.textTertiary,
    marginTop: -4,
  },
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
