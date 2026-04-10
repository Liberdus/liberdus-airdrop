const { loadFixture, time } = require("@nomicfoundation/hardhat-toolbox/network-helpers");
const { expect } = require("chai");
const { ethers } = require("hardhat");
const { buildTree, deployFixture, fundAirdrop } = require("./helpers/airdropFixture");

describe("EpochMerkleAirdrop", function () {
  describe("admin controls", function () {
    it("allows the owner to withdraw even while epochs are still active", async function () {
      const { owner, treasury, token, airdrop } = await loadFixture(deployFixture);
      const now = await time.latest();
      const tree = buildTree([{ index: 0n, account: owner.address, amount: ethers.parseEther("10") }]);
      const deadline = now + 500;
      const withdrawAmount = ethers.parseEther("10");

      await airdrop.startNewAirdrop(tree.root, deadline);
      await fundAirdrop(token, owner, airdrop, ethers.parseEther("500"));

      await expect(airdrop.withdraw(treasury.address, withdrawAmount))
        .to.emit(airdrop, "Withdrawn")
        .withArgs(treasury.address, withdrawAmount);

      expect(await token.balanceOf(treasury.address)).to.equal(withdrawAmount);
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

    it("lets the owner disable an active epoch", async function () {
      const { owner, airdrop } = await loadFixture(deployFixture);
      const now = await time.latest();
      const firstTree = buildTree([{ index: 0n, account: owner.address, amount: 1n }]);
      const secondTree = buildTree([{ index: 1n, account: owner.address, amount: 2n }]);
      const secondDeadline = now + 900;

      await airdrop.startNewAirdrop(firstTree.root, now + 300);
      await airdrop.startNewAirdrop(secondTree.root, secondDeadline);

      await expect(airdrop.setEpochDeadline(2, 0))
        .to.emit(airdrop, "DeadlineUpdated")
        .withArgs(2, secondDeadline, 0);
      expect(await airdrop.deadlines(2)).to.equal(0);
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

    it("lets only the pending owner complete a two-step ownership transfer", async function () {
      const { owner, alice, bob, airdrop } = await loadFixture(deployFixture);

      await airdrop.transferOwnership(alice.address);

      await expect(airdrop.connect(bob).acceptOwnership()).to.be.revertedWithCustomError(
        airdrop,
        "OwnableUnauthorizedAccount"
      );

      await airdrop.connect(alice).acceptOwnership();

      expect(await airdrop.owner()).to.equal(alice.address);

      await expect(airdrop.connect(owner).withdraw(bob.address, 1n))
        .to.be.revertedWithCustomError(airdrop, "OwnableUnauthorizedAccount")
        .withArgs(owner.address);
    });
  });
});
