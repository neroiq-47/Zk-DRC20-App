// Development seed data. Run after db:migrate:  pnpm --filter @zoko/api db:seed
import fs from 'node:fs';
import { createHash } from 'node:crypto';
import pg from 'pg';
import { loadConfig } from '../config.js';
import { hashPassword } from '../auth/passwords.js';
import { addressFromHash160 } from '../chain/dogecoin.js';
import { extractHashtags } from '../services/posts.js';
import type { IndexerFixture } from '../indexer/adapter.js';

const cfg = loadConfig();
if (cfg.isProduction) throw new Error('Refusing to seed demo data in production.');

const PASSWORD = 'zoko-demo-password';
const users = [
  { handle: 'demo', email: 'demo@zoko.app', name: 'Demo Shibe', bio: 'Trying out Zoko. Much social, very wow.', role: 'user' },
  { handle: 'shibe_studio', email: 'studio@zoko.app', name: 'Shibe Studio', bio: 'Illustrations and tiny animations. #art', role: 'user' },
  { handle: 'moonpainter', email: 'moon@zoko.app', name: 'Moon Painter', bio: 'Night skies, long exposures.', role: 'user' },
  { handle: 'dogedev', email: 'dev@zoko.app', name: 'Doge Dev', bio: 'Building on Dogecoin. Opinions are my own.', role: 'user' },
  { handle: 'kabosu_fan', email: 'kabosu@zoko.app', name: 'Kabosu Fan Club', bio: 'Good dogs only.', role: 'user' },
  { handle: 'pixelpup', email: 'pixel@zoko.app', name: 'Pixel Pup', bio: 'Pixel art every day.', role: 'user' },
  { handle: 'mod', email: 'mod@zoko.app', name: 'Zoko Moderation', bio: 'Keeping Zoko friendly.', role: 'moderator' },
] as const;

const posts: Array<[string, string, ('public' | 'followers')?]> = [
  ['shibe_studio', 'New sketch series starts today: one shibe a day for a month. #art #shibe'],
  ['moonpainter', 'Caught the moon rising over the bay last night. Full gallery soon. #photography'],
  ['dogedev', 'Shipping a small DRC-20 explorer this weekend. What would you want to see first? #dogecoin #drc20'],
  ['kabosu_fan', 'Reminder: be kind, tip generously, and pet your dog. #dogecoin'],
  ['pixelpup', '16x16 doge, take 4. Getting closer. #pixelart #art'],
  ['demo', 'Hello Zoko! First post from the demo account. #hello'],
  ['dogedev', 'Followers-only: early notes on the indexer reconciliation design.', 'followers'],
  ['moonpainter', 'Tip for night shots: lower ISO, longer exposure, steady tripod. #photography'],
  ['shibe_studio', 'Day 2: sleepy shibe. @demo what should day 3 be? #art'],
];

