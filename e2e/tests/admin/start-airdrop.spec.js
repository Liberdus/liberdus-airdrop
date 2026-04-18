const { expect, test } = require("../../fixtures/testWithMockWallet");
const { connectViaWalletPicker, setFutureDeadline } = require("../helpers");

test("@smoke admin claims builder can save and deploy a matching airdrop draft", async ({ page, mockWallet }) => {
  await page.goto("admin.html");
  await connectViaWalletPicker(page);

  await expect(page.getByText("Owner wallet detected. Admin controls are unlocked.")).toBeVisible();

  await page.locator('[data-builder-field="account"]').fill(mockWallet.accounts.claimant);
  await page.locator('[data-builder-field="amount"]').fill("125");
  await page.getByRole("button", { name: "Add Row" }).click();
  await page.locator('[data-builder-row-id="2"][data-builder-field="account"]').fill(mockWallet.accounts.secondary);
  await page.locator('[data-builder-row-id="2"][data-builder-field="amount"]').fill("90");

  await expect(page.locator("#builderClaimCount")).toHaveText("2 wallets");
  await expect(page.locator("#builderClaimTotal")).toHaveText("215 LIB");
  await expect(page.locator("#builderMerkleRoot")).not.toHaveText("-");

  await page.getByRole("button", { name: "Use Built Claims" }).click();
  await expect(page.getByText("Built claims loaded.")).toBeVisible();
  await expect(page.locator("#uploadedClaimCount")).toHaveText("2 wallets");
  await expect(page.locator("#uploadedClaimTotal")).toContainText("215 LIB");

  await setFutureDeadline(page, "#startDeadlineInput");
  await expect(page.locator("#startDeadlineUnix")).not.toHaveValue("");

  await page.getByRole("button", { name: "Save Round to DB" }).click();
  await expect(page.locator("#selectedRoundLabel")).toContainText("Draft");
  await page.getByRole("button", { name: "Fund Total" }).first().click();
  await expect(page.getByText("Fund airdrop complete.")).toBeVisible();
  await page.getByRole("button", { name: "Deploy" }).first().click();
  await expect(page.locator("#currentEpoch")).toHaveText("1");
  await expect(page.locator("#epochListBody")).toContainText("DB + Chain");
  await page.getByRole("button", { name: "Prepare" }).click();
  await expect(page.locator("#epochListBody")).toContainText("Active");
});
