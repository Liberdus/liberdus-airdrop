const { expect, test, toHexChainId } = require("../../fixtures/testWithMockWallet");
const { connectViaWalletPicker, startAirdropFromUpload } = require("../helpers");

test("non-owner wallet can view public admin status while controls stay locked", async ({ page, mockWallet }) => {
  await page.goto("admin.html");
  await mockWallet.setAccount(page, mockWallet.accounts.outsider);
  await connectViaWalletPicker(page);

  await expect(page.locator("#accountRole")).toHaveText("Read-only viewer");
  await expect(page.getByText("Public contract and airdrop round information is available below. Owner actions remain locked.")).toBeVisible();
  await expect(page.locator("#adminShell")).toBeVisible();
  await expect(page.getByRole("button", { name: "Rounds", exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Accounts", exact: true })).toBeHidden();
  await expect(page.locator("#refreshRoundClaimsStatusButton")).toBeDisabled();
  await expect(page.locator("#pendingOwnerShell")).toBeHidden();
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

test("delayed round claims cannot unlock claimed-status controls after switching to a viewer", async ({ page, mockWallet, e2eClaimsFile }) => {
  await page.goto("admin.html");
  await connectViaWalletPicker(page);
  await startAirdropFromUpload(page, e2eClaimsFile);
  await page.reload();
  await expect(page.locator("#accountRole")).toHaveText("Owner connected");
  await page.getByRole("button", { name: "Rounds", exact: true }).click();

  let releaseClaims;
  const claimsCanContinue = new Promise((resolve) => { releaseClaims = resolve; });
  let markRequested;
  const claimsRequested = new Promise((resolve) => { markRequested = resolve; });
  await page.route("**/api/airdrop/rounds/*/claims", async (route) => {
    const response = await route.fetch();
    markRequested();
    await claimsCanContinue;
    await route.fulfill({ response });
  });
  await page.getByRole("button", { name: "View Claims", exact: true }).first().click();
  await claimsRequested;
  try {
    await mockWallet.setAccount(page, mockWallet.accounts.outsider);
    await expect(page.locator("#accountRole")).toHaveText("Read-only viewer");
  } finally {
    releaseClaims();
  }
  await expect(page.locator("#selectedRoundClaimCount")).toHaveText("2 claims");
  await expect(page.locator("#refreshRoundClaimsStatusButton")).toBeDisabled();
});
