const { expect, test } = require("../../fixtures/testWithMockWallet");
const { connectViaWalletPicker } = require("../helpers");

test("ownership transfer can be accepted by the pending owner", async ({ page, mockWallet }) => {
  await page.goto("admin.html");
  await connectViaWalletPicker(page);

  await page.getByRole("button", { name: "Contract", exact: true }).click();
  await expect(page.locator("#ownershipShell")).toBeVisible();
  await page.locator("#transferOwnershipAddress").fill(mockWallet.accounts.claimant);
  await page.getByRole("button", { name: "Transfer Ownership" }).click();
  await expect(page.getByText("Transfer ownership complete.")).toBeVisible();
  await expect(page.locator("#ownershipPendingOwner")).toContainText(/0x70997970c51812dc3a010c7d01b50e0d17dc79c8/i);

  await mockWallet.setAccount(page, mockWallet.accounts.claimant);
  await expect(page.locator("#accountRole")).toHaveText("Pending owner connected");
  await expect(page.locator("#adminShell")).toBeHidden();
  await expect(page.locator("#pendingOwnerShell")).toBeVisible();
  await expect(page.locator("#pendingAcceptOwnershipButton")).toBeEnabled();

  await page.locator("#pendingAcceptOwnershipButton").click();
  await expect(page.getByText("Accept ownership complete.")).toBeVisible();
  await expect(page.locator("#ownerAddress")).toContainText(/0x70997970c51812dc3a010c7d01b50e0d17dc79c8/i);
  await expect(page.locator("#accountRole")).toHaveText("Owner connected");
});
