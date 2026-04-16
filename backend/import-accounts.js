const path = require("node:path");

const dotenv = require("dotenv");

const { openDatabase, resolveRepoPath } = require("./lib/db");
const { createAccountStore } = require("./lib/x-account-store");

dotenv.config({ path: path.join(__dirname, "..", ".env"), quiet: true });

function usage() {
  console.error(
    [
      "Usage:",
      "  node backend/import-accounts.js --file <combined-accounts.csv> [--imported-at <iso8601>]",
      "",
      "Behavior:",
      "  - imports a combined follower/form-response CSV into SQLite",
      "  - updates follower flags, recovery flags, and form wallets on x_accounts",
      "  - keeps existing recovery submissions intact",
    ].join("\n"),
  );
}

function parseArgs(argv) {
  const options = {
    filePath: "",
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
    throw new Error("A combined accounts CSV file path is required.");
  }

  return options;
}

function main() {
  const options = parseArgs(process.argv.slice(2));
  const db = openDatabase();
  const accountStore = createAccountStore(db);
  const resolvedFilePath = resolveRepoPath(options.filePath);
  const result = accountStore.importCombinedAccountsFromFile(resolvedFilePath, {
    importedAt: options.importedAt || undefined,
  });
  const stats = accountStore.getStats();

  console.log(`Imported combined accounts: ${resolvedFilePath}`);
  console.log(`Imported at: ${result.importedAt}`);
  console.log(`Accounts imported: ${result.importedCount}`);
  console.log(`Accounts in DB: ${stats.accountCount}`);
  console.log(`Current followers in DB: ${stats.followerCount}`);
  console.log(`Recovery candidates in DB: ${stats.recoveryCandidateCount}`);
  console.log(`Latest snapshot captured at: ${stats.latestSnapshotCapturedAt || "(none)"}`);
}

try {
  main();
} catch (error) {
  console.error(error.message || String(error));
  usage();
  process.exitCode = 1;
}
