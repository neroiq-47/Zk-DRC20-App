import { loadConfig } from '../config.js';
import { rollbackLast } from '../migrations.js';

const cfg = loadConfig();
const name = await rollbackLast(cfg.databaseUrl, (m) => console.log(m));
console.log(name ? `Rolled back ${name}.` : 'Nothing to roll back.');
