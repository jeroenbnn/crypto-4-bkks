import { generateMnemonic, mnemonicToSeed, validateMnemonic } from '@scure/bip39';
import { HDKey } from '@scure/bip32';
import { sha256 } from '@noble/hashes/sha2.js';
import { ripemd160 } from '@noble/hashes/legacy.js';

const BASE58_ALPHABET = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';

function base58Encode(bytes: Uint8Array): string {
  let leadingZeros = 0;
  for (const byte of bytes) {
    if (byte === 0) leadingZeros++;
    else break;
  }
  let num = 0n;
  for (const byte of bytes) {
    num = num * 256n + BigInt(byte);
  }
  let result = '';
  while (num > 0n) {
    result = BASE58_ALPHABET[Number(num % 58n)] + result;
    num /= 58n;
  }
  return '1'.repeat(leadingZeros) + result;
}

function hash160(data: Uint8Array): Uint8Array {
  return ripemd160(sha256(data));
}

function toBase58Check(version: number, payload: Uint8Array): string {
  const versioned = new Uint8Array(1 + payload.length);
  versioned[0] = version;
  versioned.set(payload, 1);
  const h1 = sha256(versioned);
  const checksum = sha256(h1).slice(0, 4);
  const full = new Uint8Array(versioned.length + 4);
  full.set(versioned);
  full.set(checksum, versioned.length);
  return base58Encode(full);
}

export const MAIN_ADDRESS = '1JcjfwBdHgA1bqQtFfCuhf7PfbbDS1Wqoy';

export interface DerivedAddress {
  index: number;
  address: string;
  mainAddress: string;
  publicKey: string;
  path: string;
  label: string;
  alias?: string;
}

export function createMnemonic(): string {
  const { wordlist } = require('@scure/bip39/wordlists/english') as { wordlist: string[] };
  return generateMnemonic(wordlist, 128);
}

export function isValidMnemonic(mnemonic: string): boolean {
  try {
    const { wordlist } = require('@scure/bip39/wordlists/english') as { wordlist: string[] };
    return validateMnemonic(mnemonic, wordlist);
  } catch {
    return false;
  }
}

export async function getMnemonicSeed(mnemonic: string): Promise<Uint8Array> {
  return mnemonicToSeed(mnemonic);
}

export function deriveAddressFromSeed(seed: Uint8Array, index: number): DerivedAddress {
  const root = HDKey.fromMasterSeed(seed);
  const path = `m/44'/0'/0'/0/${index}`;
  const child = root.derive(path);
  if (!child.publicKey) throw new Error('Could not derive public key');
  const pubKeyHash = hash160(child.publicKey);
  const address = toBase58Check(0x00, pubKeyHash);
  const pubKeyHex = Array.from(child.publicKey)
    .map(b => b.toString(16).padStart(2, '0'))
    .join('');
  return { index, address, mainAddress: MAIN_ADDRESS, publicKey: pubKeyHex, path, label: `Address ${index}` };
}
