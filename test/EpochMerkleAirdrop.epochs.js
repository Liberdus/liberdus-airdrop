const { loadFixture, time } = require("@nomicfoundation/hardhat-toolbox/network-helpers");
const { expect } = require("chai");
const { ethers } = require("hardhat");
const { buildTree, deployFixture } = require("./helpers/airdropFixture");

describe("EpochMerkleAirdrop", function () {
  describe("deployment and epoch management", function () {
    it("rejects deployment with a zero token address", async function () {
      const factory = await ethers.getContractFactory("EpochMerkleAirdrop");

      await expect(factory.deploy(ethers.ZeroAddress)).to.be.revertedWithCustomError(factory, "ZeroAddress");
    });

    it("starts sequential epochs and stores each root and deadline", async function () {
      const { airdrop, alice, bob } = await loadFixture(deployFixture);
      const now = await time.latest();

      const epochOneClaims = [
        { index: 0n, account: alice.address, amount: ethers.parseEther("100") },
        { index: 1n, account: bob.address, amount: ethers.parseEther("200") },
      ];
      const epochTwoClaims = [
        { index: 0n, account: alice.address, amount: ethers.parseEther("50") },
        { index: 9n, account: bob.address, amount: ethers.parseEther("75") },
      ];

      const treeOne = buildTree(epochOneClaims);
      const treeTwo = buildTree(epochTwoClaims);
      const deadlineOne = now + 3600;
      const deadlineTwo = now + 7200;

      await expect(airdrop.startNewAirdrop(treeOne.root, deadlineOne))
        .to.emit(airdrop, "AirdropStarted")
        .withArgs(1, treeOne.root, deadlineOne);

      expect(await airdrop.currentEpoch()).to.equal(1);
      expect(await airdrop.merkleRoots(1)).to.equal(treeOne.root);
      expect(await airdrop.deadlines(1)).to.equal(deadlineOne);

      await expect(airdrop.startNewAirdrop(treeTwo.root, deadlineTwo))
        .to.emit(airdrop, "AirdropStarted")
        .withArgs(2, treeTwo.root, deadlineTwo);

      expect(await airdrop.currentEpoch()).to.equal(2);
      expect(await airdrop.merkleRoots(2)).to.equal(treeTwo.root);
      expect(await airdrop.deadlines(2)).to.equal(deadlineTwo);
    });

    it("rejects non-owner attempts to start a new airdrop", async function () {
      const { airdrop, alice, bob } = await loadFixture(deployFixture);
      const now = await time.latest();
      const tree = buildTree([{ index: 0n, account: bob.address, amount: ethers.parseEther("1") }]);

      await expect(airdrop.connect(alice).startNewAirdrop(tree.root, now + 3600))
        .to.be.revertedWithCustomError(airdrop, "OwnableUnauthorizedAccount")
        .withArgs(alice.address);
    });

    it("rejects invalid epoch configuration", async function () {
      const { alice, airdrop } = await loadFixture(deployFixture);
      const now = await time.latest();
      const tree = buildTree([{ index: 0n, account: alice.address, amount: ethers.parseEther("1") }]);

      await expect(airdrop.startNewAirdrop(ethers.ZeroHash, now + 3600)).to.be.revertedWithCustomError(
        airdrop,
        "InvalidMerkleRoot"
      );

      await expect(airdrop.startNewAirdrop(tree.root, now)).to.be.revertedWithCustomError(airdrop, "InvalidDeadline");
      await expect(airdrop.startNewAirdrop(tree.root, now - 1)).to.be.revertedWithCustomError(
        airdrop,
        "InvalidDeadline"
      );
    });

    it("reports false for unclaimed indexes, including across bitmap word boundaries", async function () {
      const { airdrop } = await loadFixture(deployFixture);

      expect(await airdrop.isClaimed(1, 0)).to.equal(false);
      expect(await airdrop.isClaimed(1, 255)).to.equal(false);
      expect(await airdrop.isClaimed(1, 256)).to.equal(false);
      expect(await airdrop.isClaimed(99, 1024)).to.equal(false);
    });
  });
});
