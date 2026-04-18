const fs = require("node:fs");
const path = require("node:path");

const dotenv = require("dotenv");
const Database = require("better-sqlite3");

const { getDatabasePath, resolveRepoPath } = require("./lib/db");

dotenv.config({ path: path.join(__dirname, "..", ".env"), quiet: true });

function usage() {
  console.error(
    [
      "Usage:",
      "  node backend/backup-db.js [--dir <backup-directory>] [--output <backup-file>] [--label <name>]",
      "",
      "Behavior:",
      "  - creates a consistent SQLite backup using the SQLite backup API",
      "  - defaults to a timestamped file under backups/",
      "  - uses LIBERDUS_DB_PATH when set, otherwise data/liberdus.sqlite",
    ].join("\n"),
  );
}

function parseArgs(argv) {
  const options = {
    outputDir: "backups",
    outputPath: "",
    label: "",
  };
  let sawOutputDir = false;
  let sawOutputPath = false;

  for (let index = 0; index < argv.length; index += 1) {
    const arg = String(argv[index] || "").trim();

    if (arg === "--dir") {
      options.outputDir = String(argv[++index] || "").trim();
      sawOutputDir = true;
      continue;
    }

    if (arg === "--output") {
      options.outputPath = String(argv[++index] || "").trim();
      sawOutputPath = true;
      continue;
    }

    if (arg === "--label") {
      options.label = String(argv[++index] || "").trim();
      continue;
    }

    throw new Error(`Unknown option: ${arg}`);
  }

  if (!options.outputDir && !options.outputPath) {
    throw new Error("Backup output directory cannot be empty.");
  }

  if (sawOutputDir && sawOutputPath) {
    throw new Error("Use either --output or --dir, not both.");
  }

  return options;
}

function formatTimestampForFilename(date = new Date()) {
  const year = String(date.getFullYear());
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  const hours = String(date.getHours()).padStart(2, "0");
  const minutes = String(date.getMinutes()).padStart(2, "0");
  const seconds = String(date.getSeconds()).padStart(2, "0");
  return `${year}${month}${day}-${hours}${minutes}${seconds}`;
}

function sanitizeLabel(label) {
  return String(label || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/gu, "-")
    .replace(/^-+|-+$/gu, "");
}

function resolveOutputPath(sourcePath, options) {
  if (options.outputPath) {
    return path.isAbsolute(options.outputPath)
      ? path.normalize(options.outputPath)
      : resolveRepoPath(options.outputPath);
  }

  const sourceName = path.basename(sourcePath, path.extname(sourcePath));
  const timestamp = formatTimestampForFilename();
  const label = sanitizeLabel(options.label);
  const backupFileName = [sourceName, label, timestamp]
    .filter(Boolean)
    .join("-")
    .concat(".sqlite");

  return resolveRepoPath(path.join(options.outputDir, backupFileName));
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const sourcePath = getDatabasePath();

  if (!fs.existsSync(sourcePath)) {
    throw new Error(`SQLite database was not found at ${sourcePath}`);
  }

  const outputPath = resolveOutputPath(sourcePath, options);
  fs.mkdirSync(path.dirname(outputPath), { recursive: true });

  if (fs.existsSync(outputPath)) {
    throw new Error(`Backup destination already exists: ${outputPath}`);
  }

  const db = new Database(sourcePath, {
    readonly: true,
    fileMustExist: true,
  });

  try {
    const result = await db.backup(outputPath);
    const outputStats = fs.statSync(outputPath);

    console.log(`Source DB: ${sourcePath}`);
    console.log(`Backup file: ${outputPath}`);
    console.log(`Backup size: ${outputStats.size} bytes`);
    console.log(`Pages copied: ${result.totalPages}`);
    console.log("Backup complete.");
  } finally {
    db.close();
  }
}

main().catch((error) => {
  console.error(error.message || String(error));
  usage();
  process.exitCode = 1;
});
