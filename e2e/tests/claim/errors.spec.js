const { expect, test, toHexChainId } = require("../../fixtures/testWithMockWallet");
const { connectViaWalletPicker, startAirdropFromUpload } = require("../helpers");

test("claimant sees an underfunded airdrop error when the contract balance is drained", async ({ page, e2eClaimsFile, mockWallet }) => {
  await page.goto("admin.html");
  await connectViaWalletPicker(page);
  await startAirdropFromUpload(page, e2eClaimsFile);

  await page.getByRole("button", { name: "Contract", exact: true }).click();
  await page.locator("#withdrawRecipient").fill(mockWallet.accounts.owner);
  await page.locator("#withdrawAmount").fill("100");
  await page.getByRole("button", { name: "Withdraw" }).click();
  await expect(page.getByText("Withdraw complete.")).toBeVisible();
  await expect(page.locator("#airdropTokenBalance")).toContainText("115 LIB");
  const availableBalance = (await page.locator("#airdropTokenBalance").textContent())?.trim();

  await mockWallet.setAccount(page, mockWallet.accounts.claimant);
  await page.goto("index.html");

  await expect(page.getByRole("button", { name: /0x7099\.\.\.79c8/i })).toBeVisible();
  await expect(page.getByRole("button", { name: "Claim" })).toBeVisible();
  const claimAmount = (await page.locator(".round-amount").first().textContent())?.trim();

  await page.getByRole("button", { name: "Claim" }).click();
  await expect(page.locator("#claimToast")).toBeVisible();
  await expect(page.locator("#claimToastMessage")).toHaveText(
    `Claim: The airdrop contract does not have enough LIB for this claim. It has ${availableBalance}, but this claim needs ${claimAmount}. Fund the airdrop contract and try again.`,
  );
  await expect(page.getByRole("button", { name: "Claim" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Already Claimed" })).toHaveCount(0);
});

test("claimant sees a wallet rejection message when the wallet declines the claim transaction", async ({ page, e2eClaimsFile, mockWallet }) => {
  await page.goto("admin.html");
  await connectViaWalletPicker(page);
  await startAirdropFromUpload(page, e2eClaimsFile);

  await mockWallet.setAccount(page, mockWallet.accounts.claimant);
  await page.goto("index.html");

  await mockWallet.failNextRequest(page, "eth_sendTransaction", {
    code: 4001,
    message: "User rejected the request.",
  });

  await page.getByRole("button", { name: "Claim" }).click();
  await expect(page.getByText("Claim: request rejected in the wallet.")).toBeVisible();
  await expect(page.getByRole("button", { name: "Claim" })).toBeVisible();
});

test("claimant sees a pending wallet request message when network switching is already in progress", async ({ page, e2eClaimsFile, mockWallet }) => {
  await page.goto("admin.html");
  await connectViaWalletPicker(page);
  await startAirdropFromUpload(page, e2eClaimsFile);

  await mockWallet.setAccount(page, mockWallet.accounts.claimant);
  await mockWallet.setChainId(page, toHexChainId(31337));
  await page.goto("index.html");

  await expect(page.getByRole("button", { name: "Switch Network to Claim" })).toBeVisible();
  await mockWallet.failNextRequest(page, "wallet_switchEthereumChain", {
    code: -32002,
    message: "Request already pending.",
  });

  await page.getByRole("button", { name: "Switch Network to Claim" }).click();
  await expect(page.getByText("Claim: the wallet already has a pending request.")).toBeVisible();
  await expect(page.getByRole("button", { name: "Switch Network to Claim" })).toBeVisible();
});
