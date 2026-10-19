# @zoko/api

The Zoko API server: auth, profiles, posts and feeds, media, direct messages, notifications, moderation, Dogecoin wallet proof, DRC-20 balances and multi-step DRC-20 transfers. It implements every endpoint in [`packages/contracts/src/index.ts`](../../packages/contracts/src/index.ts) under `/api/v1`, with the same paths and response shapes.

Stack: TypeScript, Fastify 5, PostgreSQL 16 via `pg` with plain SQL (no ORM), `zod` validation, `jose` (HS256 JWT), `@fastify/websocket`, `@fastify/rate-limit`, `@fastify/cors`, `@noble/secp256k1` + `@noble/hashes` + `@scure/base` for Dogecoin crypto. Passwords are hashed with Node's built-in `crypto.scrypt`, so there are no native dependencies.

## Run it locally

```bash
# 1. Start a PostgreSQL 16 server and create a database (UTF8)
createdb zoko            # or: psql -c "create database zoko encoding 'UTF8' template template0"

# 2. Configure (every variable has a dev default; see .env.example)
cp apps/api/.env.example apps/api/.env   # then edit DATABASE_URL

# 3. Schema + demo data
pnpm --filter @zoko/api db:migrate
pnpm --filter @zoko/api db:seed

# 4. Start (tsx watch)
pnpm --filter @zoko/api dev            # http://localhost:4000/api/v1/health
```

Demo accounts (password `zoko-demo-password` for all): `demo@zoko.app` (@demo, has a verified demo wallet, follows, posts, a conversation and a message request), `mod@zoko.app` (@mod, moderator), and the creators @shibe_studio, @moonpainter, @dogedev, @kabosu_fan and @pixelpup. Seeded DRC-20 tokens are `dogi` (18 decimals) and `wow` (8 decimals).

The demo wallet address is derived from a label hash, so nobody holds its private key and it can't receive spendable funds. To connect your own wallet in dev, use a real Dogecoin wallet that supports "Sign message" with a legacy `D…` address.

To run on a phone, set `PUBLIC_BASE_URL=http://<your-LAN-IP>:4000` so media and upload URLs resolve on the device. The mobile app reads `EXPO_PUBLIC_API_BASE_URL`.

### Scripts

| Command | What it does |
| --- | --- |
| `dev` | `tsx watch src/index.ts` (API, websocket, and background worker) |
| `build` / `start` | `tsc -p tsconfig.build.json` → `node dist/index.js` |
| `typecheck` | `tsc --noEmit` (src and tests) |
| `test` | vitest integration tests against a real Postgres |
| `db:migrate` | applies `database/migrations/NNNN_*.sql` in order (skips `*_rollback.sql`) and records them in `schema_migrations` |
| `db:rollback` | runs `NNNN_rollback.sql` for the most recently applied migration |
| `db:seed` | demo data (refuses to run with `NODE_ENV=production`) |
| `chain:mine [n]` | mines `n` blocks on the dev simulated chain through a running API |

### Tests

```bash
TEST_DATABASE_URL=postgres://postgres:postgres@localhost:5432/postgres pnpm --filter @zoko/api test
```

- `TEST_DATABASE_URL` (or `DATABASE_URL` as a fallback) must point at a PostgreSQL 16 server. The role needs `CREATEDB`, because the test setup creates a migrated template database and then one fresh database per test file. All of them are dropped afterwards. Any database name in the URL works, because only the server and credentials are used.
- If neither variable is set, the database suites are skipped with a clear message, and only the pure unit tests (crypto, scanning, reconciliation, state machine) run.
- No other environment variables are needed. Tests use the simulated chain, the simulated builder and in-memory fixture indexers, and they never touch the network.

