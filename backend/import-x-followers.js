const path = require("node:path");

const dotenv = require("dotenv");

const { openDatabase, resolveRepoPath } = require("./lib/db");
const { createAccountStore } = require("./lib/x-account-store");

const DEFAULT_FOLLOWER_SNAPSHOT_FILE = path.join("cache", "x", "liberdus-followers.json");

dotenv.config({ path: path.join(__dirname, "..", ".env"), quiet: true });

function usage() {
  console.error(
    [
      "Usage:",
      "  node backend/import-x-followers.js [--file <snapshot.json>] [--imported-at <iso8601>]",
      "",
      "Defaults:",
      `  file: ${DEFAULT_FOLLOWER_SNAPSHOT_FILE}`,
      "",
      "Behavior:",
      "  - imports a raw follower snapshot JSON into SQLite",
      "  - upserts the latest follower state on x_accounts",
      "  - updates per-account snapshot rollups for follower longevity",
    ].join("\n"),
  );
}

function parseArgs(argv) {
  const options = {
    filePath: process.env.X_FOLLOWER_SNAPSHOT_FILE || DEFAULT_FOLLOWER_SNAPSHOT_FILE,
    importedAt: "",
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];

    if (arg === "--file") {
      options.filePath = String(argv[++index] || "").trim();
      continue;
    }

    if (arg === "--imported-at") {
      options.importedAt = String(argv[++index] || "").trim();
      continue;
    }

    throw new Error(`Unknown option: ${arg}`);
  }

  if (!options.filePath) {
    throw new Error("A follower snapshot file path is required.");
  }

  return options;
}

function main() {
  const options = parseArgs(process.argv.slice(2));
  const db = openDatabase();
  const accountStore = createAccountStore(db);
  const resolvedFilePath = resolveRepoPath(options.filePath);
  const result = accountStore.importFollowerSnapshotFromFile(resolvedFilePath, {
    importedAt: options.importedAt || undefined,
  });
  const stats = accountStore.getStats();

  console.log(`Imported follower snapshot: ${resolvedFilePath}`);
  console.log(`Captured at: ${result.capturedAt}`);
  console.log(`Accounts processed: ${result.importedCount}`);
  console.log(`Became latest snapshot: ${result.becameLatest ? "yes" : "no"}`);
  console.log(`Accounts in DB: ${stats.accountCount}`);
  console.log(`Current followers in DB: ${stats.followerCount}`);
  console.log(`Latest snapshot captured at: ${stats.latestSnapshotCapturedAt || "(none)"}`);
}

try {
  main();
} catch (error) {
  console.error(error.message || String(error));
  usage();
  process.exitCode = 1;
}
