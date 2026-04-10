const { ethers } = require("hardhat");

function compareHex(left, right) {
  const leftValue = BigInt(left);
  const rightValue = BigInt(right);

  if (leftValue === rightValue) return 0;
  return leftValue < rightValue ? -1 : 1;
}

function hashLeaf(index, account, amount) {
  const encoded = ethers.AbiCoder.defaultAbiCoder().encode(
    ["uint256", "address", "uint256"],
    [index, account, amount]
  );

  return ethers.keccak256(ethers.keccak256(encoded));
}

function hashPair(left, right) {
  const ordered = compareHex(left, right) <= 0 ? [left, right] : [right, left];
  return ethers.keccak256(ethers.concat(ordered));
}

function buildTree(claims) {
  const hashedValues = claims
    .map((claim, valueIndex) => ({
      claim,
      valueIndex,
      hash: hashLeaf(claim.index, claim.account, claim.amount),
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

  const proofsByIndex = new Map();
  for (const [valueIndex, claim] of claims.entries()) {
    let treeIndex = claimTreeIndices[valueIndex];
    const proof = [];

    while (treeIndex > 0) {
      const siblingIndex = treeIndex % 2 === 0 ? treeIndex - 1 : treeIndex + 1;
      proof.push(tree[siblingIndex]);
      treeIndex = Math.floor((treeIndex - 1) / 2);
    }

    proofsByIndex.set(claim.index.toString(), proof);
  }

  return {
    root: tree[0],
    proofFor(index) {
      return proofsByIndex.get(index.toString());
    },
  };
}

function sumAmounts(claims) {
  return claims.reduce((total, claim) => total + claim.amount, 0n);
}

async function deployFixture() {
  const [owner, alice, bob, carol, relayer, treasury] = await ethers.getSigners();

  const mockTokenFactory = await ethers.getContractFactory("MockERC20");
  const token = await mockTokenFactory.deploy("Liberdus", "LIB");
  const dustToken = await mockTokenFactory.deploy("Dust", "DST");

  const airdropFactory = await ethers.getContractFactory("EpochMerkleAirdrop");
  const airdrop = await airdropFactory.deploy(await token.getAddress());

  return {
    owner,
    alice,
    bob,
    carol,
    relayer,
    treasury,
    token,
    dustToken,
    airdrop,
    airdropFactory,
  };
}

async function fundAirdrop(token, owner, airdrop, amount) {
  await token.mint(owner.address, amount);
  await token.transfer(await airdrop.getAddress(), amount);
}

module.exports = {
  buildTree,
  deployFixture,
  fundAirdrop,
  sumAmounts,
};
