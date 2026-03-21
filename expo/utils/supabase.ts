import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.EXPO_PUBLIC_SUPABASE_URL ?? 'https://cpkkohlgptamkunryjwx.supabase.co';
const supabaseAnonKey = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY ?? 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImNwa2tvaGxncHRhbWt1bnJ5and4Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzQwNDkwNjUsImV4cCI6MjA4OTYyNTA2NX0.uChVdV-LxM3AxXltrE-YviwRFMxZbMKpCcCN5lySiwQ';

if (!supabaseUrl || !supabaseAnonKey) {
  console.warn('[Supabase] Missing environment variables. Database sync disabled.');
}

export const supabase = createClient(supabaseUrl, supabaseAnonKey);

export interface AddressRow {
  id?: string;
  wallet_id: string;
  address: string;
  main_address: string;
  address_index: number;
  path: string;
  public_key: string;
  alias: string | null;
  balance_satoshi?: number;
  is_used?: boolean;
  balance_updated_at?: string;
  created_at?: string;
}

export async function upsertAddresses(walletId: string, addresses: { address: string; mainAddress: string; index: number; path: string; publicKey: string }[]): Promise<void> {
  if (!supabaseUrl) return;
  const rows: Omit<AddressRow, 'id' | 'created_at'>[] = addresses.map((a) => ({
    wallet_id: walletId,
    address: a.address,
    main_address: a.mainAddress,
    address_index: a.index,
    path: a.path,
    public_key: a.publicKey,
    alias: null,
  }));

  const { error } = await supabase
    .from('btc_addresses')
    .upsert(rows, { onConflict: 'address', ignoreDuplicates: true });

  if (error) {
    const missingColumn = error.message.includes('main_address');
    if (missingColumn) {
      console.warn('[Supabase] main_address column missing — run supabase-setup.sql to add it. Retrying without main_address…');
      const rowsFallback = rows.map(({ main_address: _m, ...rest }) => rest);
      const { error: fallbackError } = await supabase
        .from('btc_addresses')
        .upsert(rowsFallback as Omit<AddressRow, 'id' | 'created_at'>[], { onConflict: 'address', ignoreDuplicates: true });
      if (fallbackError) {
        console.error('[Supabase] upsertAddresses fallback error:', fallbackError.message);
      } else {
        console.log(`[Supabase] Synced ${rows.length} addresses (without main_address — run supabase-setup.sql to fix)`);
      }
    } else {
      console.error('[Supabase] upsertAddresses error:', error.message, '\n→ Fix: run supabase-setup.sql in your Supabase SQL Editor.');
    }
  } else {
    console.log(`[Supabase] Synced ${rows.length} addresses`);
  }
}

export async function fetchAliases(walletId: string): Promise<Map<string, string>> {
  if (!supabaseUrl) return new Map();
  const { data, error } = await supabase
    .from('btc_addresses')
    .select('address, alias')
    .eq('wallet_id', walletId)
    .not('alias', 'is', null);
  if (error) {
    console.error('[Supabase] fetchAliases error:', error.message);
    return new Map();
  }
  const map = new Map<string, string>();
  for (const row of data ?? []) {
    if (row.alias) map.set(row.address, row.alias);
  }
  console.log(`[Supabase] Fetched ${map.size} aliases`);
  return map;
}

export async function updateAddressAlias(address: string, alias: string): Promise<void> {
  if (!supabaseUrl) return;
  const { error } = await supabase
    .from('btc_addresses')
    .update({ alias: alias.trim() || null })
    .eq('address', address);
  if (error) throw new Error(error.message);
  console.log(`[Supabase] Updated alias for ${address} → "${alias}"`);
}

export interface StoredBalance {
  satoshi: number;
  isUsed: boolean;
}

export async function fetchStoredBalances(walletId: string): Promise<Map<string, StoredBalance>> {
  if (!supabaseUrl) return new Map();
  const { data, error } = await supabase
    .from('btc_addresses')
    .select('address, balance_satoshi, is_used')
    .eq('wallet_id', walletId);
  if (error) {
    console.error('[Supabase] fetchStoredBalances error:', error.message);
    return new Map();
  }
  const map = new Map<string, StoredBalance>();
  for (const row of data ?? []) {
    map.set(row.address, {
      satoshi: row.balance_satoshi ?? 0,
      isUsed: row.is_used ?? false,
    });
  }
  console.log(`[Supabase] Fetched stored balances for ${map.size} addresses`);
  return map;
}

export async function deleteAddresses(addresses: string[]): Promise<void> {
  if (!supabaseUrl || addresses.length === 0) return;
  const { error } = await supabase
    .from('btc_addresses')
    .delete()
    .in('address', addresses);
  if (error) {
    console.error('[Supabase] deleteAddresses error:', error.message);
  } else {
    console.log(`[Supabase] Deleted ${addresses.length} addresses`);
  }
}

export interface WalletSummary {
  wallet_id: string;
  address_count: number;
  total_satoshi: number;
}

export async function fetchAllWallets(): Promise<WalletSummary[]> {
  if (!supabaseUrl) return [];
  const { data, error } = await supabase
    .from('btc_addresses')
    .select('wallet_id, balance_satoshi');
  if (error) {
    console.error('[Supabase] fetchAllWallets error:', error.message);
    return [];
  }
  const map = new Map<string, { count: number; total: number }>();
  for (const row of data ?? []) {
    const wid = row.wallet_id as string;
    const existing = map.get(wid) ?? { count: 0, total: 0 };
    map.set(wid, {
      count: existing.count + 1,
      total: existing.total + ((row.balance_satoshi as number) ?? 0),
    });
  }
  const result = Array.from(map.entries()).map(([wallet_id, { count, total }]) => ({
    wallet_id,
    address_count: count,
    total_satoshi: total,
  }));
  console.log(`[Supabase] Fetched ${result.length} wallet(s)`);
  return result;
}

export async function updateAddressBalances(
  updates: { address: string; satoshi: number; isUsed: boolean }[]
): Promise<void> {
  if (!supabaseUrl || updates.length === 0) return;
  const now = new Date().toISOString();
  try {
    await Promise.all(
      updates.map(({ address, satoshi, isUsed }) =>
        supabase
          .from('btc_addresses')
          .update({ balance_satoshi: satoshi, is_used: isUsed, balance_updated_at: now })
          .eq('address', address)
      )
    );
    console.log(`[Supabase] Updated balances for ${updates.length} addresses`);
  } catch (e) {
    console.error('[Supabase] updateAddressBalances error:', e);
  }
}
