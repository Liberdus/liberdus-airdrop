const { expect, test, toHexChainId } = require("../../fixtures/testWithMockWallet");
const { connectViaWalletPicker } = require("../helpers");

test("non-owner wallet stays gated from admin controls", async ({ page, mockWallet }) => {
  await page.goto("admin.html");
  await mockWallet.setAccount(page, mockWallet.accounts.outsider);
  await connectViaWalletPicker(page);

  await expect(page.locator("#accountRole")).toHaveText("Connected wallet");
  await expect(page.getByText("This page only unlocks for the current owner address.")).toBeVisible();
  await expect(page.locator("#adminShell")).toBeHidden();
  await expect(page.locator("#ownershipShell")).toBeHidden();
});

test("wrong-network owner is gated until switching back to the configured network", async ({ page, mockWallet }) => {
  await page.goto("admin.html");
  await connectViaWalletPicker(page);
  await expect(page.locator("#accountRole")).toHaveText("Owner connected");

  await mockWallet.setChainId(page, toHexChainId(31337));
  await page.reload();
  await expect(page.locator("#accountRole")).toHaveText("Wrong network");
  await expect(page.getByText("Switch the connected wallet to the configured network to manage the airdrop.")).toBeVisible();
  await expect(page.locator("#switchNetworkGateButton")).toBeVisible();
  await expect(page.locator("#adminShell")).toBeHidden();

  await page.getByRole("button", { name: "Switch to Configured Network" }).click();
  await expect(page.getByText("Switched to Hardhat Local.")).toBeVisible();
  await expect(page.locator("#accountRole")).toHaveText("Owner connected");
  await expect(page.locator("#adminShell")).toBeVisible();
});
