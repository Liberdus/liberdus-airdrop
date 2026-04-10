import { ethers } from "./ethers.js";
import { normalizeAddress, parseHumanAmount, parseRequiredBigInt } from "./format.js";

export const STANDARD_MERKLE_LEAF_TYPES = ["uint256", "address", "uint256"];

function compareHex(left, right) {
  const leftValue = BigInt(left);
  const rightValue = BigInt(right);

  if (leftValue === rightValue) return 0;
  return leftValue < rightValue ? -1 : 1;
}

function trimFormattedUnits(value) {
  return value.includes(".") ? value.replace(/\.?0+$/, "") : value;
}

function hashLeaf(index, account, amountRaw) {
  const encoded = ethers.AbiCoder.defaultAbiCoder().encode(
    STANDARD_MERKLE_LEAF_TYPES,
    [index, account, amountRaw],
  );

  return ethers.keccak256(ethers.keccak256(encoded));
}

function hashPair(left, right) {
  const ordered = compareHex(left, right) <= 0 ? [left, right] : [right, left];
  return ethers.keccak256(ethers.concat(ordered));
}

export function normalizeClaimsInput(rawInput, tokenDecimals) {
  const rawClaims = Array.isArray(rawInput)
    ? rawInput
    : rawInput?.claims;

  if (!Array.isArray(rawClaims)) {
    throw new Error("Claims JSON must be an array or an object with a claims array.");
  }

  if (rawClaims.length === 0) {
    throw new Error("Claims array is empty.");
  }

  const seenIndexes = new Set();
  const seenAccounts = new Set();

  return rawClaims.map((entry, idx) => {
    if (!entry || typeof entry !== "object") {
      throw new Error(`Claim ${idx} must be an object.`);
    }

    const index = parseRequiredBigInt(entry.index, `Claim ${idx} index`);
    if (index < 0n) {
      throw new Error(`Claim ${idx} index cannot be negative.`);
    }

    const indexKey = index.toString();
    if (seenIndexes.has(indexKey)) {
      throw new Error(`Claim ${idx} reuses index ${indexKey}. Each index must be unique.`);
    }
    seenIndexes.add(indexKey);

    const account = normalizeAddress(entry.account);
    if (!account || account === ethers.ZeroAddress) {
      throw new Error(`Claim ${idx} has an invalid account.`);
    }

    const accountKey = account.toLowerCase();
    if (seenAccounts.has(accountKey)) {
      throw new Error(`Claim ${idx} reuses account ${account}. Each wallet can appear only once per round.`);
    }
    seenAccounts.add(accountKey);

    let amountRaw;
    let amountDisplay;

    if (entry.amountRaw != null && String(entry.amountRaw).trim() !== "") {
      amountRaw = parseRequiredBigInt(entry.amountRaw, `Claim ${idx} amountRaw`);
      amountDisplay = entry.amount != null
        ? String(entry.amount).trim()
        : trimFormattedUnits(ethers.formatUnits(amountRaw, tokenDecimals));
    } else if (entry.amount != null) {
      amountDisplay = String(entry.amount).trim();
      if (!amountDisplay) throw new Error(`Claim ${idx} amount is required.`);
      amountRaw = parseHumanAmount(amountDisplay, tokenDecimals);
    } else {
      throw new Error(`Claim ${idx} must include either amount or amountRaw.`);
    }

    if (amountRaw < 0n) {
      throw new Error(`Claim ${idx} amount cannot be negative.`);
    }

    return {
      index,
      account,
      amountRaw,
      amountDisplay,
    };
  });
}

export function parseClaimsJson(rawValue, tokenDecimals) {
  let rawInput;

  try {
    rawInput = JSON.parse(rawValue);
  } catch {
    throw new Error("Claims JSON must be valid JSON.");
  }

  return normalizeClaimsInput(rawInput, tokenDecimals);
}

export function sumClaimAmounts(claims) {
  return claims.reduce((total, claim) => total + claim.amountRaw, 0n);
}

export function buildStandardMerkleData(claims) {
  if (!Array.isArray(claims) || claims.length === 0) {
    throw new Error("Claims array is empty.");
  }

  const hashedValues = claims
    .map((claim, valueIndex) => ({
      claim,
      valueIndex,
      hash: hashLeaf(claim.index, claim.account, claim.amountRaw),
    }))
    .sort((left, right) => compareHex(left.hash, right.hash));

  const tree = new Array((2 * hashedValues.length) - 1);
  const claimTreeIndices = new Array(claims.length);

  for (const [leafIndex, item] of hashedValues.entries()) {
    const treeIndex = tree.length - 1 - leafIndex;
    tree[treeIndex] = item.hash;
    claimTreeIndices[item.valueIndex] = treeIndex;
  }

  for (let treeIndex = tree.length - hashedValues.length - 1; treeIndex >= 0; treeIndex -= 1) {
    tree[treeIndex] = hashPair(tree[(2 * treeIndex) + 1], tree[(2 * treeIndex) + 2]);
  }

  return {
    root: tree[0],
    totalAmountRaw: sumClaimAmounts(claims),
    claimCount: claims.length,
    claims: claims.map((claim, valueIndex) => {
      let treeIndex = claimTreeIndices[valueIndex];
      const proof = [];

      while (treeIndex > 0) {
        const siblingIndex = treeIndex % 2 === 0 ? treeIndex - 1 : treeIndex + 1;
        proof.push(tree[siblingIndex]);
        treeIndex = Math.floor((treeIndex - 1) / 2);
      }

      return {
        ...claim,
        proof,
      };
    }),
  };
}

export function buildClaimRound(rawInput, tokenDecimals) {
  const normalizedClaims = typeof rawInput === "string"
    ? parseClaimsJson(rawInput, tokenDecimals)
    : normalizeClaimsInput(rawInput, tokenDecimals);
  const merkleData = buildStandardMerkleData(normalizedClaims);

  return {
    root: merkleData.root,
    leafEncoding: [...STANDARD_MERKLE_LEAF_TYPES],
    decimals: tokenDecimals,
    claimCount: merkleData.claimCount,
    totalAmountRaw: merkleData.totalAmountRaw.toString(),
    claims: merkleData.claims.map((claim) => ({
      index: claim.index.toString(),
      account: claim.account,
      amount: claim.amountDisplay,
      amountRaw: claim.amountRaw.toString(),
      proof: [...claim.proof],
    })),
  };
}
