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
  ScrollView,
  Linking,
  AppState,
  AppStateStatus,
  Platform,
} from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { LinearGradient } from 'expo-linear-gradient';
import { router } from 'expo-router';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Settings,
  Plus,
  ChevronRight,
  Eye,
  EyeOff,
  TrendingUp,
  Globe,
  RotateCcw,
  ArrowUpRight,
  ArrowDownLeft,
  Clock,
  Home,
  History,
  QrCode,
  ExternalLink,
} from 'lucide-react-native';
import * as Clipboard from 'expo-clipboard';
import { useWallet } from '@/context/wallet';
import { useLanguage } from '@/context/language';
import { Colors } from '@/constants/colors';
import { DerivedAddress, MAIN_ADDRESS } from '@/utils/bitcoin';
import { Language } from '@/constants/i18n';
import {
  fetchStoredBalances,
  updateAddressBalances,
  StoredBalance,
} from '@/utils/supabase';
import {
  requestNotificationPermissions,
  sendLowUnusedAddressNotification,
  sendPendingTransactionNotification,
  sendConfirmedTransactionNotification,
  sendOutgoingConfirmedNotification,
} from '@/utils/notifications';
import { QRCodeDisplay } from '@/components/QRCodeDisplay';

const LOW_UNUSED_THRESHOLD = 10;

type TabName = 'start' | 'history' | 'betalen' | 'ontvangen';

interface MempoolData {
  chain_stats: {
    funded_txo_sum: number;
    spent_txo_sum: number;
    tx_count: number;
  };
  mempool_stats: {
    funded_txo_sum: number;
    spent_txo_sum: number;
    tx_count: number;
  };
}

interface MempoolTxVout {
  scriptpubkey_address?: string;
  value: number;
}

interface MempoolTxVin {
  prevout?: {
    scriptpubkey_address?: string;
    value: number;
  };
}

interface MempoolTx {
  txid: string;
  status: {
    confirmed: boolean;
    block_height: number;
    block_time?: number;
  };
  vin: MempoolTxVin[];
  vout: MempoolTxVout[];
}

interface AddressBalance {
  address: string;
  satoshi: number;
  pendingSat: number;
  isUsed: boolean;
}

