const fs = require("node:fs");
const path = require("node:path");

const { expect, test } = require("../../fixtures/testWithMockWallet");
const { connectViaWalletPicker } = require("../helpers");

function writeFixtureFile(testInfo, name, content) {
  const filePath = testInfo.outputPath(name);
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, content);
  return filePath;
}

test("admin can manage accounts and recovery submissions from the accounts tab", async ({ page }, testInfo) => {
  const accountsCsvPath = writeFixtureFile(testInfo, "accounts.csv", [
    "x_username,wallet_address,x_user_id,is_follower,needs_recovery,snapshot_history_json",
    "alpha,0x70997970c51812dc3a010c7d01b50e0d17dc79c8,111,true,false,\"[\"\"2026-04-01T12:00:00.000Z\"\", \"\"2026-04-15T12:00:00.000Z\"\"]\"",
    "beta,,222,false,true,",
  ].join("\n"));
  const recoveryJsonPath = writeFixtureFile(testInfo, "recovery-links.json", JSON.stringify({
    records: [
      {
        id: "submission-1",
        xUserId: "333",
        xUsername: "gamma",
        walletAddress: "0x3c44cdddb6a900fa2b585dd299e03d12fa4293bc",
        signedMessage: "Signed test message",
        signature: "0xdeadbeef",
        isKnownFollower: true,
        isRecoveryCandidate: true,
        status: "received",
        updatedAt: "2026-04-18T15:45:00.000Z",
        createdAt: "2026-04-18T15:45:00.000Z",
      },
    ],
  }, null, 2));

  await page.goto("admin.html");
  await connectViaWalletPicker(page);

  await page.getByRole("button", { name: "Accounts", exact: true }).click();
  await expect(page.locator("#accountsPaginationLabel")).toContainText("0 accounts");

  await page.locator("#accountsImportFileInput").setInputFiles(accountsCsvPath);
  await page.getByRole("button", { name: "Upload Accounts" }).click();

  await expect(page.locator("#managementAccountCount")).toHaveText("2");
  await expect(page.locator("#managementFollowerCount")).toHaveText("1");
  await expect(page.locator("#managementRecoveryCandidateCount")).toHaveText("1");
  await expect(page.locator("#accountsTableBody")).toContainText("alpha");
  await expect(page.locator("#accountsTableBody")).toContainText("beta");
  const alphaRow = page.locator("#accountsTableBody tr").filter({ hasText: "alpha" }).first();
  await expect(alphaRow).toContainText("2");
  await expect(alphaRow).toContainText("First:");
  await expect(alphaRow).not.toContainText("No snapshot");

  await page.locator("#singleAccountUsernameInput").fill("gamma");
  await page.locator("#singleAccountUserIdInput").fill("333");
  await page.locator("#singleAccountNeedsRecoveryInput").check();
  await page.locator("#singleAccountIsFollowerInput").check();
  await page.getByRole("button", { name: "Save Account" }).click();

  await expect(page.locator("#managementAccountCount")).toHaveText("3");

  await page.locator("#accountsSearchInput").fill("gamma");
  await page.getByRole("button", { name: "Apply" }).first().click();
  await expect(page.locator("#accountsTableBody")).toContainText("gamma");

  await page.locator("#recoveryImportFileInput").setInputFiles(recoveryJsonPath);
  await page.getByRole("button", { name: "Upload Recovery JSON" }).click();

  await expect(page.locator("#managementSubmissionCount")).toHaveText("1");
  await expect(page.locator("#recoverySubmissionsBody")).toContainText("gamma");
  await expect(page.locator("#recoverySubmissionsBody")).toContainText("received");

  const jsonDownloadPromise = page.waitForEvent("download");
  await page.getByRole("button", { name: "Export JSON" }).click();
  const jsonDownload = await jsonDownloadPromise;
  const jsonPath = testInfo.outputPath("recovery-export.json");
  await jsonDownload.saveAs(jsonPath);
  const jsonContent = fs.readFileSync(jsonPath, "utf8");
  expect(jsonContent).toContain("\"xUsername\": \"gamma\"");
  expect(jsonContent).toContain("\"signature\": \"0xdeadbeef\"");

  const csvDownloadPromise = page.waitForEvent("download");
  await page.getByRole("button", { name: "Export CSV" }).click();
  const csvDownload = await csvDownloadPromise;
  const csvPath = testInfo.outputPath("recovery-export.csv");
  await csvDownload.saveAs(csvPath);
  const csvContent = fs.readFileSync(csvPath, "utf8");
  expect(csvContent).toContain("username_at_submission");
  expect(csvContent).toContain("gamma");
  expect(csvContent).toContain("0xdeadbeef");
});
