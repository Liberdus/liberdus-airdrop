const path = require("node:path");

const dotenv = require("dotenv");

const { openDatabase, resolveRepoPath } = require("./lib/db");
const { loadAppConfig } = require("./lib/app-config");
const { createAccountStore } = require("./lib/x-account-store");

const DEFAULT_RECOVERY_CANDIDATES_FILE = path.join("cache", "x", "missing-address-usernames.json");

dotenv.config({ path: path.join(__dirname, "..", ".env"), quiet: true });

function usage() {
  console.error(
    [
      "Usage:",
      "  node backend/import-recovery-candidates.js [--file <candidates.csv|json>] [--imported-at <iso8601>]",
      "",
      "Defaults:",
      `  file: ${DEFAULT_RECOVERY_CANDIDATES_FILE}`,
      "",
      "Behavior:",
      "  - imports a recovery-candidate list into SQLite",
      "  - supports the processed CSV format and the legacy JSON username list",
      "  - marks the latest needs-recovery set on x_accounts",
    ].join("\n"),
  );
}

function parseArgs(argv) {
  const options = {
    filePath: process.env.X_RECOVERY_CANDIDATES_FILE || DEFAULT_RECOVERY_CANDIDATES_FILE,
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
    throw new Error("A recovery-candidate file path is required.");
  }

  return options;
}

function main() {
  const options = parseArgs(process.argv.slice(2));
  const appConfig = loadAppConfig();
  const db = openDatabase();
  const accountStore = createAccountStore(db);
  const resolvedFilePath = resolveRepoPath(options.filePath);
  const result = accountStore.importRecoveryCandidatesFromFile(resolvedFilePath, {
    importedAt: options.importedAt || undefined,
  });
  const stats = accountStore.getStats();

  console.log(`Imported recovery candidates: ${resolvedFilePath}`);
  console.log(`Imported at: ${result.importedAt}`);
  console.log(`Candidates imported: ${result.importedCount}`);
  console.log(`Accounts in DB: ${stats.accountCount}`);
  console.log(`Recovery candidates in DB: ${stats.recoveryCandidateCount}`);
}

try {
  main();
} catch (error) {
  console.error(error.message || String(error));
  usage();
  process.exitCode = 1;
}
