const fs = require("node:fs");
const path = require("node:path");

const { ethers } = require("ethers");

const HARDHAT_DEFAULT_MNEMONIC = "test test test test test test test test test test test junk";

function usage() {
  console.error(
    [
      "Usage:",
      "  node scripts/generate-test-claims.js [--start-epoch <n>] [--rounds <n>] [--claims-per-round <n>] [--output-dir <dir>]",
      "",
      "Defaults:",
      "  start-epoch: 1",
      "  rounds: 10",
      "  claims-per-round: 5",
      "  output-dir: frontend/claims/generated",
    ].join("\n"),
  );
}

function deriveHardhatAddresses(count) {
  return Array.from({ length: count }, (_, index) => {
    const wallet = ethers.HDNodeWallet.fromPhrase(
      HARDHAT_DEFAULT_MNEMONIC,
      undefined,
      `m/44'/60'/0'/0/${index}`,
    );
    return wallet.address;
  });
}

function parseArgs(argv) {
  const options = {
    startEpoch: 1,
    rounds: 10,
    claimsPerRound: 5,
    outputDir: path.join("frontend", "claims", "generated"),
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];

    if (arg === "--start-epoch") {
      options.startEpoch = Number(argv[++i]);
      continue;
    }

    if (arg === "--rounds") {
      options.rounds = Number(argv[++i]);
      continue;
    }

    if (arg === "--claims-per-round") {
      options.claimsPerRound = Number(argv[++i]);
      continue;
    }

    if (arg === "--output-dir") {
      options.outputDir = argv[++i] || options.outputDir;
      continue;
    }

    throw new Error(`Unknown option: ${arg}`);
  }

  if (!Number.isInteger(options.startEpoch) || options.startEpoch < 1) {
    throw new Error("--start-epoch must be a positive integer.");
  }

  if (!Number.isInteger(options.rounds) || options.rounds < 1) {
    throw new Error("--rounds must be a positive integer.");
  }

  if (!Number.isInteger(options.claimsPerRound) || options.claimsPerRound < 1) {
    throw new Error("--claims-per-round must be a positive integer.");
  }

  return options;
}

function buildAmount(roundOffset, claimOffset) {
  const whole = 100 + (roundOffset * 37) + (claimOffset * 19);
  const tenths = (roundOffset + claimOffset) % 10;
  return tenths === 0 ? String(whole) : `${whole}.${tenths}`;
}

function buildRound(epoch, roundOffset, claimsPerRound) {
  const claims = [];
  const hardhatAddresses = deriveHardhatAddresses(Math.max(claimsPerRound, 10));

  for (let claimOffset = 0; claimOffset < claimsPerRound; claimOffset += 1) {
    const addressIndex = (roundOffset + claimOffset) % hardhatAddresses.length;
    claims.push({
      index: claimOffset,
      account: hardhatAddresses[addressIndex],
      amount: buildAmount(roundOffset, claimOffset),
    });
  }

  return {
    epoch,
    claims,
  };
}

function writeJson(filePath, value) {
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`);
}

function main() {
  const options = parseArgs(process.argv.slice(2));
  const repoRoot = path.join(__dirname, "..");
  const outputDir = path.resolve(repoRoot, options.outputDir);

  fs.mkdirSync(outputDir, { recursive: true });

  const manifest = { rounds: [] };

  for (let roundOffset = 0; roundOffset < options.rounds; roundOffset += 1) {
    const epoch = options.startEpoch + roundOffset;
    const round = buildRound(epoch, roundOffset, options.claimsPerRound);
    const fileName = `generated-round-${epoch}.claims.json`;
    writeJson(path.join(outputDir, fileName), round.claims);
    manifest.rounds.push({
      epoch,
      file: `./${fileName}`,
    });
  }

  writeJson(path.join(outputDir, "index.json"), manifest);

  console.log(`Wrote ${options.rounds} generated claim rounds to ${outputDir}`);
  console.log(`Manifest: ${path.join(outputDir, "index.json")}`);
}

try {
  main();
} catch (error) {
  console.error(error.message || String(error));
  usage();
  process.exitCode = 1;
}
