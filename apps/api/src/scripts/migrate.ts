import { loadConfig } from '../config.js';
import { migrate } from '../migrations.js';

const cfg = loadConfig();
const applied = await migrate(cfg.databaseUrl, (m) => console.log(m));
console.log(applied.length ? `Applied ${applied.length} migration(s).` : 'Database is up to date.');
