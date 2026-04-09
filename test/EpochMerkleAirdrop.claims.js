const { loadFixture, time } = require("@nomicfoundation/hardhat-toolbox/network-helpers");
const { expect } = require("chai");
const { ethers } = require("hardhat");
const { buildTree, deployFixture, fundAirdrop, sumAmounts } = require("./helpers/airdropFixture");

describe("EpochMerkleAirdrop", function () {
  describe("claims", function () {
    it("allows valid claims across multiple epochs and tracks claims separately", async function () {
      const { owner, alice, bob, carol, token, airdrop } = await loadFixture(deployFixture);
      const now = await time.latest();

      const epochOneClaims = [
        { index: 0n, account: alice.address, amount: ethers.parseEther("100") },
        { index: 256n, account: bob.address, amount: ethers.parseEther("200") },
      ];
      const epochTwoClaims = [
        { index: 0n, account: alice.address, amount: ethers.parseEther("25") },
        { index: 1n, account: carol.address, amount: ethers.parseEther("10") },
      ];

      const treeOne = buildTree(epochOneClaims);
      const treeTwo = buildTree(epochTwoClaims);
      const totalFunding = sumAmounts(epochOneClaims) + sumAmounts(epochTwoClaims);

      await airdrop.startNewAirdrop(treeOne.root, now + 3600);
      await airdrop.startNewAirdrop(treeTwo.root, now + 7200);
      await fundAirdrop(token, owner, airdrop, totalFunding);

      await expect(
        airdrop.claim(1, epochOneClaims[0].index, alice.address, epochOneClaims[0].amount, treeOne.proofFor(0n))
      )
        .to.emit(airdrop, "Claimed")
        .withArgs(1, epochOneClaims[0].index, alice.address, epochOneClaims[0].amount);

      await expect(
        airdrop.claim(1, epochOneClaims[1].index, bob.address, epochOneClaims[1].amount, treeOne.proofFor(256n))
      )
        .to.emit(airdrop, "Claimed")
        .withArgs(1, epochOneClaims[1].index, bob.address, epochOneClaims[1].amount);

      await expect(
        airdrop.claim(2, epochTwoClaims[0].index, alice.address, epochTwoClaims[0].amount, treeTwo.proofFor(0n))
      )
        .to.emit(airdrop, "Claimed")
        .withArgs(2, epochTwoClaims[0].index, alice.address, epochTwoClaims[0].amount);

      expect(await airdrop.isClaimed(1, 0)).to.equal(true);
      expect(await airdrop.isClaimed(1, 256)).to.equal(true);
      expect(await airdrop.isClaimed(2, 0)).to.equal(true);
      expect(await airdrop.isClaimed(2, 1)).to.equal(false);
      expect(await token.balanceOf(alice.address)).to.equal(epochOneClaims[0].amount + epochTwoClaims[0].amount);
      expect(await token.balanceOf(bob.address)).to.equal(epochOneClaims[1].amount);
    });

    it("allows a relayer to submit a claim for the beneficiary", async function () {
      const { owner, alice, relayer, token, airdrop } = await loadFixture(deployFixture);
      const claims = [{ index: 7n, account: alice.address, amount: ethers.parseEther("42") }];
      const tree = buildTree(claims);

      await airdrop.startNewAirdrop(tree.root, (await time.latest()) + 3600);
      await fundAirdrop(token, owner, airdrop, sumAmounts(claims));

      await expect(
        airdrop
          .connect(relayer)
          .claim(1, claims[0].index, alice.address, claims[0].amount, tree.proofFor(claims[0].index))
      )
        .to.emit(airdrop, "Claimed")
        .withArgs(1, claims[0].index, alice.address, claims[0].amount);

      expect(await token.balanceOf(alice.address)).to.equal(claims[0].amount);
    });

    it("rejects claims for unknown epochs", async function () {
      const { alice, airdrop } = await loadFixture(deployFixture);

      await expect(airdrop.claim(42, 0, alice.address, ethers.parseEther("1"), []))
        .to.be.revertedWithCustomError(airdrop, "EpochNotStarted")
        .withArgs(42);
    });

    it("rejects duplicate claims within the same epoch", async function () {
      const { owner, alice, token, airdrop } = await loadFixture(deployFixture);
      const claims = [{ index: 0n, account: alice.address, amount: ethers.parseEther("100") }];
      const tree = buildTree(claims);

      await airdrop.startNewAirdrop(tree.root, (await time.latest()) + 3600);
      await fundAirdrop(token, owner, airdrop, sumAmounts(claims));

      await airdrop.claim(1, claims[0].index, alice.address, claims[0].amount, tree.proofFor(0n));

      await expect(
        airdrop.claim(1, claims[0].index, alice.address, claims[0].amount, tree.proofFor(0n))
      )
        .to.be.revertedWithCustomError(airdrop, "AlreadyClaimed")
        .withArgs(1, claims[0].index);
    });

    it("rejects mismatched proofs when the amount, account, or index is altered", async function () {
      const { owner, alice, bob, token, airdrop } = await loadFixture(deployFixture);
      const claims = [
        { index: 0n, account: alice.address, amount: ethers.parseEther("100") },
        { index: 1n, account: bob.address, amount: ethers.parseEther("200") },
      ];
      const tree = buildTree(claims);

      await airdrop.startNewAirdrop(tree.root, (await time.latest()) + 3600);
      await fundAirdrop(token, owner, airdrop, sumAmounts(claims));

      await expect(
        airdrop.claim(1, 1n, bob.address, claims[1].amount + 1n, tree.proofFor(1n))
      ).to.be.revertedWithCustomError(airdrop, "InvalidProof");

      await expect(
        airdrop.claim(1, 1n, alice.address, claims[1].amount, tree.proofFor(1n))
      ).to.be.revertedWithCustomError(airdrop, "InvalidProof");

      await expect(
        airdrop.claim(1, 2n, bob.address, claims[1].amount, tree.proofFor(1n))
      ).to.be.revertedWithCustomError(airdrop, "InvalidProof");
    });

    it("rejects proofs from a different epoch", async function () {
      const { owner, alice, bob, token, airdrop } = await loadFixture(deployFixture);
      const now = await time.latest();
      const epochOneClaims = [
        { index: 0n, account: alice.address, amount: ethers.parseEther("10") },
        { index: 1n, account: bob.address, amount: ethers.parseEther("5") },
      ];
      const epochTwoClaims = [
        { index: 0n, account: alice.address, amount: ethers.parseEther("20") },
        { index: 1n, account: bob.address, amount: ethers.parseEther("7") },
      ];
      const treeOne = buildTree(epochOneClaims);
      const treeTwo = buildTree(epochTwoClaims);

      await airdrop.startNewAirdrop(treeOne.root, now + 3600);
      await airdrop.startNewAirdrop(treeTwo.root, now + 7200);
      await fundAirdrop(token, owner, airdrop, sumAmounts(epochOneClaims) + sumAmounts(epochTwoClaims));

      await expect(
        airdrop.claim(2, 0n, alice.address, epochTwoClaims[0].amount, treeOne.proofFor(0n))
      ).to.be.revertedWithCustomError(airdrop, "InvalidProof");
    });

    it("blocks claims at and after the configured deadline", async function () {
      const { owner, alice, token, airdrop } = await loadFixture(deployFixture);
      const claims = [{ index: 0n, account: alice.address, amount: ethers.parseEther("100") }];
      const tree = buildTree(claims);
      const deadline = (await time.latest()) + 300;

      await airdrop.startNewAirdrop(tree.root, deadline);
      await fundAirdrop(token, owner, airdrop, sumAmounts(claims));

      await time.increaseTo(deadline);

      await expect(
        airdrop.claim(1, claims[0].index, alice.address, claims[0].amount, tree.proofFor(0n))
      )
        .to.be.revertedWithCustomError(airdrop, "ClaimWindowClosed")
        .withArgs(1, deadline);
    });

    it("reverts underfunded claims without marking them as claimed", async function () {
      const { owner, alice, token, airdrop } = await loadFixture(deployFixture);
      const claims = [{ index: 0n, account: alice.address, amount: ethers.parseEther("100") }];
      const tree = buildTree(claims);

      await airdrop.startNewAirdrop(tree.root, (await time.latest()) + 3600);

      await expect(
        airdrop.claim(1, claims[0].index, alice.address, claims[0].amount, tree.proofFor(0n))
      ).to.be.reverted;

      expect(await airdrop.isClaimed(1, claims[0].index)).to.equal(false);

      await fundAirdrop(token, owner, airdrop, sumAmounts(claims));
      await airdrop.claim(1, claims[0].index, alice.address, claims[0].amount, tree.proofFor(0n));

      expect(await airdrop.isClaimed(1, claims[0].index)).to.equal(true);
      expect(await token.balanceOf(alice.address)).to.equal(claims[0].amount);
    });
  });
});
