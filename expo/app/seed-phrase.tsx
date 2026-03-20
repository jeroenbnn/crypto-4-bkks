import React, { useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ScrollView,
  Alert,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import * as Clipboard from 'expo-clipboard';
import { AlertTriangle, Copy, X, Eye, EyeOff, Check } from 'lucide-react-native';
import { useWallet } from '@/context/wallet';
import { Colors } from '@/constants/colors';

export default function SeedPhraseScreen() {
  const { mnemonic } = useWallet();
  const [revealed, setRevealed] = useState(false);
  const [copied, setCopied] = useState(false);

  const words = mnemonic?.split(' ') ?? [];

  const handleReveal = () => {
    if (!revealed) {
      Alert.alert(
        'Security Warning',
        'Make sure no one can see your screen. Your seed phrase gives complete access to your funds.',
        [
          { text: 'Cancel', style: 'cancel' },
          { text: 'Reveal', onPress: () => setRevealed(true) },
        ]
      );
    } else {
      setRevealed(false);
    }
  };

  const handleCopy = async () => {
    if (!mnemonic) return;
    await Clipboard.setStringAsync(mnemonic);
    setCopied(true);
    setTimeout(() => setCopied(false), 3000);
  };

  return (
    <View style={styles.container}>
      <SafeAreaView style={styles.safeArea} edges={['top', 'bottom']}>
        <View style={styles.header}>
          <View style={styles.headerLeft}>
            <View style={styles.lockBadge}>
              <Text style={styles.lockEmoji}>🔐</Text>
            </View>
            <Text style={styles.headerTitle}>Seed Phrase</Text>
          </View>
          <TouchableOpacity style={styles.closeBtn} onPress={() => router.back()}>
            <X size={17} color={Colors.textSecondary} />
          </TouchableOpacity>
        </View>

        <ScrollView
          contentContainerStyle={styles.content}
          showsVerticalScrollIndicator={false}
        >
          <View style={styles.warningCard}>
            <AlertTriangle size={20} color={Colors.warning} />
            <View style={styles.warningBody}>
              <Text style={styles.warningTitle}>Keep this secret</Text>
              <Text style={styles.warningDesc}>
                Anyone with your seed phrase can steal your funds. Never share it with anyone or enter it on any website.
              </Text>
            </View>
          </View>

          <TouchableOpacity
            style={styles.revealBtn}
            onPress={handleReveal}
            activeOpacity={0.8}
            testID="reveal-seed-btn"
          >
            {revealed ? (
              <>
                <EyeOff size={16} color={Colors.textSecondary} />
                <Text style={styles.revealBtnText}>Hide Seed Phrase</Text>
              </>
            ) : (
              <>
                <Eye size={16} color={Colors.bitcoin} />
                <Text style={[styles.revealBtnText, { color: Colors.bitcoin }]}>Reveal Seed Phrase</Text>
              </>
            )}
          </TouchableOpacity>

          <View style={styles.wordsGrid}>
            {words.map((word, i) => (
              <View key={i} style={styles.wordChip}>
                <Text style={styles.wordNum}>{i + 1}</Text>
                <Text style={[styles.wordText, !revealed && styles.wordBlurred]}>
                  {revealed ? word : '••••••'}
                </Text>
              </View>
            ))}
          </View>

          {revealed && (
            <TouchableOpacity
              style={[styles.copyBtn, copied && styles.copyBtnSuccess]}
              onPress={handleCopy}
              activeOpacity={0.8}
              testID="copy-seed-btn"
            >
              {copied ? (
                <>
                  <Check size={16} color={Colors.success} />
                  <Text style={[styles.copyBtnText, { color: Colors.success }]}>Copied to clipboard</Text>
                </>
              ) : (
                <>
                  <Copy size={16} color={Colors.bitcoin} />
                  <Text style={styles.copyBtnText}>Copy Seed Phrase</Text>
                </>
              )}
            </TouchableOpacity>
          )}

          <View style={styles.footerCard}>
            <Text style={styles.footerText}>
              Write these {words.length} words in order on paper and store them somewhere safe and offline. This is the only way to recover your wallet.
            </Text>
          </View>
        </ScrollView>
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
  headerLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  lockBadge: {
    width: 30,
    height: 30,
    borderRadius: 15,
    backgroundColor: Colors.surfaceElevated,
    alignItems: 'center',
    justifyContent: 'center',
  },
  lockEmoji: { fontSize: 16 },
  headerTitle: { fontSize: 18, fontWeight: '700', color: Colors.text },
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
  content: { padding: 20, gap: 16, paddingBottom: 48 },
  warningCard: {
    flexDirection: 'row',
    gap: 12,
    backgroundColor: 'rgba(255,159,10,0.07)',
    borderRadius: 16,
    borderWidth: 1,
    borderColor: 'rgba(255,159,10,0.22)',
    padding: 16,
    alignItems: 'flex-start',
  },
  warningBody: { flex: 1, gap: 5 },
  warningTitle: { fontSize: 14, fontWeight: '700', color: Colors.warning },
  warningDesc: { fontSize: 13, color: Colors.textSecondary, lineHeight: 19 },
  revealBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    backgroundColor: Colors.surface,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: Colors.border,
    paddingVertical: 15,
  },
  revealBtnText: { fontSize: 15, fontWeight: '700', color: Colors.textSecondary },
  wordsGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  wordChip: {
    width: '31%',
    flexGrow: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 7,
    backgroundColor: Colors.surface,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: Colors.border,
    paddingVertical: 11,
    paddingHorizontal: 10,
  },
  wordNum: {
    fontSize: 10,
    color: Colors.textTertiary,
    fontWeight: '700',
    minWidth: 14,
    textAlign: 'right',
  },
  wordText: { fontSize: 13, fontWeight: '600', color: Colors.text, flex: 1 },
  wordBlurred: { color: Colors.textTertiary, letterSpacing: 2 },
  copyBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    backgroundColor: 'rgba(247,147,26,0.1)',
    borderRadius: 14,
    paddingVertical: 15,
    borderWidth: 1,
    borderColor: 'rgba(247,147,26,0.2)',
  },
  copyBtnSuccess: {
    backgroundColor: 'rgba(52,199,89,0.1)',
    borderColor: 'rgba(52,199,89,0.2)',
  },
  copyBtnText: { fontSize: 14, fontWeight: '700', color: Colors.bitcoin },
  footerCard: {
    backgroundColor: Colors.surface,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: Colors.border,
    padding: 14,
  },
  footerText: { fontSize: 13, color: Colors.textTertiary, lineHeight: 19, textAlign: 'center' },
});
