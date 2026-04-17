const { expect, test } = require("../../fixtures/testWithMockWallet");
const { connectViaWalletPicker, setFutureDeadline } = require("../helpers");

test("admin can upload an existing claims file and gets a duplicate-root warning on re-upload", async ({ page, e2eClaimsFile }) => {
  await page.goto("admin.html");
  await connectViaWalletPicker(page);

  await page.locator("#uploadClaimsFileInput").setInputFiles(e2eClaimsFile);
  await expect(page.getByText("Claims file loaded.")).toBeVisible();
  await expect(page.locator("#uploadedClaimCount")).toHaveText("2 wallets");
  await expect(page.locator("#uploadedClaimTotal")).toContainText("215 LIB");
  await expect(page.locator("#startRootInput")).not.toHaveValue("");
  await expect(page.locator("#uploadPreviewBody")).toContainText("125 LIB");
  await expect(page.locator("#uploadPreviewBody")).toContainText("90 LIB");

  await setFutureDeadline(page, "#startDeadlineInput");
  await page.getByRole("button", { name: "Save Round to DB" }).click();
  await page.getByRole("button", { name: "Fund Total" }).first().click();
  await expect(page.getByText("Fund airdrop complete.")).toBeVisible();
  await page.getByRole("button", { name: "Deploy" }).first().click();
  await expect(page.locator("#currentEpoch")).toHaveText("1");
  await expect(page.locator("#epochListBody")).toContainText("DB + Chain");
  await page.getByRole("button", { name: "Prepare" }).click();

  await page.getByRole("button", { name: "Clear Claims" }).click();
  await page.locator("#uploadClaimsFileInput").setInputFiles(e2eClaimsFile);
  await expect(page.getByText("Claims file loaded.")).toBeVisible();
  await expect(page.locator("#startRootWarning")).toContainText("already exists on chain");
});
