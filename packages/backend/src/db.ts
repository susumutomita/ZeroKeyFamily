import type { Database } from 'bun:sqlite';

const TABLES: readonly string[] = [
  `CREATE TABLE IF NOT EXISTS members (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    created_at TEXT NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS devices (
    id TEXT PRIMARY KEY,
    member_id TEXT NOT NULL REFERENCES members(id),
    public_key TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'active',
    created_at TEXT NOT NULL,
    revoked_at TEXT
  )`,
  `CREATE TABLE IF NOT EXISTS circles (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'normal',
    created_at TEXT NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS circle_members (
    circle_id TEXT NOT NULL REFERENCES circles(id),
    member_id TEXT NOT NULL REFERENCES members(id),
    joined_at TEXT NOT NULL,
    left_at TEXT,
    PRIMARY KEY (circle_id, member_id)
  )`,
  `CREATE TABLE IF NOT EXISTS invites (
    id TEXT PRIMARY KEY,
    circle_id TEXT NOT NULL REFERENCES circles(id),
    inviter_member_id TEXT NOT NULL REFERENCES members(id),
    invitee_member_id TEXT REFERENCES members(id),
    kind TEXT NOT NULL,
    status TEXT NOT NULL,
    created_at TEXT NOT NULL,
    confirmable_at TEXT NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS requests (
    id TEXT PRIMARY KEY,
    circle_id TEXT NOT NULL REFERENCES circles(id),
    requester_member_id TEXT NOT NULL REFERENCES members(id),
    target_member_id TEXT NOT NULL REFERENCES members(id),
    subject TEXT NOT NULL,
    amount REAL NOT NULL,
    beneficiary TEXT NOT NULL,
    reason TEXT NOT NULL,
    deadline TEXT NOT NULL,
    nonce TEXT NOT NULL,
    status TEXT NOT NULL,
    high_risk_second_approval INTEGER NOT NULL DEFAULT 0,
    high_risk_wait_required INTEGER NOT NULL DEFAULT 0,
    high_risk_wait_until TEXT,
    created_at TEXT NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS responses (
    id TEXT PRIMARY KEY,
    request_id TEXT NOT NULL REFERENCES requests(id),
    device_id TEXT NOT NULL REFERENCES devices(id),
    kind TEXT NOT NULL,
    payload TEXT NOT NULL,
    signature TEXT NOT NULL,
    verified INTEGER NOT NULL,
    created_at TEXT NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS stop_events (
    id TEXT PRIMARY KEY,
    circle_id TEXT NOT NULL REFERENCES circles(id),
    member_id TEXT NOT NULL REFERENCES members(id),
    created_at TEXT NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS stop_releases (
    id TEXT PRIMARY KEY,
    stop_event_id TEXT NOT NULL REFERENCES stop_events(id),
    device_id TEXT NOT NULL REFERENCES devices(id),
    signature TEXT NOT NULL,
    created_at TEXT NOT NULL
  )`,
];

export function migrate(db: Database): void {
  db.run('PRAGMA foreign_keys = ON');
  for (const sql of TABLES) {
    db.run(sql);
  }
}
