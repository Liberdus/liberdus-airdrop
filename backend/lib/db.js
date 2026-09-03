const fs = require("node:fs");
const path = require("node:path");

const Database = require("better-sqlite3");

const DEFAULT_DB_PATH = path.join("data", "liberdus.sqlite");
const CURRENT_SCHEMA_VERSION = 3;
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

  createAirdropSchema(db);
  createCampaignSchema(db);
}

function createAirdropSchema(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS airdrop_rounds (
      id INTEGER PRIMARY KEY,
      deployment_key TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'deployed')),
      epoch INTEGER,
      merkle_root TEXT NOT NULL,
      deadline INTEGER NOT NULL DEFAULT 0,
      claim_count INTEGER NOT NULL DEFAULT 0,
      total_amount_raw TEXT NOT NULL,
      decimals INTEGER NOT NULL DEFAULT 18,
      chain_id INTEGER NOT NULL,
      contract_address TEXT NOT NULL,
      source_kind TEXT NOT NULL DEFAULT 'manual',
      start_tx_hash TEXT,
      start_block_number INTEGER,
      start_block_hash TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE UNIQUE INDEX IF NOT EXISTS idx_airdrop_rounds_deployment_epoch
      ON airdrop_rounds(deployment_key, epoch)
      WHERE epoch IS NOT NULL;

    CREATE INDEX IF NOT EXISTS idx_airdrop_rounds_deployment_merkle_root
      ON airdrop_rounds(deployment_key, LOWER(merkle_root));

    CREATE INDEX IF NOT EXISTS idx_airdrop_rounds_deployment_contract_epoch
      ON airdrop_rounds(deployment_key, LOWER(contract_address), epoch)
      WHERE epoch IS NOT NULL;

    CREATE INDEX IF NOT EXISTS idx_airdrop_rounds_deployment_status
      ON airdrop_rounds(deployment_key, status, updated_at DESC, id DESC);

    CREATE TABLE IF NOT EXISTS airdrop_claims (
      id INTEGER PRIMARY KEY,
      round_id INTEGER NOT NULL REFERENCES airdrop_rounds(id) ON DELETE CASCADE,
      claim_index INTEGER NOT NULL,
      wallet_address TEXT NOT NULL,
      amount_raw TEXT NOT NULL,
      proof_json TEXT NOT NULL,
      claimed_at TEXT,
      claimed_tx_hash TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE UNIQUE INDEX IF NOT EXISTS idx_airdrop_claims_round_index
      ON airdrop_claims(round_id, claim_index);

    CREATE UNIQUE INDEX IF NOT EXISTS idx_airdrop_claims_round_wallet
      ON airdrop_claims(round_id, LOWER(wallet_address));

    CREATE INDEX IF NOT EXISTS idx_airdrop_claims_wallet_lookup
      ON airdrop_claims(LOWER(wallet_address));

    CREATE INDEX IF NOT EXISTS idx_airdrop_claims_round_lookup
      ON airdrop_claims(round_id, claim_index, id);
  `);
}

function createCampaignSchema(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS social_reward_candidates (
      id INTEGER PRIMARY KEY,
      account_id INTEGER NOT NULL UNIQUE REFERENCES x_accounts(id) ON DELETE CASCADE,
      submitted_x_username TEXT NOT NULL UNIQUE COLLATE NOCASE,
      submitted_wallet_address TEXT NOT NULL,
      submitted_email TEXT,
      submission_json TEXT NOT NULL DEFAULT '{}',
      compliance_status TEXT NOT NULL DEFAULT 'prevalidated',
      x_verification_status TEXT NOT NULL DEFAULT 'pending',
      follower_status TEXT NOT NULL DEFAULT 'pending',
      authenticated_x_user_id TEXT,
      authenticated_x_username TEXT,
      x_verified_at TEXT,
      follower_checked_at TEXT,
      imported_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_social_reward_candidates_wallet
      ON social_reward_candidates(LOWER(submitted_wallet_address));

    CREATE INDEX IF NOT EXISTS idx_social_reward_candidates_x_user_id
      ON social_reward_candidates(authenticated_x_user_id);
  `);
}

