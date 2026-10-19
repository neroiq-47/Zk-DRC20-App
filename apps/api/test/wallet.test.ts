import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { connectWallet, createTestApp, hasDb, newKey, registerUser, type TestCtx, type TestUser } from './helpers.js';
import { addressFromHash160, signDogecoinMessage } from '../src/chain/dogecoin.js';

describe.skipIf(!hasDb)('wallet proof of ownership (EP08)', () => {
  let ctx: TestCtx;
  let alice: TestUser, bob: TestUser;
  beforeAll(async () => {
    ctx = await createTestApp();
    [alice, bob] = await Promise.all([registerUser(ctx.app), registerUser(ctx.app)]);
  });
  afterAll(async () => ctx?.close());

  it('lists the provider capability matrix', async () => {
    const res = await alice.api.get('/wallet/providers');
    expect(res.body.items).toEqual([
      expect.objectContaining({ id: 'manual', can_sign_message: true, can_sign_transaction: true, signing_method: 'copy_paste' }),
    ]);
  });

  it('issues a challenge bound to domain, network, address, user and nonce', async () => {
    const key = newKey();
    const res = await alice.api.post('/wallet/challenges', { address: key.address, provider: 'manual' });
    expect(res.status).toBe(201);
    const msg: string = res.body.message;
    expect(msg).toContain('zoko.app wants you to prove you own this Dogecoin address:');
    expect(msg).toContain(key.address);
    expect(msg).toContain('Network: dogecoin-mainnet');
    expect(msg).toContain(`User ID: ${alice.id}`);
    expect(msg).toMatch(/Nonce: [0-9a-f]{32}/);
    expect(msg).toMatch(/Issued At: \d{4}-/);
    const ttl = new Date(res.body.expires_at).getTime() - Date.now();
    expect(ttl).toBeGreaterThan(9 * 60_000);
    expect(ttl).toBeLessThanOrEqual(10 * 60_000);
  });

  it('rejects wrong-network, malformed and P2SH addresses', async () => {
    const h = new Uint8Array(20).fill(9);
    const testnet = await alice.api.post('/wallet/challenges', { address: addressFromHash160(h, 0x71), provider: 'manual' });
    expect(testnet.status).toBe(422);
    expect(testnet.body.code).toBe('wrong_network');
    expect((await alice.api.post('/wallet/challenges', { address: '1BgGZ9tcN4rm9KBzDn7KprQz87SZ26SAMH', provider: 'manual' })).body.code).toBe('wrong_network');
    expect((await alice.api.post('/wallet/challenges', { address: 'Dnotanaddress', provider: 'manual' })).body.code).toBe('invalid_address');
    expect((await alice.api.post('/wallet/challenges', { address: addressFromHash160(h, 0x16), provider: 'manual' })).body.code).toBe(
      'address_type_unsupported',
    );
    expect((await alice.api.post('/wallet/challenges', { address: addressFromHash160(h), provider: 'metamask' })).body.code).toBe('unknown_provider');
  });

  it('verifies a real Dogecoin signed message and connects the wallet', async () => {
    const { key, wallet } = await connectWallet(alice);
    expect(wallet).toMatchObject({ address: key.address, network: 'dogecoin-mainnet', provider: 'manual' });
    const list = await alice.api.get('/wallet/connections');
    expect(list.body.items.map((w: any) => w.id)).toContain(wallet.id);
    expect((await bob.api.get(`/users/${alice.handle}`)).body.has_verified_wallet).toBe(true);
    // One active connection per address across users.
    await expect(connectWallet(bob, key)).rejects.toThrow(/address_already_connected/);
    // Disconnect frees the address.
    expect((await alice.api.del(`/wallet/connections/${wallet.id}`)).status).toBe(204);
    expect((await bob.api.get(`/users/${alice.handle}`)).body.has_verified_wallet).toBe(false);
    const again = await connectWallet(bob, key);
    expect(again.wallet.address).toBe(key.address);
  });

  it('a challenge is one-use: replaying a valid signature fails', async () => {
    const key = newKey();
    const ch = await alice.api.post('/wallet/challenges', { address: key.address, provider: 'manual' });
    const sig = signDogecoinMessage(key.priv, ch.body.message);
    const body = { challenge_id: ch.body.challenge_id, signature: sig, provider: 'manual' };
    expect((await alice.api.post('/wallet/connections', body)).status).toBe(201);
    const replay = await alice.api.post('/wallet/connections', body);
    expect(replay.status).toBe(409);
    expect(replay.body.code).toBe('challenge_used');
    // Another user can't use someone else's challenge either.
    expect((await bob.api.post('/wallet/connections', body)).status).toBe(404);
  });

  it('rejects expired challenges', async () => {
    const key = newKey();
    const ch = await alice.api.post('/wallet/challenges', { address: key.address, provider: 'manual' });
    await ctx.deps.db.query(`UPDATE wallet_challenges SET expires_at = now() - interval '1 second' WHERE id = $1`, [ch.body.challenge_id]);
    const res = await alice.api.post('/wallet/connections', {
      challenge_id: ch.body.challenge_id,
      signature: signDogecoinMessage(key.priv, ch.body.message),
      provider: 'manual',
    });
    expect(res.status).toBe(410);
    expect(res.body.code).toBe('challenge_expired');
  });

  it('rejects challenges bound to another domain, and signatures by another key or over another message', async () => {
    const key = newKey();
    const ch = await alice.api.post('/wallet/challenges', { address: key.address, provider: 'manual' });
    await ctx.deps.db.query(`UPDATE wallet_challenges SET domain = 'evil.example' WHERE id = $1`, [ch.body.challenge_id]);
    const res = await alice.api.post('/wallet/connections', {
      challenge_id: ch.body.challenge_id,
      signature: signDogecoinMessage(key.priv, ch.body.message),
      provider: 'manual',
    });
    expect(res.body.code).toBe('wrong_network');

    const ch2 = await alice.api.post('/wallet/challenges', { address: key.address, provider: 'manual' });
    const wrongKey = await alice.api.post('/wallet/connections', {
      challenge_id: ch2.body.challenge_id,
      signature: signDogecoinMessage(newKey().priv, ch2.body.message),
      provider: 'manual',
    });
    expect(wrongKey.status).toBe(422);
    expect(wrongKey.body.code).toBe('invalid_signature');

    const ch3 = await alice.api.post('/wallet/challenges', { address: key.address, provider: 'manual' });
    const wrongMsg = await alice.api.post('/wallet/connections', {
      challenge_id: ch3.body.challenge_id,
      signature: signDogecoinMessage(key.priv, ch3.body.message.replace('dogecoin-mainnet', 'dogecoin-testnet')),
      provider: 'manual',
    });
    expect(wrongMsg.body.code).toBe('invalid_signature');
  });
});
