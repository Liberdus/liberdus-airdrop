const fs = require("node:fs");
const path = require("node:path");

const { expect, test } = require("../../fixtures/testWithMockWallet");
const { connectViaWalletPicker, setFutureDeadline } = require("../helpers");

function writeFixtureFile(testInfo, name, content) {
  const filePath = testInfo.outputPath(name);
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, content);
  return filePath;
}

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

test("admin can save a large uploaded round to the backend", async ({ page }, testInfo) => {
  const claimCount = 600;
  const claimsFile = writeFixtureFile(
    testInfo,
    "large-round.claims.json",
    `${JSON.stringify(
      Array.from({ length: claimCount }, (_, index) => ({
        index,
        account: `0x${(index + 1).toString(16).padStart(40, "0")}`,
        amount: "1",
      })),
      null,
      2,
    )}\n`,
  );

  await page.goto("admin.html");
  await connectViaWalletPicker(page);

  await page.locator("#uploadClaimsFileInput").setInputFiles(claimsFile);
  await expect(page.getByText("Claims file loaded.")).toBeVisible();
  await expect(page.locator("#uploadedClaimCount")).toHaveText(`${claimCount} wallets`);

  await setFutureDeadline(page, "#startDeadlineInput");
  await page.getByRole("button", { name: "Save Round to DB" }).click();

  await expect(page.locator("#selectedRoundLabel")).toContainText("Draft");
  await expect(page.locator("#uploadedClaimCount")).toHaveText(`${claimCount} wallets`);
});