function dropKnownTablesAndIndexes(db) {
  db.exec(`
    DROP INDEX IF EXISTS idx_social_reward_candidates_wallet;
    DROP INDEX IF EXISTS idx_social_reward_candidates_x_user_id;
    DROP INDEX IF EXISTS idx_x_accounts_username_norm;
    DROP INDEX IF EXISTS idx_x_accounts_username_lookup;
    DROP INDEX IF EXISTS idx_x_accounts_is_follower;
    DROP INDEX IF EXISTS idx_x_accounts_needs_recovery;
    DROP INDEX IF EXISTS idx_recovery_submissions_account_id;
    DROP INDEX IF EXISTS idx_recovery_submissions_x_user_id;
    DROP INDEX IF EXISTS idx_recovery_submissions_wallet_address;
    DROP INDEX IF EXISTS idx_airdrop_rounds_merkle_root;
    DROP INDEX IF EXISTS idx_airdrop_rounds_contract_epoch;
    DROP INDEX IF EXISTS idx_airdrop_rounds_deployment_epoch;
    DROP INDEX IF EXISTS idx_airdrop_rounds_deployment_merkle_root;
    DROP INDEX IF EXISTS idx_airdrop_rounds_deployment_contract_epoch;
    DROP INDEX IF EXISTS idx_airdrop_rounds_deployment_status;
    DROP INDEX IF EXISTS idx_airdrop_claims_round_index;
    DROP INDEX IF EXISTS idx_airdrop_claims_round_wallet;
    DROP INDEX IF EXISTS idx_airdrop_claims_wallet_lookup;
    DROP INDEX IF EXISTS idx_airdrop_claims_round_lookup;
    DROP TABLE IF EXISTS airdrop_claims;
    DROP TABLE IF EXISTS airdrop_rounds;
    DROP TABLE IF EXISTS airdrop_claims_legacy;
    DROP TABLE IF EXISTS airdrop_rounds_legacy;
    DROP TABLE IF EXISTS social_reward_candidates;
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

function tableExists(db, tableName) {
  const row = db.prepare(`
    SELECT name
    FROM sqlite_master
    WHERE type = 'table'
      AND name = ?
    LIMIT 1
  `).get(tableName);

  return Boolean(row);
}

function getTableColumnNames(db, tableName) {
  if (!tableExists(db, tableName)) {
    return [];
  }

  return db.prepare(`PRAGMA table_info(${tableName})`).all().map((row) => String(row.name || ""));
}

function hasCurrentSchema(db) {
  const tableNames = db.prepare(`
    SELECT name
    FROM sqlite_master
    WHERE type = 'table'
      AND name IN ('x_accounts', 'recovery_submissions', 'airdrop_rounds', 'airdrop_claims')
    ORDER BY name
  `).all().map((row) => row.name);

  const airdropRoundColumns = getTableColumnNames(db, "airdrop_rounds");
  const airdropClaimColumns = getTableColumnNames(db, "airdrop_claims");

  return tableNames.includes("x_accounts")
    && tableNames.includes("recovery_submissions")
    && tableNames.includes("airdrop_rounds")
    && tableNames.includes("airdrop_claims")
    && airdropRoundColumns.includes("deployment_key")
    && airdropRoundColumns.includes("status")
    && airdropClaimColumns.includes("id")
    && airdropClaimColumns.includes("updated_at");
}

function resetToCurrentSchema(db) {
  dropKnownTablesAndIndexes(db);
  initializeSchema(db);
  setSchemaVersion(db, CURRENT_SCHEMA_VERSION);
}

function migrateAirdropSchemaV2(db) {
  const roundColumns = getTableColumnNames(db, "airdrop_rounds");
  const claimColumns = getTableColumnNames(db, "airdrop_claims");

  if (
    roundColumns.includes("status")
    && claimColumns.includes("id")
    && claimColumns.includes("updated_at")
  ) {
    return;
  }

  if (!roundColumns.includes("deployment_key")) {
    db.exec(`
      DROP INDEX IF EXISTS idx_airdrop_rounds_merkle_root;
      DROP INDEX IF EXISTS idx_airdrop_rounds_contract_epoch;
      DROP INDEX IF EXISTS idx_airdrop_rounds_deployment_epoch;
      DROP INDEX IF EXISTS idx_airdrop_rounds_deployment_merkle_root;
      DROP INDEX IF EXISTS idx_airdrop_rounds_deployment_contract_epoch;
      DROP INDEX IF EXISTS idx_airdrop_claims_round_wallet;
      DROP INDEX IF EXISTS idx_airdrop_claims_wallet_lookup;
      DROP TABLE IF EXISTS airdrop_claims;
      DROP TABLE IF EXISTS airdrop_rounds;
    `);
    createAirdropSchema(db);
    return;
  }

  db.exec(`
    ALTER TABLE airdrop_rounds RENAME TO airdrop_rounds_legacy_v1;
    ALTER TABLE airdrop_claims RENAME TO airdrop_claims_legacy_v1;
  `);
  createAirdropSchema(db);

  db.exec(`
    INSERT INTO airdrop_rounds (
      id,
      deployment_key,
      status,
      epoch,
      merkle_root,
      deadline,
      claim_count,
      total_amount_raw,
      decimals,
      chain_id,
      contract_address,
      source_kind,
      start_tx_hash,
      start_block_number,
      start_block_hash,
      created_at,
      updated_at
    )
    SELECT
      id,
      deployment_key,
      'deployed',
      epoch,
      merkle_root,
      deadline,
      claim_count,
      total_amount_raw,
      decimals,
      chain_id,
      contract_address,
      source_kind,
      start_tx_hash,
      start_block_number,
      start_block_hash,
      created_at,
      updated_at
    FROM airdrop_rounds_legacy_v1;

    INSERT INTO airdrop_claims (
      round_id,
      claim_index,
      wallet_address,
      amount_raw,
      proof_json,
      claimed_at,
      claimed_tx_hash,
      created_at,
      updated_at
    )
    SELECT
      round_id,
      claim_index,
      wallet_address,
      amount_raw,
      proof_json,
      NULL,
      NULL,
      created_at,
      created_at
    FROM airdrop_claims_legacy_v1;

    DROP TABLE IF EXISTS airdrop_claims_legacy_v1;
    DROP TABLE IF EXISTS airdrop_rounds_legacy_v1;
  `);
}

function migrateSchema(db) {
  if (hasCurrentSchema(db)) {
    createCampaignSchema(db);
    setSchemaVersion(db, CURRENT_SCHEMA_VERSION);
    return;
  }

  const hasAccountTables = tableExists(db, "x_accounts") && tableExists(db, "recovery_submissions");
  const hasAirdropTables = tableExists(db, "airdrop_rounds") && tableExists(db, "airdrop_claims");

  if (!hasAccountTables && !hasAirdropTables) {
    initializeSchema(db);
    setSchemaVersion(db, CURRENT_SCHEMA_VERSION);
    return;
  }

  if (!hasAccountTables) {
    resetToCurrentSchema(db);
    return;
  }

  if (!hasAirdropTables) {
    createAirdropSchema(db);
    createCampaignSchema(db);
    setSchemaVersion(db, CURRENT_SCHEMA_VERSION);
    return;
  }

  migrateAirdropSchemaV2(db);
  createCampaignSchema(db);
  setSchemaVersion(db, CURRENT_SCHEMA_VERSION);
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
