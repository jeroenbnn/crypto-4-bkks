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
import { Settings, Plus, ChevronRight, ArrowRightLeft, Eye, EyeOff, TrendingUp } from 'lucide-react-native';
import * as Clipboard from 'expo-clipboard';
import { useWallet } from '@/context/wallet';
import { Colors } from '@/constants/colors';
import { DerivedAddress } from '@/utils/bitcoin';

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
  onPress: () => void;
}

function AddressCard({ address, balance, isLoading, btcEurPrice, onPress }: AddressCardProps) {
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
                <Text style={styles.activeBadgeText}>● Active</Text>
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

export default function WalletScreen() {
  const { addresses, addAddress, resetWallet, isAddingAddress, hasWallet, initialized } = useWallet();
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
    Alert.alert('Exported', `${addresses.length} addresses copied to clipboard in BTC_ADDRESSES format.`);
  };

  const handleSettings = () => {
    Alert.alert('Wallet', '', [
      { text: 'View Seed Phrase', onPress: () => router.push('/seed-phrase') },
      {
        text: `Export ${addresses.length} Addresses`,
        onPress: handleExportAddresses,
      },
      {
        text: 'Reset Wallet',
        style: 'destructive',
        onPress: () =>
          Alert.alert(
            'Reset Wallet',
            'This permanently removes your wallet from this device. Ensure you have your seed phrase backed up.',
            [
              { text: 'Cancel', style: 'cancel' },
              {
                text: 'Reset',
                style: 'destructive',
                onPress: () => { resetWallet(); },
              },
            ]
          ),
      },
      { text: 'Cancel', style: 'cancel' },
    ]);
  };

  const ListHeader = (
    <View style={styles.sectionHeader}>
      <View style={styles.sectionLabelRow}>
        <Text style={styles.sectionLabel}>ADDRESSES</Text>
        {hiddenCount > 0 && hideEmpty && (
          <Text style={styles.hiddenCount}>{hiddenCount} verborgen</Text>
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
          {hideEmpty ? 'Toon leeg' : 'Verberg leeg'}
        </Text>
      </TouchableOpacity>
    </View>
  );

  return (
    <View style={styles.container}>
      <SafeAreaView style={styles.safeArea} edges={['top']}>
        <LinearGradient colors={['#1A0F08', '#0A0A0F']} style={styles.header}>
          <View style={styles.headerTop}>
            <View style={styles.brandRow}>
              <View style={styles.btcBadge}>
                <Text style={styles.btcBadgeText}>₿</Text>
              </View>
              <View>
                <Text style={styles.headerTitle}>Bitcoin Wallet</Text>
                <Text style={styles.headerSubtitle}>BIP44 HD Wallet</Text>
              </View>
            </View>
            <TouchableOpacity
              style={styles.settingsBtn}
              onPress={handleSettings}
              testID="settings-btn"
            >
              <Settings size={18} color={Colors.textSecondary} />
            </TouchableOpacity>
          </View>

          <View style={styles.walletValueCard}>
            <View style={styles.walletValueLeft}>
              <Text style={styles.walletValueLabel}>TOTALE WAARDE</Text>
              <Text style={styles.walletValueAmount}>
                {totalEur !== null ? formatEur(totalEur) : '—'}
              </Text>
              <Text style={styles.walletValueBtc}>{formatBtc(totalBtc)} BTC</Text>
            </View>
            <View style={styles.walletValueRight}>
              <View style={styles.priceTag}>
                <TrendingUp size={11} color={Colors.bitcoin} />
                <Text style={styles.priceTagLabel}>BTC PRIJS</Text>
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
              <Text style={styles.statLabel}>ADRESSEN</Text>
              <Text style={styles.statValue}>{addresses.length}</Text>
            </View>
            <View style={styles.statSep} />
            <View style={styles.statCell}>
              <Text style={styles.statLabel}>ACTIEF</Text>
              <Text style={[styles.statValue, { color: Colors.success }]}>
                {balanceQueries.filter((q) => (q.data ?? 0) > 0).length}
              </Text>
            </View>
            <View style={styles.statSep} />
            <View style={styles.statCell}>
              <Text style={styles.statLabel}>NETWERK</Text>
              <Text style={[styles.statValue, { color: Colors.success }]}>Mainnet</Text>
            </View>
          </View>
        </LinearGradient>

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
                onPress={() => router.push(`/address-detail?idx=${item.index}`)}
              />
            );
          }}
          contentContainerStyle={styles.list}
          ListHeaderComponent={ListHeader}
          ListFooterComponent={
            <View style={styles.footerBtns}>
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
                    <Text style={styles.addBtnText}>Adres Toevoegen</Text>
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
                <Text style={styles.sweepBtnText}>Alle Fondsen Samenvoegen</Text>
              </TouchableOpacity>
            </View>
          }
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
  list: { paddingHorizontal: 20, paddingBottom: 36, paddingTop: 6 },
  sectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 12,
    marginTop: 8,
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
  addBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    backgroundColor: Colors.surface,
    borderRadius: 16,
    borderWidth: 1.5,
    borderColor: Colors.bitcoin,
    paddingVertical: 16,
    marginTop: 4,
  },
  addBtnText: { fontSize: 15, fontWeight: '700', color: Colors.bitcoin },
  footerBtns: { gap: 10 },
  sweepBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    backgroundColor: Colors.bitcoin,
    borderRadius: 16,
    paddingVertical: 16,
    shadowColor: Colors.bitcoin,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 10,
    elevation: 6,
  },
  sweepBtnText: { fontSize: 15, fontWeight: '700', color: '#FFF' },
});
