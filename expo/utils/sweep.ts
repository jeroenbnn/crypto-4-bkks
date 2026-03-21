import { Transaction } from '@scure/btc-signer';
import { HDKey } from '@scure/bip32';
import { DerivedAddress } from './bitcoin';

export interface UTXO {
  txid: string;
  vout: number;
  value: number;
  status: { confirmed: boolean };
}

export interface AddressUTXOs {
  address: DerivedAddress;
  utxos: UTXO[];
  total: number;
}

export interface SweepEstimate {
  totalSats: number;
  feeSats: number;
  netSats: number;
  numInputs: number;
  addressesWithFunds: AddressUTXOs[];
}

function hexToBytes(hex: string): Uint8Array {
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < hex.length; i += 2) {
    bytes[i / 2] = parseInt(hex.slice(i, i + 2), 16);
  }
  return bytes;
}

export async function fetchUTXOs(address: string): Promise<UTXO[]> {
  try {
    console.log(`[Sweep] Fetching UTXOs for ${address}`);
    const res = await fetch(`https://mempool.space/api/address/${address}/utxo`);
    if (!res.ok) return [];
    return (await res.json()) as UTXO[];
  } catch (e) {
    console.error(`[Sweep] fetchUTXOs error for ${address}:`, e);
    return [];
  }
}

async function fetchRawTxBytes(txid: string): Promise<Uint8Array> {
  console.log(`[Sweep] Fetching raw tx: ${txid}`);
  const res = await fetch(`https://mempool.space/api/tx/${txid}/hex`);
  if (!res.ok) throw new Error(`Failed to fetch raw tx ${txid}`);
  const hex = await res.text();
  return hexToBytes(hex.trim());
}

export function estimateFee(numInputs: number, feeRate: number): number {
  const estimatedVBytes = 10 + 148 * numInputs + 34;
  return Math.ceil(estimatedVBytes * feeRate);
}

export async function gatherAllUTXOs(addresses: DerivedAddress[]): Promise<AddressUTXOs[]> {
  const results = await Promise.all(
    addresses.map(async (addr) => {
      const utxos = await fetchUTXOs(addr.address);
      const total = utxos.reduce((sum, u) => sum + u.value, 0);
      return { address: addr, utxos, total };
    })
  );
  return results.filter((r) => r.total > 0);
}

export function buildSweepEstimate(
  addressesWithFunds: AddressUTXOs[],
  feeRate: number
): SweepEstimate {
  const totalSats = addressesWithFunds.reduce((s, a) => s + a.total, 0);
  const numInputs = addressesWithFunds.reduce((s, a) => s + a.utxos.length, 0);
  const feeSats = estimateFee(numInputs, feeRate);
  const netSats = totalSats - feeSats;
  return { totalSats, feeSats, netSats, numInputs, addressesWithFunds };
}

export async function sweepToAddress(
  seed: Uint8Array,
  addressesWithFunds: AddressUTXOs[],
  destinationAddress: string,
  feeRate: number
): Promise<string> {
  const root = HDKey.fromMasterSeed(seed);

  const tx = new Transaction();

  const inputsInfo: Array<{ address: DerivedAddress; utxo: UTXO }> = [];
  for (const { address, utxos } of addressesWithFunds) {
    for (const utxo of utxos) {
      inputsInfo.push({ address, utxo });
    }
  }

  const totalSats = inputsInfo.reduce((s, { utxo }) => s + utxo.value, 0);
  const feeSats = estimateFee(inputsInfo.length, feeRate);
  const netSats = totalSats - feeSats;

  if (netSats <= 546) {
    throw new Error('Net amount after fee is too low (dust limit). Lower the fee rate or add more funds.');
  }

  console.log(`[Sweep] Building tx: ${inputsInfo.length} inputs, ${totalSats} sat total, ${feeSats} sat fee, ${netSats} sat net`);

  for (const { utxo } of inputsInfo) {
    const rawTx = await fetchRawTxBytes(utxo.txid);
    tx.addInput({
      txid: utxo.txid,
      index: utxo.vout,
      nonWitnessUtxo: rawTx,
    });
  }

  tx.addOutputAddress(destinationAddress, BigInt(netSats));

  for (let i = 0; i < inputsInfo.length; i++) {
    const { address } = inputsInfo[i];
    const child = root.derive(address.path);
    if (!child.privateKey) throw new Error(`Could not derive private key for path ${address.path}`);
    tx.signIdx(child.privateKey, i);
  }

  tx.finalize();
  const txHex = tx.hex;
  console.log(`[Sweep] Transaction built: ${txHex.slice(0, 40)}...`);
  return txHex;
}

export async function broadcastTransaction(txHex: string): Promise<string> {
  console.log('[Sweep] Broadcasting transaction...');
  const res = await fetch('https://mempool.space/api/tx', {
    method: 'POST',
    headers: { 'Content-Type': 'text/plain' },
    body: txHex,
  });

  if (!res.ok) {
    const errorText = await res.text();
    console.error('[Sweep] Broadcast error:', errorText);
    throw new Error(errorText || 'Failed to broadcast transaction');
  }

  const txid = await res.text();
  console.log('[Sweep] Broadcast success, txid:', txid);
  return txid;
}
