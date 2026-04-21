const fs = require("node:fs");
const path = require("node:path");

const { expect, test } = require("../../fixtures/testWithMockWallet");
const { connectViaWalletPicker, startAirdropFromUpload } = require("../helpers");

function writeFixtureFile(testInfo, name, content) {
  const filePath = testInfo.outputPath(name);
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, content);
  return filePath;
}

test("admin can reconcile mirrored claims and surface them across the reporting UI", async ({ page, e2eClaimsFile, mockWallet }, testInfo) => {
  const accountsCsvPath = writeFixtureFile(testInfo, "accounts.csv", [
    "x_username,wallet_address,x_user_id,is_follower,needs_recovery,snapshot_history_json",
    `alpha,${mockWallet.accounts.claimant},111,true,false,"[""2026-04-01T12:00:00.000Z""]"`,
  ].join("\n"));

  await page.goto("admin.html");
  await connectViaWalletPicker(page);

  await page.getByRole("button", { name: "Accounts", exact: true }).click();
  await page.locator("#accountsImportFileInput").setInputFiles(accountsCsvPath);
  await page.getByRole("button", { name: "Upload Accounts" }).click();
  await expect(page.locator("#accountsTableBody")).toContainText("alpha");

  await page.getByRole("button", { name: "Prepare", exact: true }).click();
  await startAirdropFromUpload(page, e2eClaimsFile);

  await mockWallet.setAccount(page, mockWallet.accounts.claimant);
  await page.goto("index.html");
  await page.getByRole("button", { name: "Claim" }).click();
  await expect(page.getByRole("button", { name: "Already Claimed" })).toBeVisible();

  await mockWallet.setAccount(page, mockWallet.accounts.owner);
  await page.goto("admin.html");
  await expect(page.locator("#adminClaimedTotal")).toHaveText("0 LIB");

  await page.getByRole("button", { name: "Reconcile Claims" }).click();
  await expect(page.locator("#adminToastMessage")).toContainText("Claims reconciled:");
  await expect(page.locator("#adminClaimedTotal")).toHaveText("125 LIB");
  await expect(page.locator("#claimSyncStatus")).toContainText("Claim sync last ran");

  await page.getByRole("button", { name: "Rounds", exact: true }).click();
  await page.getByRole("button", { name: "View Claims" }).first().click();
  await expect(page.locator("#roundClaimsBody")).toContainText("Claimed");

  await page.getByRole("button", { name: "Lookups", exact: true }).click();
  await page.locator("#claimLookupInput").fill(mockWallet.accounts.claimant);
  await page.getByRole("button", { name: "Lookup Claim(s)" }).click();
  await expect(page.locator("#claimLookupBody")).toContainText("Claimed");

  await page.getByRole("button", { name: "Accounts", exact: true }).click();
  const alphaRow = page.locator("#accountsTableBody tr").filter({ hasText: "alpha" }).first();
  await expect(alphaRow).toContainText("125 LIB");
  await expect(alphaRow).toContainText("1 claimed round");
});
