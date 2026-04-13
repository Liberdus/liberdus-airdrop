const fs = require("node:fs");
const path = require("node:path");
const { ethers } = require("ethers");

const LEAF_TYPES = ["uint256", "address", "uint256"];
const DAY_IN_SECONDS = 24 * 60 * 60;
const DEFAULT_DECIMALS = 18;
const DEFAULT_RPC_URL = "http://127.0.0.1:8545";

function compareHex(left, right) {
  const leftValue = BigInt(left);
  const rightValue = BigInt(right);

  if (leftValue === rightValue) return 0;
  return leftValue < rightValue ? -1 : 1;
}

function hashLeaf(index, account, amountRaw) {
  const encoded = ethers.AbiCoder.defaultAbiCoder().encode(LEAF_TYPES, [index, account, amountRaw]);
  return ethers.keccak256(ethers.keccak256(encoded));
}

function hashPair(left, right) {
  const ordered = compareHex(left, right) <= 0 ? [left, right] : [right, left];
  return ethers.keccak256(ethers.concat(ordered));
}

function trimFormattedUnits(value) {
  return value.includes(".") ? value.replace(/\.?0+$/, "") : value;
}

function loadJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function normalizeClaims(rawClaims) {
  if (!Array.isArray(rawClaims) || rawClaims.length === 0) {
    throw new Error("Claims file must contain at least one claim.");
  }

  return rawClaims.map((entry, idx) => {
    if (!ethers.isAddress(entry.account)) {
      throw new Error(`Claim ${idx} has an invalid account.`);
    }

    const account = ethers.getAddress(entry.account);
    const index = BigInt(entry.index);
    const amountRaw = entry.amountRaw != null && String(entry.amountRaw).trim() !== ""
      ? BigInt(entry.amountRaw)
      : ethers.parseUnits(String(entry.amount), DEFAULT_DECIMALS);

    return {
      index,
      account,
      amountRaw,
    };
  });
}

function buildClaimSummary(rawClaims) {
  const claims = normalizeClaims(rawClaims);
  const hashedValues = claims
    .map((claim) => hashLeaf(claim.index, claim.account, claim.amountRaw))
    .sort(compareHex);

  const tree = new Array((2 * hashedValues.length) - 1);

  for (const [leafIndex, hash] of hashedValues.entries()) {
    tree[tree.length - 1 - leafIndex] = hash;
  }

  for (let treeIndex = tree.length - hashedValues.length - 1; treeIndex >= 0; treeIndex -= 1) {
    tree[treeIndex] = hashPair(tree[(2 * treeIndex) + 1], tree[(2 * treeIndex) + 2]);
  }

  const totalAmountRaw = claims.reduce((total, claim) => total + claim.amountRaw, 0n);

  return {
    root: tree[0],
    totalAmountRaw,
    totalAmount: trimFormattedUnits(ethers.formatUnits(totalAmountRaw, DEFAULT_DECIMALS)),
    claimCount: claims.length,
  };
}

async function main() {
  const repoRoot = path.join(__dirname, "..");
  const configPath = path.join(repoRoot, "frontend", "config.local.json");
  const manifestPath = path.join(repoRoot, "frontend", "claims", "index.json");

  const config = loadJson(configPath);
  const manifest = loadJson(manifestPath);

  const provider = new ethers.JsonRpcProvider(config.rpcUrl || DEFAULT_RPC_URL);
  const signer = await provider.getSigner(0);

  const airdropAbi = [
    "function currentEpoch() view returns (uint256)",
    "function startNewAirdrop(bytes32 newRoot, uint256 deadline)",
  ];
  const tokenAbi = [
    "function mint(address to, uint256 amount)",
    "function transfer(address to, uint256 amount) returns (bool)",
  ];

  const airdrop = new ethers.Contract(config.airdropAddress, airdropAbi, signer);
  const token = new ethers.Contract(config.tokenAddress, tokenAbi, signer);

  const currentEpoch = Number(await airdrop.currentEpoch());
  const pendingRounds = (manifest.rounds || [])
    .filter((round) => Number.isInteger(round.epoch) && round.epoch > currentEpoch)
    .sort((left, right) => left.epoch - right.epoch);

  if (pendingRounds.length === 0) {
    console.log(`No undeployed rounds found. Current epoch is ${currentEpoch}.`);
    return;
  }

  const latestBlock = await provider.getBlock("latest");
  let baseDeadline = Number(latestBlock.timestamp) + DAY_IN_SECONDS;

  for (const round of pendingRounds) {
    const claimsPath = path.join(repoRoot, "frontend", "claims", path.basename(round.file));
    const rawClaims = loadJson(claimsPath);
    const summary = buildClaimSummary(rawClaims);
    const deadline = baseDeadline;

    console.log(`Starting epoch ${round.epoch} from ${path.basename(claimsPath)}`);
    console.log(`  root:   ${summary.root}`);
    console.log(`  claims: ${summary.claimCount}`);
    console.log(`  total:  ${summary.totalAmount} LIB`);
    console.log(`  deadline: ${deadline}`);

    const startTx = await airdrop.startNewAirdrop(summary.root, deadline);
    await startTx.wait();

    const mintTx = await token.mint(await signer.getAddress(), summary.totalAmountRaw);
    await mintTx.wait();

    const fundTx = await token.transfer(config.airdropAddress, summary.totalAmountRaw);
    await fundTx.wait();

    baseDeadline += DAY_IN_SECONDS;
  }

  console.log(`Deployed ${pendingRounds.length} additional rounds.`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
