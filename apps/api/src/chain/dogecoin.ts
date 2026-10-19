import * as secp from '@noble/secp256k1';
import { sha256 } from '@noble/hashes/sha2.js';
import { hmac } from '@noble/hashes/hmac.js';
import { ripemd160 } from '@noble/hashes/legacy.js';
import { createBase58check } from '@scure/base';

// noble-secp256k1 v3 needs sync hash functions wired for sign/verify.
secp.hashes.sha256 = sha256;
secp.hashes.hmacSha256 = (key: Uint8Array, msg: Uint8Array) => hmac(sha256, key, msg);

const b58c = createBase58check(sha256);

/** Dogecoin mainnet version bytes. */
export const DOGE_P2PKH_VERSION = 0x1e; // addresses start with 'D'
export const DOGE_P2SH_VERSION = 0x16; // addresses start with '9' or 'A'
export const MESSAGE_PREFIX = 'Dogecoin Signed Message:\n';

export type AddressCheck =
  | { ok: true; type: 'p2pkh' | 'p2sh'; hash160: Uint8Array }
  | { ok: false; reason: 'malformed' | 'wrong_network' };

const KNOWN_OTHER_NETWORKS = new Set([
  0x71, // dogecoin testnet P2PKH ('n')
  0xc4, // dogecoin/bitcoin testnet P2SH
  0x6f, // bitcoin testnet P2PKH
  0x00, // bitcoin mainnet P2PKH
  0x05, // bitcoin mainnet P2SH
  0x30, // litecoin P2PKH
  0x32, // litecoin P2SH
]);

/** Validates a Dogecoin *mainnet* address via base58check and version byte. */
export function checkDogecoinAddress(address: string): AddressCheck {
  if (typeof address !== 'string' || address.length < 25 || address.length > 40 || !/^[1-9A-HJ-NP-Za-km-z]+$/.test(address)) {
    return { ok: false, reason: 'malformed' };
  }
  let raw: Uint8Array;
  try {
    raw = b58c.decode(address);
  } catch {
    return { ok: false, reason: 'malformed' };
  }
  if (raw.length !== 21) return { ok: false, reason: 'malformed' };
  const version = raw[0];
  if (version === DOGE_P2PKH_VERSION) return { ok: true, type: 'p2pkh', hash160: raw.subarray(1) };
  if (version === DOGE_P2SH_VERSION) return { ok: true, type: 'p2sh', hash160: raw.subarray(1) };
  return { ok: false, reason: KNOWN_OTHER_NETWORKS.has(version) ? 'wrong_network' : 'malformed' };
}

export function hash160(data: Uint8Array): Uint8Array {
  return ripemd160(sha256(data));
}

export function p2pkhAddress(pubkey: Uint8Array, version = DOGE_P2PKH_VERSION): string {
  const payload = new Uint8Array(21);
  payload[0] = version;
  payload.set(hash160(pubkey), 1);
  return b58c.encode(payload);
}

export function addressFromHash160(h: Uint8Array, version = DOGE_P2PKH_VERSION): string {
  const payload = new Uint8Array(21);
  payload[0] = version;
  payload.set(h, 1);
  return b58c.encode(payload);
}

function varint(n: number): Uint8Array {
  if (n < 0xfd) return Uint8Array.of(n);
  if (n <= 0xffff) return Uint8Array.of(0xfd, n & 0xff, n >> 8);
  const b = new Uint8Array(5);
  b[0] = 0xfe;
  new DataView(b.buffer).setUint32(1, n, true);
  return b;
}

/** Double-SHA256 of varint(len(prefix)) || prefix || varint(len(msg)) || msg ("\x19Dogecoin Signed Message:\n"). */
export function dogecoinMessageHash(message: string): Uint8Array {
  const enc = new TextEncoder();
  const prefix = enc.encode(MESSAGE_PREFIX);
  const msg = enc.encode(message);
  const parts = [varint(prefix.length), prefix, varint(msg.length), msg];
  const total = parts.reduce((n, p) => n + p.length, 0);
  const buf = new Uint8Array(total);
  let o = 0;
  for (const p of parts) {
    buf.set(p, o);
    o += p.length;
  }
  return sha256(sha256(buf));
}

/**
 * Verifies a base64 compact recoverable signature (65 bytes: header 27..34, r, s), as produced by
 * Dogecoin Core `signmessage` and compatible wallets, against a P2PKH address.
 */
export function verifyDogecoinMessage(address: string, message: string, signatureB64: string): boolean {
  const check = checkDogecoinAddress(address);
  if (!check.ok || check.type !== 'p2pkh') return false;
  let sig: Buffer;
  try {
    sig = Buffer.from(signatureB64.trim(), 'base64');
  } catch {
    return false;
  }
  if (sig.length !== 65) return false;
  const header = sig[0];
  if (header < 27 || header > 34) return false;
  const recovery = (header - 27) & 3;
  const compressed = header >= 31;
  try {
    const recovered = new Uint8Array(65);
    recovered[0] = recovery;
    recovered.set(sig.subarray(1), 1);
    const hash = dogecoinMessageHash(message);
    const pubCompressed = secp.recoverPublicKey(recovered, hash, { prehash: false });
    const pub = compressed ? pubCompressed : secp.Point.fromBytes(pubCompressed).toBytes(false);
    const derived = hash160(pub);
    return Buffer.from(derived).equals(Buffer.from(check.hash160));
  } catch {
    return false;
  }
}

/** Test/dev helper: signs like `signmessage` does. Never used with real user keys on the server. */
export function signDogecoinMessage(privateKey: Uint8Array, message: string, compressed = true): string {
  const hash = dogecoinMessageHash(message);
  const rec = secp.sign(hash, privateKey, { prehash: false, format: 'recovered' });
  const out = new Uint8Array(65);
  out[0] = 27 + rec[0] + (compressed ? 4 : 0);
  out.set(rec.subarray(1), 1);
  return Buffer.from(out).toString('base64');
}

export function publicKeyFor(privateKey: Uint8Array, compressed = true): Uint8Array {
  return secp.getPublicKey(privateKey, compressed);
}

export function doubleSha256Hex(data: Uint8Array): string {
  return Buffer.from(sha256(sha256(data))).toString('hex');
}

/** Bitcoin-family txid: double-SHA256 of the serialized tx, byte-reversed, hex. */
export function txidFromHex(txHex: string): string {
  const h = sha256(sha256(Buffer.from(txHex, 'hex')));
  return Buffer.from(h).reverse().toString('hex');
}