interface CombinedTx {
  txid: string;
  address: string;
  alias?: string;
  label: string;
  netSats: number;
  confirmed: boolean;
  blockTime?: number;
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

function formatDate(ts?: number): string {
  if (!ts) return '';
  const d = new Date(ts * 1000);
  return d.toLocaleDateString('nl-NL', { day: '2-digit', month: 'short', year: 'numeric' });
}

async function fetchSingleAddressBalance(address: string, currentHeight: number): Promise<AddressBalance> {
  try {
    const res = await fetch(`https://mempool.space/api/address/${address}`);
    if (!res.ok) return { address, satoshi: 0, pendingSat: 0, isUsed: false };
    const data = (await res.json()) as MempoolData;
    const confirmedSat = Math.max(0, data.chain_stats.funded_txo_sum - data.chain_stats.spent_txo_sum);
    const isUsed = data.chain_stats.funded_txo_sum > 0;

    const hasTxs = data.chain_stats.tx_count > 0 || data.mempool_stats.tx_count > 0;
    if (!hasTxs || currentHeight === 0) {
      return { address, satoshi: confirmedSat, pendingSat: 0, isUsed };
    }

    const txsRes = await fetch(`https://mempool.space/api/address/${address}/txs`);
    if (!txsRes.ok) return { address, satoshi: confirmedSat, pendingSat: 0, isUsed };

    const txs = (await txsRes.json()) as MempoolTx[];
    let pendingIncomingSat = 0;
    let chainPendingNetSat = 0;

    for (const tx of txs) {
      const confs = tx.status.confirmed ? currentHeight - tx.status.block_height + 1 : 0;
      if (confs < 3) {
        const incoming = tx.vout
          .filter((v) => v.scriptpubkey_address === address)
          .reduce((s, v) => s + v.value, 0);
        const outgoing = tx.vin
          .filter((v) => v.prevout?.scriptpubkey_address === address)
          .reduce((s, v) => s + (v.prevout?.value ?? 0), 0);
        pendingIncomingSat += incoming - outgoing;
        if (tx.status.confirmed) chainPendingNetSat += incoming - outgoing;
      }
    }

    const adjustedSat = Math.max(0, confirmedSat - chainPendingNetSat);
    const pendingSat = Math.max(0, pendingIncomingSat);
    return { address, satoshi: adjustedSat, pendingSat, isUsed };
  } catch {
    return { address, satoshi: 0, pendingSat: 0, isUsed: false };
  }
}

interface AddressCardProps {
  address: DerivedAddress;
  liveBalance?: AddressBalance;
  storedBalance?: StoredBalance;
  btcEurPrice?: number;
  onPress: () => void;
  onHistoryPress: () => void;
}

function AddressCard({ address, liveBalance, storedBalance, btcEurPrice, onPress, onHistoryPress }: AddressCardProps) {
  const scaleAnim = useRef(new Animated.Value(1)).current;

  const onPressIn = useCallback(
    () => Animated.spring(scaleAnim, { toValue: 0.97, useNativeDriver: true, speed: 50 }).start(),
    [scaleAnim]
  );
  const onPressOut = useCallback(
    () => Animated.spring(scaleAnim, { toValue: 1, useNativeDriver: true, speed: 50 }).start(),
    [scaleAnim]
  );

  const confirmedSat = liveBalance?.satoshi ?? storedBalance?.satoshi ?? 0;
  const pendingSat = liveBalance?.pendingSat ?? 0;
  const hasFunds = confirmedSat > 0 || pendingSat > 0;

  return (
    <Animated.View style={{ transform: [{ scale: scaleAnim }] }}>
      <View style={styles.card}>
        <Pressable
          style={styles.cardMain}
          onPress={onPress}
          onPressIn={onPressIn}
          onPressOut={onPressOut}
          testID={`address-card-${address.index}`}
        >
          <View style={[styles.cardAccent, hasFunds && styles.cardAccentFunded]} />
          <View style={styles.cardBody}>
            <View style={styles.cardTopRow}>
              <View style={styles.labelBadge}>
                <Text style={styles.labelBadgeText}>{address.label}</Text>
              </View>
              {address.alias ? (
                <View style={styles.aliasBadge}>
                  <Text style={styles.aliasBadgeText} numberOfLines={1}>{address.alias}</Text>
                </View>
              ) : null}
            </View>
            <Text style={styles.addressText}>{formatAddress(address.address)}</Text>
            {(confirmedSat > 0 || pendingSat > 0) && (
              <View style={styles.balanceCol}>
                {confirmedSat > 0 && (
                  <View style={styles.balanceRow}>
                    <View style={styles.confirmedBadge}>
                      <Text style={styles.confirmedBadgeText}>✓ {(confirmedSat / 1e8).toFixed(8)} BTC</Text>
                    </View>
                    {btcEurPrice ? (
                      <Text style={styles.eurValueText}>
                        ≈ {formatEur((confirmedSat / 1e8) * btcEurPrice)}
                      </Text>
                    ) : null}
                  </View>
                )}
                {pendingSat > 0 && (
                  <View style={styles.balanceRow}>
                    <View style={styles.pendingBadge}>
                      <Clock size={9} color="#D4A017" />
                      <Text style={styles.pendingBadgeText}>({(pendingSat / 1e8).toFixed(8)} BTC)</Text>
                    </View>
                    {btcEurPrice ? (
                      <Text style={styles.eurPendingText}>
                        ≈ {formatEur((pendingSat / 1e8) * btcEurPrice)}
                      </Text>
                    ) : null}
                  </View>
                )}
              </View>
            )}
          </View>
        </Pressable>
        <View style={styles.cardActions}>
          <TouchableOpacity
            style={styles.historyIconBtn}
            onPress={onHistoryPress}
            testID={`history-btn-${address.index}`}
            hitSlop={{ top: 8, bottom: 8, left: 4, right: 4 }}
          >
            <History size={15} color={Colors.textTertiary} />
          </TouchableOpacity>
          <TouchableOpacity
            style={styles.chevronBtn}
            onPress={onPress}
            hitSlop={{ top: 8, bottom: 8, left: 4, right: 8 }}
          >
            <ChevronRight size={16} color={Colors.textTertiary} />
          </TouchableOpacity>
        </View>
      </View>
    </Animated.View>
  );
}

type TabIconComponent = React.ComponentType<{ size: number; color: string }>;

const TAB_ITEMS: { key: TabName; label: string; Icon: TabIconComponent }[] = [
  { key: 'start', label: 'Start', Icon: Home },
  { key: 'history', label: 'Geschiedenis', Icon: History },
  { key: 'betalen', label: 'Betalen', Icon: ArrowUpRight },
  { key: 'ontvangen', label: 'Ontvangen', Icon: QrCode },
];

function BottomTabBar({ active, onChange }: { active: TabName; onChange: (t: TabName) => void }) {
  const insets = useSafeAreaInsets();
  return (
    <View style={[tabStyles.bar, { paddingBottom: insets.bottom > 0 ? insets.bottom : 10 }]}>
      {TAB_ITEMS.map(({ key, label, Icon }) => {
        const isActive = active === key;
        return (
          <TouchableOpacity
            key={key}
            style={tabStyles.item}
            onPress={() => onChange(key)}
            testID={`tab-${key}`}
            activeOpacity={0.7}
          >
            <View style={[tabStyles.iconWrap, isActive && tabStyles.iconWrapActive]}>
              <Icon size={20} color={isActive ? Colors.bitcoin : Colors.textTertiary} />
            </View>
            <Text style={[tabStyles.label, isActive && tabStyles.labelActive]}>{label}</Text>
          </TouchableOpacity>
        );
      })}
    </View>
  );
}

const LANG_LABELS: Record<Language, string> = { nl: 'NL', fr: 'FR', en: 'EN' };
const LANG_CYCLE: Language[] = ['nl', 'fr', 'en'];

const WALLET_ID = 'BKKS';

export default function WalletScreen() {
  const { addresses, addAddress, removeAddresses, resetWallet, isAddingAddress, isRemovingAddresses, hasWallet, initialized } =
    useWallet();
  const { t, language, setLanguage } = useLanguage();
  const [hideNoAlias, setHideNoAlias] = useState(true);
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [activeTab, setActiveTab] = useState<TabName>('start');
  const [selectedFromAddr, setSelectedFromAddr] = useState<string | null>(null);
  const queryClient = useQueryClient();

  const spinAnim = useRef(new Animated.Value(0)).current;
  const notificationSentRef = useRef(false);
  const lastSupabaseUpdateRef = useRef<number>(0);
  const prevBalancesRef = useRef<Map<string, { satoshi: number; pendingSat: number }>>(new Map());
  const appStateRef = useRef<AppStateStatus>(AppState.currentState);

  useEffect(() => {
    if (initialized && !hasWallet) {
      router.replace('/');
    }
  }, [initialized, hasWallet]);

  useEffect(() => {
    void requestNotificationPermissions();
  }, []);

  useEffect(() => {
    const handleAppStateChange = (nextState: AppStateStatus) => {
      const prev = appStateRef.current;
      appStateRef.current = nextState;
      if ((prev === 'background' || prev === 'inactive') && nextState === 'active') {
        console.log('[AppState] Foreground detected — refetching balances');
        notificationSentRef.current = false;
        lastSupabaseUpdateRef.current = 0;
        void queryClient.refetchQueries({ queryKey: ['all-address-balances', WALLET_ID] });
      }
    };
    const sub = AppState.addEventListener('change', handleAppStateChange);
    return () => sub.remove();
  }, [queryClient]);

  const { data: btcEurPrice } = useBtcEurPrice();

  const { data: storedBalances } = useQuery({
    queryKey: ['stored-balances', WALLET_ID],
    queryFn: () => fetchStoredBalances(WALLET_ID),
    staleTime: Infinity,
  });

  const allBalancesQuery = useQuery({
    queryKey: ['all-address-balances', WALLET_ID, addresses.length],
    queryFn: async (): Promise<AddressBalance[]> => {
      const derivedSet = new Set(addresses.map((a) => a.address));
      const allAddrs = [MAIN_ADDRESS, ...addresses.map((a) => a.address).filter((a) => a !== MAIN_ADDRESS)];
      console.log(`[Balance] Fetching balances for ${allAddrs.length} unique addresses (incl. main, dedup: ${derivedSet.has(MAIN_ADDRESS) ? 'yes' : 'no'})...`);
      const heightRes = await fetch('https://mempool.space/api/blocks/tip/height');
      const currentHeight = heightRes.ok ? parseInt(await heightRes.text(), 10) : 0;

      const results = await Promise.all(
        allAddrs.map((addr) => fetchSingleAddressBalance(addr, currentHeight))
      );

      const withFunds = results.filter((r) => r.satoshi > 0 || r.pendingSat > 0);
      console.log(`[Balance] ${withFunds.length}/${allAddrs.length} addresses have funds`);
      return results;
    },
    enabled: true,
    staleTime: 0,
    refetchOnMount: true,
    refetchInterval: 10 * 60 * 1000,
    retry: 1,
  });

  const liveBalanceMap = useMemo(() => {
    const map = new Map<string, AddressBalance>();
    if (allBalancesQuery.data) {
      for (const b of allBalancesQuery.data) map.set(b.address, b);
    }
    return map;
  }, [allBalancesQuery.data]);

  const historyQuery = useQuery({
    queryKey: ['combined-history', WALLET_ID, addresses.map((a) => a.address).join(',')],
    queryFn: async (): Promise<CombinedTx[]> => {
      console.log(`[History] Fetching txs for ${addresses.length} addresses`);
      const allTxs: CombinedTx[] = [];

      await Promise.all(
        addresses.map(async (addrInfo) => {
          const res = await fetch(`https://mempool.space/api/address/${addrInfo.address}/txs`);
          if (!res.ok) return;
          const txs = (await res.json()) as MempoolTx[];
          for (const tx of txs) {
            const incoming = tx.vout
              .filter((v) => v.scriptpubkey_address === addrInfo.address)
              .reduce((s, v) => s + v.value, 0);
            const outgoing = tx.vin
              .filter((v) => v.prevout?.scriptpubkey_address === addrInfo.address)
              .reduce((s, v) => s + (v.prevout?.value ?? 0), 0);
            if (incoming === 0 && outgoing === 0) continue;
            allTxs.push({
              txid: tx.txid,
              address: addrInfo.address,
              alias: addrInfo.alias ?? undefined,
              label: addrInfo.label,
              netSats: incoming - outgoing,
              confirmed: tx.status.confirmed,
              blockTime: tx.status.block_time,
            });
          }
        })
      );

      return allTxs.sort((a, b) => {
        const at = a.blockTime ?? 9_999_999_999;
        const bt = b.blockTime ?? 9_999_999_999;
        return bt - at;
      });
    },
    enabled: activeTab === 'history' && addresses.length > 0,
    staleTime: 5 * 60 * 1000,
    retry: 1,
  });

  useEffect(() => {
    const ALIAS_INTERVAL = 10 * 60 * 1000;
    const timer = setInterval(() => {
      const aliasAddresses = addresses.filter((a) => a.alias);
      if (aliasAddresses.length === 0) return;
      console.log(`[Wallet] 10-min alias refresh: ${aliasAddresses.length} addresses with alias`);
      void queryClient.refetchQueries({ queryKey: ['all-address-balances', WALLET_ID, addresses.length] });
    }, ALIAS_INTERVAL);
    return () => clearInterval(timer);
  }, [addresses, queryClient]);

  useEffect(() => {
    if (!allBalancesQuery.isFetched || !allBalancesQuery.data) return;
    const now = Date.now();
    if (now - lastSupabaseUpdateRef.current < 30_000) return;
    lastSupabaseUpdateRef.current = now;

    const updates = allBalancesQuery.data
      .filter((b) => b.address !== MAIN_ADDRESS)
      .map(({ address, satoshi, isUsed }) => ({ address, satoshi, isUsed }));

    void updateAddressBalances(updates);

    const prev = prevBalancesRef.current;
    for (const { address, satoshi, pendingSat } of allBalancesQuery.data) {
      if (address === MAIN_ADDRESS) continue;
      const old = prev.get(address);
      if (!old) {
        if (pendingSat > 0) {
          console.log(`[Notifications] New pending tx on ${address}: ${pendingSat} sat`);
          void sendPendingTransactionNotification(address, pendingSat, language);
        }
      } else {
        if (pendingSat > 0 && old.pendingSat === 0) {
          console.log(`[Notifications] New pending tx on ${address}: ${pendingSat} sat`);
          void sendPendingTransactionNotification(address, pendingSat, language);
        }
        if (old.pendingSat > 0 && pendingSat === 0 && satoshi > old.satoshi) {
          const gained = satoshi - old.satoshi;
          console.log(`[Notifications] Incoming tx confirmed on ${address}: +${gained} sat`);
          void sendConfirmedTransactionNotification(address, gained, language);
        }
        if (old.satoshi > 0 && satoshi < old.satoshi && pendingSat === 0 && old.pendingSat === 0) {
          const spent = old.satoshi - satoshi;
          console.log(`[Notifications] Outgoing tx confirmed on ${address}: -${spent} sat`);
          void sendOutgoingConfirmedNotification(address, spent, language);
        }
      }
    }
    const newPrev = new Map<string, { satoshi: number; pendingSat: number }>();
    for (const { address, satoshi, pendingSat } of allBalancesQuery.data) {
      newPrev.set(address, { satoshi, pendingSat });
    }
    prevBalancesRef.current = newPrev;

    const unusedCount = addresses.filter((a) => !a.alias).length;
    console.log(`[Wallet] Addresses without alias: ${unusedCount}`);

    if (unusedCount <= LOW_UNUSED_THRESHOLD && unusedCount > 0 && !notificationSentRef.current) {
      notificationSentRef.current = true;
      void sendLowUnusedAddressNotification(unusedCount, language);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [allBalancesQuery.isFetched, allBalancesQuery.dataUpdatedAt]);

  const totalSat = useMemo(
    () => allBalancesQuery.data?.reduce((sum, b) => sum + b.satoshi, 0) ?? 0,
    [allBalancesQuery.data]
  );
  const totalPendingSat = useMemo(
    () => allBalancesQuery.data?.reduce((sum, b) => sum + b.pendingSat, 0) ?? 0,
    [allBalancesQuery.data]
  );
  const totalBtc = totalSat / 1e8;
  const totalEur = btcEurPrice ? totalBtc * btcEurPrice : null;
  const totalPendingBtc = totalPendingSat / 1e8;
  const totalPendingEur = btcEurPrice && totalPendingSat > 0 ? totalPendingBtc * btcEurPrice : null;

  const getStoredBalance = useCallback((addr: string): StoredBalance | undefined => {
    return storedBalances?.get(addr);
  }, [storedBalances]);

  const getLiveBalance = useCallback((addr: string): AddressBalance | undefined => {
    return liveBalanceMap.get(addr);
  }, [liveBalanceMap]);

  const isAnyFetching = allBalancesQuery.isFetching;

  const handleRefresh = useCallback(() => {
    notificationSentRef.current = false;
    lastSupabaseUpdateRef.current = 0;

    Animated.loop(
      Animated.timing(spinAnim, { toValue: 1, duration: 800, useNativeDriver: true }),
      { iterations: -1 }
    ).start();

    void queryClient.refetchQueries({ queryKey: ['all-address-balances', WALLET_ID, addresses.length] }).then(() => {
      spinAnim.stopAnimation();
      spinAnim.setValue(0);
    });
  }, [queryClient, spinAnim, addresses.length]);

  const spinInterpolate = spinAnim.interpolate({
    inputRange: [0, 1],
    outputRange: ['0deg', '360deg'],
  });

  const baseAddresses = hideNoAlias ? addresses.filter((a) => !!a.alias) : addresses;
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

  const addressesWithFunds = useMemo(() => {
    return addresses.filter((a) => {
      const balance = liveBalanceMap.get(a.address);
      return (balance?.satoshi ?? 0) > 0;
    });
  }, [addresses, liveBalanceMap]);

  const aliasAddresses = useMemo(() => addresses.filter((a) => !!a.alias), [addresses]);

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

  const handleRemoveUnused = useCallback(() => {
    const unusedIndices = addresses
      .filter((addr) => {
        const hasAlias = !!addr.alias;
        if (hasAlias) return false;
        const live = liveBalanceMap.get(addr.address);
        const hasFunds = live ? (live.satoshi > 0 || live.pendingSat > 0) : false;
        return !hasFunds;
      })
      .map((a) => a.index);

    if (unusedIndices.length === 0) {
      Alert.alert('Geen ongebruikte adressen', 'Alle adressen hebben een alias of saldo.');
      return;
    }

    Alert.alert(
      'Verwijder ongebruikte adressen',
      `${unusedIndices.length} adres(sen) zonder alias en zonder saldo worden verwijderd. Dit kan niet ongedaan worden gemaakt.`,
      [
        { text: t.wallet.cancel, style: 'cancel' },
        {
          text: `Verwijder ${unusedIndices.length}`,
          style: 'destructive',
          onPress: () => removeAddresses(unusedIndices),
        },
      ]
    );
  }, [addresses, liveBalanceMap, removeAddresses, t.wallet.cancel]);

  const handleSettings = () => {
    Alert.alert(t.wallet.title, '', [
      { text: t.wallet.viewSeedPhrase, onPress: () => router.push('/seed-phrase') },
      {
        text: t.wallet.exportAddresses.replace('%d', String(addresses.length)),
        onPress: handleExportAddresses,
      },
      {
        text: 'Sweep (consolideer fondsen)',
        onPress: () => router.push('/sweep'),
      },
      {
        text: 'Verwijder ongebruikte adressen',
        style: 'destructive',
        onPress: handleRemoveUnused,
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
              onPress: () => { resetWallet(); },
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
            {allBalancesQuery.isFetching && totalSat === 0 ? (
              <ActivityIndicator size="small" color={Colors.bitcoin} style={{ marginVertical: 8 }} />
            ) : (
              <>
                <Text style={styles.walletValueAmount}>
                  {totalEur !== null ? formatEur(totalEur) : '—'}
                </Text>
                <Text style={styles.walletValueBtc}>{formatBtc(totalBtc)} BTC</Text>
                {totalPendingSat > 0 && (
                  <View style={styles.pendingRow}>
                    <Clock size={10} color="#D4A017" />
                    <Text style={styles.totalPendingText}>
                      ({formatBtc(totalPendingBtc)}{totalPendingEur !== null ? ` / ${formatEur(totalPendingEur)}` : ''}) wachtend
                    </Text>
                  </View>
                )}
              </>
            )}
            <Text style={styles.mainAddrLabel}>{formatAddress(MAIN_ADDRESS)}</Text>
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
            <TouchableOpacity
              style={styles.refreshMainBtn}
              onPress={handleRefresh}
              disabled={allBalancesQuery.isFetching}
              testID="refresh-main-btn"
            >
              <Animated.View style={{ transform: [{ rotate: allBalancesQuery.isFetching ? spinInterpolate : '0deg' }] }}>
                <RotateCcw size={11} color={allBalancesQuery.isFetching ? Colors.bitcoin : Colors.textTertiary} />
              </Animated.View>
              <Text style={[styles.refreshMainBtnText, allBalancesQuery.isFetching && { color: Colors.bitcoin }]}>
                {allBalancesQuery.isFetching ? 'Laden…' : '60 min'}
              </Text>
            </TouchableOpacity>
          </View>
        </View>

        <View style={styles.statsRow}>
          <View style={styles.statCell}>
            <Text style={styles.statLabel}>{t.wallet.addresses}</Text>
            <Text style={styles.statValue}>{addresses.length}</Text>
          </View>
          <View style={styles.statSep} />
          <View style={styles.statCell}>
            <Text style={styles.statLabel}>MET ALIAS</Text>
            <Text style={[styles.statValue, { color: Colors.success }]}>
              {addresses.filter((a) => !!a.alias).length}
            </Text>
          </View>
          <View style={styles.statSep} />
          <View style={styles.statCell}>
            <Text style={styles.statLabel}>{t.wallet.network}</Text>
            <Text style={[styles.statValue, { color: Colors.success }]}>{t.wallet.mainnet}</Text>
          </View>
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
          {hiddenCount > 0 && hideNoAlias && (
            <Text style={styles.hiddenCount}>
              {hiddenCount} {t.wallet.hidden}
            </Text>
          )}
        </View>
        <View style={styles.sectionActions}>
          <TouchableOpacity
            style={styles.addBtnSmall}
            onPress={() => addAddress()}
            disabled={isAddingAddress || isRemovingAddresses}
            activeOpacity={0.8}
            testID="add-address-btn"
          >
            {isAddingAddress ? (
              <ActivityIndicator size="small" color={Colors.bitcoin} />
            ) : (
              <>
                <Plus size={13} color={Colors.bitcoin} />
                <Text style={styles.addBtnSmallText}>Toevoegen</Text>
              </>
            )}
          </TouchableOpacity>
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
            style={[styles.filterToggle, hideNoAlias && styles.filterToggleActive]}
            onPress={() => setHideNoAlias((v) => !v)}
            activeOpacity={0.7}
            testID="hide-no-alias-toggle"
          >
            {hideNoAlias ? (
              <EyeOff size={13} color={Colors.bitcoin} />
            ) : (
              <Eye size={13} color={Colors.textTertiary} />
            )}
            <Text style={[styles.filterToggleText, hideNoAlias && styles.filterToggleTextActive]}>
              {hideNoAlias ? 'Toon alle' : 'Alias'}
            </Text>
          </TouchableOpacity>
        </View>
      </View>
    </View>
  );

  return (
    <View style={styles.container}>
      <SafeAreaView style={styles.safeArea} edges={['top']}>
        {activeTab === 'start' && (
          <FlatList
            data={displayedAddresses}
            keyExtractor={(item) => item.address}
            renderItem={({ item }) => (
              <AddressCard
                address={item}
                liveBalance={getLiveBalance(item.address)}
                storedBalance={getStoredBalance(item.address)}
                btcEurPrice={btcEurPrice ?? undefined}
                onPress={() => router.push(`/address-detail?idx=${item.index}`)}
                onHistoryPress={() =>
                  router.push(
                    `/address-history?addr=${item.address}&label=${encodeURIComponent(item.alias ?? item.label)}`
                  )
                }
              />
            )}
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
        )}

        {activeTab === 'history' && (
          <View style={{ flex: 1 }}>
            <View style={styles.historyPageHeader}>
              <View style={styles.historyPageTitleRow}>
                <View>
                  <Text style={styles.tabPageTitle}>Geschiedenis</Text>
                  <Text style={styles.tabPageSub}>Alle transacties</Text>
                </View>
                <TouchableOpacity
                  style={[styles.refreshBtn, historyQuery.isFetching && styles.refreshBtnActive]}
                  onPress={() => void historyQuery.refetch()}
                  disabled={historyQuery.isFetching}
                  activeOpacity={0.7}
                >
                  <Animated.View style={{ transform: [{ rotate: historyQuery.isFetching ? spinInterpolate : '0deg' }] }}>
                    <RotateCcw size={13} color={historyQuery.isFetching ? Colors.bitcoin : Colors.textTertiary} />
                  </Animated.View>
                  <Text style={[styles.refreshBtnText, historyQuery.isFetching && styles.refreshBtnTextActive]}>
                    {historyQuery.isFetching ? 'Laden…' : 'Vernieuwen'}
                  </Text>
                </TouchableOpacity>
              </View>
              {allBalancesQuery.data && (
                <View style={styles.historyStatsRow}>
                  <View style={styles.historyStatCard}>
                    <Text style={styles.historyStatLabel}>TOTAAL BTC</Text>
                    <Text style={styles.historyStatValue}>{formatBtc(totalBtc)}</Text>
                  </View>
                  <View style={styles.historyStatCard}>
                    <Text style={styles.historyStatLabel}>TOTAAL EUR</Text>
                    <Text style={[styles.historyStatValue, { color: Colors.bitcoin }]}>
                      {totalEur !== null ? formatEur(totalEur) : '—'}
                    </Text>
                  </View>
                  <View style={styles.historyStatCard}>
                    <Text style={styles.historyStatLabel}>ADRESSEN</Text>
                    <Text style={styles.historyStatValue}>{addresses.length}</Text>
                  </View>
                </View>
              )}
            </View>
            {historyQuery.isLoading && (
              <View style={styles.centerState}>
                <ActivityIndicator size="large" color={Colors.bitcoin} />
                <Text style={styles.centerText}>Transacties laden…</Text>
              </View>
            )}
            {historyQuery.isError && (
              <View style={styles.centerState}>
                <Text style={styles.emptyTitle}>Ophalen mislukt</Text>
                <TouchableOpacity style={styles.retryBtn} onPress={() => void historyQuery.refetch()}>
                  <Text style={styles.retryBtnText}>Opnieuw proberen</Text>
                </TouchableOpacity>
              </View>
            )}
            {historyQuery.isFetched && !historyQuery.isLoading && (historyQuery.data?.length ?? 0) === 0 && (
              <View style={styles.centerState}>
                <Text style={styles.emptyTitle}>Geen transacties</Text>
                <Text style={styles.emptyText}>Er zijn nog geen transacties gevonden voor de adressen in deze wallet.</Text>
              </View>
            )}
            {!historyQuery.isFetched && !historyQuery.isLoading && addresses.length === 0 && (
              <View style={styles.centerState}>
                <Text style={styles.emptyTitle}>Geen adressen</Text>
                <Text style={styles.emptyText}>Voeg adressen toe om transacties te zien.</Text>
              </View>
            )}
            {(historyQuery.data?.length ?? 0) > 0 && (
              <FlatList
                data={historyQuery.data}
                keyExtractor={(item, idx) => `${item.txid}-${item.address}-${idx}`}
                contentContainerStyle={styles.historyList}
                showsVerticalScrollIndicator={false}
                renderItem={({ item }) => {
                  const isIn = item.netSats >= 0;
                  return (
                    <TouchableOpacity
                      style={styles.historyCard}
                      activeOpacity={0.75}
                      onPress={() => void Linking.openURL(`https://mempool.space/tx/${item.txid}`)}
                    >
                      <View style={[styles.historyIconWrap, isIn ? styles.historyIconIn : styles.historyIconOut]}>
                        {isIn ? (
                          <ArrowDownLeft size={15} color={Colors.success} />
                        ) : (
                          <ArrowUpRight size={15} color={Colors.error} />
                        )}
                      </View>
                      <View style={styles.historyBody}>
                        <View style={styles.historyTopRow}>
                          <Text style={styles.historyAlias} numberOfLines={1}>
                            {item.alias ?? item.label}
                          </Text>
                          {item.confirmed ? (
                            <View style={styles.smallConfirmedBadge}>
                              <Text style={styles.smallConfirmedText}>✓</Text>
                            </View>
                          ) : (
                            <View style={styles.smallPendingBadge}>
                              <Clock size={8} color="#D4A017" />
                            </View>
                          )}
                        </View>
                        <Text style={[styles.historyAmount, isIn ? styles.historyAmountIn : styles.historyAmountOut]}>
                          {isIn ? '+' : '−'}{(Math.abs(item.netSats) / 1e8).toFixed(8)} BTC
                        </Text>
                        {item.blockTime ? (
                          <Text style={styles.historyDate}>{formatDate(item.blockTime)}</Text>
                        ) : (
                          <Text style={styles.historyDate}>Onbevestigd</Text>
                        )}
                      </View>
                      <ExternalLink size={12} color={Colors.textTertiary} />
                    </TouchableOpacity>
                  );
                }}
              />
            )}
          </View>
        )}

        {activeTab === 'betalen' && (
          <View style={{ flex: 1 }}>
            <View style={styles.tabPageHeader}>
              <Text style={styles.tabPageTitle}>Betalen</Text>
              <Text style={styles.tabPageSub}>Kies een verzendadres</Text>
            </View>
            {addressesWithFunds.length === 0 ? (
              <View style={styles.centerState}>
                <Text style={styles.emptyTitle}>Geen saldo</Text>
                <Text style={styles.emptyText}>Er zijn momenteel geen adressen met een bevestigd saldo.</Text>
              </View>
            ) : (
              <View style={{ flex: 1 }}>
                <ScrollView contentContainerStyle={styles.betalenList} showsVerticalScrollIndicator={false}>
                  <Text style={styles.betalenHint}>
                    Selecteer het adres van waaruit je wilt betalen, of ga direct door voor een betaling vanuit de hele wallet.
                  </Text>
                  {addressesWithFunds.map((addr) => {
                    const balance = liveBalanceMap.get(addr.address);
                    const sat = balance?.satoshi ?? 0;
                    const eur = btcEurPrice ? (sat / 1e8) * btcEurPrice : null;
                    const isSelected = selectedFromAddr === addr.address;
                    return (
                      <TouchableOpacity
                        key={addr.address}
                        style={[styles.betalenCard, isSelected && styles.betalenCardSelected]}
                        onPress={() => setSelectedFromAddr(isSelected ? null : addr.address)}
                        activeOpacity={0.8}
                        testID={`betalen-addr-${addr.index}`}
                      >
                        <View style={[styles.betalenAccent, isSelected && styles.betalenAccentSelected]} />
                        <View style={{ flex: 1, paddingHorizontal: 12, paddingVertical: 12 }}>
                          <View style={styles.betalenCardTop}>
                            <View style={styles.labelBadge}>
                              <Text style={styles.labelBadgeText}>{addr.label}</Text>
                            </View>
                            {addr.alias ? (
                              <View style={[styles.aliasBadge, isSelected && styles.aliasBadgeSelected]}>
                                <Text style={[styles.aliasBadgeText, isSelected && { color: Colors.bitcoin }]} numberOfLines={1}>
                                  {addr.alias}
                                </Text>
                              </View>
                            ) : null}
                          </View>
                          <Text style={styles.betalenAddrText}>{formatAddress(addr.address)}</Text>
                          <Text style={[styles.betalenBalance, isSelected && { color: Colors.bitcoin }]}>
                            {(sat / 1e8).toFixed(8)} BTC
                            {eur !== null ? ` ≈ ${formatEur(eur)}` : ''}
                          </Text>
                        </View>
                        {isSelected && (
                          <View style={styles.betalenCheck}>
                            <Text style={styles.betalenCheckText}>✓</Text>
                          </View>
                        )}
                      </TouchableOpacity>
                    );
                  })}
                </ScrollView>
                <View style={styles.betalenFooter}>
                  <TouchableOpacity
                    style={styles.betalenBtn}
                    onPress={() => router.push('/send')}
                    activeOpacity={0.85}
                    testID="betalen-proceed-btn"
                  >
                    <ArrowUpRight size={18} color="#FFF" />
                    <Text style={styles.betalenBtnText}>
                      {selectedFromAddr ? 'Betalen van geselecteerd adres' : 'Betalen vanuit wallet'}
                    </Text>
                  </TouchableOpacity>
                </View>
              </View>
            )}
          </View>
        )}

        {activeTab === 'ontvangen' && (
          <View style={{ flex: 1 }}>
            <View style={styles.tabPageHeader}>
              <Text style={styles.tabPageTitle}>Ontvangen</Text>
              <Text style={styles.tabPageSub}>Kies een ontvangstadres</Text>
            </View>
            {aliasAddresses.length === 0 ? (
              <View style={styles.centerState}>
                <Text style={styles.emptyTitle}>Geen adressen</Text>
                <Text style={styles.emptyText}>Voeg adressen toe en geef ze een alias om ze hier te zien.</Text>
              </View>
            ) : (
              <FlatList
                data={aliasAddresses}
                keyExtractor={(item) => item.address}
                contentContainerStyle={styles.ontvangenList}
                showsVerticalScrollIndicator={false}
                renderItem={({ item }) => {
                  const balance = liveBalanceMap.get(item.address);
                  const sat = balance?.satoshi ?? 0;
                  return (
                    <TouchableOpacity
                      style={styles.ontvangenCard}
                      onPress={() => router.push(`/address-detail?idx=${item.index}`)}
                      activeOpacity={0.8}
                      testID={`ontvangen-addr-${item.index}`}
                    >
                      <View style={styles.ontvangenQrWrap}>
                        <QRCodeDisplay
                          value={`bitcoin:${item.address}`}
                          size={64}
                          bgColor="#FFFFFF"
                          fgColor="#0A0A0F"
                        />
                      </View>
                      <View style={styles.ontvangenBody}>
                        <View style={styles.ontvangenTopRow}>
                          <View style={styles.labelBadge}>
                            <Text style={styles.labelBadgeText}>{item.label}</Text>
                          </View>
                          <Text style={styles.ontvangenAlias} numberOfLines={1}>{item.alias}</Text>
                        </View>
                        <Text style={styles.ontvangenAddr}>{formatAddress(item.address)}</Text>
                        {sat > 0 && (
                          <Text style={styles.ontvangenBalance}>
                            {(sat / 1e8).toFixed(8)} BTC
                          </Text>
                        )}
                      </View>
                      <ChevronRight size={15} color={Colors.textTertiary} />
                    </TouchableOpacity>
                  );
                }}
              />
            )}
          </View>
        )}
      </SafeAreaView>

      <BottomTabBar active={activeTab} onChange={setActiveTab} />
    </View>
  );
}

const tabStyles = StyleSheet.create({
  bar: {
    flexDirection: 'row',
    backgroundColor: Colors.surface,
    borderTopWidth: 1,
    borderTopColor: Colors.border,
    paddingTop: 8,
  },
  item: {
    flex: 1,
    alignItems: 'center',
    gap: 3,
    paddingTop: 2,
  },
  iconWrap: {
    width: 40,
    height: 32,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 16,
  },
  iconWrapActive: {
    backgroundColor: 'rgba(247,147,26,0.12)',
  },
  label: {
    fontSize: 10,
    fontWeight: '600',
    color: Colors.textTertiary,
    letterSpacing: 0.2,
  },
  labelActive: {
    color: Colors.bitcoin,
  },
});

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
    flex: 1,
    marginRight: 8,
    overflow: 'hidden',
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
  headerTitle: { fontSize: 18, fontWeight: '800', color: Colors.text, letterSpacing: -0.3, includeFontPadding: false } as object,
  headerSubtitle: { fontSize: 11, color: Colors.textTertiary, marginTop: 1, flexShrink: 1, includeFontPadding: false } as object,
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
    alignItems: 'flex-start',
    justifyContent: 'space-between',
  },
  walletValueLeft: {
    gap: 2,
    flex: 1,
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
    includeFontPadding: false,
  } as object,
  walletValueBtc: {
    fontSize: 12,
    color: Colors.textSecondary,
    marginTop: 2,
    fontFamily: Platform.OS === 'android' ? 'monospace' : 'Courier',
  },
  pendingRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    marginTop: 2,
  },
  totalPendingText: {
    fontSize: 11,
    color: '#D4A017',
    fontWeight: '600',
    fontFamily: Platform.OS === 'android' ? 'monospace' : 'Courier',
  },
  mainAddrLabel: {
    fontSize: 10,
    color: Colors.textTertiary,
    fontFamily: 'monospace',
    marginTop: 4,
  },
  walletValueRight: {
    alignItems: 'flex-end',
    gap: 6,
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
  refreshMainBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 12,
    backgroundColor: Colors.background,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  refreshMainBtnText: {
    fontSize: 10,
    color: Colors.textTertiary,
    fontWeight: '600',
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
  list: { paddingBottom: 16 },
  sectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 12,
    marginTop: 16,
    paddingHorizontal: 20,
    flexWrap: 'wrap',
    gap: 6,
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
  addBtnSmall: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 20,
    backgroundColor: 'rgba(247,147,26,0.1)',
    borderWidth: 1,
    borderColor: 'rgba(247,147,26,0.25)',
  },
  addBtnSmallText: {
    fontSize: 11,
    fontWeight: '700',
    color: Colors.bitcoin,
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
  cardMain: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
  },
  cardAccent: {
    width: 3,
    alignSelf: 'stretch',
    backgroundColor: Colors.bitcoin,
    opacity: 0.3,
  },
  cardAccentFunded: {
    opacity: 1,
  },
  cardBody: { flex: 1, padding: 14, paddingLeft: 13, gap: 5 },
  cardTopRow: { flexDirection: 'row', alignItems: 'center', gap: 8, flexWrap: 'wrap' },
  cardActions: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingRight: 6,
    gap: 2,
  },
  historyIconBtn: {
    width: 32,
    height: 32,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 16,
    backgroundColor: 'rgba(255,255,255,0.04)',
  },
  chevronBtn: {
    width: 28,
    height: 32,
    alignItems: 'center',
    justifyContent: 'center',
  },
  labelBadge: {
    backgroundColor: 'rgba(247,147,26,0.12)',
    paddingHorizontal: 9,
    paddingVertical: 3,
    borderRadius: 6,
  },
  labelBadgeText: { fontSize: 11, fontWeight: '700', color: Colors.bitcoin },
  aliasBadge: {
    backgroundColor: 'rgba(52,199,89,0.1)',
    paddingHorizontal: 9,
    paddingVertical: 3,
    borderRadius: 6,
    maxWidth: 160,
  },
  aliasBadgeText: { fontSize: 11, fontWeight: '600', color: Colors.success },
  addressText: {
    fontSize: 12,
    color: Colors.textTertiary,
    fontFamily: Platform.OS === 'android' ? 'monospace' : 'Courier',
    letterSpacing: 0.2,
  },
  balanceCol: {
    gap: 4,
  },
  balanceRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    flexWrap: 'wrap',
  },
  confirmedBadge: {
    backgroundColor: 'rgba(247,147,26,0.15)',
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 5,
    borderWidth: 1,
    borderColor: 'rgba(247,147,26,0.3)',
  },
  confirmedBadgeText: {
    fontSize: 11,
    fontWeight: '700',
    color: Colors.bitcoin,
  },
  pendingBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
    backgroundColor: 'rgba(212,160,23,0.1)',
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 5,
    borderWidth: 1,
    borderColor: 'rgba(212,160,23,0.25)',
  },
  pendingBadgeText: {
    fontSize: 11,
    fontWeight: '600',
    color: '#D4A017',
    fontFamily: Platform.OS === 'android' ? 'monospace' : 'Courier',
  },
  eurValueText: {
    fontSize: 11,
    fontWeight: '600',
    color: Colors.textSecondary,
  },
  eurPendingText: {
    fontSize: 11,
    fontWeight: '500',
    color: Colors.textTertiary,
  },
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
  historyPageHeader: {
    paddingHorizontal: 20,
    paddingTop: 20,
    paddingBottom: 16,
    borderBottomWidth: 1,
    borderBottomColor: Colors.border,
    gap: 14,
  },
  historyPageTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  historyStatsRow: {
    flexDirection: 'row',
    gap: 8,
  },
  historyStatCard: {
    flex: 1,
    backgroundColor: Colors.surface,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: Colors.border,
    paddingVertical: 10,
    paddingHorizontal: 10,
    gap: 3,
  },
  historyStatLabel: {
    fontSize: 9,
    fontWeight: '700',
    color: Colors.textTertiary,
    letterSpacing: 0.8,
  },
  historyStatValue: {
    fontSize: 13,
    fontWeight: '800',
    color: Colors.text,
    letterSpacing: -0.2,
    fontFamily: Platform.OS === 'android' ? 'monospace' : 'Courier',
    includeFontPadding: false,
  } as object,
  tabPageHeader: {
    paddingHorizontal: 20,
    paddingTop: 20,
    paddingBottom: 16,
    borderBottomWidth: 1,
    borderBottomColor: Colors.border,
  },
  tabPageTitle: {
    fontSize: 24,
    fontWeight: '800',
    color: Colors.text,
    letterSpacing: -0.5,
  },
  tabPageSub: {
    fontSize: 12,
    color: Colors.textTertiary,
    marginTop: 2,
  },
  centerState: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 14,
    paddingHorizontal: 32,
  },
  centerText: { fontSize: 14, color: Colors.textSecondary },
  emptyTitle: { fontSize: 18, fontWeight: '700', color: Colors.text },
  emptyText: { fontSize: 14, color: Colors.textSecondary, textAlign: 'center', lineHeight: 21 },
  retryBtn: {
    paddingHorizontal: 20,
    paddingVertical: 10,
    borderRadius: 12,
    backgroundColor: Colors.surface,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  retryBtnText: { fontSize: 14, fontWeight: '700', color: Colors.bitcoin },
  historyList: {
    paddingHorizontal: 16,
    paddingTop: 10,
    paddingBottom: 16,
  },
  historyCard: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: Colors.surface,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: Colors.border,
    padding: 12,
    marginBottom: 8,
    gap: 10,
  },
  historyIconWrap: {
    width: 34,
    height: 34,
    borderRadius: 17,
    alignItems: 'center',
    justifyContent: 'center',
  },
  historyIconIn: { backgroundColor: 'rgba(52,199,89,0.12)' },
  historyIconOut: { backgroundColor: 'rgba(255,59,48,0.12)' },
  historyBody: { flex: 1, gap: 2 },
  historyTopRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  historyAlias: {
    fontSize: 13,
    fontWeight: '700',
    color: Colors.text,
    flex: 1,
  },
  historyAmount: {
    fontSize: 13,
    fontWeight: '800',
    fontFamily: Platform.OS === 'android' ? 'monospace' : 'Courier',
    includeFontPadding: false,
  } as object,
  historyAmountIn: { color: Colors.success },
  historyAmountOut: { color: Colors.error },
  historyDate: { fontSize: 10, color: Colors.textTertiary },
  smallConfirmedBadge: {
    backgroundColor: 'rgba(52,199,89,0.12)',
    width: 18,
    height: 18,
    borderRadius: 9,
    alignItems: 'center',
    justifyContent: 'center',
  },
  smallConfirmedText: { fontSize: 9, fontWeight: '800', color: Colors.success },
  smallPendingBadge: {
    backgroundColor: 'rgba(212,160,23,0.12)',
    width: 18,
    height: 18,
    borderRadius: 9,
    alignItems: 'center',
    justifyContent: 'center',
  },
  betalenList: {
    padding: 16,
    paddingBottom: 100,
    gap: 10,
  },
  betalenHint: {
    fontSize: 13,
    color: Colors.textTertiary,
    lineHeight: 19,
    marginBottom: 6,
  },
  betalenCard: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: Colors.surface,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: Colors.border,
    overflow: 'hidden',
  },
  betalenCardSelected: {
    borderColor: Colors.bitcoin,
    backgroundColor: 'rgba(247,147,26,0.06)',
  },
  betalenAccent: {
    width: 3,
    alignSelf: 'stretch',
    backgroundColor: Colors.bitcoin,
    opacity: 0.3,
  },
  betalenAccentSelected: {
    opacity: 1,
  },
  betalenCardTop: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    flexWrap: 'wrap',
    marginBottom: 4,
  },
  aliasBadgeSelected: {
    backgroundColor: 'rgba(247,147,26,0.15)',
  },
  betalenAddrText: {
    fontSize: 11,
    color: Colors.textTertiary,
    fontFamily: Platform.OS === 'android' ? 'monospace' : 'Courier',
    marginBottom: 3,
  },
  betalenBalance: {
    fontSize: 13,
    fontWeight: '700',
    color: Colors.text,
    fontFamily: Platform.OS === 'android' ? 'monospace' : 'Courier',
  },
  betalenCheck: {
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: Colors.bitcoin,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 12,
  },
  betalenCheckText: {
    fontSize: 13,
    fontWeight: '800',
    color: '#FFF',
  },
  betalenFooter: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    padding: 16,
    backgroundColor: Colors.background,
    borderTopWidth: 1,
    borderTopColor: Colors.border,
  },
  betalenBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    backgroundColor: Colors.bitcoin,
    borderRadius: 16,
    paddingVertical: 16,
    shadowColor: Colors.bitcoin,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.35,
    shadowRadius: 10,
    elevation: 6,
  },
  betalenBtnText: {
    fontSize: 16,
    fontWeight: '800',
    color: '#FFF',
    letterSpacing: -0.2,
  },
  ontvangenList: {
    padding: 16,
    gap: 10,
    paddingBottom: 16,
  },
  ontvangenCard: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: Colors.surface,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: Colors.border,
    padding: 12,
    gap: 12,
  },
  ontvangenQrWrap: {
    borderRadius: 10,
    overflow: 'hidden',
    padding: 4,
    backgroundColor: '#FFFFFF',
  },
  ontvangenBody: { flex: 1, gap: 4 },
  ontvangenTopRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  ontvangenAlias: {
    fontSize: 13,
    fontWeight: '700',
    color: Colors.text,
    flex: 1,
  },
  ontvangenAddr: {
    fontSize: 11,
    color: Colors.textTertiary,
    fontFamily: Platform.OS === 'android' ? 'monospace' : 'Courier',
  },
  ontvangenBalance: {
    fontSize: 11,
    fontWeight: '700',
    color: Colors.bitcoin,
    fontFamily: Platform.OS === 'android' ? 'monospace' : 'Courier',
  },
});
