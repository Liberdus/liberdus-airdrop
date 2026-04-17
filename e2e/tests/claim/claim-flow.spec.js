const { expect, test, toHexChainId } = require("../../fixtures/testWithMockWallet");
const { connectViaWalletPicker, setFutureDeadline } = require("../helpers");

test("@smoke claimant can claim from the wrong network after wallet switch", async ({ page, e2eClaimsFile, mockWallet }) => {
  await page.goto("admin.html");
  await connectViaWalletPicker(page);

  await page.locator("#uploadClaimsFileInput").setInputFiles(e2eClaimsFile);
  await expect(page.getByText("Claims file loaded.")).toBeVisible();
  await setFutureDeadline(page, "#startDeadlineInput");
  await page.getByRole("button", { name: "Fund Contract" }).click();
  await expect(page.getByText("Fund airdrop complete.")).toBeVisible();
  await page.getByRole("button", { name: "Start New Airdrop" }).click();
  await expect(page.locator("#currentEpoch")).toHaveText("1");

  await mockWallet.setAccount(page, mockWallet.accounts.claimant);
  await mockWallet.setChainId(page, toHexChainId(31337));

  await page.goto("index.html");
  await expect(page.getByRole("button", { name: /0x7099\.\.\.79c8/i })).toBeVisible();
  await expect(page.getByRole("button", { name: "Switch Network to Claim" })).toBeVisible();

  await page.getByRole("button", { name: "Switch Network to Claim" }).click();
  const celebrationDialog = page.getByRole("dialog", { name: "Claim complete" });
  await expect(celebrationDialog).toBeVisible();
  await expect(page.getByText("Keep following Liberdus on our social channels to stay eligible for future rewards.")).toBeVisible();
  await expect(page.getByRole("link", { name: "Follow on X" })).toHaveAttribute("href", "https://x.com/liberdus");
  await expect(page.getByRole("button", { name: "Back to rewards" })).toBeVisible();
  await page.getByRole("button", { name: "Back to rewards" }).click();
  await expect(celebrationDialog).toBeHidden();
  await expect(page.getByRole("button", { name: "Already Claimed" })).toBeVisible();

  await page.reload();
  await expect(page.getByRole("button", { name: "Already Claimed" })).toBeVisible();
});

test("claimant outsider sees the generic empty state", async ({ page, e2eClaimsFile, mockWallet }) => {
  await page.goto("admin.html");
  await connectViaWalletPicker(page);

  await page.locator("#uploadClaimsFileInput").setInputFiles(e2eClaimsFile);
  await setFutureDeadline(page, "#startDeadlineInput");
  await page.getByRole("button", { name: "Fund Contract" }).click();
  await expect(page.getByText("Fund airdrop complete.")).toBeVisible();
  await page.getByRole("button", { name: "Start New Airdrop" }).click();
  await expect(page.locator("#currentEpoch")).toHaveText("1");

  await mockWallet.setAccount(page, mockWallet.accounts.outsider);
  await page.goto("index.html");

  await expect(page.getByRole("button", { name: /0x9965\.\.\.a4dc/i })).toBeVisible();
  await expect(page.getByText("Nothing available right now.")).toBeVisible();
  await expect(page.getByText("If anything is available for this wallet, it will appear here.")).toBeVisible();
});
