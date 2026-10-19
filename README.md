# Zoko

Zoko is a mainstream social app for Android and iOS: posts, photos and video, follows, direct messages and notifications, with optional Dogecoin wallet proof and DRC-20 balances and transfers.

> Connect freely. Create boldly.

## Repository layout

| Path | What it is |
| --- | --- |
| `apps/mobile` | The Expo (SDK 58) + Expo Router app for Android and iOS |
| `apps/api` | The API server (Fastify, PostgreSQL 16) implementing `packages/contracts` |
| `packages/contracts` | Shared TypeScript API contract (paths, request and response shapes) plus the original OpenAPI design baseline |
| `packages/tokens` | Brand design tokens (colors light/dark, type, spacing, radii, motion, brand copy) with WCAG contrast tests |
| `database/migrations` | PostgreSQL migrations and development-only rollbacks |
| `brand` | Logo and app icon source SVGs |
| `docs` | Engineering backlog and release gates from the implementation starter |

## Quick start

Requirements: Node 22, pnpm 10, PostgreSQL 16.

```bash
pnpm install
cp apps/api/.env.example apps/api/.env      # set DATABASE_URL
pnpm db:migrate
pnpm db:seed                                # demo accounts, posts and a DRC-20 token
pnpm dev:api                                # http://localhost:4000/api/v1
pnpm dev:mobile                             # Expo dev server; press a (Android) or i (iOS)
```

The app finds the API on the machine running Metro automatically. To point it elsewhere, copy `apps/mobile/.env.example` to `apps/mobile/.env` and set `EXPO_PUBLIC_API_BASE_URL`.

Sign in with the seeded demo account `demo@zoko.app` / `zoko-demo-password`.

Native builds use EAS (`apps/mobile/eas.json`): `npx eas-cli@latest build --profile preview --platform android`. Push notifications on a real device need an EAS project id in the app config.

## Checks

```bash
pnpm typecheck
pnpm test        # tokens contrast tests, mobile unit tests, API integration tests (needs TEST_DATABASE_URL)
```

## What is real and what is simulated

Social features, media upload with file-type scanning, messaging with a realtime socket, notifications, moderation, wallet ownership proof (real Dogecoin signed-message verification) and the transfer state machine are implemented end to end.

Two parts need provider work before they touch mainnet, and the server refuses rather than faking success when they aren't configured:

- **DRC-20 balances** come from indexer adapters. Development uses deterministic fixtures; a production deployment must configure at least two independent indexers so disagreements show as "disputed".
- **DRC-20 transfers** need a real inscription transaction builder and a Dogecoin node. Development uses a simulated builder and chain so the whole flow (prepare, sign, broadcast, confirmations, reorg) can be exercised. Without a builder in production the prepare step returns `501 transfer_builder_unavailable`.

The release gates in `docs/ENGINEERING_BACKLOG.md` (security review, store review, legal review of crypto features, indexer agreement, backups) still apply before launch. The logo is a proposed concept and is not trademark-cleared.
