const path = require('node:path');
const fs = require('node:fs');
const Database = require('better-sqlite3');
const { runMigrations } = require('./migrations');

const DB_PATH = process.env.DB_PATH
  ? path.resolve(process.env.DB_PATH)
  : path.join(process.cwd(), 'data', 'netclaw-license.db');

fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });

const db = new Database(DB_PATH);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

db.exec(`
  CREATE TABLE IF NOT EXISTS licenses (
    license_key   TEXT PRIMARY KEY,
    customer_name TEXT NOT NULL,
    plan          TEXT NOT NULL DEFAULT 'pro',
    seats         INTEGER NOT NULL DEFAULT 1,
    created_at    TEXT NOT NULL,
    expires_at    TEXT NOT NULL,
    status        TEXT NOT NULL DEFAULT 'active',
    notes         TEXT
  );
  CREATE INDEX IF NOT EXISTS idx_licenses_status  ON licenses(status);
  CREATE INDEX IF NOT EXISTS idx_licenses_expires ON licenses(expires_at);

  CREATE TABLE IF NOT EXISTS seats (
    id                INTEGER PRIMARY KEY AUTOINCREMENT,
    license_key       TEXT NOT NULL,
    fingerprint       TEXT NOT NULL,
    hostname          TEXT,
    platform          TEXT,
    app_version       TEXT,
    activated_at      TEXT NOT NULL,
    last_verified_at  TEXT NOT NULL,
    deactivated_at    TEXT,
    FOREIGN KEY (license_key) REFERENCES licenses(license_key) ON DELETE CASCADE,
    UNIQUE (license_key, fingerprint)
  );
  CREATE INDEX IF NOT EXISTS idx_seats_license  ON seats(license_key);
  CREATE INDEX IF NOT EXISTS idx_seats_fp       ON seats(fingerprint);
  CREATE INDEX IF NOT EXISTS idx_seats_active   ON seats(license_key, deactivated_at);
`);

runMigrations(db);

module.exports = { db, DB_PATH };
