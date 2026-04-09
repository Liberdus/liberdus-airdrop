const { loadFixture, time } = require("@nomicfoundation/hardhat-toolbox/network-helpers");
const { expect } = require("chai");
const { ethers } = require("hardhat");
const { buildTree, deployFixture, fundAirdrop } = require("./helpers/airdropFixture");

describe("EpochMerkleAirdrop", function () {
  describe("admin controls", function () {
    it("only allows withdrawing the airdrop token after the latest epoch deadline", async function () {
      const { owner, treasury, token, airdrop } = await loadFixture(deployFixture);
      const now = await time.latest();
      const firstTree = buildTree([{ index: 0n, account: owner.address, amount: ethers.parseEther("1") }]);
      const secondTree = buildTree([{ index: 0n, account: owner.address, amount: ethers.parseEther("2") }]);
      const deadlineOne = now + 100;
      const deadlineTwo = now + 500;
      const depositAmount = ethers.parseEther("500");

      await airdrop.startNewAirdrop(firstTree.root, deadlineOne);
      await airdrop.startNewAirdrop(secondTree.root, deadlineTwo);
      await fundAirdrop(token, owner, airdrop, depositAmount);

      await expect(airdrop.withdraw(treasury.address, ethers.parseEther("10")))
        .to.be.revertedWithCustomError(airdrop, "ActiveEpoch")
        .withArgs(2, deadlineTwo);

      await time.increaseTo(deadlineTwo + 1);

      await expect(airdrop.withdraw(treasury.address, ethers.parseEther("10")))
        .to.emit(airdrop, "Withdrawn")
        .withArgs(treasury.address, ethers.parseEther("10"));

      expect(await token.balanceOf(treasury.address)).to.equal(ethers.parseEther("10"));
    });

    it("allows the owner to withdraw when no epoch has been started", async function () {
      const { owner, treasury, token, airdrop } = await loadFixture(deployFixture);
      const amount = ethers.parseEther("5");

      await fundAirdrop(token, owner, airdrop, amount);

      await expect(airdrop.withdraw(treasury.address, amount))
        .to.emit(airdrop, "Withdrawn")
        .withArgs(treasury.address, amount);

      expect(await token.balanceOf(treasury.address)).to.equal(amount);
    });

    it("rejects non-owner withdrawals and zero-address withdrawals", async function () {
      const { alice, treasury, airdrop } = await loadFixture(deployFixture);

      await expect(airdrop.connect(alice).withdraw(treasury.address, 1n))
        .to.be.revertedWithCustomError(airdrop, "OwnableUnauthorizedAccount")
        .withArgs(alice.address);

      await expect(airdrop.withdraw(ethers.ZeroAddress, 1n)).to.be.revertedWithCustomError(airdrop, "ZeroAddress");
    });

    it("recovers non-airdrop ERC20 tokens", async function () {
      const { owner, treasury, dustToken, airdrop } = await loadFixture(deployFixture);
      const dustAmount = ethers.parseEther("123");

      await dustToken.mint(owner.address, dustAmount);
      await dustToken.transfer(await airdrop.getAddress(), dustAmount);

      await expect(airdrop.recoverERC20(await dustToken.getAddress(), treasury.address, dustAmount))
        .to.emit(airdrop, "RecoveredERC20")
        .withArgs(await dustToken.getAddress(), treasury.address, dustAmount);

      expect(await dustToken.balanceOf(treasury.address)).to.equal(dustAmount);
    });

    it("rejects invalid recovery attempts", async function () {
      const { alice, treasury, token, dustToken, airdrop } = await loadFixture(deployFixture);

      await expect(airdrop.connect(alice).recoverERC20(await dustToken.getAddress(), treasury.address, 1n))
        .to.be.revertedWithCustomError(airdrop, "OwnableUnauthorizedAccount")
        .withArgs(alice.address);

      await expect(
        airdrop.recoverERC20(await token.getAddress(), treasury.address, 1n)
      ).to.be.revertedWithCustomError(airdrop, "InvalidRecoverToken");

      await expect(
        airdrop.recoverERC20(ethers.ZeroAddress, treasury.address, 1n)
      ).to.be.revertedWithCustomError(airdrop, "ZeroAddress");

      await expect(
        airdrop.recoverERC20(await dustToken.getAddress(), ethers.ZeroAddress, 1n)
      ).to.be.revertedWithCustomError(airdrop, "ZeroAddress");
    });
  });
});
