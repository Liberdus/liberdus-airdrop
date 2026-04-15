const { expect, test } = require("../../fixtures/testWithMockWallet");
const { connectViaWalletPicker, startAirdropFromUpload } = require("../helpers");

test("claimant only sees deployed active rounds sorted newest-first", async ({ page, e2eClaimsFile, e2eClaimsFileEpoch2, e2eMultiEpochManifest, mockWallet }) => {
  await page.goto("admin.html");
  await connectViaWalletPicker(page);

  await startAirdropFromUpload(page, e2eClaimsFile);
  await startAirdropFromUpload(page, e2eClaimsFileEpoch2);
  await expect(page.locator("#currentEpoch")).toHaveText("2");

  await mockWallet.setUiConfig(page, { claimsManifestPath: e2eMultiEpochManifest });
  await mockWallet.setAccount(page, mockWallet.accounts.claimant);
  await page.goto("index.html");

  const claimCards = page.locator(".round-card");
  await expect(claimCards).toHaveCount(2);
  await expect(claimCards.nth(0)).toContainText("200 LIB");
  await expect(claimCards.nth(1)).toContainText("125 LIB");
  await expect(page.getByText("300 LIB")).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Claim" })).toHaveCount(2);
});

test("claimant no longer sees a round after the owner disables it", async ({ page, e2eClaimsFile, mockWallet }) => {
  await page.goto("admin.html");
  await connectViaWalletPicker(page);

  await startAirdropFromUpload(page, e2eClaimsFile);
  await page.locator("#updateEpochInput").fill("1");
  await page.getByRole("button", { name: "Disable Epoch" }).click();
  await expect(page.getByText("Disable epoch complete.")).toBeVisible();
  await expect(page.locator("#epochListBody")).toContainText("Disabled");

  await mockWallet.setAccount(page, mockWallet.accounts.claimant);
  await page.goto("index.html");

  await expect(page.getByRole("button", { name: /0x7099\.\.\.79c8/i })).toBeVisible();
  await expect(page.getByText("Nothing available right now.")).toBeVisible();
  await expect(page.getByRole("button", { name: "Claim" })).toHaveCount(0);
});

test("claimant no longer sees a round after its deadline passes on-chain", async ({ page, e2eClaimsFile, hardhatChain, mockWallet }) => {
  await page.goto("admin.html");
  await connectViaWalletPicker(page);

  await startAirdropFromUpload(page, e2eClaimsFile, { deadlineSelector: "#startDeadlineInput" });
  await mockWallet.setAccount(page, mockWallet.accounts.claimant);
  await page.goto("index.html");

  await expect(page.getByRole("button", { name: "Claim" })).toBeVisible();

  await hardhatChain.rpcCall("evm_increaseTime", [2 * 60 * 60]);
  await hardhatChain.rpcCall("evm_mine", []);
  await page.addInitScript((offsetMs) => {
    const originalDateNow = Date.now.bind(Date);
    Date.now = () => originalDateNow() + offsetMs;
  }, 2 * 60 * 60 * 1000);

  await page.reload();
  await expect(page.getByText("Nothing available right now.")).toBeVisible();
  await expect(page.getByRole("button", { name: "Claim" })).toHaveCount(0);
});
