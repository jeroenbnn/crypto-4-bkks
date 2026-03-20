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
  address_index: number;
  path: string;
  public_key: string;
  alias: string | null;
  created_at?: string;
}

export async function upsertAddresses(walletId: string, addresses: { address: string; index: number; path: string; publicKey: string }[]): Promise<void> {
  if (!supabaseUrl) return;
  const rows: Omit<AddressRow, 'id' | 'created_at'>[] = addresses.map((a) => ({
    wallet_id: walletId,
    address: a.address,
    address_index: a.index,
    path: a.path,
    public_key: a.publicKey,
    alias: null,
  }));
  const { error } = await supabase
    .from('btc_addresses')
    .upsert(rows, { onConflict: 'address', ignoreDuplicates: true });
  if (error) console.error('[Supabase] upsertAddresses error:', error.message);
  else console.log(`[Supabase] Synced ${rows.length} addresses`);
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