Coverage includes:
- **Auth:** register, login, refresh rotation, reuse of a rotated refresh token revoking the whole family, logout, rate limit (429), and account deletion and export.
- **Users:** case-insensitive handle and email uniqueness.
- **Posts:** validation, idempotency (including concurrent retries), followers-only visibility, two-way blocks, and author or moderator deletion.
- **Feeds:** cursor stability while new posts are inserted, repost dedupe, and discover filtering.
- **Media:** magic-byte rejection, no unscanned media served, owner-only upload, and avatar ownership.
- **DMs:** membership checks, message requests, websocket auth (401 on upgrade), member-only frames, and rejected subscriptions.
- **Moderation:** RBAC, actions, and the audit trail.
- **Wallet proof:** valid signature (keys generated in the test), replay, expiry, wrong network or domain, wrong key or message, and one active connection per address.
- **Indexers:** agreement → `confirmed`, disagreement → `disputed`, single source → `unverified`.
- **Transfers:** the happy path to `confirmed` with no premature confirmation, reorg → `reorged`, re-mined after a reorg, binding and expiry of signed payloads, and `prepare` with no builder → 501.

## Architecture

```
src/
  index.ts            boot: config → deps → Fastify app → worker loop
  app.ts              buildDeps() wires implementations from env; buildApp() registers plugins/routes under /api/v1
  config.ts           env parsing + production safety checks (refuses simulations in production)
  db.ts               pg Pool, tx() helper with post-commit callbacks
  migrations.ts       migration runner used by db:migrate and the tests
  worker.ts           interval loop (advisory-locked): chain sync → transfer monitor → push outbox
  auth/               scrypt passwords, JWT access tokens, bearer hook (checks session family is live)
  lib/                problem+json errors, zod parse, opaque keyset cursors, Idempotency-Key handling
  services/           post hydration (batched), visibility SQL, user summaries, notifications, Expo push, media scan
  routes/             one Fastify plugin per area (auth, users, posts, feed+search, media, conversations,
                      notifications+devices, realtime (ws), moderation, wallet, transfers, health, dev)
  storage/            MediaStorage interface + LocalDiskStorage (apps/api/storage/, gitignored)
  realtime/hub.ts     in-process websocket fan-out to explicit recipient user ids
  chain/              Dogecoin address/signed-message crypto; ChainSource (DogecoinRpcChainSource, SimulatedChain); sync job
  indexer/            IndexerAdapter (FixtureIndexerAdapter, HttpIndexerAdapter) + reconciler
  transfers/          state machine, TransferBuilder (SimulatedTransferBuilder), monitor/rollback service
```

Key behaviours:

- **Errors** are always `application/problem+json` with `type, title, status, detail, code, errors`. Validation failures return 422 with per-field `errors`.
- **Auth:** access JWTs are HS256 with a 15-minute lifetime and carry the session family id. Refresh tokens are opaque random values, stored as SHA-256 hashes in `sessions`, and rotated on every refresh. Reusing a rotated token revokes the whole family. Every request checks that the user is active and that the token's family is still live, so logout, suspension and deletion take effect immediately.
- **Feeds** use keyset pagination over `(created_at, id)`. Each cursor is an opaque base64url string that holds a microsecond-precision timestamp and an id, so concurrent inserts never duplicate or skip items. Posts are hydrated in a fixed number of queries per page (posts with counts and viewer flags, then media, then quoted posts), so there is no N+1. Visibility is a single SQL predicate (`visiblePostSql`): published, author active, public or follower or self, and no block in either direction. It is used by every read path.
- **Idempotency:** `POST /posts` and `POST /transfers` require `Idempotency-Key`. The key row is written in the same transaction as the work. A retry with the same user, route and key returns the stored response with the `Idempotent-Replayed: true` header. Reusing a key with a different body returns 422.
- **Media:** `POST /media/uploads` returns a `PUT` URL. With the local driver that URL is `PUT /api/v1/media/:id/blob`, which needs auth, is owner-only, and checks the Content-Type and the exact byte size. `complete` scans the file: the magic bytes must match the declared MIME type (jpeg, png, webp, heic, mp4, quicktime) and the size must be within limits. The file is then marked `ready`, or `rejected` and deleted. `GET /media/:id/file` serves only `ready` media and supports Range requests for video.
- **Realtime:** `GET /api/v1/ws?access_token=…` verifies the token before the upgrade and rejects with 401 otherwise. Frames are `RealtimeEvent` JSON sent only to the users concerned (conversation members, or the owner of a notification or transfer). Optional client frames are `{"type":"ping"}` and `{"type":"subscribe","conversation_id"}`. A subscribe from a non-member gets `{"type":"error","code":"forbidden"}` and the socket is closed with code 4403.
- **Notifications:** rows are created for like, reply, follow, repost, mention, message (coalesced per conversation while unread) and transfer milestones. Each one also gets an outbox row that the worker sends to Expo (`PUSH_ENABLED=true`) from the tokens registered with `POST /devices`.
- **Moderation:** `/moderation/*` is limited to the moderator and admin roles. Actions write `moderation_actions` and `audit_events`. Suspension revokes sessions. A moderator can't suspend an admin or another moderator.

