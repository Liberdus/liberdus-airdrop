const fs = require("node:fs");
const path = require("node:path");

const dotenv = require("dotenv");

const { openDatabase, resolveRepoPath } = require("./lib/db");
const { loadAppConfig, requireChainConfig } = require("./lib/app-config");
const { buildClaimRound } = require("./lib/claim-round");
const { createAirdropRoundStore } = require("./lib/airdrop-round-store");
const { fetchEpochMetadata } = require("./lib/airdrop-chain");

dotenv.config({ path: path.join(__dirname, "..", ".env"), quiet: true });

function normalizeClaimCatalog(rawCatalog) {
  const sourceRows = Array.isArray(rawCatalog)
    ? rawCatalog
    : rawCatalog?.epochs || rawCatalog?.rounds || rawCatalog?.claims || [];

  if (!Array.isArray(sourceRows)) {
    throw new Error("Claims catalog must be an array or an object with an epochs array.");
  }

  return sourceRows.map((row, idx) => {
    const epoch = Number(row?.epoch);
    if (!Number.isInteger(epoch) || epoch <= 0) {
      throw new Error(`Claims catalog row ${idx} has an invalid epoch.`);
    }

    const file = String(row?.file || row?.path || row?.url || "").trim();
    if (!file) {
      throw new Error(`Claims catalog row ${idx} is missing a file path.`);
    }

    return { epoch, file };
  });
}

function usage(defaultManifestPath) {
  console.error(
    [
      "Usage:",
      "  node backend/import-claim-rounds.js [--manifest <manifest.json>] [--decimals <tokenDecimals>]",
      "",
      "Defaults:",
      `  manifest: ${defaultManifestPath || "(missing)"}`,
      "",
      "Behavior:",
      "  - imports file-backed claim rounds into SQLite",
      "  - recomputes the Merkle root and proofs from each claims file",
      "  - enriches deadline data from chain when the imported root matches the live epoch",
    ].join("\n"),
  );
}

function parseArgs(argv, defaultManifestPath) {
  const options = {
    manifestPath: defaultManifestPath,
    decimals: null,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];

    if (arg === "--manifest") {
      options.manifestPath = String(argv[++index] || "").trim();
      continue;
    }

    if (arg === "--decimals") {
      options.decimals = Number.parseInt(String(argv[++index] || "").trim(), 10);
      continue;
    }

    throw new Error(`Unknown option: ${arg}`);
  }

  if (!options.manifestPath) {
    throw new Error("A claims manifest path is required.");
  }

  return options;
}

async function main() {
  const appConfig = loadAppConfig();
  const defaultManifestPath = path.join("frontend", "claims", "index.json");
  const options = parseArgs(process.argv.slice(2), defaultManifestPath);
  const manifestPath = resolveRepoPath(options.manifestPath);
  const manifestDir = path.dirname(manifestPath);
  const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
  const catalog = normalizeClaimCatalog(manifest);
  const tokenDecimals = Number.isInteger(options.decimals) ? options.decimals : Number(appConfig.tokenDecimals || 18);
  const chainConfig = requireChainConfig(appConfig);

  const db = openDatabase();
  const roundStore = createAirdropRoundStore(db);

  let importedCount = 0;
  for (const source of catalog) {
    const sourcePath = path.resolve(manifestDir, source.file);
    const rawClaims = JSON.parse(fs.readFileSync(sourcePath, "utf8"));
    const builtRound = buildClaimRound(rawClaims, tokenDecimals);

    let deadline = 0;
    try {
      const onchain = await fetchEpochMetadata(chainConfig, source.epoch);
      if (onchain.merkleRoot === builtRound.root.toLowerCase()) {
        deadline = onchain.deadline;
      }
    } catch {
      deadline = 0;
    }

    roundStore.upsertRound({
      deploymentKey: appConfig.deploymentKey,
      epoch: source.epoch,
      merkleRoot: builtRound.root,
      deadline,
      claimCount: builtRound.claimCount,
      totalAmountRaw: builtRound.totalAmountRaw,
      decimals: builtRound.decimals,
      chainId: chainConfig.chainId,
      contractAddress: chainConfig.airdropAddress,
      sourceKind: "imported-file",
      claims: builtRound.claims,
      updatedAt: new Date().toISOString(),
    });
    importedCount += 1;
  }

  const stats = roundStore.getStats(appConfig.deploymentKey);
  console.log(`Imported claim manifest: ${manifestPath}`);
  console.log(`Deployment key: ${appConfig.deploymentKey || "(missing)"}`);
  console.log(`Rounds imported: ${importedCount}`);
  console.log(`Airdrop rounds in current deployment: ${stats.roundCount}`);
  console.log(`Airdrop claims in current deployment: ${stats.claimCount}`);
}

main().catch((error) => {
  usage(path.join("frontend", "claims", "index.json"));
  console.error(error.message || String(error));
  process.exitCode = 1;
});
