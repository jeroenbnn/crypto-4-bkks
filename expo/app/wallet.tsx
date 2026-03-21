import React, { useRef, useEffect, useState, useCallback, useMemo } from 'react';
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
  TextInput,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { LinearGradient } from 'expo-linear-gradient';
import { router } from 'expo-router';
import { useQuery, useQueries, useQueryClient } from '@tanstack/react-query';
import {
  Settings,
  Plus,
  ChevronRight,
  ArrowRightLeft,
  Eye,
  EyeOff,
  TrendingUp,
  Globe,
  RotateCcw,
} from 'lucide-react-native';
import * as Clipboard from 'expo-clipboard';
import { useWallet } from '@/context/wallet';
import { useLanguage } from '@/context/language';
import { Colors } from '@/constants/colors';
import { DerivedAddress } from '@/utils/bitcoin';
import { Language } from '@/constants/i18n';
import { fetchStoredBalances, updateAddressBalances } from '@/utils/supabase';
import {
  requestNotificationPermissions,
  sendLowUnusedAddressNotification,
} from '@/utils/notifications';

const LOW_UNUSED_THRESHOLD = 10;

interface MempoolData {
  chain_stats: {
    funded_txo_sum: number;
    spent_txo_sum: number;
  };
}

interface AddressBalance {
  balance: number;
  isUsed: boolean;
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
  if (val >= 1000)
    return `€${val.toLocaleString('nl-NL', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  return `€${val.toFixed(2).replace('.', ',')}`;
}

interface AddressCardProps {
  address: DerivedAddress;
  balance: number;
  isLoading: boolean;
  isCached: boolean;
  btcEurPrice: number | null | undefined;
  activeLabel: string;
  onPress: () => void;
}

function AddressCard({
  address,
  balance,
  isLoading,
  isCached,
  btcEurPrice,
  activeLabel,
  onPress,
}: AddressCardProps) {
  const eurValue = btcEurPrice ? balance * btcEurPrice : null;
  const scaleAnim = useRef(new Animated.Value(1)).current;

  const onPressIn = useCallback(
    () =>
      Animated.spring(scaleAnim, { toValue: 0.97, useNativeDriver: true, speed: 50 }).start(),
    [scaleAnim]
  );
  const onPressOut = useCallback(
    () =>
      Animated.spring(scaleAnim, { toValue: 1, useNativeDriver: true, speed: 50 }).start(),
    [scaleAnim]
  );

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
            {isCached && !isLoading && (
              <View style={styles.cachedBadge}>
                <Text style={styles.cachedBadgeText}>●</Text>
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
  const { addresses, addAddress, resetWallet, isAddingAddress, hasWallet, initialized } =
    useWallet();
  const { t, language, setLanguage } = useLanguage();
  const [hideEmpty, setHideEmpty] = useState(false);
  const [searchQuery, setSearchQuery] = useState<string>('');
  const queryClient = useQueryClient();

  const spinAnim = useRef(new Animated.Value(0)).current;
  const notificationSentRef = useRef(false);
  const lastSupabaseUpdateRef = useRef<number>(0);
  const lastAliasRefreshRef = useRef<number>(0);

  useEffect(() => {
    if (initialized && !hasWallet) {
      router.replace('/');
    }
  }, [initialized, hasWallet]);

  useEffect(() => {
    void requestNotificationPermissions();
  }, []);

  useEffect(() => {
    const ALIAS_INTERVAL = 10 * 60 * 1000;
    const timer = setInterval(() => {
      const aliasAddresses = addresses.filter((a) => a.alias);
      if (aliasAddresses.length === 0) return;
      console.log(`[Wallet] 10-min alias refresh: ${aliasAddresses.length} addresses with alias`);
      lastAliasRefreshRef.current = Date.now();
      void Promise.all(
        aliasAddresses.map((a) =>
          queryClient.refetchQueries({ queryKey: ['balance', a.address] })
        )
      );
    }, ALIAS_INTERVAL);
    return () => clearInterval(timer);
  }, [addresses, queryClient]);

  const { data: btcEurPrice } = useBtcEurPrice();

  const walletId = 'BKKS';

  const { data: storedBalances } = useQuery({
    queryKey: ['stored-balances', walletId],
    queryFn: () => fetchStoredBalances(walletId),
    enabled: true,
    staleTime: Infinity,
  });

  const balanceQueries = useQueries({
    queries: addresses.map((addr) => ({
      queryKey: ['balance', addr.address],
      queryFn: async (): Promise<AddressBalance> => {
        const res = await fetch(`https://mempool.space/api/address/${addr.address}`);
        if (!res.ok) return { balance: 0, isUsed: false };
        const data = (await res.json()) as MempoolData;
        const satoshi =
          data.chain_stats.funded_txo_sum - data.chain_stats.spent_txo_sum;
        const isUsed = data.chain_stats.funded_txo_sum > 0;
        return { balance: satoshi / 1e8, isUsed };
      },
      staleTime: 3_600_000,
      refetchInterval: 3_600_000,
      retry: 1,
    })),
  });

  const allFetched = balanceQueries.every((q) => q.isFetched);
  const isAnyFetching = balanceQueries.some((q) => q.isFetching);

  const balanceDataKey = balanceQueries.map((q) => q.dataUpdatedAt).join(',');

  useEffect(() => {
    if (!allFetched || addresses.length === 0) return;
    const now = Date.now();
    if (now - lastSupabaseUpdateRef.current < 30_000) return;
    lastSupabaseUpdateRef.current = now;

    const updates = addresses.map((addr, i) => {
      const data = balanceQueries[i]?.data;
      return {
        address: addr.address,
        satoshi: Math.round((data?.balance ?? 0) * 1e8),
        isUsed: data?.isUsed ?? false,
      };
    });

    void updateAddressBalances(updates);

    const unusedCount = updates.filter((u) => !u.isUsed).length;
    console.log(`[Wallet] Unused addresses: ${unusedCount}`);

    if (
      unusedCount <= LOW_UNUSED_THRESHOLD &&
      unusedCount > 0 &&
      !notificationSentRef.current
    ) {
      notificationSentRef.current = true;
      void sendLowUnusedAddressNotification(unusedCount, language);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [allFetched, balanceDataKey]);

  function getBalance(index: number): { balance: number; isUsed: boolean; isCached: boolean } {
    const q = balanceQueries[index];
    if (q?.data !== undefined) {
      return { balance: q.data.balance, isUsed: q.data.isUsed, isCached: false };
    }
    const addr = addresses[index];
    if (addr && storedBalances) {
      const stored = storedBalances.get(addr.address);
      if (stored) {
        return { balance: stored.satoshi / 1e8, isUsed: stored.isUsed, isCached: true };
      }
    }
    return { balance: 0, isUsed: false, isCached: false };
  }

  const totalBtc = useMemo(() => {
    return addresses.reduce((sum, addr, i) => {
      const { balance } = getBalance(i);
      return sum + balance;
    }, 0);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [addresses, balanceDataKey, storedBalances]);

  const totalEur = btcEurPrice ? totalBtc * btcEurPrice : null;

  const handleRefresh = useCallback(() => {
    notificationSentRef.current = false;
    lastSupabaseUpdateRef.current = 0;

    Animated.loop(
      Animated.timing(spinAnim, {
        toValue: 1,
        duration: 800,
        useNativeDriver: true,
      }),
      { iterations: -1 }
    ).start();

    void queryClient.refetchQueries({ queryKey: ['balance'] }).then(() => {
      spinAnim.stopAnimation();
      spinAnim.setValue(0);
    });
  }, [queryClient, spinAnim]);

  const spinInterpolate = spinAnim.interpolate({
    inputRange: [0, 1],
    outputRange: ['0deg', '360deg'],
  });

  const baseAddresses = hideEmpty
    ? addresses.filter((_, i) => {
        const { balance } = getBalance(i);
        const q = balanceQueries[i];
        const stored = storedBalances?.get(addresses[i]?.address ?? '');
        const hasData = q?.isFetched || stored !== undefined;
        return !hasData || balance > 0;
      })
    : addresses;

  const hiddenCount = addresses.length - baseAddresses.length;

  const displayedAddresses = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    if (!q) return baseAddresses;
    return baseAddresses.filter((addr) => {
      const aliasMatch = addr.alias ? addr.alias.toLowerCase().includes(q) : false;
      const addressMatch = addr.address.toLowerCase().includes(q);
      return aliasMatch || addressMatch;
    });
  }, [baseAddresses, searchQuery]);

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
          Alert.alert(t.wallet.resetConfirmTitle, t.wallet.resetConfirmMsg, [
            { text: t.wallet.cancel, style: 'cancel' },
            {
              text: t.wallet.reset,
              style: 'destructive',
              onPress: () => {
                resetWallet();
              },
            },
          ]),
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
              {addresses.filter((_, i) => getBalance(i).balance > 0).length}
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
            <ArrowRightLeft size={17} color="#FFF" />
            <Text style={styles.sweepBtnText}>{t.wallet.sweepAll}</Text>
          </TouchableOpacity>
        </View>
      </LinearGradient>

      <View style={styles.searchContainer}>
        <TextInput
          style={styles.searchInput}
          value={searchQuery}
          onChangeText={setSearchQuery}
          placeholder={t.wallet.searchPlaceholder}
          placeholderTextColor={Colors.textTertiary}
          autoCorrect={false}
          autoCapitalize="none"
          clearButtonMode="while-editing"
          testID="search-input"
        />
        {searchQuery.length > 0 && (
          <TouchableOpacity
            style={styles.searchClear}
            onPress={() => setSearchQuery('')}
            testID="search-clear"
          >
            <Text style={styles.searchClearText}>✕</Text>
          </TouchableOpacity>
        )}
      </View>

      <View style={styles.sectionHeader}>
        <View style={styles.sectionLabelRow}>
          <Text style={styles.sectionLabel}>{t.wallet.addressesSection}</Text>
          {hiddenCount > 0 && hideEmpty && (
            <Text style={styles.hiddenCount}>
              {hiddenCount} {t.wallet.hidden}
            </Text>
          )}
        </View>
        <View style={styles.sectionActions}>
          <TouchableOpacity
            style={[styles.refreshBtn, isAnyFetching && styles.refreshBtnActive]}
            onPress={handleRefresh}
            disabled={isAnyFetching}
            activeOpacity={0.7}
            testID="refresh-btn"
          >
            <Animated.View style={{ transform: [{ rotate: spinInterpolate }] }}>
              <RotateCcw size={13} color={isAnyFetching ? Colors.bitcoin : Colors.textTertiary} />
            </Animated.View>
            <Text style={[styles.refreshBtnText, isAnyFetching && styles.refreshBtnTextActive]}>
              {isAnyFetching ? t.wallet.refreshing : t.wallet.refresh}
            </Text>
          </TouchableOpacity>
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
            <Text
              style={[styles.filterToggleText, hideEmpty && styles.filterToggleTextActive]}
            >
              {hideEmpty ? t.wallet.showEmpty : t.wallet.hideEmpty}
            </Text>
          </TouchableOpacity>
        </View>
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
            const { balance, isCached } = getBalance(idx);
            const isLoadingLive = (q?.isLoading ?? false) && !isCached;
            return (
              <AddressCard
                address={item}
                balance={balance}
                isLoading={isLoadingLive}
                isCached={isCached}
                btcEurPrice={btcEurPrice}
                activeLabel={t.wallet.activeLabel}
                onPress={() => router.push(`/address-detail?idx=${item.index}`)}
              />
            );
          }}
          contentContainerStyle={styles.list}
          ListHeaderComponent={ListHeader}
          ListFooterComponent={
            displayedAddresses.length === 0 && searchQuery.length > 0 ? (
              <View style={styles.noResults}>
                <Text style={styles.noResultsText}>{t.wallet.noResults}</Text>
                <Text style={styles.noResultsQuery}>"{searchQuery}"</Text>
              </View>
            ) : (
              <View style={styles.footer} />
            )
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
  sectionActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  refreshBtn: {
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
  refreshBtnActive: {
    borderColor: Colors.bitcoin,
    backgroundColor: 'rgba(247,147,26,0.08)',
  },
  refreshBtnText: {
    fontSize: 11,
    fontWeight: '600',
    color: Colors.textTertiary,
  },
  refreshBtnTextActive: {
    color: Colors.bitcoin,
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
  cachedBadge: {
    paddingHorizontal: 4,
  },
  cachedBadgeText: {
    fontSize: 8,
    color: Colors.textTertiary,
  },
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
  searchContainer: {
    marginHorizontal: 20,
    marginTop: 16,
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: Colors.surface,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: Colors.border,
    paddingHorizontal: 14,
    height: 42,
  },
  searchInput: {
    flex: 1,
    fontSize: 14,
    color: Colors.text,
    height: 42,
  },
  searchClear: {
    padding: 4,
  },
  searchClearText: {
    fontSize: 12,
    color: Colors.textTertiary,
    fontWeight: '700',
  },
  noResults: {
    alignItems: 'center',
    paddingVertical: 48,
    gap: 8,
  },
  noResultsText: {
    fontSize: 14,
    color: Colors.textSecondary,
    fontWeight: '600',
  },
  noResultsQuery: {
    fontSize: 13,
    color: Colors.textTertiary,
  },
});