const client = new pg.Client({ connectionString: cfg.databaseUrl });
await client.connect();
try {
  const exists = await client.query(`SELECT 1 FROM users WHERE handle = 'demo'`);
  if (exists.rowCount) {
    console.log('Seed data already present (user @demo exists). Nothing to do.');
    process.exit(0);
  }
  await client.query('BEGIN');
  const hash = await hashPassword(PASSWORD);
  const ids: Record<string, string> = {};
  for (const u of users) {
    const r = await client.query(
      `INSERT INTO users (handle, display_name, bio, role) VALUES ($1, $2, $3, $4) RETURNING id`,
      [u.handle, u.name, u.bio, u.role],
    );
    ids[u.handle] = r.rows[0].id;
    await client.query(`INSERT INTO credentials (user_id, email, password_hash) VALUES ($1, $2, $3)`, [ids[u.handle], u.email, hash]);
    await client.query(`INSERT INTO auth_identities (user_id, provider, provider_subject) VALUES ($1, 'password', $2)`, [ids[u.handle], u.email]);
  }
  const follow = (a: string, b: string) =>
    client.query(`INSERT INTO follows (follower_id, following_id) VALUES ($1, $2) ON CONFLICT DO NOTHING`, [ids[a], ids[b]]);
  for (const h of ['shibe_studio', 'moonpainter', 'dogedev', 'kabosu_fan']) await follow('demo', h);
  for (const h of ['shibe_studio', 'moonpainter', 'dogedev']) await follow(h, 'demo');
  await follow('pixelpup', 'shibe_studio');
  await follow('kabosu_fan', 'dogedev');
  await follow('moonpainter', 'shibe_studio');

  const postIds: string[] = [];
  let minutesAgo = posts.length * 37;
  for (const [handle, body, visibility] of posts) {
    const r = await client.query(
      `INSERT INTO posts (author_id, body, visibility, created_at) VALUES ($1, $2, $3, now() - make_interval(mins => $4)) RETURNING id, created_at`,
      [ids[handle], body, visibility ?? 'public', minutesAgo],
    );
    minutesAgo -= 37;
    postIds.push(r.rows[0].id);
    const tags = extractHashtags(body);
    if (tags.length) {
      await client.query(`INSERT INTO post_hashtags (post_id, tag, created_at) SELECT $1, unnest($2::text[]), $3`, [r.rows[0].id, tags, r.rows[0].created_at]);
    }
  }
  // A reply, a repost, likes and bookmarks.
  await client.query(`INSERT INTO posts (author_id, parent_id, body) VALUES ($1, $2, 'Token holder lists with independent indexer agreement, please!')`, [
    ids.demo,
    postIds[2],
  ]);
  await client.query(`INSERT INTO posts (author_id, quote_post_id, body, is_repost) VALUES ($1, $2, '', true)`, [ids.kabosu_fan, postIds[1]]);
  for (const [h, i] of [['demo', 0], ['demo', 1], ['moonpainter', 0], ['dogedev', 5], ['shibe_studio', 5], ['pixelpup', 0], ['kabosu_fan', 2]] as const) {
    await client.query(`INSERT INTO reactions (user_id, post_id, kind) VALUES ($1, $2, 'like') ON CONFLICT DO NOTHING`, [ids[h], postIds[i]]);
  }
  await client.query(`INSERT INTO bookmarks (user_id, post_id) VALUES ($1, $2)`, [ids.demo, postIds[7]]);

  // A conversation (demo <-> dogedev) and a message request (pixelpup -> demo, demo doesn't follow pixelpup).
  const conv = async (from: string, to: string, accepted: boolean, lines: Array<[string, string]>) => {
    const key = [ids[from], ids[to]].sort().join(':');
    const c = await client.query(`INSERT INTO conversations (created_by, direct_key) VALUES ($1, $2) RETURNING id`, [ids[from], key]);
    const cid = c.rows[0].id;
    await client.query(`INSERT INTO conversation_members (conversation_id, user_id, accepted_at) VALUES ($1, $2, now()), ($1, $3, $4)`, [
      cid,
      ids[from],
      ids[to],
      accepted ? new Date() : null,
    ]);
    let ago = lines.length * 3;
    for (const [sender, body] of lines) {
      await client.query(`INSERT INTO messages (conversation_id, sender_id, body, created_at) VALUES ($1, $2, $3, now() - make_interval(mins => $4))`, [
        cid,
        ids[sender],
        body,
        ago,
      ]);
      ago -= 3;
    }
    await client.query(`UPDATE conversations SET updated_at = now() WHERE id = $1`, [cid]);
  };
  await conv('dogedev', 'demo', true, [
    ['dogedev', 'Hey! Saw your reply about holder lists. Want to test the explorer beta?'],
    ['demo', 'Absolutely, send it over.'],
    ['dogedev', 'Will do this weekend 🚀'],
  ]);
  await conv('pixelpup', 'demo', false, [['pixelpup', 'Hi! Would you like a pixel portrait of your shibe?']]);

  await client.query(
    `INSERT INTO notifications (recipient_id, actor_id, kind, post_id, entity_id) VALUES
       ($1, $2, 'like', $3, $3), ($1, $4, 'follow', NULL, $4), ($1, $5, 'mention', $6, $6)`,
    [ids.demo, ids.dogedev, postIds[5], ids.moonpainter, ids.shibe_studio, postIds[8]],
  );

  // DRC-20 tokens from the dev indexer fixture (synthetic deploy txids; development only).
  const fixture = JSON.parse(fs.readFileSync(cfg.indexerFixturePath, 'utf8')) as IndexerFixture;
  for (const t of fixture.tokens) {
    await client.query(
      `INSERT INTO drc20_tokens (ticker, protocol_version, deploy_txid, decimals, max_supply) VALUES ($1, 'drc-20', $2, $3, $4) ON CONFLICT DO NOTHING`,
      [t.ticker, t.deploy_txid, t.decimals, t.max_supply],
    );
  }
  // A verified demo wallet on an address nobody holds a key for (hash160 derived from a label), so it can
  // never receive spendable funds. Balances come from the fixture indexers on first GET /wallet/assets.
  const demoAddress = addressFromHash160(createHash('sha256').update('zoko demo wallet (no private key)').digest().subarray(0, 20));
  await client.query(
    `INSERT INTO wallet_connections (user_id, address, network, provider, verified_at) VALUES ($1, $2, 'dogecoin-mainnet', 'manual', now())`,
    [ids.demo, demoAddress],
  );
  await client.query('COMMIT');
  console.log(`Seeded ${users.length} users (password for all: ${PASSWORD}).`);
  console.log(`  demo@zoko.app (@demo), mod@zoko.app (@mod, moderator); demo wallet ${demoAddress}`);
} catch (err) {
  await client.query('ROLLBACK').catch(() => undefined);
  throw err;
} finally {
  await client.end();
}
