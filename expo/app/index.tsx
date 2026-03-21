import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  Animated,
  TextInput,
  ScrollView,
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  Dimensions,
} from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { router } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { AlertCircle, ArrowLeft, Fingerprint, ScanFace, ShieldCheck } from 'lucide-react-native';
import { useWallet } from '@/context/wallet';
import { useLanguage } from '@/context/language';
import { Colors } from '@/constants/colors';
import { authenticateWithBiometrics, getSupportedBiometricType, BiometricType } from '@/utils/biometrics';

const { height } = Dimensions.get('window');

type ScreenView = 'welcome' | 'import' | 'locked';

export default function WelcomeScreen() {
  const {
    initialized,
    hasWallet,
    createWallet,
    importWallet,
    isCreating,
    isImporting,
    importError,
  } = useWallet();

  const { t } = useLanguage();

  const [view, setView] = useState<ScreenView>('welcome');
  const [seedInput, setSeedInput] = useState('');
  const [biometricType, setBiometricType] = useState<BiometricType>('none');
  const [authError, setAuthError] = useState<string | null>(null);
  const [isAuthenticating, setIsAuthenticating] = useState(false);
  const prevHasWalletRef = useRef(false);

  const fadeAnim = useRef(new Animated.Value(0)).current;
  const pulseScale = useRef(new Animated.Value(1)).current;
  const pulseOpacity = useRef(new Animated.Value(0.4)).current;
  const lockFadeAnim = useRef(new Animated.Value(0)).current;
  const lockScaleAnim = useRef(new Animated.Value(0.9)).current;

  useEffect(() => {
    void getSupportedBiometricType().then(setBiometricType);
  }, []);

  useEffect(() => {
    if (initialized && hasWallet) {
      const wasLocked = !prevHasWalletRef.current;
      prevHasWalletRef.current = true;
      setView('locked');
      if (wasLocked) {
        lockFadeAnim.setValue(0);
        lockScaleAnim.setValue(0.9);
      }
      Animated.parallel([
        Animated.timing(lockFadeAnim, { toValue: 1, duration: 600, useNativeDriver: true }),
        Animated.spring(lockScaleAnim, { toValue: 1, useNativeDriver: true, speed: 8, bounciness: 6 }),
      ]).start();
    } else if (initialized && !hasWallet) {
      prevHasWalletRef.current = false;
    }
  }, [initialized, hasWallet, lockFadeAnim, lockScaleAnim]);

  useEffect(() => {
    Animated.timing(fadeAnim, {
      toValue: 1,
      duration: 900,
      useNativeDriver: true,
    }).start();

    Animated.loop(
      Animated.parallel([
        Animated.sequence([
          Animated.timing(pulseScale, { toValue: 1.4, duration: 2400, useNativeDriver: true }),
          Animated.timing(pulseScale, { toValue: 1, duration: 2400, useNativeDriver: true }),
        ]),
        Animated.sequence([
          Animated.timing(pulseOpacity, { toValue: 0.75, duration: 2400, useNativeDriver: true }),
          Animated.timing(pulseOpacity, { toValue: 0.25, duration: 2400, useNativeDriver: true }),
        ]),
      ])
    ).start();
  }, [fadeAnim, pulseScale, pulseOpacity]);

  const handleUnlock = useCallback(async () => {
    setIsAuthenticating(true);
    setAuthError(null);
    const result = await authenticateWithBiometrics('Unlock your Bitcoin Wallet');
    setIsAuthenticating(false);
    if (result.success) {
      router.replace('/wallet');
    } else {
      setAuthError(t.index.authFailed);
    }
  }, [t]);

  useEffect(() => {
    if (view === 'locked') {
      void handleUnlock();
    }
  }, [view]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!initialized) {
    return (
      <View style={styles.loadingContainer}>
        <ActivityIndicator size="large" color={Colors.bitcoin} />
      </View>
    );
  }

  const lockSubtitle =
    biometricType === 'face'
      ? t.index.useFaceId
      : biometricType === 'fingerprint'
      ? t.index.useTouchId
      : t.index.usePasscode;

  const unlockBtnLabel =
    biometricType === 'face'
      ? t.index.unlockFaceId
      : biometricType === 'fingerprint'
      ? t.index.unlockTouchId
      : t.index.unlockPasscode;

  if (view === 'locked') {
    return (
      <View style={styles.container}>
        <LinearGradient
          colors={['#0D0A0A', '#0A0A0F', '#090D0D']}
          style={StyleSheet.absoluteFill}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 1 }}
        />
        <SafeAreaView style={styles.safeArea}>
          <Animated.View
            style={[
              styles.lockContent,
              { opacity: lockFadeAnim, transform: [{ scale: lockScaleAnim }] },
            ]}
          >
            <View style={styles.lockIconWrapper}>
              <Animated.View
                style={[
                  styles.lockGlow,
                  { transform: [{ scale: pulseScale }], opacity: pulseOpacity },
                ]}
              />
              <View style={styles.lockCircle}>
                <ShieldCheck size={44} color={Colors.bitcoin} strokeWidth={1.5} />
              </View>
            </View>

            <View style={styles.lockTextSection}>
              <Text style={styles.lockTitle}>{t.wallet.title}</Text>
              <Text style={styles.lockSubtitle}>{lockSubtitle}</Text>
            </View>

            {authError ? (
              <View style={styles.authErrorCard}>
                <AlertCircle size={15} color={Colors.error} />
                <Text style={styles.authErrorText}>{authError}</Text>
              </View>
            ) : null}

            <TouchableOpacity
              style={styles.unlockBtn}
              onPress={handleUnlock}
              activeOpacity={0.85}
              disabled={isAuthenticating}
              testID="unlock-btn"
            >
              <LinearGradient
                colors={['#F7931A', '#DE7C0E']}
                style={styles.unlockBtnGradient}
                start={{ x: 0, y: 0 }}
                end={{ x: 1, y: 0 }}
              >
                {isAuthenticating ? (
                  <ActivityIndicator color="#FFF" />
                ) : (
                  <View style={styles.unlockBtnInner}>
                    {biometricType === 'face' ? (
                      <ScanFace size={20} color="#FFF" />
                    ) : biometricType === 'fingerprint' ? (
                      <Fingerprint size={20} color="#FFF" />
                    ) : null}
                    <Text style={styles.unlockBtnText}>{unlockBtnLabel}</Text>
                  </View>
                )}
              </LinearGradient>
            </TouchableOpacity>
          </Animated.View>
        </SafeAreaView>
      </View>
    );
  }

  if (view === 'import') {
    return (
      <View style={styles.container}>
        <LinearGradient
          colors={['#0D0A0A', '#0A0A0F', '#090D0D']}
          style={StyleSheet.absoluteFill}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 1 }}
        />
        <KeyboardAvoidingView
          style={{ flex: 1 }}
          behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        >
          <SafeAreaView style={styles.safeArea}>
            <ScrollView
              contentContainerStyle={styles.importContent}
              keyboardShouldPersistTaps="handled"
              showsVerticalScrollIndicator={false}
            >
              <TouchableOpacity
                style={styles.backButton}
                onPress={() => { setView('welcome'); setSeedInput(''); }}
              >
                <ArrowLeft size={18} color={Colors.textSecondary} />
                <Text style={styles.backButtonText}>{t.index.back}</Text>
              </TouchableOpacity>

              <View style={styles.importHeader}>
                <View style={styles.importIconRow}>
                  <View style={styles.smallBtcBadge}>
                    <Text style={styles.smallBtcText}>₿</Text>
                  </View>
                </View>
                <Text style={styles.importTitle}>{t.index.importTitle}</Text>
                <Text style={styles.importSubtitle}>{t.index.importSubtitle}</Text>
              </View>

              <View style={styles.inputContainer}>
                <TextInput
                  style={styles.seedInput}
                  value={seedInput}
                  onChangeText={setSeedInput}
                  placeholder={t.index.importPlaceholder}
                  placeholderTextColor={Colors.textTertiary}
                  multiline
                  numberOfLines={5}
                  autoCapitalize="none"
                  autoCorrect={false}
                  spellCheck={false}
                  testID="seed-input"
                />
              </View>

              {importError ? (
                <View style={styles.errorContainer}>
                  <AlertCircle size={15} color={Colors.error} />
                  <Text style={styles.errorText}>{importError}</Text>
                </View>
              ) : null}

              <TouchableOpacity
                style={[styles.primaryButton, { marginTop: 16 }]}
                onPress={() => importWallet(seedInput)}
                activeOpacity={0.85}
                disabled={isImporting || !seedInput.trim()}
                testID="import-confirm-btn"
              >
                <LinearGradient
                  colors={['#F7931A', '#DE7C0E']}
                  style={styles.primaryButtonGradient}
                  start={{ x: 0, y: 0 }}
                  end={{ x: 1, y: 0 }}
                >
                  {isImporting ? (
                    <ActivityIndicator color="#FFF" />
                  ) : (
                    <Text style={styles.primaryButtonText}>{t.index.importConfirm}</Text>
                  )}
                </LinearGradient>
              </TouchableOpacity>

              <Text style={styles.importFooter}>{t.index.importFooter}</Text>
            </ScrollView>
          </SafeAreaView>
        </KeyboardAvoidingView>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <LinearGradient
        colors={['#0D0A0A', '#0A0A0F', '#090D0D']}
        style={StyleSheet.absoluteFill}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
      />
      <SafeAreaView style={styles.safeArea}>
        <Animated.View style={[styles.content, { opacity: fadeAnim }]}>
          <View style={styles.symbolSection}>
            <Animated.View
              style={[
                styles.glowRingOuter,
                { transform: [{ scale: pulseScale }], opacity: pulseOpacity },
              ]}
            />
            <Animated.View
              style={[
                styles.glowRingInner,
                { transform: [{ scale: pulseScale }], opacity: pulseOpacity },
              ]}
            />
            <View style={styles.symbolCircle}>
              <Text style={styles.symbolText}>₿</Text>
            </View>
          </View>

          <View style={styles.titleSection}>
            <Text style={styles.title}>{t.wallet.title}</Text>
            <Text style={styles.subtitle}>
              {t.index.yourKeys}{'\n'}{t.index.nonCustodial}
            </Text>
          </View>

          <View style={styles.actionsSection}>
            <TouchableOpacity
              style={styles.primaryButton}
              onPress={() => createWallet()}
              activeOpacity={0.85}
              disabled={isCreating}
              testID="create-wallet-btn"
            >
              <LinearGradient
                colors={['#F7931A', '#DE7C0E']}
                style={styles.primaryButtonGradient}
                start={{ x: 0, y: 0 }}
                end={{ x: 1, y: 0 }}
              >
                {isCreating ? (
                  <ActivityIndicator color="#FFF" />
                ) : (
                  <Text style={styles.primaryButtonText}>{t.index.createWallet}</Text>
                )}
              </LinearGradient>
            </TouchableOpacity>

            <TouchableOpacity
              style={styles.secondaryButton}
              onPress={() => setView('import')}
              activeOpacity={0.7}
              testID="import-wallet-btn"
            >
              <Text style={styles.secondaryButtonText}>{t.index.importWallet}</Text>
            </TouchableOpacity>
          </View>

          <View style={styles.footerRow}>
            <View style={styles.footerPill}>
              <Text style={styles.footerText}>BIP44</Text>
            </View>
            <View style={styles.footerPill}>
              <Text style={styles.footerText}>HD Wallet</Text>
            </View>
            <View style={styles.footerPill}>
              <Text style={styles.footerText}>Multi-Address</Text>
            </View>
          </View>
        </Animated.View>
      </SafeAreaView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: Colors.background,
  },
  loadingContainer: {
    flex: 1,
    backgroundColor: Colors.background,
    justifyContent: 'center',
    alignItems: 'center',
  },
  safeArea: {
    flex: 1,
  },
  content: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 28,
    paddingTop: height * 0.07,
    paddingBottom: 36,
  },
  symbolSection: {
    alignItems: 'center',
    justifyContent: 'center',
    width: 200,
    height: 200,
  },
  glowRingOuter: {
    position: 'absolute',
    width: 180,
    height: 180,
    borderRadius: 90,
    backgroundColor: Colors.bitcoin,
    opacity: 0.12,
  },
  glowRingInner: {
    position: 'absolute',
    width: 140,
    height: 140,
    borderRadius: 70,
    backgroundColor: Colors.bitcoin,
    opacity: 0.18,
  },
  symbolCircle: {
    width: 108,
    height: 108,
    borderRadius: 54,
    backgroundColor: Colors.surface,
    borderWidth: 2,
    borderColor: Colors.bitcoin,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: Colors.bitcoin,
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.9,
    shadowRadius: 24,
    elevation: 20,
  },
  symbolText: {
    fontSize: 52,
    color: Colors.bitcoin,
    fontWeight: '800',
  },
  titleSection: {
    alignItems: 'center',
    gap: 12,
  },
  title: {
    fontSize: 36,
    fontWeight: '800',
    color: Colors.text,
    letterSpacing: -0.8,
  },
  subtitle: {
    fontSize: 15,
    color: Colors.textSecondary,
    textAlign: 'center',
    lineHeight: 23,
  },
  actionsSection: {
    width: '100%',
    gap: 12,
  },
  primaryButton: {
    width: '100%',
    borderRadius: 16,
    overflow: 'hidden',
  },
  primaryButtonGradient: {
    paddingVertical: 17,
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 56,
  },
  primaryButtonText: {
    fontSize: 16,
    fontWeight: '700',
    color: '#FFFFFF',
    letterSpacing: 0.2,
  },
  secondaryButton: {
    width: '100%',
    paddingVertical: 17,
    borderRadius: 16,
    borderWidth: 1.5,
    borderColor: Colors.border,
    alignItems: 'center',
  },
  secondaryButtonText: {
    fontSize: 16,
    fontWeight: '600',
    color: Colors.textSecondary,
  },
  footerRow: {
    flexDirection: 'row',
    gap: 8,
  },
  footerPill: {
    backgroundColor: Colors.surface,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: Colors.border,
    paddingHorizontal: 12,
    paddingVertical: 5,
  },
  footerText: {
    fontSize: 11,
    color: Colors.textTertiary,
    fontWeight: '600',
    letterSpacing: 0.3,
  },
  importContent: {
    flexGrow: 1,
    paddingHorizontal: 24,
    paddingBottom: 48,
    paddingTop: 8,
  },
  backButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingVertical: 8,
    alignSelf: 'flex-start',
  },
  backButtonText: {
    fontSize: 15,
    color: Colors.textSecondary,
  },
  importHeader: {
    marginTop: 24,
    marginBottom: 28,
    gap: 10,
  },
  importIconRow: {
    marginBottom: 4,
  },
  smallBtcBadge: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: Colors.bitcoin,
    alignItems: 'center',
    justifyContent: 'center',
  },
  smallBtcText: {
    fontSize: 20,
    color: '#FFF',
    fontWeight: '800',
  },
  importTitle: {
    fontSize: 30,
    fontWeight: '800',
    color: Colors.text,
    letterSpacing: -0.5,
  },
  importSubtitle: {
    fontSize: 14,
    color: Colors.textSecondary,
    lineHeight: 21,
  },
  inputContainer: {
    borderRadius: 14,
    borderWidth: 1.5,
    borderColor: Colors.border,
    backgroundColor: Colors.surface,
    overflow: 'hidden',
  },
  seedInput: {
    color: Colors.text,
    fontSize: 15,
    padding: 16,
    minHeight: 130,
    textAlignVertical: 'top',
    lineHeight: 22,
  },
  errorContainer: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 8,
    marginTop: 12,
    padding: 12,
    backgroundColor: 'rgba(255,59,48,0.08)',
    borderRadius: 10,
    borderWidth: 1,
    borderColor: 'rgba(255,59,48,0.2)',
  },
  errorText: {
    flex: 1,
    fontSize: 13,
    color: Colors.error,
    lineHeight: 19,
  },
  importFooter: {
    marginTop: 20,
    fontSize: 12,
    color: Colors.textTertiary,
    textAlign: 'center',
    lineHeight: 18,
  },
  lockContent: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 32,
    gap: 32,
  },
  lockIconWrapper: {
    alignItems: 'center',
    justifyContent: 'center',
    width: 180,
    height: 180,
  },
  lockGlow: {
    position: 'absolute',
    width: 160,
    height: 160,
    borderRadius: 80,
    backgroundColor: Colors.bitcoin,
    opacity: 0.1,
  },
  lockCircle: {
    width: 110,
    height: 110,
    borderRadius: 55,
    backgroundColor: Colors.surface,
    borderWidth: 2,
    borderColor: Colors.bitcoin,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: Colors.bitcoin,
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.7,
    shadowRadius: 20,
    elevation: 16,
  },
  lockTextSection: {
    alignItems: 'center',
    gap: 10,
  },
  lockTitle: {
    fontSize: 32,
    fontWeight: '800',
    color: Colors.text,
    letterSpacing: -0.6,
  },
  lockSubtitle: {
    fontSize: 15,
    color: Colors.textSecondary,
    textAlign: 'center',
    lineHeight: 22,
  },
  authErrorCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: 'rgba(255,59,48,0.08)',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: 'rgba(255,59,48,0.2)',
    paddingHorizontal: 14,
    paddingVertical: 11,
    width: '100%',
  },
  authErrorText: {
    flex: 1,
    fontSize: 13,
    color: Colors.error,
  },
  unlockBtn: {
    width: '100%',
    borderRadius: 16,
    overflow: 'hidden',
  },
  unlockBtnGradient: {
    paddingVertical: 17,
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 56,
  },
  unlockBtnInner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  unlockBtnText: {
    fontSize: 16,
    fontWeight: '700',
    color: '#FFFFFF',
    letterSpacing: 0.2,
  },
});
