import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { connectWallet, createTestApp, hasDb, newKey, registerUser, type TestCtx, type TestUser } from './helpers.js';
import { syncChain } from '../src/chain/sync.js';
import { monitorTransfers } from '../src/transfers/service.js';
import { SimulatedTransferBuilder } from '../src/transfers/builder.js';
import { TRANSITIONS, canTransition } from '../src/transfers/stateMachine.js';

describe('transfer state machine (unit)', () => {
  it('only allows explicit transitions', () => {
    expect(canTransition('draft', 'prepared')).toBe(true);
    expect(canTransition('draft', 'confirmed')).toBe(false);
    expect(canTransition('broadcast', 'confirmed')).toBe(false);
    expect(canTransition('confirming', 'confirmed')).toBe(true);
    expect(canTransition('cancelled', 'draft')).toBe(false);
    expect(TRANSITIONS.failed).toEqual([]);
  });
});

describe.skipIf(!hasDb)('DRC-20 transfers (EP10)', () => {
  let ctx: TestCtx;
  let user: TestUser;
  let walletId: string;
  let tokenId: string;
  let balance: bigint;
  let n = 0;
  const key = () => ({ 'idempotency-key': `t-${Date.now()}-${++n}` });
  const tick = async (blocks = 1) => {
    ctx.chain.mine(blocks);
    await syncChain(ctx.deps);
    await monitorTransfers(ctx.deps);
  };
  const get = async (id: string) => (await user.api.get(`/transfers/${id}`)).body;

  /** create -> (prepare -> sign -> broadcast) x 2 steps */
  async function sendTransfer(amount = '1000') {
    const t = await user.api.post(
      '/transfers',
      { wallet_id: walletId, token_id: tokenId, recipient_address: newKey().address, amount_base_units: amount },
      key(),
    );
    expect(t.status).toBe(201);
    for (const expectedKind of ['inscription', 'transfer']) {
      const step = await user.api.post(`/transfers/${t.body.id}/prepare`);
      expect(step.status).toBe(201);
      expect(step.body.kind).toBe(expectedKind);
      const signed = await user.api.post(`/transfers/${t.body.id}/signed`, {
        step_id: step.body.step_id,
        signed_payload: SimulatedTransferBuilder.simulateSignature(step.body.wallet_payload.data),
      });
      expect(signed.body.status).toBe('signed');
      const b = await user.api.post(`/transfers/${t.body.id}/broadcast`);
      expect(b.body.status).toBe('broadcast');
    }
    return t.body.id as string;
  }

  beforeAll(async () => {
    ctx = await createTestApp();
    user = await registerUser(ctx.app);
    const { wallet } = await connectWallet(user);
    walletId = wallet.id;
    await syncChain(ctx.deps);
    const assets = await user.api.get('/wallet/assets');
    const dogi = assets.body.drc20.find((b: any) => b.token.ticker === 'dogi');
    expect(dogi.status).toBe('confirmed');
    tokenId = dogi.token.id;
    balance = BigInt(dogi.amount_base_units);
    expect(assets.body.chain_height).toBeGreaterThan(0);
  });
  afterAll(async () => ctx?.close());

  it('validates create, requires Idempotency-Key, is idempotent and checks balance', async () => {
    const body = { wallet_id: walletId, token_id: tokenId, recipient_address: newKey().address, amount_base_units: '5' };
    expect((await user.api.post('/transfers', body)).body.code).toBe('idempotency_key_required');
    expect((await user.api.post('/transfers', { ...body, amount_base_units: '0' }, key())).status).toBe(422);
    expect((await user.api.post('/transfers', { ...body, amount_base_units: '1.5' }, key())).status).toBe(422);
    expect((await user.api.post('/transfers', { ...body, recipient_address: 'nope' }, key())).body.code).toBe('invalid_address');
    const big = await user.api.post('/transfers', { ...body, amount_base_units: (balance + 1n).toString() }, key());
    expect(big.status).toBe(422);
    expect(big.body.code).toBe('insufficient_balance');
    const other = await registerUser(ctx.app);
    expect((await other.api.post('/transfers', body, key())).body.code).toBe('wallet_not_connected');

    const k = key();
    const a = await user.api.post('/transfers', body, k);
    const b = await user.api.post('/transfers', body, k);
    expect(a.status).toBe(201);
    expect(b.body.id).toBe(a.body.id);
    expect(a.body).toMatchObject({
      status: 'draft',
      wallet_id: walletId,
      amount_base_units: '5',
      network_fee_koinu: null,
      required_confirmations: 6,
      error_code: null,
      token: { id: tokenId, ticker: 'dogi' },
    });
    expect(a.body.steps.map((s: any) => [s.step_index, s.kind, s.status, s.txid])).toEqual([
      [0, 'inscription', 'draft', null],
      [1, 'transfer', 'draft', null],
    ]);
    expect((await other.api.get(`/transfers/${a.body.id}`)).status).toBe(404);
    const list = await user.api.get('/transfers');
    expect(list.body.items.map((t: any) => t.id)).toContain(a.body.id);

    // Cancel before broadcast is allowed; afterwards nothing moves.
    const c = await user.api.post(`/transfers/${a.body.id}/cancel`);
    expect(c.body.status).toBe('cancelled');
    expect((await user.api.post(`/transfers/${a.body.id}/prepare`)).body.code).toBe('invalid_transfer_state');
  });

  it('enforces the state machine and signed-payload binding', async () => {
    const t = await user.api.post(
      '/transfers',
      { wallet_id: walletId, token_id: tokenId, recipient_address: newKey().address, amount_base_units: '7' },
      key(),
    );
    const id = t.body.id;
    expect((await user.api.post(`/transfers/${id}/broadcast`)).status).toBe(409);
    expect((await user.api.post(`/transfers/${id}/signed`, { step_id: t.body.steps[0].id, signed_payload: 'abcd' })).status).toBe(409);
    const step = await user.api.post(`/transfers/${id}/prepare`);
    expect(step.body).toMatchObject({ step_index: 0, kind: 'inscription', wallet_payload: { provider_format: 'unsigned_tx_hex' } });
    expect(step.body.network_fee_koinu).toMatch(/^\d+$/);
    expect((await get(id)).status).toBe('awaiting_signature');
    expect((await get(id)).network_fee_koinu).toBe(step.body.network_fee_koinu);

    // Wrong step id, tampered payload, signature over another template.
    expect((await user.api.post(`/transfers/${id}/signed`, { step_id: t.body.steps[1].id, signed_payload: 'ab'.repeat(40) })).body.code).toBe('step_mismatch');
    const tampered = SimulatedTransferBuilder.simulateSignature(step.body.wallet_payload.data).replace(/^../, 'ff');
    const bad = await user.api.post(`/transfers/${id}/signed`, { step_id: step.body.step_id, signed_payload: tampered });
    expect(bad.status).toBe(422);
    expect(bad.body.code).toBe('signed_payload_mismatch');

    // Expired signing request.
    await ctx.deps.db.query(`UPDATE transfer_steps SET prepare_expires_at = now() - interval '1 second' WHERE id = $1`, [step.body.step_id]);
    const expired = await user.api.post(`/transfers/${id}/signed`, {
      step_id: step.body.step_id,
      signed_payload: SimulatedTransferBuilder.simulateSignature(step.body.wallet_payload.data),
    });
    expect(expired.status).toBe(410);
    expect(expired.body.code).toBe('signing_step_expired');
    // Re-prepare issues a fresh template; the old signature no longer binds.
    const step2 = await user.api.post(`/transfers/${id}/prepare`);
    expect(step2.body.step_id).toBe(step.body.step_id);
    expect(step2.body.wallet_payload.data).not.toBe(step.body.wallet_payload.data);
    const stale = await user.api.post(`/transfers/${id}/signed`, {
      step_id: step.body.step_id,
      signed_payload: SimulatedTransferBuilder.simulateSignature(step.body.wallet_payload.data),
    });
    expect(stale.body.code).toBe('signed_payload_mismatch');
    await user.api.post(`/transfers/${id}/cancel`);
  });

  it('happy path: confirmed only after required confirmations on the canonical chain', async () => {
    const id = await sendTransfer('1000');
    let t = await get(id);
    expect(t.status).toBe('broadcast');
    expect(t.steps.every((s: any) => s.status === 'broadcast' && /^[0-9a-f]{64}$/.test(s.txid))).toBe(true);
    // Already broadcast: cannot cancel.
    expect((await user.api.post(`/transfers/${id}/cancel`)).status).toBe(409);

    // Not mined yet: monitor alone does nothing.
    await syncChain(ctx.deps);
    await monitorTransfers(ctx.deps);
    expect((await get(id)).status).toBe('broadcast');

    await tick(1);
    t = await get(id);
    expect(t.status).toBe('confirming');
    expect(t.steps.map((s: any) => s.confirmations)).toEqual([1, 1]);
    for (let c = 2; c <= 5; c++) {
      await tick(1);
      t = await get(id);
      expect(t.status).toBe('confirming'); // never premature
      expect(t.steps[0].confirmations).toBe(c);
    }
    await tick(1);
    t = await get(id);
    expect(t.status).toBe('confirmed');
    expect(t.steps.every((s: any) => s.status === 'confirmed' && s.confirmations === 6)).toBe(true);

    const events = await ctx.deps.db.query(`SELECT to_status FROM transfer_events WHERE transfer_id = $1 ORDER BY created_at, id`, [id]);
    const seq = events.rows.map((r) => r.to_status);
    expect(seq[0]).toBe('draft');
    expect(seq.slice(-2)).toEqual(['confirming', 'confirmed']);
    expect(seq).toContain('awaiting_signature');
    const notes = await user.api.get('/notifications');
    expect(notes.body.items.filter((x: any) => x.kind === 'transfer' && x.entity_id === id).length).toBeGreaterThanOrEqual(2);
  });

  it('a reorg that drops the transactions rolls the transfer to reorged', async () => {
    const id = await sendTransfer('10');
    await tick(1);
    await tick(1);
    expect((await get(id)).status).toBe('confirming');
    const minedIn = await ctx.deps.db.query(`SELECT DISTINCT block_hash FROM transfer_steps WHERE transfer_id = $1`, [id]);
    const blockHash = minedIn.rows[0].block_hash;

    ctx.chain.reorg(2); // replace the last 2 blocks; the transactions are not in the new chain
    const sync = await syncChain(ctx.deps);
    expect(sync.orphaned).toHaveLength(2);
    expect(sync.reorgedTransfers).toContain(id);
    const t = await get(id);
    expect(t.status).toBe('reorged');
    expect(t.error_code).toBe('reorged');
    expect(t.steps.every((s: any) => s.status === 'reorged' && s.confirmations === 0)).toBe(true);
    const blk = await ctx.deps.db.query(`SELECT canonical FROM chain_blocks WHERE hash = $1`, [blockHash]);
    expect(blk.rows[0].canonical).toBe(false);
    const ev = await ctx.deps.db.query(`SELECT bool_or(canonical) AS any FROM chain_events WHERE block_hash = $1`, [blockHash]);
    expect(ev.rows[0].any).toBe(false);

    for (let i = 0; i < 7; i++) await tick(1);
    expect((await get(id)).status).toBe('reorged'); // the dropped tx never confirms
  });

  it('a reorg that re-mines the transactions goes reorged -> confirming -> confirmed', async () => {
    const id = await sendTransfer('11');
    await tick(1);
    ctx.chain.reorg(1, { returnToMempool: true });
    await syncChain(ctx.deps);
    await monitorTransfers(ctx.deps);
    // The replacement chain is one block longer and its first block includes the txs again.
    const t = await get(id);
    expect(['confirming', 'reorged']).toContain(t.status);
    for (let i = 0; i < 6; i++) await tick(1);
    expect((await get(id)).status).toBe('confirmed');
  });

  it('dev endpoints drive the simulated flow over HTTP', async () => {
    const t = await user.api.post(
      '/transfers',
      { wallet_id: walletId, token_id: tokenId, recipient_address: newKey().address, amount_base_units: '3' },
      key(),
    );
    const step = await user.api.post(`/transfers/${t.body.id}/prepare`);
    const sig = await user.api.post('/dev/sign-simulated', { data: step.body.wallet_payload.data });
    expect((await user.api.post(`/transfers/${t.body.id}/signed`, { step_id: step.body.step_id, signed_payload: sig.body.signed_payload })).status).toBe(201);
    expect((await user.api.post(`/transfers/${t.body.id}/broadcast`)).body.status).toBe('broadcast');
    const mined = await user.api.post('/dev/chain/mine', { blocks: 2 });
    expect(mined.status).toBe(200);
    expect(mined.body.tip).toBeGreaterThan(0);
  });
});

describe.skipIf(!hasDb)('transfers without a builder', () => {
  let ctx: TestCtx;
  beforeAll(async () => {
    ctx = await createTestApp({ deps: { builder: null } });
  });
  afterAll(async () => ctx?.close());

  it('prepare returns 501 transfer_builder_unavailable and never fakes success', async () => {
    const user = await registerUser(ctx.app);
    const { wallet } = await connectWallet(user);
    const assets = await user.api.get('/wallet/assets');
    const tokenId = assets.body.drc20[0].token.id;
    const t = await user.api.post(
      '/transfers',
      { wallet_id: wallet.id, token_id: tokenId, recipient_address: newKey().address, amount_base_units: '1' },
      { 'idempotency-key': 'nb-1' },
    );
    expect(t.status).toBe(201);
    const p = await user.api.post(`/transfers/${t.body.id}/prepare`);
    expect(p.status).toBe(501);
    expect(p.body).toMatchObject({ status: 501, code: 'transfer_builder_unavailable' });
    expect((await user.api.get(`/transfers/${t.body.id}`)).body.status).toBe('draft');
  });
});
