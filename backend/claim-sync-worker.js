const path = require("node:path");

const dotenv = require("dotenv");

const { openDatabase, getDatabasePath } = require("./lib/db");
const { loadAppConfig } = require("./lib/app-config");
const { createAirdropRoundStore } = require("./lib/airdrop-round-store");
const { createClaimSyncService } = require("./lib/claim-sync");

dotenv.config({ path: path.join(__dirname, "..", ".env"), quiet: true });

function createWorkerLogger() {
  return {
    info(message) {
      console.log(`[claim-sync-worker] ${message}`);
    },
    warn(message) {
      console.warn(`[claim-sync-worker] ${message}`);
    },
    error(message) {
      console.error(`[claim-sync-worker] ${message}`);
    },
  };
}

const logger = createWorkerLogger();
const appConfig = loadAppConfig();
const db = openDatabase();
const airdropRoundStore = createAirdropRoundStore(db);

let claimSyncService = null;

try {
  claimSyncService = createClaimSyncService({
    appConfig,
    airdropRoundStore,
    logger,
  });
} catch (error) {
  logger.warn(`claim sync is idle: ${error?.message || error}`);
}

if (claimSyncService) {
  const config = claimSyncService.getConfig();
  logger.info(`SQLite path: ${getDatabasePath()}`);
  logger.info(`deployment key: ${config.deploymentKey || "(missing)"}`);
  claimSyncService.start();
}

function shutdown(signal) {
  if (claimSyncService) {
    claimSyncService.stop();
  }

  try {
    db.close();
  } catch {
    // Ignore shutdown cleanup failures.
  }

  logger.info(`stopped on ${signal}`);
  process.exit(0);
}

process.on("SIGINT", () => shutdown("SIGINT"));
process.on("SIGTERM", () => shutdown("SIGTERM"));