### Wallet proof (EP08)

`GET /wallet/providers` returns the capability matrix. The MVP provider is `manual`: copy the message into any Dogecoin wallet with "Sign message", then paste the base64 signature back.

Challenges are single-use: they are consumed atomically, even when the signature is wrong. They expire after 10 minutes. The message binds `APP_DOMAIN`, the `dogecoin-mainnet` network, the address, the user id, a random nonce (only its hash is stored), the issue time and the expiry. Addresses are base58check-validated as Dogecoin mainnet: P2PKH `0x1e` or P2SH `0x16`. Testnet, Bitcoin and Litecoin versions are reported as `wrong_network`. Message signing needs a P2PKH address.

Signatures are checked as genuine Dogecoin signed messages. The hash is double-SHA256 of `"\x19Dogecoin Signed Message:\n" + varint(len) + message`, the signature is a 65-byte compact recoverable secp256k1 signature, and the public key is recovered and compared by hash160 with the address. Only one active connection per address is allowed across all users.

### DRC-20 read model (EP09)

`IndexerAdapter` has `getTip`, `getDogeBalance` and `getDrc20Balances`. The reconciler queries every configured adapter in parallel and applies these rules:
- All available adapters agree, and there are at least two → `confirmed`.
- Any disagreement → `disputed`. The lowest amount is stored.
- Only one adapter answered → `unverified`.
- None answered → the stored value is left unchanged.

`GET /wallet/assets` refreshes balances older than `ASSET_STALE_SECONDS` (or all of them with `?refresh=true`) and returns DOGE and DRC-20 balances separately. Transfers are refused unless the token balance is `confirmed`.

- `FixtureIndexerAdapter` (dev and tests) reads `fixtures/indexer.json`. In `deterministic` mode it derives balances from `sha256(address)`, so any wallet you connect in dev shows assets. The fixture token deploy txids are synthetic.
- `HttpIndexerAdapter` speaks a small **Zoko indexer adapter protocol** that we define ourselves: `GET /v1/tip`, `GET /v1/addresses/:address/doge` and `GET /v1/addresses/:address/drc20`. The JSON shapes are documented in `src/indexer/adapter.ts`. Operators run one shim per independent indexer they trust. No third-party endpoints are assumed.

Chain sync (`chain/sync.ts`) records block headers in `chain_blocks`. It detects reorgs in two ways: by comparing stored canonical hashes with the node, and by a parent-hash mismatch while extending the chain. It then marks orphaned blocks and their `chain_events` as non-canonical and moves the affected transfers to `reorged`. `DogecoinRpcChainSource` uses real Dogecoin Core RPCs (`getblockcount`, `getblockhash`, `getblockheader`, `getrawtransaction` (needs `txindex=1`), `testmempoolaccept`, `sendrawtransaction`). Dogecoin Core 1.14 has no `testmempoolaccept`; in that case the pre-check is skipped.

### Transfers (EP10)

The state machine is enforced server-side (`transfers/stateMachine.ts`). Every change goes through `setTransferStatus`, which validates the transition and appends a row to `transfer_events`. A DRC-20 transfer has two steps: an `inscription` step and then a `transfer` step. Each step goes prepare → wallet signs externally → `signed` → `broadcast`.

```
draft → prepared → awaiting_signature → signed → broadcast ─┬→ prepared (next step) …
                                                            └→ confirming → confirmed
any pre-broadcast state → cancelled · broadcast/confirming → reorged → confirming · * → failed
```

