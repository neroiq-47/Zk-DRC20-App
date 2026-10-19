// Mines blocks on the dev simulated chain through a running API (POST /api/v1/dev/chain/mine).
// Usage: pnpm --filter @zoko/api chain:mine [blocks]   (logs in as the seeded demo user)
const base = (process.env.PUBLIC_BASE_URL || 'http://localhost:4000').replace(/\/$/, '') + '/api/v1';
const blocks = Number(process.argv[2] || 1);
const login = await fetch(`${base}/auth/login`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ email: process.env.DEMO_EMAIL || 'demo@zoko.app', password: process.env.DEMO_PASSWORD || 'zoko-demo-password' }),
});
if (!login.ok) throw new Error(`login failed: ${login.status} ${await login.text()}`);
const { access_token } = (await login.json()) as { access_token: string };
const res = await fetch(`${base}/dev/chain/mine`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${access_token}` },
  body: JSON.stringify({ blocks }),
});
console.log(res.status, await res.text());
