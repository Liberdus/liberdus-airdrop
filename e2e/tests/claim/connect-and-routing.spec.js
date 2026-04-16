const { expect, test } = require("../../fixtures/testWithMockWallet");
const { connectViaWalletPicker, openWalletMenu } = require("../helpers");

test("@smoke claimant page connects owner and links to admin", async ({ page }) => {
  await page.goto("index.html");

  await expect(page.getByText("Connect your wallet to check for claims.")).toBeVisible();
  await connectViaWalletPicker(page);

  await expect(page.getByRole("button", { name: /0xf39f\.\.\.2266/i })).toBeVisible();
  await expect(page.locator("#addTokenLink")).toBeVisible();
  await expect(page.locator("#tokenExplorerLink")).toHaveAttribute("href", /https:\/\/explorer\.local\.test\/address\/0x/i);

  await openWalletMenu(page, /0xf39f\.\.\.2266/i);
  await expect(page.getByRole("button", { name: "Open Admin" })).toBeVisible();
  await page.getByRole("button", { name: "Open Admin" }).click();

  await expect(page).toHaveURL(/\/frontend\/admin\.html$/);
  await expect(page.getByText("Owner wallet detected. Admin controls are unlocked.")).toBeVisible();
});
