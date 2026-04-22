const { expect, test } = require("../../fixtures/testWithMockWallet");
const { connectViaWalletPicker, openWalletMenu } = require("../helpers");

test("claimant wallet menu shows the connected address, chain id, and disconnect flow", async ({ page }) => {
  await page.goto("index.html");
  await connectViaWalletPicker(page);
  await expect(page.getByText("Nothing available right now.")).toBeVisible();

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

test("wallet picker merges a legacy wallet with the same EIP-6963 wallet announcement", async ({ page }) => {
  await page.addInitScript(() => {
    const icon = "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 1 1'%3E%3Crect width='1' height='1' fill='%23f6851b'/%3E%3C/svg%3E";

    window.addEventListener("eip6963:requestProvider", () => {
      const provider = {
        get isMetaMask() {
          return Boolean(window.ethereum?.isMetaMask);
        },
        request(args) {
          return window.ethereum.request(args);
        },
        on(...args) {
          return window.ethereum.on(...args);
        },
        removeListener(...args) {
          return window.ethereum.removeListener(...args);
        },
        off(...args) {
          return window.ethereum.off?.(...args);
        },
        once(...args) {
          return window.ethereum.once?.(...args);
        },
      };

      window.dispatchEvent(new CustomEvent("eip6963:announceProvider", {
        detail: {
          info: {
            uuid: "test-metamask-wallet",
            name: "MetaMask",
            icon,
            rdns: "io.metamask",
          },
          provider,
        },
      }));
    });
  });

  await page.goto("index.html");
  await page.getByRole("button", { name: "Connect Wallet" }).click();

  const metaMaskOption = page.getByRole("button", { name: /^MetaMask$/ });
  await expect(metaMaskOption).toHaveCount(1);
  await metaMaskOption.click();
  await expect(page.getByRole("button", { name: /0xf39f\.\.\.2266/i })).toBeVisible();
});

test.describe("EIP-6963-only wallet discovery", () => {
  test.use({ walletDiscoveryMode: "eip6963-only" });

  test("claimant page connects through an announced provider without window.ethereum", async ({ page }) => {
    await page.goto("index.html");
    await page.getByRole("button", { name: "Connect Wallet" }).click();

    const metaMaskOption = page.getByRole("button", { name: /^MetaMask$/ });
    await expect(metaMaskOption).toHaveCount(1);
    await metaMaskOption.click();
    await expect(page.getByText("Nothing available right now.")).toBeVisible();

    await openWalletMenu(page, /0xf39f\.\.\.2266/i);
    await expect(page.locator("#walletMenu")).toBeVisible();
    await expect(page.locator("#walletMenuChainId")).toHaveText("1337");
  });
});

test("wallet picker merges Firefox-style Phantom variants into one option", async ({ page }) => {
  await page.addInitScript(() => {
    const icon = "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 1 1'%3E%3Crect width='1' height='1' fill='%2353f3c3'/%3E%3C/svg%3E";

    window.addEventListener("ethereum#initialized", () => {
      window.ethereum.isPhantom = true;
    });

    window.addEventListener("eip6963:requestProvider", () => {
      const provider = {
        get isPhantom() {
          return true;
        },
        request(args) {
          return window.ethereum.request(args);
        },
        on(...args) {
          return window.ethereum.on(...args);
        },
        removeListener(...args) {
          return window.ethereum.removeListener(...args);
        },
        off(...args) {
          return window.ethereum.off?.(...args);
        },
        once(...args) {
          return window.ethereum.once?.(...args);
        },
      };

      window.dispatchEvent(new CustomEvent("eip6963:announceProvider", {
        detail: {
          info: {
            uuid: "test-phantom-wallet",
            name: "Phantom Wallet",
            icon,
            rdns: "com.phantom.browser",
          },
          provider,
        },
      }));
    });
  });

  await page.goto("index.html");
  await page.getByRole("button", { name: "Connect Wallet" }).click();

  const phantomOptions = page.getByRole("button", { name: /Phantom/i });
  await expect(phantomOptions).toHaveCount(1);
  await phantomOptions.first().click();
  await expect(page.getByRole("button", { name: /0xf39f\.\.\.2266/i })).toBeVisible();
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
