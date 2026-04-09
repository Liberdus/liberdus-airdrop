const { loadFixture, time } = require("@nomicfoundation/hardhat-toolbox/network-helpers");
const { expect } = require("chai");
const { ethers } = require("hardhat");
const { buildTree, deployFixture, fundAirdrop, sumAmounts } = require("./helpers/airdropFixture");

describe("EpochMerkleAirdrop", function () {
  describe("smoke flows", function () {
    it("runs an overlapping-epoch lifecycle from funding through final withdrawals", async function () {
      const { owner, alice, bob, carol, treasury, token, airdrop } = await loadFixture(deployFixture);
      const now = await time.latest();

      const epochOneClaims = [
        { index: 0n, account: alice.address, amount: ethers.parseEther("100") },
        { index: 1n, account: bob.address, amount: ethers.parseEther("40") },
      ];
      const epochTwoClaims = [
        { index: 0n, account: carol.address, amount: ethers.parseEther("25") },
        { index: 1n, account: alice.address, amount: ethers.parseEther("10") },
      ];
      const treeOne = buildTree(epochOneClaims);
      const treeTwo = buildTree(epochTwoClaims);
      const deadlineOne = now + 400;
      const deadlineTwo = now + 900;
      const extraFunding = ethers.parseEther("200");
      const totalFunding = sumAmounts(epochOneClaims) + sumAmounts(epochTwoClaims) + extraFunding;

      await expect(airdrop.startNewAirdrop(treeOne.root, deadlineOne))
        .to.emit(airdrop, "AirdropStarted")
        .withArgs(1, treeOne.root, deadlineOne);

      await fundAirdrop(token, owner, airdrop, totalFunding);

      await expect(airdrop.withdraw(treasury.address, 1n))
        .to.be.revertedWithCustomError(airdrop, "ActiveEpoch")
        .withArgs(1, deadlineOne);

      await expect(
        airdrop.claim(1, epochOneClaims[0].index, alice.address, epochOneClaims[0].amount, treeOne.proofFor(0n))
      )
        .to.emit(airdrop, "Claimed")
        .withArgs(1, epochOneClaims[0].index, alice.address, epochOneClaims[0].amount);

      await expect(airdrop.startNewAirdrop(treeTwo.root, deadlineTwo))
        .to.emit(airdrop, "AirdropStarted")
        .withArgs(2, treeTwo.root, deadlineTwo);

      expect(await airdrop.latestDeadline()).to.equal(deadlineTwo);
      expect(await airdrop.latestDeadlineEpoch()).to.equal(2);

      await expect(
        airdrop.claim(2, epochTwoClaims[0].index, carol.address, epochTwoClaims[0].amount, treeTwo.proofFor(0n))
      )
        .to.emit(airdrop, "Claimed")
        .withArgs(2, epochTwoClaims[0].index, carol.address, epochTwoClaims[0].amount);

      expect(await airdrop.epochClaimedAmounts(1)).to.equal(epochOneClaims[0].amount);
      expect(await airdrop.epochClaimedAmounts(2)).to.equal(epochTwoClaims[0].amount);

      await time.increaseTo(deadlineOne + 1);

      await expect(airdrop.withdraw(treasury.address, 1n))
        .to.be.revertedWithCustomError(airdrop, "ActiveEpoch")
        .withArgs(2, deadlineTwo);

      await time.increaseTo(deadlineTwo + 1);

      const remainingBalance = await token.balanceOf(await airdrop.getAddress());
      const firstSweep = ethers.parseEther("50");

      await expect(airdrop.withdraw(treasury.address, firstSweep))
        .to.emit(airdrop, "Withdrawn")
        .withArgs(treasury.address, firstSweep);

      expect(await token.balanceOf(treasury.address)).to.equal(firstSweep);

      const secondSweep = remainingBalance - firstSweep;

      await expect(airdrop.withdraw(treasury.address, secondSweep))
        .to.emit(airdrop, "Withdrawn")
        .withArgs(treasury.address, secondSweep);

      expect(await token.balanceOf(treasury.address)).to.equal(remainingBalance);
      expect(await token.balanceOf(await airdrop.getAddress())).to.equal(0);
      expect(await token.balanceOf(alice.address)).to.equal(epochOneClaims[0].amount);
      expect(await token.balanceOf(carol.address)).to.equal(epochTwoClaims[0].amount);
      expect(await token.balanceOf(bob.address)).to.equal(0);
    });
  });
});
