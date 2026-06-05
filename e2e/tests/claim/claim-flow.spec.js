const { expect, test, toHexChainId } = require("../../fixtures/testWithMockWallet");
const { connectViaWalletPicker, enableXRecovery, startAirdropFromUpload } = require("../helpers");

test("@smoke claimant can claim from the wrong network after wallet switch", async ({ page, e2eClaimsFile, mockWallet }) => {
  await page.goto("admin.html");
  await connectViaWalletPicker(page);
  await startAirdropFromUpload(page, e2eClaimsFile);

  await mockWallet.setAccount(page, mockWallet.accounts.claimant);
  await mockWallet.setChainId(page, toHexChainId(1337));

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

test("claim page does not show X recovery before wallet state is known", async ({ page, hardhatChain }) => {
  await enableXRecovery(page, hardhatChain.backendUrl);
  await page.route("**/js/pages/claim.js", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/javascript",
      body: "",
    });
  });

  await page.goto("index.html");

  await expect(page.getByRole("heading", { name: "Sign In With X" })).toHaveCount(0);
  await expect(page.getByRole("heading", { name: "Available Claims" })).toBeVisible();
  await expect(page.getByText(/Loading Rewards/)).toBeVisible();
});

test("claimant outsider sees the generic empty state when X recovery is disabled", async ({ page, e2eClaimsFile, mockWallet }) => {
  await page.goto("admin.html");
  await connectViaWalletPicker(page);
  await startAirdropFromUpload(page, e2eClaimsFile);

  await mockWallet.setAccount(page, mockWallet.accounts.outsider);
  await page.goto("index.html");

  await expect(page.getByRole("button", { name: /0x9965\.\.\.a4dc/i })).toBeVisible();
  await expect(page.getByText("Nothing available right now.")).toBeVisible();
  await expect(page.getByText("If anything is available for this wallet, it will appear here.")).toBeVisible();
});

test("claimant sees refresh guidance when rewards lookup fails", async ({ page, hardhatChain, mockWallet }) => {
  await enableXRecovery(page, hardhatChain.backendUrl);
  await page.route("**/api/claims/wallet/**", async (route) => {
    await route.fulfill({
      status: 503,
      contentType: "application/json",
      body: JSON.stringify({ error: "Claims API unavailable." }),
    });
  });

  await page.goto("index.html");
  await mockWallet.setAccount(page, mockWallet.accounts.outsider);
  await connectViaWalletPicker(page);

  await expect(page.getByRole("button", { name: /0x9965\.\.\.a4dc/i })).toBeVisible();
  await expect(page.getByText("Rewards could not be loaded.")).toBeVisible();
  await expect(page.getByText("Check your connection, then refresh this page.")).toBeVisible();
  await expect(page.getByRole("heading", { name: "Sign In With X" })).toHaveCount(0);
  await expect(page.getByText("Nothing available right now.")).toHaveCount(0);
});

test("claimant outsider sees X recovery without the generic empty state when enabled", async ({
  page,
  e2eClaimsFile,
  hardhatChain,
  mockWallet,
}) => {
  await enableXRecovery(page, hardhatChain.backendUrl);

  await page.goto("admin.html");
  await connectViaWalletPicker(page);
  await startAirdropFromUpload(page, e2eClaimsFile);

  let releaseClaimsLookup;
  const claimsLookupCanContinue = new Promise((resolve) => {
    releaseClaimsLookup = resolve;
  });
  await page.route("**/api/claims/wallet/**", async (route) => {
    await claimsLookupCanContinue;
    await route.continue();
  });

  await mockWallet.setAccount(page, mockWallet.accounts.outsider);
  await page.goto("index.html");

  await expect(page.getByRole("button", { name: /0x9965\.\.\.a4dc/i })).toBeVisible();
  await expect(page.getByText(/Loading Rewards/)).toBeVisible();
  await expect(page.getByRole("heading", { name: "Sign In With X" })).toHaveCount(0);

  releaseClaimsLookup();

  await expect(page.getByRole("heading", { name: "Sign In With X" })).toBeVisible();
  await expect(page.getByText("No claim was found for this wallet. Sign in with X to start follower recovery.")).toBeVisible();
  await expect(page.getByRole("button", { name: "Sign in with X" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Available Claims" })).toHaveCount(0);
  await expect(page.getByText(/Loading Rewards/)).toHaveCount(0);
  await expect(page.getByText("Nothing available right now.")).toHaveCount(0);
  await expect(page.getByText("If anything is available for this wallet, it will appear here.")).toHaveCount(0);
});
