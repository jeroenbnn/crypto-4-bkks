import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ScrollView,
  TextInput,
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useLocalSearchParams, router } from 'expo-router';
import * as Clipboard from 'expo-clipboard';
import { Copy, X, Check, Pencil, Tag } from 'lucide-react-native';
import { useWallet } from '@/context/wallet';
import { Colors } from '@/constants/colors';
import { QRCodeDisplay } from '@/components/QRCodeDisplay';

export default function AddressDetailScreen() {
  const { idx } = useLocalSearchParams<{ idx: string }>();
  const { addresses, updateAlias, isUpdatingAlias } = useWallet();
  const [copied, setCopied] = useState(false);
  const [editingAlias, setEditingAlias] = useState(false);
  const [aliasInput, setAliasInput] = useState('');
  const [aliasSaved, setAliasSaved] = useState(false);

  const index = parseInt(idx ?? '0', 10);
  const address = addresses[index];

  useEffect(() => {
    if (address) {
      setAliasInput(address.alias ?? '');
    }
  }, [address]);

  const handleCopy = async () => {
    if (!address) return;
    await Clipboard.setStringAsync(address.address);
    setCopied(true);
    setTimeout(() => setCopied(false), 2500);
  };

  const handleSaveAlias = () => {
    if (!address) return;
    updateAlias(
      { index: address.index, alias: aliasInput },
      {
        onSuccess: () => {
          setEditingAlias(false);
          setAliasSaved(true);
          setTimeout(() => setAliasSaved(false), 2000);
        },
      }
    );
  };

  const handleCancelAlias = () => {
    setEditingAlias(false);
    setAliasInput(address?.alias ?? '');
  };

  if (!address) {
    return (
      <View style={styles.container}>
        <Text style={styles.errorText}>Address not found</Text>
      </View>
    );
  }

  const displayName = address.alias || address.label;

  return (
    <View style={styles.container}>
      <SafeAreaView style={styles.safeArea} edges={['top', 'bottom']}>
        <View style={styles.header}>
          <View style={styles.headerLeft}>
            <View style={styles.headerBadge}>
              <Text style={styles.headerBadgeText}>₿</Text>
            </View>
            <View>
              <Text style={styles.headerTitle}>{displayName}</Text>
              {address.alias ? (
                <Text style={styles.headerSub}>{address.label}</Text>
              ) : null}
            </View>
          </View>
          <TouchableOpacity style={styles.closeBtn} onPress={() => router.back()}>
            <X size={17} color={Colors.textSecondary} />
          </TouchableOpacity>
        </View>

        <KeyboardAvoidingView
          style={{ flex: 1 }}
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        >
          <ScrollView
            contentContainerStyle={styles.content}
            showsVerticalScrollIndicator={false}
            keyboardShouldPersistTaps="handled"
          >
            <View style={styles.qrCard}>
              <View style={styles.qrWrapper}>
                <QRCodeDisplay
                  value={`bitcoin:${address.address}`}
                  size={210}
                  bgColor="#FFFFFF"
                  fgColor="#0A0A0F"
                />
              </View>
              <View style={styles.qrFooter}>
                <Text style={styles.qrLabel}>Scan om Bitcoin te ontvangen</Text>
                <Text style={styles.qrPath}>{address.path}</Text>
              </View>
            </View>

            <View style={styles.aliasCard}>
              <View style={styles.aliasHeader}>
                <View style={styles.aliasLabelRow}>
                  <Tag size={12} color={Colors.textTertiary} />
                  <Text style={styles.infoLabel}>ALIAS</Text>
                </View>
                {!editingAlias && (
                  <TouchableOpacity
                    style={styles.editBtn}
                    onPress={() => setEditingAlias(true)}
                    testID="edit-alias-btn"
                  >
                    <Pencil size={13} color={Colors.bitcoin} />
                    <Text style={styles.editBtnText}>Edit</Text>
                  </TouchableOpacity>
                )}
              </View>

              {editingAlias ? (
                <View style={styles.aliasEditBlock}>
                  <TextInput
                    style={styles.aliasInput}
                    value={aliasInput}
                    onChangeText={setAliasInput}
                    placeholder="e.g. Main savings, Trading account..."
                    placeholderTextColor={Colors.textTertiary}
                    autoFocus
                    maxLength={50}
                    returnKeyType="done"
                    onSubmitEditing={handleSaveAlias}
                    testID="alias-input"
                  />
                  <View style={styles.aliasActions}>
                    <TouchableOpacity
                      style={styles.cancelBtn}
                      onPress={handleCancelAlias}
                    >
                      <Text style={styles.cancelBtnText}>Cancel</Text>
                    </TouchableOpacity>
                    <TouchableOpacity
                      style={[styles.saveBtn, isUpdatingAlias && styles.saveBtnDisabled]}
                      onPress={handleSaveAlias}
                      disabled={isUpdatingAlias}
                      testID="save-alias-btn"
                    >
                      {isUpdatingAlias ? (
                        <ActivityIndicator size="small" color="#FFF" />
                      ) : (
                        <Text style={styles.saveBtnText}>Save</Text>
                      )}
                    </TouchableOpacity>
                  </View>
                </View>
              ) : (
                <View style={styles.aliasValueRow}>
                  {aliasSaved ? (
                    <View style={styles.savedRow}>
                      <Check size={14} color={Colors.success} />
                      <Text style={styles.savedText}>Alias saved!</Text>
                    </View>
                  ) : address.alias ? (
                    <Text style={styles.aliasValue}>{address.alias}</Text>
                  ) : (
                    <Text style={styles.aliasPlaceholder}>No alias set — tap Edit to add one</Text>
                  )}
                </View>
              )}
            </View>

            <View style={styles.infoCard}>
              <Text style={styles.infoLabel}>BETALINGSADRES</Text>
              <Text style={styles.addressFull} selectable>
                {address.address}
              </Text>
              <TouchableOpacity
                style={[styles.copyBtn, copied && styles.copyBtnSuccess]}
                onPress={handleCopy}
                activeOpacity={0.8}
                testID="copy-address-btn"
              >
                {copied ? (
                  <>
                    <Check size={15} color={Colors.success} />
                    <Text style={[styles.copyBtnText, { color: Colors.success }]}>Gekopieerd!</Text>
                  </>
                ) : (
                  <>
                    <Copy size={15} color={Colors.bitcoin} />
                    <Text style={styles.copyBtnText}>Kopieer Adres</Text>
                  </>
                )}
              </TouchableOpacity>
            </View>

            <View style={styles.infoCard}>
              <Text style={styles.infoLabel}>AFLEIDINGSPAD</Text>
              <Text style={styles.monoText}>{address.path}</Text>
              <Text style={styles.infoHint}>HD-afgeleid adres — uniek per gebruiker, ontvangt betalingen rechtstreeks</Text>
            </View>

            <View style={styles.warningCard}>
              <Text style={styles.warningText}>
                ⚡ Deel dit adres om bitcoin te ontvangen. Bewaar nooit je herstelzin of privésleutels bij anderen.
              </Text>
            </View>
          </ScrollView>
        </KeyboardAvoidingView>
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
  headerBadge: {
    width: 30,
    height: 30,
    borderRadius: 15,
    backgroundColor: Colors.bitcoin,
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerBadgeText: { fontSize: 14, color: '#FFF', fontWeight: '800' },
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
  content: { padding: 20, gap: 14, paddingBottom: 36 },
  errorText: { color: Colors.text, textAlign: 'center', marginTop: 40 },
  qrCard: {
    backgroundColor: Colors.surface,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: Colors.border,
    padding: 24,
    alignItems: 'center',
    gap: 18,
  },
  qrWrapper: {
    borderRadius: 16,
    overflow: 'hidden',
    padding: 14,
    backgroundColor: '#FFFFFF',
    shadowColor: Colors.bitcoin,
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.2,
    shadowRadius: 16,
    elevation: 10,
  },
  qrFooter: { alignItems: 'center', gap: 4 },
  qrLabel: { fontSize: 13, color: Colors.textSecondary, fontWeight: '500' },
  qrPath: { fontSize: 11, color: Colors.textTertiary, fontFamily: 'monospace' },
  aliasCard: {
    backgroundColor: Colors.surface,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: Colors.border,
    padding: 16,
    gap: 10,
  },
  aliasHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  aliasLabelRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
  },
  editBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: 'rgba(247,147,26,0.1)',
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 8,
  },
  editBtnText: { fontSize: 12, fontWeight: '700', color: Colors.bitcoin },
  aliasValueRow: { minHeight: 24, justifyContent: 'center' },
  aliasValue: { fontSize: 15, color: Colors.text, fontWeight: '600' },
  aliasPlaceholder: { fontSize: 13, color: Colors.textTertiary, fontStyle: 'italic' },
  aliasEditBlock: { gap: 10 },
  aliasInput: {
    backgroundColor: Colors.background,
    borderRadius: 10,
    borderWidth: 1.5,
    borderColor: Colors.bitcoin,
    paddingHorizontal: 12,
    paddingVertical: 10,
    color: Colors.text,
    fontSize: 15,
  },
  aliasActions: { flexDirection: 'row', gap: 8 },
  cancelBtn: {
    flex: 1,
    paddingVertical: 10,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: Colors.border,
    alignItems: 'center',
  },
  cancelBtnText: { fontSize: 14, fontWeight: '600', color: Colors.textSecondary },
  saveBtn: {
    flex: 1,
    paddingVertical: 10,
    borderRadius: 10,
    backgroundColor: Colors.bitcoin,
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 40,
  },
  saveBtnDisabled: { opacity: 0.6 },
  saveBtnText: { fontSize: 14, fontWeight: '700', color: '#FFF' },
  savedRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  savedText: { fontSize: 13, color: Colors.success, fontWeight: '600' },
  infoCard: {
    backgroundColor: Colors.surface,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: Colors.border,
    padding: 16,
    gap: 10,
  },
  infoLabel: {
    fontSize: 10,
    fontWeight: '700',
    color: Colors.textTertiary,
    letterSpacing: 1,
  },
  addressFull: {
    fontSize: 14,
    color: Colors.text,
    fontFamily: 'monospace',
    lineHeight: 22,
  },
  monoText: {
    fontSize: 13,
    color: Colors.textSecondary,
    fontFamily: 'monospace',
    lineHeight: 20,
  },
  infoHint: {
    fontSize: 11,
    color: Colors.textTertiary,
    fontStyle: 'italic',
    marginTop: 2,
  },
  copyBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 7,
    backgroundColor: 'rgba(247,147,26,0.1)',
    borderRadius: 10,
    paddingVertical: 10,
    paddingHorizontal: 14,
    alignSelf: 'flex-start',
  },
  copyBtnSuccess: {
    backgroundColor: 'rgba(52,199,89,0.1)',
  },
  copyBtnText: {
    fontSize: 13,
    fontWeight: '700',
    color: Colors.bitcoin,
  },
  warningCard: {
    backgroundColor: 'rgba(247,147,26,0.05)',
    borderRadius: 14,
    borderWidth: 1,
    borderColor: 'rgba(247,147,26,0.15)',
    padding: 14,
  },
  warningText: {
    fontSize: 13,
    color: Colors.bitcoinLight,
    lineHeight: 20,
  },
});
