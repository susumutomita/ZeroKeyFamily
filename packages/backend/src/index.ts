import { Database } from 'bun:sqlite';
import { createApp } from './app';
import { systemClock } from './clock';
import { migrate } from './db';

const { ZEROKEY_DB_PATH: dbPath = 'zerokey.sqlite' } = process.env;
const db = new Database(dbPath);
migrate(db);

const app = createApp({ db, clock: systemClock });

const server = Bun.serve({ port: 3000, fetch: app.fetch });

console.log(
  `ZeroKey Family backend listening on http://localhost:${server.port}`
);
