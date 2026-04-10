const { loadFixture, time } = require("@nomicfoundation/hardhat-toolbox/network-helpers");
const { expect } = require("chai");
const { ethers } = require("hardhat");
const { buildTree, deployFixture, sumAmounts } = require("./helpers/airdropFixture");

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
      expect(await airdrop.epochClaimedAmounts(1)).to.equal(0);

      await expect(airdrop.startNewAirdrop(treeTwo.root, deadlineTwo))
        .to.emit(airdrop, "AirdropStarted")
        .withArgs(2, treeTwo.root, deadlineTwo);

      expect(await airdrop.currentEpoch()).to.equal(2);
      expect(await airdrop.merkleRoots(2)).to.equal(treeTwo.root);
      expect(await airdrop.deadlines(2)).to.equal(deadlineTwo);
    });

    it("stores independent deadlines even when a later epoch ends sooner", async function () {
      const { airdrop, alice, bob } = await loadFixture(deployFixture);
      const now = await time.latest();
      const longTree = buildTree([{ index: 0n, account: alice.address, amount: ethers.parseEther("10") }]);
      const shortTree = buildTree([{ index: 0n, account: bob.address, amount: ethers.parseEther("20") }]);
      const longDeadline = now + 7200;
      const shortDeadline = now + 600;

      await airdrop.startNewAirdrop(longTree.root, longDeadline);
      await airdrop.startNewAirdrop(shortTree.root, shortDeadline);

      expect(await airdrop.currentEpoch()).to.equal(2);
      expect(await airdrop.deadlines(1)).to.equal(longDeadline);
      expect(await airdrop.deadlines(2)).to.equal(shortDeadline);
    });

    it("lets the owner update an epoch deadline", async function () {
      const { airdrop, alice, bob } = await loadFixture(deployFixture);
      const now = await time.latest();
      const firstTree = buildTree([{ index: 0n, account: alice.address, amount: ethers.parseEther("10") }]);
      const secondTree = buildTree([{ index: 0n, account: bob.address, amount: ethers.parseEther("20") }]);
      const secondDeadline = now + 1200;
      const updatedDeadline = now + 300;

      await airdrop.startNewAirdrop(firstTree.root, now + 600);
      await airdrop.startNewAirdrop(secondTree.root, secondDeadline);

      await expect(airdrop.setEpochDeadline(2, updatedDeadline))
        .to.emit(airdrop, "DeadlineUpdated")
        .withArgs(2, secondDeadline, updatedDeadline);

      expect(await airdrop.deadlines(2)).to.equal(updatedDeadline);
    });

    it("allows the owner to disable an epoch by setting its deadline to zero", async function () {
      const { airdrop, alice, bob } = await loadFixture(deployFixture);
      const now = await time.latest();
      const firstTree = buildTree([{ index: 0n, account: alice.address, amount: ethers.parseEther("10") }]);
      const secondTree = buildTree([{ index: 0n, account: bob.address, amount: ethers.parseEther("20") }]);
      const secondDeadline = now + 1200;

      await airdrop.startNewAirdrop(firstTree.root, now + 600);
      await airdrop.startNewAirdrop(secondTree.root, secondDeadline);

      await expect(airdrop.setEpochDeadline(2, 0))
        .to.emit(airdrop, "DeadlineUpdated")
        .withArgs(2, secondDeadline, 0);

      expect(await airdrop.deadlines(2)).to.equal(0);
    });

    it("allows equal deadlines on different epochs", async function () {
      const { airdrop, alice, bob } = await loadFixture(deployFixture);
      const now = await time.latest();
      const deadline = now + 3600;
      const firstTree = buildTree([{ index: 0n, account: alice.address, amount: ethers.parseEther("10") }]);
      const secondTree = buildTree([{ index: 0n, account: bob.address, amount: ethers.parseEther("20") }]);

      await airdrop.startNewAirdrop(firstTree.root, deadline);
      await airdrop.startNewAirdrop(secondTree.root, deadline);

      expect(await airdrop.deadlines(1)).to.equal(deadline);
      expect(await airdrop.deadlines(2)).to.equal(deadline);
    });

    it("returns epoch info with the running claimed total", async function () {
      const { owner, alice, token, airdrop } = await loadFixture(deployFixture);
      const claims = [
        { index: 0n, account: alice.address, amount: ethers.parseEther("10") },
        { index: 1n, account: owner.address, amount: ethers.parseEther("3") },
      ];
      const tree = buildTree(claims);
      const deadline = (await time.latest()) + 3600;

      await airdrop.startNewAirdrop(tree.root, deadline);
      await token.mint(owner.address, sumAmounts(claims));
      await token.transfer(await airdrop.getAddress(), sumAmounts(claims));
      await airdrop.claim(1, claims[0].index, alice.address, claims[0].amount, tree.proofFor(claims[0].index));

      const epochInfo = await airdrop.epochInfo(1);

      expect(epochInfo[0]).to.equal(tree.root);
      expect(epochInfo[1]).to.equal(deadline);
      expect(epochInfo[2]).to.equal(claims[0].amount);
    });

    it("rejects non-owner attempts to start a new airdrop", async function () {
      const { airdrop, alice, bob } = await loadFixture(deployFixture);
      const now = await time.latest();
      const tree = buildTree([{ index: 0n, account: bob.address, amount: ethers.parseEther("1") }]);

      await expect(airdrop.connect(alice).startNewAirdrop(tree.root, now + 3600))
        .to.be.revertedWithCustomError(airdrop, "OwnableUnauthorizedAccount")
        .withArgs(alice.address);
    });

    it("rejects invalid deadline updates", async function () {
      const { airdrop, alice, bob } = await loadFixture(deployFixture);
      const now = await time.latest();
      const tree = buildTree([{ index: 0n, account: bob.address, amount: ethers.parseEther("1") }]);

      await airdrop.startNewAirdrop(tree.root, now + 3600);

      await expect(airdrop.setEpochDeadline(42, now + 10))
        .to.be.revertedWithCustomError(airdrop, "EpochNotStarted")
        .withArgs(42);

      await expect(airdrop.setEpochDeadline(1, now))
        .to.be.revertedWithCustomError(airdrop, "InvalidDeadline");

      await expect(airdrop.setEpochDeadline(1, now - 1))
        .to.be.revertedWithCustomError(airdrop, "InvalidDeadline");

      await expect(airdrop.connect(alice).setEpochDeadline(1, now + 10))
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

      await expect(airdrop.startNewAirdrop(tree.root, now)).to.be.revertedWithCustomError(
        airdrop,
        "InvalidDeadline"
      );
      await expect(airdrop.startNewAirdrop(tree.root, now - 1)).to.be.revertedWithCustomError(
        airdrop,
        "InvalidDeadline"
      );
    });

    it("supports two-step ownership transfers", async function () {
      const { owner, alice, airdrop } = await loadFixture(deployFixture);

      await expect(airdrop.transferOwnership(alice.address))
        .to.emit(airdrop, "OwnershipTransferStarted")
        .withArgs(owner.address, alice.address);

      expect(await airdrop.pendingOwner()).to.equal(alice.address);

      await expect(airdrop.connect(owner).acceptOwnership()).to.be.revertedWithCustomError(
        airdrop,
        "OwnableUnauthorizedAccount"
      );

      await expect(airdrop.connect(alice).acceptOwnership())
        .to.emit(airdrop, "OwnershipTransferred")
        .withArgs(owner.address, alice.address);

      expect(await airdrop.owner()).to.equal(alice.address);
      expect(await airdrop.pendingOwner()).to.equal(ethers.ZeroAddress);
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
