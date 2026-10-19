import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import { connectWallet, createTestApp, FIXTURE_PATH, hasDb, newKey, registerUser, type TestCtx } from './helpers.js';
import { reconcileValues } from '../src/indexer/reconcile.js';
import { FixtureIndexerAdapter, type IndexerAdapter, type IndexerFixture } from '../src/indexer/adapter.js';

describe('indexer reconciliation rule (unit)', () => {
  const v = (adapter: string, value: string | null, height = 10) => ({ adapter, value, height: value === null ? null : height });
  it('confirmed only when >= 2 adapters agree', () => {
    expect(reconcileValues([v('a', '5'), v('b', '5')])?.status).toBe('confirmed');
    expect(reconcileValues([v('a', '5'), v('b', '5'), v('c', '5')])?.status).toBe('confirmed');
  });
  it('disputed on any disagreement, storing the lower amount', () => {
    const r = reconcileValues([v('a', '5'), v('b', '7')]);
    expect(r).toMatchObject({ status: 'disputed', amount: '5' });
  });
  it('unverified when only one adapter is available', () => {
    expect(reconcileValues([v('a', '5'), v('b', null)])?.status).toBe('unverified');
    expect(reconcileValues([v('a', '5')])?.status).toBe('unverified');
    expect(reconcileValues([v('a', null), v('b', null)])).toBeNull();
  });
});

class FailingAdapter implements IndexerAdapter {
  readonly id = 'down';
  async getTip(): Promise<never> {
    throw new Error('down');
  }
  async getDogeBalance(): Promise<never> {
    throw new Error('down');
  }
  async getDrc20Balances(): Promise<never> {
    throw new Error('down');
  }
}

describe.skipIf(!hasDb)('DRC-20 read model with independent adapters (EP09)', () => {
  const base = JSON.parse(fs.readFileSync(FIXTURE_PATH, 'utf8')) as IndexerFixture;
  const fa: IndexerFixture = { ...base, deterministic: false, addresses: {} };
  const fb: IndexerFixture = { ...base, deterministic: false, addresses: {} };
  let ctx: TestCtx;
  beforeAll(async () => {
    ctx = await createTestApp({
      deps: { indexers: [new FixtureIndexerAdapter('indexer-a', fa), new FixtureIndexerAdapter('indexer-b', fb)] },
    });
  });
  afterAll(async () => ctx?.close());

  it('agreeing indexers -> confirmed; disagreement -> disputed; DOGE and DRC-20 are separate', async () => {
    const user = await registerUser(ctx.app);
    const key = newKey();
    fa.addresses![key.address] = { doge_koinu: '1500000000', drc20: { dogi: '1000', wow: '50' } };
    fb.addresses![key.address] = { doge_koinu: '1500000000', drc20: { dogi: '999', wow: '50' } };
    const { wallet } = await connectWallet(user, key);
    const assets = await user.api.get('/wallet/assets');
    expect(assets.status).toBe(200);
    expect(assets.body.doge).toEqual([
      { wallet_id: wallet.id, address: key.address, amount_koinu: '1500000000', status: 'confirmed', indexed_height: null },
    ]);
    const byTicker = Object.fromEntries(assets.body.drc20.map((b: any) => [b.token.ticker, b]));
    expect(byTicker.wow).toMatchObject({ amount_base_units: '50', status: 'confirmed' });
    expect(byTicker.dogi).toMatchObject({ amount_base_units: '999', status: 'disputed' });
    expect(byTicker.dogi.token).toMatchObject({ ticker: 'dogi', decimals: 18, deploy_txid: base.tokens[0].deploy_txid });

    // Transfers are refused while the balance is disputed.
    const t = await user.api.post(
      '/transfers',
      { wallet_id: wallet.id, token_id: byTicker.dogi.token.id, recipient_address: newKey().address, amount_base_units: '1' },
      { 'idempotency-key': 'disputed-1' },
    );
    expect(t.status).toBe(409);
    expect(t.body.code).toBe('balance_disputed');

    // Indexers converge -> confirmed after refresh.
    fb.addresses![key.address].drc20!.dogi = '1000';
    const fixed = await user.api.get('/wallet/assets?refresh=true');
    expect(fixed.body.drc20.find((b: any) => b.token.ticker === 'dogi')).toMatchObject({ amount_base_units: '1000', status: 'confirmed' });

    const tok = await user.api.get('/tokens/DOGI');
    expect(tok.body).toMatchObject({ ticker: 'dogi', decimals: 18 });
    expect((await user.api.get('/tokens/nope')).status).toBe(404);
  });

  it('only one indexer available -> unverified', async () => {
    const ctx2 = await createTestApp({
      deps: { indexers: [new FixtureIndexerAdapter('only', { ...base, deterministic: true }), new FailingAdapter()] },
    });
    try {
      const user = await registerUser(ctx2.app);
      await connectWallet(user);
      const assets = await user.api.get('/wallet/assets');
      expect(assets.body.doge[0].status).toBe('unverified');
      expect(assets.body.drc20.every((b: any) => b.status === 'unverified')).toBe(true);
    } finally {
      await ctx2.close();
    }
  });
});
