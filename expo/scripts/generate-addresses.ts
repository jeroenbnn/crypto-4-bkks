import { generateMnemonic, mnemonicToSeed } from '@scure/bip39';
import { HDKey } from '@scure/bip32';
import { sha256 } from '@noble/hashes/sha2.js';
import { ripemd160 } from '@noble/hashes/legacy.js';
import { writeFileSync, readFileSync, existsSync } from 'fs';
import { join } from 'path';

const BASE58_ALPHABET = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
const MNEMONIC_FILE = join(process.cwd(), '..', '.wallet-mnemonic');
const ADDRESS_FILE = join(process.cwd(), '..', 'address.md');

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

function readExistingAddresses(): string[] {
  if (!existsSync(ADDRESS_FILE)) return [];
  const content = readFileSync(ADDRESS_FILE, 'utf-8');
  const matches = content.match(/"(1[A-Za-z0-9]+)"/g);
  if (!matches) return [];
  return matches.map(m => m.replace(/"/g, ''));
}

async function main() {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const englishModule = require('/home/user/rork-app/expo/node_modules/@scure/bip39/wordlists/english.js') as { wordlist: string[] };

  let mnemonic: string;

  if (existsSync(MNEMONIC_FILE)) {
    mnemonic = readFileSync(MNEMONIC_FILE, 'utf-8').trim();
    console.log('\n🔑 Using existing wallet mnemonic.');
  } else {
    mnemonic = generateMnemonic(englishModule.wordlist, 128);
    writeFileSync(MNEMONIC_FILE, mnemonic, 'utf-8');
    console.log('\n🔑 New wallet created and saved to .wallet-mnemonic');
    console.log('⚠️  SAVE THIS FILE SECURELY AND DO NOT SHARE IT.');
  }

  console.log('');

  const existingAddresses = readExistingAddresses();
  const startIndex = existingAddresses.length;

  console.log(`📋 Existing addresses: ${startIndex}`);
  console.log(`➕ Generating 50 more addresses (index ${startIndex} - ${startIndex + 49})...\n`);

  const seed = await mnemonicToSeed(mnemonic);
  const root = HDKey.fromMasterSeed(seed);

  const newAddresses: string[] = [];

  for (let i = startIndex; i < startIndex + 50; i++) {
    const path = `m/44'/0'/0'/0/${i}`;
    const child = root.derive(path);
    if (!child.publicKey) throw new Error(`Could not derive public key for index ${i}`);
    const pubKeyHash = hash160(child.publicKey);
    const address = toBase58Check(0x00, pubKeyHash);
    newAddresses.push(address);
    console.log(`Address ${i + 1}: ${address}`);
  }

  const allAddresses = [...existingAddresses, ...newAddresses];
  const addressLines = allAddresses.map((addr) => `  "${addr}",`).join('\n');
  const content = `const BTC_ADDRESSES = [\n${addressLines}\n];\n`;

  writeFileSync(ADDRESS_FILE, content, 'utf-8');

  console.log(`\n✅ Total addresses in address.md: ${allAddresses.length}`);
  console.log(`📁 Path: ${ADDRESS_FILE}`);
}

main().catch((e) => {
  console.error('Error:', e);
  process.exit(1);
});
