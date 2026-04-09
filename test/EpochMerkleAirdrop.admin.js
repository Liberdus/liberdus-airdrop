const { loadFixture, time } = require("@nomicfoundation/hardhat-toolbox/network-helpers");
const { expect } = require("chai");
const { ethers } = require("hardhat");
const { buildTree, deployFixture, fundAirdrop } = require("./helpers/airdropFixture");

describe("EpochMerkleAirdrop", function () {
  describe("admin controls", function () {
    const withdrawLockCases = [
      {
        name: "when the first epoch has the furthest deadline",
        offsets: [500, 100],
        blockedAtOffset: 101,
        expectedEpoch: 1,
        expectedDeadlineOffset: 500,
      },
      {
        name: "when the second epoch has the furthest deadline",
        offsets: [100, 500],
        blockedAtOffset: 101,
        expectedEpoch: 2,
        expectedDeadlineOffset: 500,
      },
      {
        name: "when both epochs share the same deadline",
        offsets: [300, 300],
        blockedAtOffset: 150,
        expectedEpoch: 1,
        expectedDeadlineOffset: 300,
      },
    ];

    it("only allows withdrawing the airdrop token after the furthest epoch deadline", async function () {
      const { owner, treasury, token, airdrop } = await loadFixture(deployFixture);
      const now = await time.latest();
      const firstTree = buildTree([{ index: 0n, account: owner.address, amount: ethers.parseEther("10") }]);
      const secondTree = buildTree([{ index: 0n, account: owner.address, amount: ethers.parseEther("2") }]);
      const deadlineOne = now + 500;
      const deadlineTwo = now + 100;
      const depositAmount = ethers.parseEther("500");

      await airdrop.startNewAirdrop(firstTree.root, deadlineOne);
      await airdrop.startNewAirdrop(secondTree.root, deadlineTwo);
      await fundAirdrop(token, owner, airdrop, depositAmount);

      await time.increaseTo(deadlineTwo + 1);

      await expect(airdrop.withdraw(treasury.address, ethers.parseEther("10")))
        .to.be.revertedWithCustomError(airdrop, "ActiveEpoch")
        .withArgs(1, deadlineOne);

      await time.increaseTo(deadlineOne + 1);

      await expect(airdrop.withdraw(treasury.address, ethers.parseEther("10")))
        .to.emit(airdrop, "Withdrawn")
        .withArgs(treasury.address, ethers.parseEther("10"));

      expect(await token.balanceOf(treasury.address)).to.equal(ethers.parseEther("10"));
    });

    withdrawLockCases.forEach(({ name, offsets, blockedAtOffset, expectedEpoch, expectedDeadlineOffset }) => {
      it(`applies the withdraw lock table ${name}`, async function () {
        const { owner, treasury, token, airdrop } = await loadFixture(deployFixture);
        const now = await time.latest();
        const firstDeadline = now + offsets[0];
        const secondDeadline = now + offsets[1];
        const firstTree = buildTree([{ index: 0n, account: owner.address, amount: 1n }]);
        const secondTree = buildTree([{ index: 0n, account: owner.address, amount: 2n }]);

        await airdrop.startNewAirdrop(firstTree.root, firstDeadline);
        await airdrop.startNewAirdrop(secondTree.root, secondDeadline);
        await fundAirdrop(token, owner, airdrop, 10n);

        expect(await airdrop.latestDeadline()).to.equal(now + expectedDeadlineOffset);
        expect(await airdrop.latestDeadlineEpoch()).to.equal(expectedEpoch);

        await time.increaseTo(now + blockedAtOffset);

        await expect(airdrop.withdraw(treasury.address, 1n))
          .to.be.revertedWithCustomError(airdrop, "ActiveEpoch")
          .withArgs(expectedEpoch, now + expectedDeadlineOffset);
      });
    });

    it("keeps withdraw locked at the exact latest deadline and unlocks one second later", async function () {
      const { owner, treasury, token, airdrop } = await loadFixture(deployFixture);
      const deadline = (await time.latest()) + 300;
      const tree = buildTree([{ index: 0n, account: owner.address, amount: ethers.parseEther("1") }]);
      const amount = ethers.parseEther("5");

      await airdrop.startNewAirdrop(tree.root, deadline);
      await fundAirdrop(token, owner, airdrop, amount);

      await time.setNextBlockTimestamp(deadline);

      await expect(airdrop.withdraw(treasury.address, 1n))
        .to.be.revertedWithCustomError(airdrop, "ActiveEpoch")
        .withArgs(1, deadline);

      await time.increaseTo(deadline + 1);

      await expect(airdrop.withdraw(treasury.address, amount))
        .to.emit(airdrop, "Withdrawn")
        .withArgs(treasury.address, amount);

      expect(await token.balanceOf(treasury.address)).to.equal(amount);
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
