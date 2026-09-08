const fs = require("node:fs");
const path = require("node:path");

const { expect, test } = require("../../fixtures/testWithMockWallet");
const {
  connectViaWalletPicker,
  fetchStoredRounds,
  getUtcDateTimeInputValue,
  setFutureDeadline,
} = require("../helpers");

function writeFixtureFile(testInfo, name, content) {
  const filePath = testInfo.outputPath(name);
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, content);
  return filePath;
}

test("@smoke admin claims builder can save and deploy a matching airdrop draft", async ({ page, mockWallet }) => {
  await page.goto("admin.html");
  await connectViaWalletPicker(page);

  await expect(page.getByText("Owner wallet detected. Admin controls are unlocked.")).toBeVisible();
  await page.getByRole("button", { name: "Prepare", exact: true }).click();

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

test("admin can build a round from every linked wallet with one shared amount", async ({ page, mockWallet }, testInfo) => {
  const accountsCsvPath = writeFixtureFile(testInfo, "linked-wallet-accounts.csv", [
    "x_username,wallet_address,x_user_id,is_follower,needs_recovery",
    `alpha,${mockWallet.accounts.claimant},111,true,false`,
    `beta,${mockWallet.accounts.secondary},222,true,false`,
    `beta-duplicate,${mockWallet.accounts.secondary},333,false,false`,
    "invalid,not-a-wallet,444,false,false",
    "no-wallet,,555,false,false",
  ].join("\n"));

  await page.goto("admin.html");
  await connectViaWalletPicker(page);

  await expect(page.getByText("Owner wallet detected. Admin controls are unlocked.")).toBeVisible();

  await page.getByRole("button", { name: "Accounts", exact: true }).click();
  await page.locator("#accountsImportFileInput").setInputFiles(accountsCsvPath);
  await page.getByRole("button", { name: "Upload Accounts" }).click();
  await expect(page.locator("#managementAccountCount")).toHaveText("5");

  await page.getByRole("button", { name: "Prepare" }).click();
  await page.locator("#builderUniformAmountInput").fill("25");
  await page.getByRole("button", { name: "Use All Linked Wallets" }).click();

  await expect(page.locator("#builderClaimCount")).toHaveText("2 wallets");
  await expect(page.locator("#builderClaimTotal")).toHaveText("50 LIB");
  await expect(page.locator("#uploadedClaimCount")).toHaveText("2 wallets");
  await expect(page.locator("#uploadedClaimTotal")).toContainText("50 LIB");
  await expect(page.locator("#claimsBuilderBody tr")).toHaveCount(2);
  await expect(page.locator('[data-builder-field="account"]').nth(0)).toHaveValue(new RegExp(`^${mockWallet.accounts.claimant}$`, "i"));
  await expect(page.locator('[data-builder-field="account"]').nth(1)).toHaveValue(new RegExp(`^${mockWallet.accounts.secondary}$`, "i"));
  await expect(page.locator("#adminToastMessage")).toHaveText("2 linked wallets loaded; 1 invalid skipped; 1 duplicate skipped.");

  await setFutureDeadline(page, "#startDeadlineInput");
  await page.getByRole("button", { name: "Save Round to DB" }).click();
  await expect(page.locator("#selectedRoundLabel")).toContainText("Draft");
  await page.getByRole("button", { name: "Fund Total" }).first().click();
  await expect(page.getByText("Fund airdrop complete.")).toBeVisible();
  await page.getByRole("button", { name: "Deploy" }).first().click();
  await expect(page.locator("#currentEpoch")).toHaveText("1");
});

test("admin accepts a claims CSV as well as JSON", async ({ page, mockWallet }, testInfo) => {
  const claimsCsvPath = writeFixtureFile(testInfo, "claims.csv", [
    "account,amount",
    `${mockWallet.accounts.claimant},12.5`,
    `${mockWallet.accounts.secondary},7.5`,
  ].join("\n"));

  await page.goto("admin.html");
  await connectViaWalletPicker(page);
  await expect(page.locator("#accountRole")).toHaveText("Owner connected");
  await page.getByRole("button", { name: "Prepare", exact: true }).click();
  await page.locator("#uploadClaimsFileInput").setInputFiles(claimsCsvPath);
  await expect(page.locator("#uploadedClaimCount")).toHaveText("2 wallets");
  await expect(page.locator("#uploadedClaimTotal")).toContainText("20 LIB");
});

test("admin can edit a saved draft deadline before deploying it", async ({ page, e2eClaimsFile }) => {
  await page.goto("admin.html");
  await connectViaWalletPicker(page);
  await expect(page.locator("#accountRole")).toHaveText("Owner connected");
  await page.getByRole("button", { name: "Prepare", exact: true }).click();

  await page.locator("#uploadClaimsFileInput").setInputFiles(e2eClaimsFile);
  await setFutureDeadline(page, "#startDeadlineInput", 90);
  await page.getByRole("button", { name: "Save Round to DB" }).click();
  await expect(page.locator("#selectedRoundLabel")).toContainText("Draft");

  const beforeRounds = await fetchStoredRounds(page);
  const draftBefore = beforeRounds.rounds.find((round) => round.status === "draft");
  expect(draftBefore).toBeTruthy();

  await page.locator("#epochListBody tr", { hasText: "Draft" }).getByRole("button", { name: "Edit Deadline" }).click();

  const nextDeadlineUnix = await page.evaluate(() => {
    const nextDeadline = Math.floor(Date.now() / 1000) + (3 * 60 * 60);
    return String(Math.floor(nextDeadline / 60) * 60);
  });
  const nextDeadlineUtc = await getUtcDateTimeInputValue(page, nextDeadlineUnix);
  await page.locator("#updateDeadlineUtcInput").fill(nextDeadlineUtc);
  await page.getByRole("button", { name: "Update Deadline" }).click();
  await expect(page.getByText("Draft deadline updated.")).toBeVisible();

  const afterRounds = await fetchStoredRounds(page);
  const draftAfter = afterRounds.rounds.find((round) => round.id === draftBefore.id);
  expect(draftAfter.deadline).toBe(Number(nextDeadlineUnix));
  expect(Date.parse(draftAfter.updatedAt)).toBeGreaterThan(Date.parse(draftBefore.updatedAt));

  await page.getByRole("button", { name: "Rounds", exact: true }).click();
  await expect(page.locator("#epochListBody")).toContainText("Draft");
  await page.getByRole("button", { name: "Fund Total" }).first().click();
  await expect(page.getByText("Fund airdrop complete.")).toBeVisible();
  await page.getByRole("button", { name: "Deploy" }).first().click();
  await expect(page.getByText("Draft deployed as epoch 1.")).toBeVisible();

  await page.getByRole("button", { name: "Lookups", exact: true }).click();
  await page.locator("#queryEpochInput").fill("1");
  await page.getByRole("button", { name: "Fetch Epoch Data" }).click();
  await expect(page.locator("#epochQueryResult")).toContainText(`"deadline": "${nextDeadlineUnix}"`);
});
