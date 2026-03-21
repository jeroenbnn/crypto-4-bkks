import React, { useRef, useEffect, useState, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  FlatList,
  TouchableOpacity,
  ActivityIndicator,
  Alert,
  Animated,
  Pressable,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { LinearGradient } from 'expo-linear-gradient';
import { router } from 'expo-router';
import { useQuery, useQueries } from '@tanstack/react-query';
import { Settings, Plus, ChevronRight, ArrowRightLeft, Eye, EyeOff, TrendingUp, Globe } from 'lucide-react-native';
import * as Clipboard from 'expo-clipboard';
import { useWallet } from '@/context/wallet';
import { useLanguage } from '@/context/language';
import { Colors } from '@/constants/colors';
import { DerivedAddress } from '@/utils/bitcoin';
import { Language } from '@/constants/i18n';

interface BalanceData {
  chain_stats: { funded_txo_sum: number; spent_txo_sum: number };
}

interface CoinbasePrice {
  data: { amount: string };
}

function useBtcEurPrice() {
  return useQuery({
    queryKey: ['btc-price-eur'],
    queryFn: async () => {
      const res = await fetch('https://api.coinbase.com/v2/prices/BTC-EUR/spot');
      if (!res.ok) return null;
      const json = (await res.json()) as CoinbasePrice;
      return parseFloat(json.data.amount);
    },
    staleTime: 60_000,
    refetchInterval: 60_000,
    retry: 1,
  });
}

function formatAddress(addr: string): string {
  return `${addr.slice(0, 8)}···${addr.slice(-8)}`;
}

function formatBtc(val: number): string {
  return val === 0 ? '0.00000000' : val.toFixed(8);
}

function formatEur(val: number): string {
  if (val === 0) return '€0,00';
  if (val >= 1000) return `€${val.toLocaleString('nl-NL', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  return `€${val.toFixed(2).replace('.', ',')}`;
}

interface AddressCardProps {
  address: DerivedAddress;
  balance: number;
  isLoading: boolean;
  btcEurPrice: number | null | undefined;
  activeLabel: string;
  onPress: () => void;
}

function AddressCard({ address, balance, isLoading, btcEurPrice, activeLabel, onPress }: AddressCardProps) {
  const eurValue = btcEurPrice ? balance * btcEurPrice : null;
  const scaleAnim = useRef(new Animated.Value(1)).current;

  const onPressIn = useCallback(() =>
    Animated.spring(scaleAnim, { toValue: 0.97, useNativeDriver: true, speed: 50 }).start(), [scaleAnim]);
  const onPressOut = useCallback(() =>
    Animated.spring(scaleAnim, { toValue: 1, useNativeDriver: true, speed: 50 }).start(), [scaleAnim]);

  return (
    <Animated.View style={{ transform: [{ scale: scaleAnim }] }}>
      <Pressable
        style={styles.card}
        onPress={onPress}
        onPressIn={onPressIn}
        onPressOut={onPressOut}
        testID={`address-card-${address.index}`}
      >
        <View style={styles.cardAccent} />
        <View style={styles.cardBody}>
          <View style={styles.cardTopRow}>
            <View style={styles.labelBadge}>
              <Text style={styles.labelBadgeText}>{address.label}</Text>
            </View>
            {balance > 0 && (
              <View style={styles.activeBadge}>
                <Text style={styles.activeBadgeText}>{activeLabel}</Text>
              </View>
            )}
          </View>
          {address.alias ? (
            <Text style={styles.aliasText}>{address.alias}</Text>
          ) : null}
          <Text style={styles.addressText}>{formatAddress(address.address)}</Text>
          <View style={styles.balanceRow}>
            {isLoading ? (
              <ActivityIndicator size="small" color={Colors.bitcoin} />
            ) : (
              <>
                <Text style={styles.balanceBtc}>{formatBtc(balance)} BTC</Text>
                {eurValue !== null && eurValue > 0 && (
                  <Text style={styles.balanceEur}>{formatEur(eurValue)}</Text>
                )}
              </>
            )}
          </View>
        </View>
        <ChevronRight size={16} color={Colors.textTertiary} style={{ marginRight: 14 }} />
      </Pressable>
    </Animated.View>
  );
}

const LANG_LABELS: Record<Language, string> = { nl: 'NL', fr: 'FR', en: 'EN' };
const LANG_CYCLE: Language[] = ['nl', 'fr', 'en'];

export default function WalletScreen() {
  const { addresses, addAddress, resetWallet, isAddingAddress, hasWallet, initialized } = useWallet();
  const { t, language, setLanguage } = useLanguage();
  const [hideEmpty, setHideEmpty] = useState(false);

  useEffect(() => {
    if (initialized && !hasWallet) {
      router.replace('/');
    }
  }, [initialized, hasWallet]);

  const { data: btcEurPrice } = useBtcEurPrice();

  const balanceQueries = useQueries({
    queries: addresses.map((addr) => ({
      queryKey: ['balance', addr.address],
      queryFn: async () => {
        const res = await fetch(`https://mempool.space/api/address/${addr.address}`);
        if (!res.ok) return 0;
        const data = (await res.json()) as BalanceData;
        return (data.chain_stats.funded_txo_sum - data.chain_stats.spent_txo_sum) / 1e8;
      },
      staleTime: 30_000,
      retry: 1,
    })),
  });

  const totalBtc = balanceQueries.reduce((sum, q) => sum + (q.data ?? 0), 0);
  const totalEur = btcEurPrice ? totalBtc * btcEurPrice : null;

  const displayedAddresses = hideEmpty
    ? addresses.filter((_, i) => {
        const q = balanceQueries[i];
        return !q.isFetched || (q.data ?? 0) > 0;
      })
    : addresses;

  const hiddenCount = addresses.length - displayedAddresses.length;

  const handleExportAddresses = async () => {
    const lines = addresses.map((a) => `  "${a.address}",`).join('\n');
    const content = `const BTC_ADDRESSES = [\n${lines}\n];`;
    await Clipboard.setStringAsync(content);
    Alert.alert(
      t.wallet.exportedTitle,
      t.wallet.exportedMsg.replace('%d', String(addresses.length))
    );
  };

  const handleCycleLanguage = useCallback(() => {
    const idx = LANG_CYCLE.indexOf(language);
    const next = LANG_CYCLE[(idx + 1) % LANG_CYCLE.length];
    void setLanguage(next);
  }, [language, setLanguage]);

  const handleSettings = () => {
    Alert.alert(t.wallet.title, '', [
      { text: t.wallet.viewSeedPhrase, onPress: () => router.push('/seed-phrase') },
      {
        text: t.wallet.exportAddresses.replace('%d', String(addresses.length)),
        onPress: handleExportAddresses,
      },
      {
        text: t.wallet.resetWallet,
        style: 'destructive',
        onPress: () =>
          Alert.alert(
            t.wallet.resetConfirmTitle,
            t.wallet.resetConfirmMsg,
            [
              { text: t.wallet.cancel, style: 'cancel' },
              {
                text: t.wallet.reset,
                style: 'destructive',
                onPress: () => { resetWallet(); },
              },
            ]
          ),
      },
      { text: t.wallet.cancel, style: 'cancel' },
    ]);
  };

  const ListHeader = (
    <View>
      <LinearGradient colors={['#1A0F08', '#0A0A0F']} style={styles.header}>
        <View style={styles.headerTop}>
          <View style={styles.brandRow}>
            <View style={styles.btcBadge}>
              <Text style={styles.btcBadgeText}>₿</Text>
            </View>
            <View>
              <Text style={styles.headerTitle}>{t.wallet.title}</Text>
              <Text style={styles.headerSubtitle}>{t.wallet.subtitle}</Text>
            </View>
          </View>
          <View style={styles.headerActions}>
            <TouchableOpacity
              style={styles.langBtn}
              onPress={handleCycleLanguage}
              testID="lang-btn"
            >
              <Globe size={13} color={Colors.textTertiary} />
              <Text style={styles.langBtnText}>{LANG_LABELS[language]}</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={styles.settingsBtn}
              onPress={handleSettings}
              testID="settings-btn"
            >
              <Settings size={18} color={Colors.textSecondary} />
            </TouchableOpacity>
          </View>
        </View>

        <View style={styles.walletValueCard}>
          <View style={styles.walletValueLeft}>
            <Text style={styles.walletValueLabel}>{t.wallet.totalValue}</Text>
            <Text style={styles.walletValueAmount}>
              {totalEur !== null ? formatEur(totalEur) : '—'}
            </Text>
            <Text style={styles.walletValueBtc}>{formatBtc(totalBtc)} BTC</Text>
          </View>
          <View style={styles.walletValueRight}>
            <View style={styles.priceTag}>
              <TrendingUp size={11} color={Colors.bitcoin} />
              <Text style={styles.priceTagLabel}>{t.wallet.btcPrice}</Text>
            </View>
            <Text style={styles.priceValue}>
              {btcEurPrice
                ? `€${btcEurPrice.toLocaleString('nl-NL', { maximumFractionDigits: 0 })}`
                : '—'}
            </Text>
          </View>
        </View>

        <View style={styles.statsRow}>
          <View style={styles.statCell}>
            <Text style={styles.statLabel}>{t.wallet.addresses}</Text>
            <Text style={styles.statValue}>{addresses.length}</Text>
          </View>
          <View style={styles.statSep} />
          <View style={styles.statCell}>
            <Text style={styles.statLabel}>{t.wallet.active}</Text>
            <Text style={[styles.statValue, { color: Colors.success }]}>
              {balanceQueries.filter((q) => (q.data ?? 0) > 0).length}
            </Text>
          </View>
          <View style={styles.statSep} />
          <View style={styles.statCell}>
            <Text style={styles.statLabel}>{t.wallet.network}</Text>
            <Text style={[styles.statValue, { color: Colors.success }]}>{t.wallet.mainnet}</Text>
          </View>
        </View>

        <View style={styles.actionBtns}>
          <TouchableOpacity
            style={styles.addBtn}
            onPress={() => addAddress()}
            disabled={isAddingAddress}
            activeOpacity={0.8}
            testID="add-address-btn"
          >
            {isAddingAddress ? (
              <ActivityIndicator size="small" color={Colors.bitcoin} />
            ) : (
              <>
                <Plus size={17} color={Colors.bitcoin} />
                <Text style={styles.addBtnText}>{t.wallet.addAddress}</Text>
              </>
            )}
          </TouchableOpacity>
          <TouchableOpacity
            style={styles.sweepBtn}
            onPress={() => router.push('/sweep')}
            activeOpacity={0.8}
            testID="sweep-btn"
          >
            <ArrowRightLeft size={17} color='#FFF' />
            <Text style={styles.sweepBtnText}>{t.wallet.sweepAll}</Text>
          </TouchableOpacity>
        </View>
      </LinearGradient>

      <View style={styles.sectionHeader}>
        <View style={styles.sectionLabelRow}>
          <Text style={styles.sectionLabel}>{t.wallet.addressesSection}</Text>
          {hiddenCount > 0 && hideEmpty && (
            <Text style={styles.hiddenCount}>{hiddenCount} {t.wallet.hidden}</Text>
          )}
        </View>
        <TouchableOpacity
          style={[styles.filterToggle, hideEmpty && styles.filterToggleActive]}
          onPress={() => setHideEmpty((v) => !v)}
          activeOpacity={0.7}
          testID="hide-empty-toggle"
        >
          {hideEmpty ? (
            <EyeOff size={13} color={Colors.bitcoin} />
          ) : (
            <Eye size={13} color={Colors.textTertiary} />
          )}
          <Text style={[styles.filterToggleText, hideEmpty && styles.filterToggleTextActive]}>
            {hideEmpty ? t.wallet.showEmpty : t.wallet.hideEmpty}
          </Text>
        </TouchableOpacity>
      </View>
    </View>
  );

  return (
    <View style={styles.container}>
      <SafeAreaView style={styles.safeArea} edges={['top']}>
        <FlatList
          data={displayedAddresses}
          keyExtractor={(item) => item.address}
          renderItem={({ item }) => {
            const idx = addresses.findIndex((a) => a.address === item.address);
            const q = balanceQueries[idx];
            return (
              <AddressCard
                address={item}
                balance={q?.data ?? 0}
                isLoading={q?.isLoading ?? false}
                btcEurPrice={btcEurPrice}
                activeLabel={t.wallet.activeLabel}
                onPress={() => router.push(`/address-detail?idx=${item.index}`)}
              />
            );
          }}
          contentContainerStyle={styles.list}
          ListHeaderComponent={ListHeader}
          ListFooterComponent={<View style={styles.footer} />}
          showsVerticalScrollIndicator={false}
        />
      </SafeAreaView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.background },
  safeArea: { flex: 1 },
  header: {
    paddingHorizontal: 20,
    paddingTop: 8,
    paddingBottom: 20,
    gap: 14,
  },
  headerTop: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  brandRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  btcBadge: {
    width: 38,
    height: 38,
    borderRadius: 19,
    backgroundColor: Colors.bitcoin,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: Colors.bitcoin,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.5,
    shadowRadius: 8,
    elevation: 8,
  },
  btcBadgeText: { fontSize: 18, color: '#FFF', fontWeight: '800' },
  headerTitle: { fontSize: 18, fontWeight: '800', color: Colors.text, letterSpacing: -0.3 },
  headerSubtitle: { fontSize: 11, color: Colors.textTertiary, marginTop: 1 },
  headerActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  langBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    height: 38,
    paddingHorizontal: 10,
    borderRadius: 19,
    backgroundColor: Colors.surface,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  langBtnText: {
    fontSize: 12,
    fontWeight: '700',
    color: Colors.textTertiary,
    letterSpacing: 0.5,
  },
  settingsBtn: {
    width: 38,
    height: 38,
    borderRadius: 19,
    backgroundColor: Colors.surface,
    borderWidth: 1,
    borderColor: Colors.border,
    alignItems: 'center',
    justifyContent: 'center',
  },
  walletValueCard: {
    backgroundColor: Colors.surface,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: Colors.border,
    padding: 16,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  walletValueLeft: {
    gap: 2,
  },
  walletValueLabel: {
    fontSize: 10,
    fontWeight: '700',
    color: Colors.textTertiary,
    letterSpacing: 0.8,
    marginBottom: 2,
  },
  walletValueAmount: {
    fontSize: 28,
    fontWeight: '800',
    color: Colors.text,
    letterSpacing: -0.5,
  },
  walletValueBtc: {
    fontSize: 12,
    color: Colors.textSecondary,
    marginTop: 2,
    fontFamily: 'monospace',
  },
  walletValueRight: {
    alignItems: 'flex-end',
    gap: 4,
  },
  priceTag: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: 'rgba(247,147,26,0.1)',
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 20,
  },
  priceTagLabel: {
    fontSize: 9,
    fontWeight: '700',
    color: Colors.bitcoin,
    letterSpacing: 0.5,
  },
  priceValue: {
    fontSize: 18,
    fontWeight: '800',
    color: Colors.text,
    letterSpacing: -0.3,
  },
  statsRow: {
    flexDirection: 'row',
    backgroundColor: Colors.surface,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: Colors.border,
    paddingVertical: 12,
  },
  statCell: { flex: 1, alignItems: 'center', gap: 4 },
  statLabel: { fontSize: 10, color: Colors.textTertiary, fontWeight: '700', letterSpacing: 0.8 },
  statValue: { fontSize: 14, fontWeight: '800', color: Colors.text },
  statSep: { width: 1, backgroundColor: Colors.border, marginVertical: 4 },
  actionBtns: {
    flexDirection: 'row',
    gap: 10,
  },
  addBtn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 7,
    backgroundColor: Colors.surface,
    borderRadius: 14,
    borderWidth: 1.5,
    borderColor: Colors.bitcoin,
    paddingVertical: 14,
  },
  addBtnText: { fontSize: 14, fontWeight: '700', color: Colors.bitcoin },
  sweepBtn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 7,
    backgroundColor: Colors.bitcoin,
    borderRadius: 14,
    paddingVertical: 14,
    shadowColor: Colors.bitcoin,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 10,
    elevation: 6,
  },
  sweepBtnText: { fontSize: 14, fontWeight: '700', color: '#FFF' },
  list: { paddingBottom: 36 },
  sectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 12,
    marginTop: 16,
    paddingHorizontal: 20,
  },
  sectionLabelRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  sectionLabel: {
    fontSize: 11,
    fontWeight: '700',
    color: Colors.textTertiary,
    letterSpacing: 1.2,
  },
  hiddenCount: {
    fontSize: 10,
    color: Colors.textTertiary,
    fontWeight: '500',
  },
  filterToggle: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 20,
    backgroundColor: Colors.surface,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  filterToggleActive: {
    borderColor: Colors.bitcoin,
    backgroundColor: 'rgba(247,147,26,0.08)',
  },
  filterToggleText: {
    fontSize: 11,
    fontWeight: '600',
    color: Colors.textTertiary,
  },
  filterToggleTextActive: {
    color: Colors.bitcoin,
  },
  card: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: Colors.surface,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: Colors.border,
    marginBottom: 10,
    marginHorizontal: 20,
    overflow: 'hidden',
  },
  cardAccent: {
    width: 3,
    alignSelf: 'stretch',
    backgroundColor: Colors.bitcoin,
  },
  cardBody: { flex: 1, padding: 14, paddingLeft: 13, gap: 6 },
  cardTopRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  labelBadge: {
    backgroundColor: 'rgba(247,147,26,0.12)',
    paddingHorizontal: 9,
    paddingVertical: 3,
    borderRadius: 6,
  },
  labelBadgeText: { fontSize: 11, fontWeight: '700', color: Colors.bitcoin },
  activeBadge: {
    backgroundColor: 'rgba(52,199,89,0.1)',
    paddingHorizontal: 9,
    paddingVertical: 3,
    borderRadius: 6,
  },
  activeBadgeText: { fontSize: 11, fontWeight: '600', color: Colors.success },
  aliasText: {
    fontSize: 14,
    fontWeight: '600',
    color: Colors.text,
  },
  addressText: {
    fontSize: 13,
    color: Colors.textSecondary,
    fontFamily: 'monospace',
    letterSpacing: 0.2,
  },
  balanceRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  balanceBtc: { fontSize: 15, fontWeight: '700', color: Colors.text },
  balanceEur: { fontSize: 12, color: Colors.textTertiary },
  footer: { height: 16 },
});
