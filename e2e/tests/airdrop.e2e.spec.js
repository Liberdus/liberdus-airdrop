const { expect, test, toHexChainId } = require("../fixtures/testWithMockWallet");

async function connectViaWalletPicker(page) {
  await page.getByRole("button", { name: "Connect Wallet" }).click();
  await page.getByRole("button", { name: /MetaMask/i }).click();
}

async function openWalletMenu(page, addressPattern) {
  await page.getByRole("button", { name: addressPattern }).click();
}

async function setFutureDeadline(page, selector, minutesAhead = 90) {
  const value = await page.evaluate((targetMinutesAhead) => {
    const target = new Date(Date.now() + (targetMinutesAhead * 60 * 1000));
    const offsetMs = target.getTimezoneOffset() * 60 * 1000;
    return new Date(target.getTime() - offsetMs).toISOString().slice(0, 16);
  }, minutesAhead);

  await page.locator(selector).fill(value);
}

test("claimant page connects owner and links to admin", async ({ page }) => {
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

test("admin claims builder can prepare and start a matching airdrop", async ({ page, mockWallet }) => {
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

  await page.getByRole("button", { name: "Fund Contract" }).click();
  await expect(page.getByText("Fund airdrop complete.")).toBeVisible();

  await page.getByRole("button", { name: "Start New Airdrop" }).click();
  await expect(page.getByText("Start airdrop complete.")).toBeVisible();
  await expect(page.locator("#currentEpoch")).toHaveText("1");
  await expect(page.getByRole("button", { name: "Start New Airdrop" })).toBeDisabled();
  await expect(page.locator("#startRootWarning")).toContainText("already started successfully");
  await expect(page.locator("#epochListBody")).toContainText("Active");
});

test("claimant can claim from the wrong network after wallet switch", async ({ page, e2eClaimsFile, mockWallet }) => {
  await page.goto("admin.html");
  await connectViaWalletPicker(page);

  await page.locator("#uploadClaimsFileInput").setInputFiles(e2eClaimsFile);
  await expect(page.getByText("Claims file loaded.")).toBeVisible();
  await setFutureDeadline(page, "#startDeadlineInput");
  await page.getByRole("button", { name: "Fund Contract" }).click();
  await expect(page.getByText("Fund airdrop complete.")).toBeVisible();
  await page.getByRole("button", { name: "Start New Airdrop" }).click();
  await expect(page.getByText("Start airdrop complete.")).toBeVisible();

  await mockWallet.setAccount(page, mockWallet.accounts.claimant);
  await mockWallet.setChainId(page, toHexChainId(31337));

  await page.goto("index.html");
  await expect(page.getByRole("button", { name: /0x7099\.\.\.79c8/i })).toBeVisible();
  await expect(page.getByRole("button", { name: "Switch Network to Claim" })).toBeVisible();

  await page.getByRole("button", { name: "Switch Network to Claim" }).click();
  await expect(page.getByText("Claim complete.")).toBeVisible();
  await expect(page.getByRole("button", { name: "Already Claimed" })).toBeVisible();

  await page.reload();
  await expect(page.getByRole("button", { name: "Already Claimed" })).toBeVisible();

  await mockWallet.setAccount(page, mockWallet.accounts.outsider);
  await expect(page.getByText("Nothing available right now.")).toBeVisible();
  await expect(page.getByText("If anything is available for this wallet, it will appear here.")).toBeVisible();
});

test("ownership transfer can be accepted by the pending owner", async ({ page, mockWallet }) => {
  await page.goto("admin.html");
  await connectViaWalletPicker(page);

  await expect(page.locator("#ownershipShell")).toBeVisible();
  await page.locator("#transferOwnershipAddress").fill(mockWallet.accounts.claimant);
  await page.getByRole("button", { name: "Transfer Ownership" }).click();
  await expect(page.getByText("Transfer ownership complete.")).toBeVisible();
  await expect(page.locator("#ownershipPendingOwner")).toContainText(/0x70997970c51812dc3a010c7d01b50e0d17dc79c8/i);

  await mockWallet.setAccount(page, mockWallet.accounts.claimant);
  await expect(page.locator("#ownershipShell")).toBeVisible();
  await expect(page.locator("#acceptOwnershipButton")).toBeEnabled();

  await page.getByRole("button", { name: "Accept Ownership" }).click();
  await expect(page.getByText("Accept ownership complete.")).toBeVisible();
  await expect(page.locator("#ownerAddress")).toContainText(/0x70997970c51812dc3a010c7d01b50e0d17dc79c8/i);
  await expect(page.locator("#accountRole")).toHaveText("Owner connected");
});
