import React, { useMemo, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  FlatList,
  TouchableOpacity,
  ActivityIndicator,
  Linking,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useLocalSearchParams, router } from 'expo-router';
import { useQuery } from '@tanstack/react-query';
import { X, ArrowDownLeft, ArrowUpRight, Clock, ExternalLink } from 'lucide-react-native';
import { Colors } from '@/constants/colors';

interface MempoolTxStatus {
  confirmed: boolean;
  block_height?: number;
  block_time?: number;
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
  status: MempoolTxStatus;
  vin: MempoolTxVin[];
  vout: MempoolTxVout[];
  fee?: number;
}

interface ParsedTx {
  txid: string;
  netSats: number;
  confirmed: boolean;
  blockTime?: number;
  fee?: number;
}

function formatBtc(sats: number): string {
  const abs = Math.abs(sats);
  return (abs / 1e8).toFixed(8);
}

function formatDate(ts?: number): string {
  if (!ts) return '';
  const d = new Date(ts * 1000);
  return d.toLocaleDateString('nl-NL', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  }) + '  ' + d.toLocaleTimeString('nl-NL', { hour: '2-digit', minute: '2-digit' });
}

function formatAddress(addr: string): string {
  return `${addr.slice(0, 10)}···${addr.slice(-10)}`;
}

