const path = require("node:path");

const dotenv = require("dotenv");

const { openDatabase, resolveRepoPath } = require("./lib/db");
const { createAccountStore } = require("./lib/x-account-store");
const { createRecoverySubmissionStore } = require("./lib/recovery-submission-store");

const DEFAULT_RECOVERY_STORE_FILE = path.join("cache", "x", "recovery-links.json");

dotenv.config({ path: path.join(__dirname, "..", ".env"), quiet: true });

function usage() {
  console.error(
    [
      "Usage:",
      "  node backend/import-recovery-submissions.js [--file <recovery-links.json>]",
      "",
      "Defaults:",
      `  file: ${DEFAULT_RECOVERY_STORE_FILE}`,
      "",
      "Behavior:",
      "  - imports legacy recovery-links.json rows into SQLite",
      "  - keeps future runtime submissions in recovery_submissions",
    ].join("\n"),
  );
}

function parseArgs(argv) {
  const options = {
    filePath: process.env.X_RECOVERY_STORE_FILE || DEFAULT_RECOVERY_STORE_FILE,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];

    if (arg === "--file") {
      options.filePath = String(argv[++index] || "").trim();
      continue;
    }

    throw new Error(`Unknown option: ${arg}`);
  }

  if (!options.filePath) {
    throw new Error("A recovery submissions file path is required.");
  }

  return options;
}

function main() {
  const options = parseArgs(process.argv.slice(2));
  const db = openDatabase();
  const accountStore = createAccountStore(db);
  const submissionStore = createRecoverySubmissionStore(db);
  const resolvedFilePath = resolveRepoPath(options.filePath);
  const result = submissionStore.importLegacyStore(resolvedFilePath, accountStore);
  const stats = submissionStore.getStats();

  console.log(`Imported recovery submissions: ${result.sourceFilePath}`);
  console.log(`New submissions imported: ${result.importedCount}`);
  console.log(`Recovery submissions in DB: ${stats.submissionCount}`);
}

try {
  main();
} catch (error) {
  console.error(error.message || String(error));
  usage();
  process.exitCode = 1;
}
