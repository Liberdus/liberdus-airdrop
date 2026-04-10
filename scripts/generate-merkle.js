const fs = require("node:fs");
const path = require("node:path");
const { ethers } = require("ethers");
const { StandardMerkleTree } = require("@openzeppelin/merkle-tree");

const LEAF_TYPES = ["uint256", "address", "uint256"];

function usage() {
  console.error(
    [
      "Usage:",
      "  npm run merkle -- <claims.json> [--out <output.json>] [--decimals <n>] [--stdout]",
      "",
      "Input format:",
      "  - an array of claim objects",
      "  - or an object with a top-level `claims` array",
      "",
      "Each claim must include:",
      "  - index",
      "  - account",
      "  - amount (human units) or amountRaw (base units)",
    ].join("\n"),
  );
}

function parseArgs(argv) {
  const options = {
    inputPath: "",
    outputPath: "",
    decimals: 18,
    stdout: false,
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];

    if (arg === "--out") {
      i += 1;
      options.outputPath = argv[i] || "";
      continue;
    }

    if (arg === "--decimals") {
      i += 1;
      const value = Number(argv[i]);
      if (!Number.isInteger(value) || value < 0) {
        throw new Error("`--decimals` must be a non-negative integer.");
      }
      options.decimals = value;
      continue;
    }

    if (arg === "--stdout") {
      options.stdout = true;
      continue;
    }

    if (arg.startsWith("--")) {
      throw new Error(`Unknown option: ${arg}`);
    }

    if (options.inputPath) {
      throw new Error("Only one input file can be provided.");
    }

    options.inputPath = arg;
  }

  if (!options.inputPath) {
    throw new Error("An input JSON file is required.");
  }

  return options;
}

function loadClaims(filePath) {
  const raw = JSON.parse(fs.readFileSync(filePath, "utf8"));

  if (Array.isArray(raw)) return raw;
  if (raw && Array.isArray(raw.claims)) return raw.claims;

  throw new Error("Input JSON must be an array or an object with a `claims` array.");
}

function normalizeClaims(claims, decimals) {
  if (!Array.isArray(claims) || claims.length === 0) {
    throw new Error("Claims input must contain at least one claim.");
  }

  const seenIndexes = new Set();

  return claims.map((entry, idx) => {
    if (!entry || typeof entry !== "object") {
      throw new Error(`Claim ${idx} is not an object.`);
    }

    const index = BigInt(entry.index);
    if (index < 0n) {
      throw new Error(`Claim ${idx} has a negative index.`);
    }

    const indexKey = index.toString();
    if (seenIndexes.has(indexKey)) {
      throw new Error(`Duplicate claim index detected: ${indexKey}`);
    }
    seenIndexes.add(indexKey);

    if (!ethers.isAddress(entry.account)) {
      throw new Error(`Claim ${idx} has an invalid account.`);
    }

    const account = ethers.getAddress(entry.account);
    let amountRaw;
    let amountDisplay;

    if (entry.amountRaw != null) {
      amountRaw = BigInt(entry.amountRaw);
      amountDisplay = entry.amount != null
        ? String(entry.amount)
        : ethers.formatUnits(amountRaw, decimals);
    } else if (entry.amount != null) {
      amountDisplay = String(entry.amount);
      amountRaw = ethers.parseUnits(amountDisplay, decimals);
    } else {
      throw new Error(`Claim ${idx} must include either amount or amountRaw.`);
    }

    if (amountRaw < 0n) {
      throw new Error(`Claim ${idx} has a negative amount.`);
    }

    return {
      index,
      account,
      amount: amountDisplay,
      amountRaw,
    };
  });
}

function buildOutput(claims, sourcePath, decimals) {
  const values = claims.map((claim) => [
    claim.index.toString(),
    claim.account,
    claim.amountRaw.toString(),
  ]);

  const tree = StandardMerkleTree.of(values, LEAF_TYPES);
  const proofsByIndex = new Map();

  for (const [treeIndex, value] of tree.entries()) {
    proofsByIndex.set(value[0], tree.getProof(treeIndex));
  }

  return {
    root: tree.root,
    leafEncoding: LEAF_TYPES,
    decimals,
    generatedAt: new Date().toISOString(),
    sourceFile: path.basename(sourcePath),
    claims: claims.map((claim) => ({
      index: claim.index.toString(),
      account: claim.account,
      amount: claim.amount,
      amountRaw: claim.amountRaw.toString(),
      proof: proofsByIndex.get(claim.index.toString()) || [],
    })),
  };
}

function defaultOutputPath(inputPath) {
  const parsed = path.parse(inputPath);
  return path.join(parsed.dir, `${parsed.name}.merkle.json`);
}

function main() {
  const options = parseArgs(process.argv.slice(2));
  const resolvedInput = path.resolve(options.inputPath);
  const normalizedClaims = normalizeClaims(loadClaims(resolvedInput), options.decimals);
  const output = buildOutput(normalizedClaims, resolvedInput, options.decimals);

  if (options.stdout) {
    process.stdout.write(`${JSON.stringify(output, null, 2)}\n`);
    return;
  }

  const resolvedOutput = path.resolve(options.outputPath || defaultOutputPath(resolvedInput));
  fs.writeFileSync(resolvedOutput, `${JSON.stringify(output, null, 2)}\n`);

  console.log(`Merkle root: ${output.root}`);
  console.log(`Wrote proof file: ${resolvedOutput}`);
}

try {
  main();
} catch (error) {
  console.error(error.message || String(error));
  usage();
  process.exitCode = 1;
}
