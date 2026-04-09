const { ethers } = require("hardhat");
const { StandardMerkleTree } = require("@openzeppelin/merkle-tree");

function buildTree(claims) {
  const values = claims.map(({ index, account, amount }) => [
    index.toString(),
    account,
    amount.toString(),
  ]);

  const tree = StandardMerkleTree.of(values, ["uint256", "address", "uint256"]);
  const proofsByIndex = new Map();

  for (const [treeIndex, value] of tree.entries()) {
    proofsByIndex.set(value[0], tree.getProof(treeIndex));
  }

  return {
    root: tree.root,
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
