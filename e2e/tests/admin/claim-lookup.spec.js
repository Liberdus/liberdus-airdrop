const { expect, test } = require("../../fixtures/testWithMockWallet");
const { connectViaWalletPicker, startAirdropFromUpload } = require("../helpers");

test("admin can inspect round claims and lookup claims by wallet", async ({ page, e2eClaimsFile, mockWallet }) => {
  await page.goto("admin.html");
  await connectViaWalletPicker(page);
  await startAirdropFromUpload(page, e2eClaimsFile);

  await page.getByRole("button", { name: "Rounds", exact: true }).click();
  await page.getByRole("button", { name: "View Claims" }).first().click();

  await expect(page.locator("#selectedRoundLabel")).toContainText("Epoch 1");
  await expect(page.locator("#roundClaimsBody")).toContainText("125 LIB");
  await expect(page.locator("#roundClaimsBody tr").first().locator("td").first()).toHaveText("0");

  await page.getByRole("button", { name: "Lookups", exact: true }).click();
  await page.locator("#claimLookupInput").fill(mockWallet.accounts.claimant);
  await page.getByRole("button", { name: "Lookup Claim(s)" }).click();
  await expect(page.locator("#claimLookupBody")).toContainText("125 LIB");
  await expect(page.locator("#claimLookupBody tr").first().locator("td").nth(1)).toHaveText("0");
});
