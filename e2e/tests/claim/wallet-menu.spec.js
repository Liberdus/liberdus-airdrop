const { expect, test } = require("../../fixtures/testWithMockWallet");
const { connectViaWalletPicker, openWalletMenu } = require("../helpers");

test("claimant wallet menu shows the connected address, chain id, and disconnect flow", async ({ page }) => {
  await page.goto("index.html");
  await connectViaWalletPicker(page);

  await openWalletMenu(page, /0xf39f\.\.\.2266/i);
  await expect(page.locator("#walletMenu")).toBeVisible();
  await expect(page.locator("#walletMenuAddress")).toHaveText(/0xf39f\.\.\.2266/i);
  await expect(page.locator("#walletMenuAddress")).toHaveAttribute(
    "title",
    /0xf39fd6e51aad88f6f4ce6ab8827279cfffb92266/i,
  );
  await expect(page.locator("#walletMenuChainId")).toHaveText("1337");
  await expect(page.getByRole("button", { name: "Open Admin" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Disconnect" })).toBeVisible();

  await page.getByRole("button", { name: "Disconnect" }).click();
  await expect(page.getByText("Wallet disconnected.")).toBeVisible();
  await expect(page.getByRole("button", { name: "Connect Wallet" })).toBeVisible();
  await expect(page.getByText("Connect your wallet to check for claims.")).toBeVisible();
  await expect(page.getByText("Available claims will appear here after you connect.")).toBeVisible();
});

test("connected claimant sees the generic empty state when no rounds have started", async ({ page, mockWallet }) => {
  await page.goto("index.html");
  await mockWallet.setAccount(page, mockWallet.accounts.claimant);
  await connectViaWalletPicker(page);

  await expect(page.getByRole("button", { name: /0x7099\.\.\.79c8/i })).toBeVisible();
  await expect(page.getByText("Nothing available right now.")).toBeVisible();
  await expect(page.getByText("If anything is available for this wallet, it will appear here.")).toBeVisible();
  await expect(page.getByRole("button", { name: "Claim" })).toHaveCount(0);
});

test("claimant footer can add the token to MetaMask and hides explorer link when explorerBaseUrl is unset", async ({ page, mockWallet }) => {
  await page.goto("index.html");
  await connectViaWalletPicker(page);

  await expect(page.locator("#addTokenLink")).toBeVisible();
  await expect(page.locator("#tokenExplorerLink")).toBeVisible();
  await page.locator("#addTokenLink").click();
  await expect(page.getByText("Token added to MetaMask.")).toBeVisible();

  await mockWallet.setUiConfig(page, { explorerBaseUrl: "" });
  await page.reload();

  await expect(page.locator("#addTokenLink")).toBeVisible();
  await expect(page.locator("#tokenExplorerLink")).toBeHidden();
});
