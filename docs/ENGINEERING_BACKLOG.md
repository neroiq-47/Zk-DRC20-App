# ZK Social — prioritized engineering backlog

### EP01 · P0 · Registration and login (5 points)
**Scope:** Email/OIDC login, account verification, session rotation

**Acceptance:** Auth integration tests; refresh reuse revokes family

### EP02 · P0 · Profile and settings (5 points)
**Scope:** Handle uniqueness, avatar, privacy, account export/deletion

**Acceptance:** Ownership and visibility tests

### EP03 · P0 · Posts, replies, reactions and follows (8 points)
**Scope:** 500 chars, four images, reposts, block enforcement

**Acceptance:** Cursor pagination and authorization tests

### EP04 · P0 · Following and discovery feeds (8 points)
**Scope:** Cursor feed, safety filtering, deduplication

**Acceptance:** Stable pagination under concurrent writes

### EP05 · P0 · Photos and video processing (13 points)
**Scope:** Presigned upload, scan, transcode, thumbnails, captions

**Acceptance:** No unscanned media served; retry support

### EP06 · P0 · 1:1 chat and notification delivery (8 points)
**Scope:** Membership checks, websocket delivery, message requests

**Acceptance:** Unauthorized subscription rejected

### EP07 · P0 · Moderation and reporting (8 points)
**Scope:** Blocks, reports, queue, audit and appeals

**Acceptance:** Abuse cases and moderator RBAC tests

### EP08 · P0 · Wallet connect and proof of ownership (8 points)
**Scope:** One-use nonce, expiry, chain/domain binding, wallet capability matrix

**Acceptance:** Replay and wrong-network tests

### EP09 · P0 · DRC-20 balance read model (13 points)
**Scope:** Independent adapters, canonical block sync, reorg rollback

**Acceptance:** Provider disagreement yields disputed status

### EP10 · P0 · DRC-20 multi-step transfer (21 points)
**Scope:** Prepare, external sign, broadcast, monitor, reconcile

**Acceptance:** No backend keys; no premature success

### EP11 · P0 · Threat model and hardening (8 points)
**Scope:** Rate limits, secrets, logs, penetration tests

**Acceptance:** Release security gate passed

### EP12 · P0 · Deploy, backups and observability (8 points)
**Scope:** Migrations, dashboards, SLOs, incident playbooks

**Acceptance:** Recovery drill and rollback demonstrated

### EP13 · P1 · Search and trends (8 points)
**Scope:** Users/posts/hashtags, moderation-aware ranking

**Acceptance:** Search visibility tests

### EP14 · P1 · Creator studio (8 points)
**Scope:** Post insights, media library, asset showcase

**Acceptance:** Analytics consent and access tests

### EP15 · P2 · Private eligibility credentials (21 points)
**Scope:** Issuer trust, circuit, verifier, revocation and nullifier

**Acceptance:** Independent audit and privacy review

## Release gates
1. Social and video: content moderation, access controls, accessibility, load tests.
2. Wallet: provider-specific signing compatibility and replay protection.
3. DRC-20: inscription lifecycle, transaction validation, independent indexer agreement, reorg rollback.
4. Legal: Apple/Google and local crypto/consumer obligations reviewed before enabling transactions.
5. Production: backup restore, observability, abuse response, incident procedures.

## Delivery sequence
Sprints 1–2: foundation and design. Sprints 3–5: auth/social/media. Sprints 6–8: feeds, chat, moderation. Sprints 9–12: wallet and indexer. Sprints 13–16: transactional DRC-20 and security. Sprints 17–18: store review, hardening, release. Timing is an estimate; chain compatibility may extend it.
