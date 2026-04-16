const fs = require("node:fs");
const path = require("node:path");

const Database = require("better-sqlite3");

const DEFAULT_DB_PATH = path.join("data", "liberdus.sqlite");
const BASE_SCHEMA_VERSION = 1;
function getRepoRoot() {
  return path.resolve(__dirname, "..", "..");
}

function resolveRepoPath(filePath) {
  return path.resolve(getRepoRoot(), filePath);
}

function getDatabasePath() {
  return resolveRepoPath(process.env.LIBERDUS_DB_PATH || DEFAULT_DB_PATH);
}

function ensureDatabaseDirectory(filePath) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
}

function setSchemaVersion(db, version) {
  db.pragma(`user_version = ${Number(version)}`);
}

function initializeSchema(db) {
  db.exec(`
    CREATE TABLE x_accounts (
      id INTEGER PRIMARY KEY,
      x_user_id TEXT UNIQUE,
      username_display TEXT NOT NULL,
      x_account_created_at TEXT,
      is_follower INTEGER NOT NULL DEFAULT 0,
      needs_recovery INTEGER NOT NULL DEFAULT 0,
      wallet_address TEXT,
      wallet_source TEXT CHECK (wallet_source IN ('form', 'recovery')),
      first_seen_following_at TEXT,
      last_seen_following_at TEXT,
      snapshots_seen_count INTEGER NOT NULL DEFAULT 0,
      latest_snapshot_captured_at TEXT,
      snapshot_history_json TEXT NOT NULL DEFAULT '[]',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE INDEX idx_x_accounts_username_lookup
      ON x_accounts(LOWER(username_display));

    CREATE INDEX idx_x_accounts_is_follower
      ON x_accounts(is_follower);

    CREATE INDEX idx_x_accounts_needs_recovery
      ON x_accounts(needs_recovery);

    CREATE TABLE recovery_submissions (
      id TEXT PRIMARY KEY,
      account_id INTEGER REFERENCES x_accounts(id) ON DELETE SET NULL,
      x_user_id TEXT NOT NULL,
      username_at_submission TEXT NOT NULL,
      wallet_address TEXT NOT NULL,
      signed_message TEXT NOT NULL,
      signature TEXT NOT NULL,
      was_known_follower INTEGER NOT NULL DEFAULT 0,
      was_recovery_candidate INTEGER NOT NULL DEFAULT 0,
      status TEXT NOT NULL DEFAULT 'received',
      submitted_at TEXT NOT NULL,
      created_at TEXT NOT NULL
    );

    CREATE INDEX idx_recovery_submissions_account_id
      ON recovery_submissions(account_id);

    CREATE INDEX idx_recovery_submissions_x_user_id
      ON recovery_submissions(x_user_id);

    CREATE INDEX idx_recovery_submissions_wallet_address
      ON recovery_submissions(wallet_address);
  `);
}

function dropKnownTablesAndIndexes(db) {
  db.exec(`
    DROP INDEX IF EXISTS idx_x_accounts_username_norm;
    DROP INDEX IF EXISTS idx_x_accounts_username_lookup;
    DROP INDEX IF EXISTS idx_x_accounts_is_follower;
    DROP INDEX IF EXISTS idx_x_accounts_needs_recovery;
    DROP INDEX IF EXISTS idx_recovery_submissions_account_id;
    DROP INDEX IF EXISTS idx_recovery_submissions_x_user_id;
    DROP INDEX IF EXISTS idx_recovery_submissions_wallet_address;
    DROP TABLE IF EXISTS recovery_submissions;
    DROP TABLE IF EXISTS x_recovery_candidates;
    DROP TABLE IF EXISTS x_recovery_candidate_imports;
    DROP TABLE IF EXISTS x_follower_snapshot_members;
    DROP TABLE IF EXISTS x_follower_snapshots;
    DROP TABLE IF EXISTS x_account_usernames;
    DROP TABLE IF EXISTS x_accounts;
    DROP TABLE IF EXISTS x_accounts_legacy;
  `);
}

function hasCurrentSchema(db) {
  const tableNames = db.prepare(`
    SELECT name
    FROM sqlite_master
    WHERE type = 'table'
      AND name IN ('x_accounts', 'recovery_submissions')
    ORDER BY name
  `).all().map((row) => row.name);

  return tableNames.includes("x_accounts") && tableNames.includes("recovery_submissions");
}

function resetToCurrentSchema(db) {
  dropKnownTablesAndIndexes(db);
  initializeSchema(db);
  setSchemaVersion(db, BASE_SCHEMA_VERSION);
}

function migrateSchema(db) {
  const transaction = db.transaction(() => {
    if (hasCurrentSchema(db)) {
      setSchemaVersion(db, BASE_SCHEMA_VERSION);
      return;
    }

    resetToCurrentSchema(db);
  });

  transaction();
}

function openDatabase() {
  const databasePath = getDatabasePath();
  ensureDatabaseDirectory(databasePath);

  const db = new Database(databasePath);
  db.pragma("journal_mode = WAL");
  db.pragma("synchronous = NORMAL");
  db.pragma("foreign_keys = ON");
  db.pragma("busy_timeout = 5000");
  migrateSchema(db);
  return db;
}

module.exports = {
  DEFAULT_DB_PATH,
  getDatabasePath,
  openDatabase,
  resolveRepoPath,
};
