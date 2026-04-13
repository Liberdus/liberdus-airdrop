const fs = require("node:fs");
const path = require("node:path");

function usage() {
  console.error(
    [
      "Usage:",
      "  node scripts/publish-frontend-config.js --env <test|prod>",
      "",
      "Copies frontend/config.<env>.json to frontend/config.json.",
    ].join("\n"),
  );
}

function parseArgs(argv) {
  let env = "";

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];

    if (arg === "--env") {
      env = String(argv[++i] || "").trim().toLowerCase();
      continue;
    }

    throw new Error(`Unknown option: ${arg}`);
  }

  if (env !== "test" && env !== "prod") {
    throw new Error("--env must be either test or prod.");
  }

  return { env };
}

function main() {
  const { env } = parseArgs(process.argv.slice(2));
  const repoRoot = path.join(__dirname, "..");
  const frontendDir = path.join(repoRoot, "frontend");
  const sourcePath = path.join(frontendDir, `config.${env}.json`);
  const targetPath = path.join(frontendDir, "config.json");

  if (!fs.existsSync(sourcePath)) {
    throw new Error(`Missing source config: ${sourcePath}`);
  }

  const contents = fs.readFileSync(sourcePath, "utf8");
  JSON.parse(contents);
  fs.writeFileSync(targetPath, contents.endsWith("\n") ? contents : `${contents}\n`);

  console.log(`Wrote ${targetPath} from ${sourcePath}`);
}

try {
  main();
} catch (error) {
  console.error(error.message || String(error));
  usage();
  process.exitCode = 1;
}
