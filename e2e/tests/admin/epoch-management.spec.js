const { expect, test } = require("../../fixtures/testWithMockWallet");
const {
  connectViaWalletPicker,
  getLocalDateTimeInputValue,
  getUtcDateTimeInputValue,
  startAirdropFromUpload,
} = require("../helpers");

test("admin can update an epoch deadline and the update inputs stay synchronized", async ({ page, e2eClaimsFile }) => {
  await page.goto("admin.html");
  await connectViaWalletPicker(page);
  await startAirdropFromUpload(page, e2eClaimsFile);
  await page.getByRole("button", { name: "Contract", exact: true }).click();

  const nextDeadlineUnix = await page.evaluate(() => {
    const nextDeadline = Math.floor(Date.now() / 1000) + (4 * 60 * 60);
    return String(Math.floor(nextDeadline / 60) * 60);
  });
  const nextDeadlineUtc = await getUtcDateTimeInputValue(page, nextDeadlineUnix);

  await page.locator("#updateEpochInput").fill("1");
  await page.locator("#updateDeadlineUtcInput").fill(nextDeadlineUtc);

  await expect(page.locator("#updateDeadlineUnix")).toHaveValue(nextDeadlineUnix);
  await expect(page.locator("#updateDeadlineInput")).not.toHaveValue("");

  await page.getByRole("button", { name: "Update Deadline" }).click();
  await expect(page.getByText("Update deadline complete.")).toBeVisible();
  await expect(page.locator("#epochListBody")).toContainText("Active");

  await page.getByRole("button", { name: "Lookups", exact: true }).click();
  await page.locator("#queryEpochInput").fill("1");
  await page.getByRole("button", { name: "Fetch Epoch Data" }).click();
  await expect(page.locator("#epochQueryResult")).toContainText(`"deadline": "${nextDeadlineUnix}"`);
});

test("admin rejects an epoch deadline update when the new deadline is already in the past", async ({ page, e2eClaimsFile, hardhatChain }) => {
  await page.goto("admin.html");
  await connectViaWalletPicker(page);
  await startAirdropFromUpload(page, e2eClaimsFile);
  await page.getByRole("button", { name: "Contract", exact: true }).click();

  const latestBlock = await hardhatChain.rpcCall("eth_getBlockByNumber", ["latest", false]);
  const chainTimestamp = Number.parseInt(latestBlock.timestamp, 16);
  const pastDeadlineUnix = String(Math.floor((chainTimestamp - 60) / 60) * 60);
  const pastDeadlineLocal = await getLocalDateTimeInputValue(page, pastDeadlineUnix);

  await page.locator("#updateEpochInput").fill("1");
  await page.locator("#updateDeadlineInput").fill(pastDeadlineLocal);

  await expect(page.locator("#updateDeadlineUnix")).toHaveValue(pastDeadlineUnix);

  await page.getByRole("button", { name: "Update Deadline" }).click();
  await expect(page.getByText("Update deadline: Deadline must be in the future.")).toBeVisible();

  await page.getByRole("button", { name: "Lookups", exact: true }).click();
  await page.locator("#queryEpochInput").fill("1");
  await page.getByRole("button", { name: "Fetch Epoch Data" }).click();
  await expect(page.locator("#epochQueryResult")).not.toContainText(`"deadline": "${pastDeadlineUnix}"`);
});
