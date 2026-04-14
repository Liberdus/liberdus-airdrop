const { expect, test } = require("../../fixtures/testWithMockWallet");
const { connectViaWalletPicker, startAirdropFromUpload } = require("../helpers");

test("claimant sees an underfunded airdrop error when the contract balance is drained", async ({ page, e2eClaimsFile, mockWallet }) => {
  await page.goto("admin.html");
  await connectViaWalletPicker(page);
  await startAirdropFromUpload(page, e2eClaimsFile);

  await page.locator("#withdrawRecipient").fill(mockWallet.accounts.owner);
  await page.locator("#withdrawAmount").fill("100");
  await page.getByRole("button", { name: "Withdraw" }).click();
  await expect(page.getByText("Withdraw complete.")).toBeVisible();
  await expect(page.locator("#airdropTokenBalance")).toContainText("115 LIB");

  await mockWallet.setAccount(page, mockWallet.accounts.claimant);
  await page.goto("index.html");

  await expect(page.getByRole("button", { name: /0x7099\.\.\.79c8/i })).toBeVisible();
  await expect(page.getByRole("button", { name: "Claim" })).toBeVisible();

  await page.getByRole("button", { name: "Claim" }).click();
  await expect(page.getByText(/The airdrop contract does not have enough LIB for this claim\./i)).toBeVisible();
  await expect(page.getByRole("button", { name: "Claim" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Already Claimed" })).toHaveCount(0);
});
