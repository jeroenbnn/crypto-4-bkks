import createContextHook from '@nkzw/create-context-hook';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import { useMutation } from '@tanstack/react-query';
import {
  createMnemonic,
  isValidMnemonic,
  getMnemonicSeed,
  deriveAddressFromSeed,
  DerivedAddress,
} from '@/utils/bitcoin';
import { upsertAddresses, fetchAliases, updateAddressAlias } from '@/utils/supabase';

const MNEMONIC_KEY = 'btc_wallet_mnemonic';
const ADDRESS_COUNT_KEY = 'btc_wallet_count';
const DEFAULT_ADDRESS_COUNT = 50;

function mergeAliases(addresses: DerivedAddress[], aliasMap: Map<string, string>): DerivedAddress[] {
  if (aliasMap.size === 0) return addresses;
  return addresses.map((a) => ({
    ...a,
    alias: aliasMap.get(a.address) ?? a.alias,
  }));
}

function getWalletId(addresses: DerivedAddress[]): string {
  return addresses[0]?.address ?? '';
}

export const [WalletProvider, useWallet] = createContextHook(() => {
  const [mnemonic, setMnemonic] = useState<string | null>(null);
  const [addresses, setAddresses] = useState<DerivedAddress[]>([]);
  const [initialized, setInitialized] = useState(false);
  const seedRef = useRef<Uint8Array | null>(null);
  const addressesRef = useRef<DerivedAddress[]>([]);

  useEffect(() => {
    addressesRef.current = addresses;
  }, [addresses]);

  useEffect(() => {
    void (async () => {
      try {
        const storedMnemonic = await AsyncStorage.getItem(MNEMONIC_KEY);
        const storedCount = await AsyncStorage.getItem(ADDRESS_COUNT_KEY);
        if (storedMnemonic) {
          console.log('[Wallet] Loading existing wallet...');
          const derivedSeed = await getMnemonicSeed(storedMnemonic);
          seedRef.current = derivedSeed;
          const count = storedCount ? parseInt(storedCount, 10) : 1;
          const derivedAddresses = Array.from({ length: count }, (_, i) =>
            deriveAddressFromSeed(derivedSeed, i)
          );
          setMnemonic(storedMnemonic);

          const walletId = getWalletId(derivedAddresses);
          await upsertAddresses(walletId, derivedAddresses);
          const aliasMap = await fetchAliases(walletId);
          const merged = mergeAliases(derivedAddresses, aliasMap);
          setAddresses(merged);
          console.log(`[Wallet] Loaded ${count} address(es)`);
        }
      } catch (e) {
        console.error('[Wallet] Error loading wallet:', e);
      } finally {
        setInitialized(true);
      }
    })();
  }, []);

  const createWalletMutation = useMutation({
    mutationFn: async () => {
      const newMnemonic = createMnemonic();
      const newSeed = await getMnemonicSeed(newMnemonic);
      seedRef.current = newSeed;
      const derivedAddresses = Array.from({ length: DEFAULT_ADDRESS_COUNT }, (_, i) =>
        deriveAddressFromSeed(newSeed, i)
      );
      await AsyncStorage.setItem(MNEMONIC_KEY, newMnemonic);
      await AsyncStorage.setItem(ADDRESS_COUNT_KEY, String(DEFAULT_ADDRESS_COUNT));
      const walletId = getWalletId(derivedAddresses);
      await upsertAddresses(walletId, derivedAddresses);
      return { mnemonic: newMnemonic, addresses: derivedAddresses };
    },
    onSuccess: ({ mnemonic: m, addresses: a }) => {
      setMnemonic(m);
      setAddresses(a);
    },
    onError: (e) => console.error('[Wallet] Create error:', e),
  });

  const importWalletMutation = useMutation({
    mutationFn: async (importedMnemonic: string) => {
      const cleaned = importedMnemonic.trim().toLowerCase().replace(/\s+/g, ' ');
      if (!isValidMnemonic(cleaned)) {
        throw new Error('Invalid seed phrase. Please check your 12 or 24 words.');
      }
      const newSeed = await getMnemonicSeed(cleaned);
      seedRef.current = newSeed;
      const derivedAddresses = Array.from({ length: DEFAULT_ADDRESS_COUNT }, (_, i) =>
        deriveAddressFromSeed(newSeed, i)
      );
      await AsyncStorage.setItem(MNEMONIC_KEY, cleaned);
      await AsyncStorage.setItem(ADDRESS_COUNT_KEY, String(DEFAULT_ADDRESS_COUNT));
      const walletId = getWalletId(derivedAddresses);
      await upsertAddresses(walletId, derivedAddresses);
      const aliasMap = await fetchAliases(walletId);
      const merged = mergeAliases(derivedAddresses, aliasMap);
      return { mnemonic: cleaned, addresses: merged };
    },
    onSuccess: ({ mnemonic: m, addresses: a }) => {
      setMnemonic(m);
      setAddresses(a);
    },
    onError: (e) => console.error('[Wallet] Import error:', e),
  });

  const addAddressMutation = useMutation({
    mutationFn: async () => {
      const seed = seedRef.current;
      if (!seed) throw new Error('No wallet loaded');
      const current = addressesRef.current;
      const newAddress = deriveAddressFromSeed(seed, current.length);
      const updated = [...current, newAddress];
      await AsyncStorage.setItem(ADDRESS_COUNT_KEY, String(updated.length));
      const walletId = getWalletId(updated);
      await upsertAddresses(walletId, [newAddress]);
      return updated;
    },
    onSuccess: (updated) => setAddresses(updated),
    onError: (e) => console.error('[Wallet] Add address error:', e),
  });

  const updateAliasMutation = useMutation({
    mutationFn: async ({ index, alias }: { index: number; alias: string }) => {
      const addr = addressesRef.current.find((a) => a.index === index);
      if (!addr) throw new Error('Address not found');
      await updateAddressAlias(addr.address, alias);
      return { index, alias: alias.trim() };
    },
    onSuccess: ({ index, alias }) => {
      setAddresses((prev) =>
        prev.map((a) => (a.index === index ? { ...a, alias: alias || undefined } : a))
      );
    },
    onError: (e) => console.error('[Wallet] Update alias error:', e),
  });

  const resetWalletMutation = useMutation({
    mutationFn: async () => {
      await AsyncStorage.multiRemove([MNEMONIC_KEY, ADDRESS_COUNT_KEY]);
    },
    onSuccess: () => {
      seedRef.current = null;
      setMnemonic(null);
      setAddresses([]);
    },
    onError: (e) => console.error('[Wallet] Reset error:', e),
  });

  const getSeed = useCallback(() => seedRef.current, []);

  return useMemo(() => ({
    mnemonic,
    addresses,
    initialized,
    hasWallet: mnemonic !== null,
    getSeed,
    createWallet: createWalletMutation.mutate,
    importWallet: importWalletMutation.mutate,
    addAddress: addAddressMutation.mutate,
    updateAlias: updateAliasMutation.mutate,
    resetWallet: resetWalletMutation.mutate,
    isCreating: createWalletMutation.isPending,
    isImporting: importWalletMutation.isPending,
    isAddingAddress: addAddressMutation.isPending,
    isUpdatingAlias: updateAliasMutation.isPending,
    importError: importWalletMutation.error?.message ?? null,
  }), [
    mnemonic,
    addresses,
    initialized,
    createWalletMutation.mutate,
    createWalletMutation.isPending,
    importWalletMutation.mutate,
    importWalletMutation.isPending,
    importWalletMutation.error,
    addAddressMutation.mutate,
    addAddressMutation.isPending,
    updateAliasMutation.mutate,
    updateAliasMutation.isPending,
    resetWalletMutation.mutate,
    getSeed,
  ]);
});