- `prepare` returns a `SigningStep` with the unsigned payload. It expires after 10 minutes, and its hash is stored with the step.
- `signed` checks that the payload binds to that exact prepared step (`TransferBuilder.verifySigned`) and hasn't expired. It then records the txid.
- `broadcast` runs `testmempoolaccept` and then `sendrawtransaction`. A rejected transaction moves the transfer to `failed` and sets `error_code` and `error_detail`.
- The monitor counts confirmations only against blocks that our sync has accepted as canonical. A transfer is `confirmed` only when every step has at least `REQUIRED_CONFIRMATIONS` confirmations (default 6).
- **No keys:** the backend never sees private keys or seed phrases.
- **No builder:** when no real builder is configured (the production default), `prepare` returns **501 `transfer_builder_unavailable`**. The server never fakes success.

## Simulated vs production-ready

| Area | Status |
| --- | --- |
| Auth, sessions, rate limits, profiles, settings, export, deletion | Production-shaped (see gaps) |
| Posts, replies, reposts, likes, bookmarks, blocks, visibility, feeds, search, trends | Production-shaped |
| DMs, message requests, read markers, websocket delivery | Production-shaped, but single-instance (see gaps) |
| Notifications + Expo push | Real Expo push API, best effort, behind `PUSH_ENABLED` |
| Moderation queue, actions, audit | Production-shaped |
| Wallet proof (Dogecoin signed message) | Real cryptography, works with real wallets |
| Media storage | Local disk driver for dev. An S3-compatible presigned driver plugs into `MediaStorage` |
| Media scanning | Magic bytes and size only. **No malware or CSAM scanning, no video transcoding or thumbnails** (videos are served as uploaded; `thumbnail_url` is always null) |
| Chain source | `SimulatedChain` (dev and test) or `DogecoinRpcChainSource` (real RPC, not exercised against a live node here) |
| Indexers | `FixtureIndexerAdapter` (dev and test). `HttpIndexerAdapter` needs operator-run shims for real indexers |
| Transfer builder | `SimulatedTransferBuilder` only (dev and test). **No real DRC-20 builder exists yet**, so production `prepare` returns 501 |
| Dev endpoints | `POST /api/v1/dev/chain/mine`, `/dev/chain/reorg`, `/dev/sign-simulated` (with `DEV_ENDPOINTS=true`, refused in production) |

With `NODE_ENV=production`, the API refuses to boot in any of these cases: a simulated chain, a simulated builder, fixture indexers, dev endpoints, or a `JWT_SECRET` shorter than 32 characters.

The simulated signing rule (dev only): a "signed" payload is the unsigned hex followed by at least 64 hex characters. `POST /dev/sign-simulated {data}` produces one.

## Production gaps (from the starter's release gates)

1. **Social and video:**
   - Transcoding (HLS), thumbnails, captions, and malware or CSAM hash scanning are not implemented.
   - Media URLs are unguessable capability URLs rather than signed, expiring CDN URLs, so they don't enforce followers-only visibility.
   - Load tests, accessibility review of moderation tooling, and an appeals workflow (only `restore` exists) are not done.
   - Account deletion hides content immediately, but no purge job hard-deletes it after a grace period.
   - Email verification, password reset and OIDC login are not implemented.
2. **Wallet:**
   - Signing is copy and paste only. Provider-specific integrations (deep links, PSBT-capable wallets) and compatibility testing with real wallets are still needed.
   - P2SH addresses can't sign messages, and BIP-322 isn't supported.
3. **DRC-20:**
   - A real `TransferBuilder` is required. It needs UTXO selection, commit and reveal inscription construction, fee estimation, and full validation that a signed transaction matches its template.
   - At least two genuinely independent indexers are needed behind the adapter protocol.
   - The RPC chain source needs testing against a live node with `txindex=1`.
   - Inscription lifecycle edge cases are not covered: an inscription that confirms but whose transfer step never gets broadcast, and dropped transactions that need rebroadcast or expiry.
4. **Legal:** Apple, Google and local crypto and consumer-protection obligations must be reviewed before transfers are enabled in production.
5. **Production operations:**
   - Realtime fan-out is in-process. More than one API instance needs Postgres LISTEN/NOTIFY or Redis, and so do the in-memory rate limit counters.
   - Jobs use a Postgres advisory lock, so only one instance runs them at a time.
   - Backups and restore drills, metrics and dashboards, SLOs, an incident playbook, secrets management, and a penetration test (EP11 and EP12) are not done.