export default function AddressHistoryScreen() {
  const { addr, label } = useLocalSearchParams<{ addr: string; label?: string }>();

  const txQuery = useQuery({
    queryKey: ['address-txs', addr],
    queryFn: async (): Promise<ParsedTx[]> => {
      if (!addr) return [];
      console.log(`[AddressHistory] Fetching txs for ${addr}`);
      const res = await fetch(`https://mempool.space/api/address/${addr}/txs`);
      if (!res.ok) throw new Error('Ophalen mislukt');
      const txs = (await res.json()) as MempoolTx[];

      return txs.map((tx): ParsedTx => {
        const incoming = tx.vout
          .filter((v) => v.scriptpubkey_address === addr)
          .reduce((s, v) => s + v.value, 0);
        const outgoing = tx.vin
          .filter((v) => v.prevout?.scriptpubkey_address === addr)
          .reduce((s, v) => s + (v.prevout?.value ?? 0), 0);
        return {
          txid: tx.txid,
          netSats: incoming - outgoing,
          confirmed: tx.status.confirmed,
          blockTime: tx.status.block_time,
          fee: tx.fee,
        };
      });
    },
    enabled: !!addr,
    staleTime: 5 * 60 * 1000,
    retry: 2,
  });

  const [filter, setFilter] = useState<'all' | 'in' | 'out'>('all');

  const sortedTxs = useMemo(() => {
    if (!txQuery.data) return [];
    return [...txQuery.data].sort((a, b) => {
      const at = a.blockTime ?? 9_999_999_999;
      const bt = b.blockTime ?? 9_999_999_999;
      return bt - at;
    });
  }, [txQuery.data]);

  const filteredTxs = useMemo(() => {
    if (filter === 'in') return sortedTxs.filter((tx) => tx.netSats >= 0);
    if (filter === 'out') return sortedTxs.filter((tx) => tx.netSats < 0);
    return sortedTxs;
  }, [sortedTxs, filter]);

  const displayLabel = label ?? formatAddress(addr ?? '');

  return (
    <View style={styles.container}>
      <SafeAreaView style={styles.safeArea} edges={['top', 'bottom']}>
        <View style={styles.header}>
          <View style={styles.headerLeft}>
            <View style={styles.headerBadge}>
              <Text style={styles.headerBadgeText}>₿</Text>
            </View>
            <View style={{ flex: 1 }}>
              <Text style={styles.headerTitle} numberOfLines={1}>{displayLabel}</Text>
              <Text style={styles.headerSub} numberOfLines={1}>{formatAddress(addr ?? '')}</Text>
            </View>
          </View>
          <TouchableOpacity style={styles.closeBtn} onPress={() => router.back()} testID="close-history-btn">
            <X size={17} color={Colors.textSecondary} />
          </TouchableOpacity>
        </View>

        {txQuery.isLoading && (
          <View style={styles.centerState}>
            <ActivityIndicator size="large" color={Colors.bitcoin} />
            <Text style={styles.centerText}>Transacties laden…</Text>
          </View>
        )}

        {txQuery.isError && (
          <View style={styles.centerState}>
            <Text style={styles.errorText}>Ophalen mislukt</Text>
            <TouchableOpacity style={styles.retryBtn} onPress={() => void txQuery.refetch()}>
              <Text style={styles.retryBtnText}>Opnieuw</Text>
            </TouchableOpacity>
          </View>
        )}

        {txQuery.isFetched && !txQuery.isLoading && (
          <View style={styles.filterRow}>
            <TouchableOpacity
              style={[styles.filterBtn, filter === 'all' && styles.filterBtnActive]}
              onPress={() => setFilter('all')}
              testID="filter-all"
            >
              <Text style={[styles.filterBtnText, filter === 'all' && styles.filterBtnTextActive]}>Alle</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.filterBtn, filter === 'in' && styles.filterBtnActiveIn]}
              onPress={() => setFilter('in')}
              testID="filter-in"
            >
              <ArrowDownLeft size={13} color={filter === 'in' ? Colors.success : Colors.textSecondary} />
              <Text style={[styles.filterBtnText, filter === 'in' && styles.filterBtnTextIn]}>Ontvangen</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.filterBtn, filter === 'out' && styles.filterBtnActiveOut]}
              onPress={() => setFilter('out')}
              testID="filter-out"
            >
              <ArrowUpRight size={13} color={filter === 'out' ? Colors.error : Colors.textSecondary} />
              <Text style={[styles.filterBtnText, filter === 'out' && styles.filterBtnTextOut]}>Verzonden</Text>
            </TouchableOpacity>
          </View>
        )}

        {txQuery.isFetched && sortedTxs.length === 0 && (
          <View style={styles.centerState}>
            <Text style={styles.emptyTitle}>Geen transacties</Text>
            <Text style={styles.emptyText}>Dit adres heeft nog geen activiteit op het netwerk.</Text>
          </View>
        )}

        {filteredTxs.length === 0 && sortedTxs.length > 0 && (
          <View style={styles.centerState}>
            <Text style={styles.emptyTitle}>Geen resultaten</Text>
            <Text style={styles.emptyText}>Er zijn geen {filter === 'in' ? 'inkomende' : 'uitgaande'} transacties voor dit adres.</Text>
          </View>
        )}

        {filteredTxs.length > 0 && (
          <FlatList
            data={filteredTxs}
            keyExtractor={(item) => item.txid}
            contentContainerStyle={styles.list}
            showsVerticalScrollIndicator={false}
            ListHeaderComponent={
              <View style={styles.listHeader}>
                <Text style={styles.listHeaderLabel}>
                  {filteredTxs.length} transactie{filteredTxs.length !== 1 ? 's' : ''}
                </Text>
              </View>
            }
            renderItem={({ item }) => {
              const isIn = item.netSats >= 0;
              return (
                <TouchableOpacity
                  style={styles.txCard}
                  activeOpacity={0.75}
                  onPress={() =>
                    void Linking.openURL(`https://mempool.space/tx/${item.txid}`)
                  }
                  testID={`tx-${item.txid}`}
                >
                  <View style={[styles.txIconWrap, isIn ? styles.txIconIn : styles.txIconOut]}>
                    {isIn ? (
                      <ArrowDownLeft size={16} color={Colors.success} />
                    ) : (
                      <ArrowUpRight size={16} color={Colors.error} />
                    )}
                  </View>

                  <View style={styles.txBody}>
                    <View style={styles.txTopRow}>
                      <Text style={[styles.txDirection, isIn ? styles.txIn : styles.txOut]}>
                        {isIn ? 'Ontvangen' : 'Verzonden'}
                      </Text>
                      {item.confirmed ? (
                        <View style={styles.confirmedBadge}>
                          <Text style={styles.confirmedBadgeText}>✓ Bevestigd</Text>
                        </View>
                      ) : (
                        <View style={styles.pendingBadge}>
                          <Clock size={9} color="#D4A017" />
                          <Text style={styles.pendingBadgeText}>Wachtend</Text>
                        </View>
                      )}
                    </View>
                    <Text style={[styles.txAmount, isIn ? styles.txAmountIn : styles.txAmountOut]}>
                      {isIn ? '+' : '−'}{formatBtc(item.netSats)} BTC
                    </Text>
                    {item.blockTime ? (
                      <Text style={styles.txDate}>{formatDate(item.blockTime)}</Text>
                    ) : null}
                    <Text style={styles.txid} numberOfLines={1}>
                      {item.txid.slice(0, 20)}···{item.txid.slice(-8)}
                    </Text>
                  </View>

                  <ExternalLink size={13} color={Colors.textTertiary} style={{ marginLeft: 4 }} />
                </TouchableOpacity>
              );
            }}
          />
        )}
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
    flex: 1,
    marginRight: 10,
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
  headerTitle: { fontSize: 16, fontWeight: '700', color: Colors.text },
  headerSub: { fontSize: 11, color: Colors.textTertiary, marginTop: 1, fontFamily: 'monospace' },
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
  centerState: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 14,
    paddingHorizontal: 32,
  },
  centerText: { fontSize: 14, color: Colors.textSecondary },
  errorText: { fontSize: 15, fontWeight: '700', color: Colors.error },
  retryBtn: {
    paddingHorizontal: 20,
    paddingVertical: 10,
    borderRadius: 12,
    backgroundColor: Colors.surface,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  retryBtnText: { fontSize: 14, fontWeight: '700', color: Colors.bitcoin },
  emptyTitle: { fontSize: 18, fontWeight: '700', color: Colors.text },
  emptyText: { fontSize: 14, color: Colors.textSecondary, textAlign: 'center', lineHeight: 21 },
  list: { paddingHorizontal: 20, paddingBottom: 32, paddingTop: 8 },
  listHeader: { paddingVertical: 10 },
  listHeaderLabel: {
    fontSize: 11,
    fontWeight: '700',
    color: Colors.textTertiary,
    letterSpacing: 0.8,
  },
  txCard: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: Colors.surface,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: Colors.border,
    padding: 14,
    marginBottom: 10,
    gap: 12,
  },
  txIconWrap: {
    width: 38,
    height: 38,
    borderRadius: 19,
    alignItems: 'center',
    justifyContent: 'center',
  },
  txIconIn: { backgroundColor: 'rgba(52,199,89,0.12)' },
  txIconOut: { backgroundColor: 'rgba(255,59,48,0.12)' },
  txBody: { flex: 1, gap: 3 },
  txTopRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    flexWrap: 'wrap',
  },
  txDirection: { fontSize: 13, fontWeight: '700' },
  txIn: { color: Colors.success },
  txOut: { color: Colors.error },
  txAmount: {
    fontSize: 15,
    fontWeight: '800',
    fontFamily: 'monospace',
    letterSpacing: -0.3,
  },
  txAmountIn: { color: Colors.text },
  txAmountOut: { color: Colors.text },
  txDate: { fontSize: 11, color: Colors.textTertiary, marginTop: 1 },
  txid: { fontSize: 10, color: Colors.textTertiary, fontFamily: 'monospace', marginTop: 1 },
  confirmedBadge: {
    backgroundColor: 'rgba(52,199,89,0.1)',
    paddingHorizontal: 7,
    paddingVertical: 2,
    borderRadius: 5,
    borderWidth: 1,
    borderColor: 'rgba(52,199,89,0.2)',
  },
  confirmedBadgeText: { fontSize: 10, fontWeight: '700', color: Colors.success },
  pendingBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
    backgroundColor: 'rgba(212,160,23,0.1)',
    paddingHorizontal: 7,
    paddingVertical: 2,
    borderRadius: 5,
    borderWidth: 1,
    borderColor: 'rgba(212,160,23,0.2)',
  },
  pendingBadgeText: { fontSize: 10, fontWeight: '600', color: '#D4A017' },
  filterRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 20,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: Colors.border,
  },
  filterBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    paddingHorizontal: 14,
    paddingVertical: 7,
    borderRadius: 20,
    backgroundColor: Colors.surface,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  filterBtnActive: {
    backgroundColor: Colors.bitcoin,
    borderColor: Colors.bitcoin,
  },
  filterBtnActiveIn: {
    backgroundColor: 'rgba(52,199,89,0.12)',
    borderColor: 'rgba(52,199,89,0.35)',
  },
  filterBtnActiveOut: {
    backgroundColor: 'rgba(255,59,48,0.12)',
    borderColor: 'rgba(255,59,48,0.35)',
  },
  filterBtnText: { fontSize: 13, fontWeight: '600', color: Colors.textSecondary },
  filterBtnTextActive: { color: '#FFF' },
  filterBtnTextIn: { color: Colors.success },
  filterBtnTextOut: { color: Colors.error },
});
