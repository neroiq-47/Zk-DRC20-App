import { describe, expect, it } from 'vitest';
import { secp256k1Vectors } from './vectors.js';
import {
  addressFromHash160,
  checkDogecoinAddress,
  hash160,
  p2pkhAddress,
  publicKeyFor,
  signDogecoinMessage,
  verifyDogecoinMessage,
  DOGE_P2SH_VERSION,
} from '../src/chain/dogecoin.js';

describe('dogecoin primitives', () => {
  it('hash160 of the generator point pubkey matches the well-known vector', () => {
    // Private key 1 -> compressed pubkey G; hash160 is the classic 751e76e8...
    const pub = publicKeyFor(secp256k1Vectors.privOne, true);
    expect(Buffer.from(pub).toString('hex')).toBe('0279be667ef9dcbbac55a06295ce870b07029bfcdb2dce28d959f2815b16f81798');
    expect(Buffer.from(hash160(pub)).toString('hex')).toBe('751e76e8199196d454941c45d1b3a323f1433bd6');
  });

  it('validates mainnet P2PKH/P2SH and rejects other networks and bad checksums', () => {
    const h = new Uint8Array(20).fill(7);
    const p2pkh = addressFromHash160(h);
    const p2sh = addressFromHash160(h, DOGE_P2SH_VERSION);
    expect(p2pkh.startsWith('D')).toBe(true);
    expect(['9', 'A']).toContain(p2sh[0]);
    expect(checkDogecoinAddress(p2pkh)).toMatchObject({ ok: true, type: 'p2pkh' });
    expect(checkDogecoinAddress(p2sh)).toMatchObject({ ok: true, type: 'p2sh' });
    expect(checkDogecoinAddress(addressFromHash160(h, 0x71))).toEqual({ ok: false, reason: 'wrong_network' }); // testnet
    expect(checkDogecoinAddress('1BgGZ9tcN4rm9KBzDn7KprQz87SZ26SAMH')).toEqual({ ok: false, reason: 'wrong_network' }); // bitcoin
    const tampered = p2pkh.slice(0, -1) + (p2pkh.endsWith('a') ? 'b' : 'a');
    expect(checkDogecoinAddress(tampered).ok).toBe(false);
    expect(checkDogecoinAddress('hello').ok).toBe(false);
  });

  it('signs and verifies Dogecoin signed messages (compressed and uncompressed keys)', () => {
    const priv = new Uint8Array(32).fill(3);
    for (const compressed of [true, false]) {
      const address = p2pkhAddress(publicKeyFor(priv, compressed));
      const sig = signDogecoinMessage(priv, 'hello zoko', compressed);
      expect(Buffer.from(sig, 'base64')).toHaveLength(65);
      expect(verifyDogecoinMessage(address, 'hello zoko', sig)).toBe(true);
      expect(verifyDogecoinMessage(address, 'hello zoko!', sig)).toBe(false);
    }
    const other = p2pkhAddress(publicKeyFor(new Uint8Array(32).fill(4)));
    expect(verifyDogecoinMessage(other, 'hello zoko', signDogecoinMessage(priv, 'hello zoko'))).toBe(false);
    expect(verifyDogecoinMessage(other, 'x', 'not base64 at all')).toBe(false);
  });
});
