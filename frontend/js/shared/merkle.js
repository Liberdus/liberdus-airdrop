import { ethers } from "./ethers.js";
import { parseHumanAmount, parseRequiredBigInt, normalizeAddress } from "./format.js";

function compareHex(a, b) {
  const aValue = BigInt(a);
  const bValue = BigInt(b);
  if (aValue === bValue) return 0;
  return aValue < bValue ? -1 : 1;
}

function hashLeaf(index, account, amountRaw) {
  const encoded = ethers.AbiCoder.defaultAbiCoder().encode(
    ["uint256", "address", "uint256"],
    [index, account, amountRaw],
  );

  return ethers.keccak256(ethers.keccak256(encoded));
}

function hashPair(a, b) {
  const ordered = compareHex(a, b) <= 0 ? [a, b] : [b, a];
  return ethers.keccak256(ethers.concat(ordered));
}

export function parseClaimsJson(rawValue, tokenDecimals) {
  let raw;

  try {
    raw = JSON.parse(rawValue);
  } catch {
    throw new Error("Claims JSON must be valid JSON.");
  }

  if (!Array.isArray(raw)) throw new Error("Claims JSON must be an array.");

  return raw.map((entry, idx) => {
    const account = normalizeAddress(entry.account);
    if (!account || account === ethers.ZeroAddress) {
      throw new Error(`Claim ${idx} has an invalid account.`);
    }

    const index = parseRequiredBigInt(entry.index, `Claim ${idx} index`);
    const amountRaw = entry.amountRaw != null
      ? parseRequiredBigInt(entry.amountRaw, `Claim ${idx} amountRaw`)
      : parseHumanAmount(String(entry.amount), tokenDecimals);

    return {
      index,
      account,
      amountDisplay: entry.amount != null ? String(entry.amount) : ethers.formatUnits(amountRaw, tokenDecimals),
      amountRaw,
    };
  });
}

export function buildStandardMerkleData(claims) {
  if (!claims.length) throw new Error("Claims array is empty.");

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

  for (let index = tree.length - hashedValues.length - 1; index >= 0; index -= 1) {
    tree[index] = hashPair(tree[(2 * index) + 1], tree[(2 * index) + 2]);
  }

  return {
    root: tree[0],
    claims: claims.map((claim, valueIndex) => {
      let treeIndex = claimTreeIndices[valueIndex];
      const proof = [];

      while (treeIndex > 0) {
        const siblingIndex = treeIndex % 2 === 0 ? treeIndex - 1 : treeIndex + 1;
        proof.push(tree[siblingIndex]);
        treeIndex = Math.floor((treeIndex - 1) / 2);
      }

      return { ...claim, proof };
    }),
  };
}

export function parseProofJson(value) {
  let proof;

  try {
    proof = JSON.parse(value);
  } catch {
    throw new Error("Proof must be valid JSON.");
  }

  if (!Array.isArray(proof) || proof.some((entry) => !ethers.isHexString(entry))) {
    throw new Error("Proof must be a JSON array of hex strings.");
  }

  return proof;
}
