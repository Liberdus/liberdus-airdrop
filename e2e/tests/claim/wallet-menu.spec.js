const { expect, test } = require("../../fixtures/testWithMockWallet");
const { connectViaWalletPicker, enableXRecovery, mockXAuthSession, openWalletMenu } = require("../helpers");

const X_RECOVERY_RECEIVED_MESSAGE = "Your response has been received. You may be eligible for future airdrop rounds.";

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

test("claimant wallet with no claims sees X recovery instead of the generic empty state", async ({ page, hardhatChain }) => {
  await enableXRecovery(page, hardhatChain.backendUrl);

  await page.goto("index.html");
  await connectViaWalletPicker(page);

  await expect(page.getByRole("button", { name: /0xf39f\.\.\.2266/i })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Sign In With X" })).toBeVisible();
  await expect(page.getByText("No claim was found for this wallet. Sign in with X to start follower recovery.")).toBeVisible();
  await expect(page.getByRole("heading", { name: "Available Claims" })).toHaveCount(0);
  await expect(page.getByText("Nothing available right now.")).toHaveCount(0);
  await expect(page.getByText("If anything is available for this wallet, it will appear here.")).toHaveCount(0);

  await openWalletMenu(page, /0xf39f\.\.\.2266/i);
  await expect(page.locator("#walletMenu")).toBeVisible();
  await expect(page.locator("#walletMenuChainId")).toHaveText("1337");
});

test("wallet picker merges a provider-array wallet with the same EIP-6963 wallet announcement", async ({ page }) => {
  await page.addInitScript(() => {
    const icon = "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 1 1'%3E%3Crect width='1' height='1' fill='%23f6851b'/%3E%3C/svg%3E";
    window.ethereum.providers = [window.ethereum];

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

test("wallet picker keeps distinct EIP-6963 wallets separate when they share a brand", async ({ page }) => {
  await page.addInitScript(() => {
    const icon = "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 1 1'%3E%3Crect width='1' height='1' fill='%2353f3c3'/%3E%3C/svg%3E";

    function createProvider() {
      return {
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
    }

    window.addEventListener("eip6963:requestProvider", () => {
      const wallets = [
        { uuid: "phantom-alpha-wallet", name: "Phantom Alpha", rdns: "com.phantom.alpha" },
        { uuid: "phantom-beta-wallet", name: "Phantom Beta", rdns: "com.phantom.beta" },
      ];

      for (const wallet of wallets) {
        window.dispatchEvent(new CustomEvent("eip6963:announceProvider", {
          detail: {
            info: {
              ...wallet,
              icon,
            },
            provider: createProvider(),
          },
        }));
      }
    });
  });

  await page.goto("index.html");
  await page.getByRole("button", { name: "Connect Wallet" }).click();

  await expect(page.getByRole("button", { name: /^Phantom/ })).toHaveCount(2);
  await expect(page.getByRole("button", { name: /^Phantom Alpha$/ })).toHaveCount(1);
  await expect(page.getByRole("button", { name: /^Phantom Beta$/ })).toHaveCount(1);
});

test("wallet picker keeps Frame separate from unrelated announced sh-prefixed wallets", async ({ page }) => {
  await page.addInitScript(() => {
    const icon = "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 1 1'%3E%3Crect width='1' height='1' fill='%233b82f6'/%3E%3C/svg%3E";

    const markAsFrame = () => {
      if (!window.ethereum) return;
      window.ethereum.isMetaMask = false;
      window.ethereum.isFrame = true;
    };

    markAsFrame();
    window.addEventListener("ethereum#initialized", markAsFrame);

    window.addEventListener("eip6963:requestProvider", () => {
      const provider = {
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
            uuid: "random-sh-wallet",
            name: "Random Wallet",
            icon,
            rdns: "sh.random.wallet",
          },
          provider,
        },
      }));
    });
  });

  await page.goto("index.html");
  await page.getByRole("button", { name: "Connect Wallet" }).click();

  await expect(page.getByRole("button", { name: /Frame/ })).toHaveCount(1);
  await expect(page.getByRole("button", { name: /^Random Wallet$/ })).toHaveCount(1);
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

test.describe("Manual EIP-6963 announcements", () => {
  test.use({ walletDiscoveryMode: "manual-eip6963" });

  test("wallet picker keeps distinct announced wallets separate when they share rdns", async ({ page }) => {
    await page.addInitScript(() => {
      const icon = "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 1 1'%3E%3Crect width='1' height='1' fill='%23f6851b'/%3E%3C/svg%3E";

      function createProvider() {
        return {
          get isMetaMask() {
            return true;
          },
          request(args) {
            return window.__liberdusMockWalletProvider.request(args);
          },
          on(...args) {
            return window.__liberdusMockWalletProvider.on(...args);
          },
          removeListener(...args) {
            return window.__liberdusMockWalletProvider.removeListener(...args);
          },
          off(...args) {
            return window.__liberdusMockWalletProvider.off?.(...args);
          },
          once(...args) {
            return window.__liberdusMockWalletProvider.once?.(...args);
          },
        };
      }

      window.addEventListener("eip6963:requestProvider", () => {
        const wallets = [
          { uuid: "metamask-primary-wallet", name: "MetaMask Primary", rdns: "io.metamask" },
          { uuid: "metamask-secondary-wallet", name: "MetaMask Secondary", rdns: "io.metamask" },
        ];

        for (const wallet of wallets) {
          window.dispatchEvent(new CustomEvent("eip6963:announceProvider", {
            detail: {
              info: {
                ...wallet,
                icon,
              },
              provider: createProvider(),
            },
          }));
        }
      });
    });

    await page.goto("index.html");
    await page.getByRole("button", { name: "Connect Wallet" }).click();

    await expect(page.getByRole("button", { name: /^MetaMask/ })).toHaveCount(2);
    await expect(page.getByRole("button", { name: /^MetaMask Primary$/ })).toHaveCount(1);
    await expect(page.getByRole("button", { name: /^MetaMask Secondary$/ })).toHaveCount(1);
  });

  test("selected announced wallet session restores after reload", async ({ page }) => {
    await page.addInitScript(() => {
      const icon = "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 1 1'%3E%3Crect width='1' height='1' fill='%23f6851b'/%3E%3C/svg%3E";

      function appendRequest(walletName, method) {
        const current = JSON.parse(window.localStorage.getItem("__wallet_request_log__") || "[]");
        current.push({ walletName, method });
        window.localStorage.setItem("__wallet_request_log__", JSON.stringify(current));
      }

      function createProvider(walletName) {
        return {
          get isMetaMask() {
            return true;
          },
          request(args) {
            appendRequest(walletName, String(args?.method || ""));
            return window.__liberdusMockWalletProvider.request(args);
          },
          on(...args) {
            return window.__liberdusMockWalletProvider.on(...args);
          },
          removeListener(...args) {
            return window.__liberdusMockWalletProvider.removeListener(...args);
          },
          off(...args) {
            return window.__liberdusMockWalletProvider.off?.(...args);
          },
          once(...args) {
            return window.__liberdusMockWalletProvider.once?.(...args);
          },
        };
      }

      window.addEventListener("eip6963:requestProvider", () => {
        const wallets = [
          { uuid: "metamask-primary-wallet", name: "MetaMask Primary", rdns: "io.metamask" },
          { uuid: "metamask-secondary-wallet", name: "MetaMask Secondary", rdns: "io.metamask" },
        ];

        for (const wallet of wallets) {
          window.dispatchEvent(new CustomEvent("eip6963:announceProvider", {
            detail: {
              info: {
                ...wallet,
                icon,
              },
              provider: createProvider(wallet.name),
            },
          }));
        }
      });
    });

    await page.goto("index.html");
    await page.getByRole("button", { name: "Connect Wallet" }).click();
    await page.getByRole("button", { name: /^MetaMask Secondary$/ }).click();
    await expect(page.getByRole("button", { name: /0xf39f\.\.\.2266/i })).toBeVisible();

    await page.evaluate(() => {
      window.localStorage.setItem("__wallet_request_log__", "[]");
    });

    await page.reload();
    await expect(page.getByRole("button", { name: /0xf39f\.\.\.2266/i })).toBeVisible();
    await page.waitForFunction(() => {
      const entries = JSON.parse(window.localStorage.getItem("__wallet_request_log__") || "[]");
      return entries.length > 0;
    });

    const requestLog = await page.evaluate(() => JSON.parse(window.localStorage.getItem("__wallet_request_log__") || "[]"));
    const restoredWalletNames = [...new Set(requestLog.map((entry) => entry.walletName))];
    expect(restoredWalletNames).toEqual(["MetaMask Secondary"]);
    await expect.poll(async () => page.evaluate(() => {
      return JSON.parse(window.localStorage.getItem("liberdus-airdrop-wallet-session") || "null")?.walletId || null;
    })).toBe("metamask-secondary-wallet");
  });

  test("wallet picker uses the latest announced provider wrapper", async ({ page }) => {
    await page.addInitScript(() => {
      const icon = "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 1 1'%3E%3Crect width='1' height='1' fill='%23f6851b'/%3E%3C/svg%3E";
      let latestGeneration = 0;

      function createProvider(wrapperGeneration) {
        return {
          get isMetaMask() {
            return true;
          },
          request(args) {
            if (wrapperGeneration !== latestGeneration) {
              const error = new Error("Stale EIP-6963 wrapper");
              error.code = 4999;
              throw error;
            }
            return window.__liberdusMockWalletProvider.request(args);
          },
          on(...args) {
            return window.__liberdusMockWalletProvider.on(...args);
          },
          removeListener(...args) {
            return window.__liberdusMockWalletProvider.removeListener(...args);
          },
          off(...args) {
            return window.__liberdusMockWalletProvider.off?.(...args);
          },
          once(...args) {
            return window.__liberdusMockWalletProvider.once?.(...args);
          },
        };
      }

      window.addEventListener("eip6963:requestProvider", () => {
        latestGeneration += 1;
        window.dispatchEvent(new CustomEvent("eip6963:announceProvider", {
          detail: {
            info: {
              uuid: "metamask-live-wrapper",
              name: "MetaMask",
              icon,
              rdns: "io.metamask",
            },
            provider: createProvider(latestGeneration),
          },
        }));
      });
    });

    await page.goto("index.html");
    await page.getByRole("button", { name: "Connect Wallet" }).click();
    await page.getByRole("button", { name: /^MetaMask$/ }).click();

    await expect(page.getByRole("button", { name: /0xf39f\.\.\.2266/i })).toBeVisible();
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

test("wallet picker shows Phantom as unavailable on BNB Smart Chain", async ({ page }) => {
  await page.addInitScript(() => {
    const storageKey = "liberdus-airdrop-ui-config";
    const current = JSON.parse(window.localStorage.getItem(storageKey) || "{}");
    window.localStorage.setItem(storageKey, JSON.stringify({
      ...current,
      chainId: 56,
      networkName: "BNB Smart Chain",
      rpcUrl: "https://bsc-dataseed.binance.org",
      explorerBaseUrl: "https://bscscan.com",
      nativeCurrency: {
        name: "BNB",
        symbol: "BNB",
        decimals: 18,
      },
    }));

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
            uuid: "phantom-bnb-wallet",
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

  const phantomOption = page.locator(".wallet-picker-option", { hasText: "Phantom Wallet" });
  await expect(phantomOption).toHaveCount(1);
  await expect(phantomOption).toBeDisabled();
  await expect(phantomOption).toContainText("Doesn't support BNB Smart Chain.");

  await page.evaluate(() => {
    const button = [...document.querySelectorAll(".wallet-picker-option")]
      .find((candidate) => candidate.textContent?.includes("Phantom Wallet"));
    if (!(button instanceof HTMLButtonElement)) {
      throw new Error("Phantom option not found.");
    }

    button.disabled = false;
    button.click();
  });

  await expect(page.locator("#claimToastMessage")).toHaveText(
    "Connect wallet: Phantom Wallet does not support BNB Smart Chain.",
  );
  await expect(page.getByRole("button", { name: /0xf39f\.\.\.2266/i })).toHaveCount(0);
});

test("wallet picker waits for config before disabling Phantom on BNB Smart Chain", async ({ page }) => {
  await page.route("**/config.local.json", async (route) => {
    await new Promise((resolve) => {
      setTimeout(resolve, 750);
    });
    await route.continue();
  });

  await page.addInitScript(() => {
    const storageKey = "liberdus-airdrop-ui-config";
    const current = JSON.parse(window.localStorage.getItem(storageKey) || "{}");
    window.localStorage.setItem(storageKey, JSON.stringify({
      ...current,
      chainId: 56,
      networkName: "BNB Smart Chain",
      rpcUrl: "https://bsc-dataseed.binance.org",
      explorerBaseUrl: "https://bscscan.com",
      nativeCurrency: {
        name: "BNB",
        symbol: "BNB",
        decimals: 18,
      },
    }));

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
            uuid: "phantom-delayed-config-wallet",
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

  const phantomOption = page.locator(".wallet-picker-option", { hasText: "Phantom Wallet" });
  await expect(phantomOption).toHaveCount(1);
  await expect(phantomOption).toBeDisabled();
  await expect(phantomOption).toContainText("Doesn't support BNB Smart Chain.");
});

test("connect button shows a busy state while waiting for wallet config", async ({ page }) => {
  await page.route("**/config.local.json", async (route) => {
    await new Promise((resolve) => {
      setTimeout(resolve, 750);
    });
    await route.continue();
  });

  await page.goto("index.html");
  await page.getByRole("button", { name: "Connect Wallet" }).click();

  await expect(page.getByRole("button", { name: "Connecting..." })).toBeDisabled();
  await expect(page.locator(".wallet-picker")).toBeVisible();
});

test("wallet picker does not show a stray MetaMask entry for Firefox-style Phantom provider arrays", async ({ page }) => {
  await page.addInitScript(() => {
    const storageKey = "liberdus-airdrop-ui-config";
    const current = JSON.parse(window.localStorage.getItem(storageKey) || "{}");
    window.localStorage.setItem(storageKey, JSON.stringify({
      ...current,
      chainId: 56,
      networkName: "BNB Smart Chain",
      rpcUrl: "https://bsc-dataseed.binance.org",
      explorerBaseUrl: "https://bscscan.com",
      nativeCurrency: {
        name: "BNB",
        symbol: "BNB",
        decimals: 18,
      },
    }));

    const icon = "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 1 1'%3E%3Crect width='1' height='1' fill='%2353f3c3'/%3E%3C/svg%3E";

    window.ethereum.providers = [window.ethereum];
    window.ethereum.isMetaMask = true;
    window.ethereum.isPhantom = false;
    window.phantom = { ethereum: window.ethereum };

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
            uuid: "firefox-phantom-wallet",
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

  await expect(page.locator(".wallet-picker-option", { hasText: "Phantom Wallet" })).toHaveCount(1);
  await expect(page.getByRole("button", { name: /MetaMask/i })).toHaveCount(0);
  await expect(page.locator(".wallet-picker-option", { hasText: "Phantom Wallet" })).toBeDisabled();
});

test("wallet picker removes a stale legacy entry once a later Phantom match is found", async ({ page }) => {
  await page.addInitScript(() => {
    let legacyLooksLikePhantom = false;
    const icon = "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 1 1'%3E%3Crect width='1' height='1' fill='%2353f3c3'/%3E%3C/svg%3E";

    window.addEventListener("ethereum#initialized", () => {
      Object.defineProperty(window.ethereum, "isMetaMask", {
        configurable: true,
        get() {
          return false;
        },
      });
      Object.defineProperty(window.ethereum, "isPhantom", {
        configurable: true,
        get() {
          return legacyLooksLikePhantom;
        },
      });
    });

    window.addEventListener("eip6963:requestProvider", () => {
      legacyLooksLikePhantom = true;

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
            uuid: "late-phantom-match",
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

  await expect(page.getByRole("button", { name: /Phantom/i })).toHaveCount(1);
  await expect(page.getByRole("button", { name: /Injected Wallet/i })).toHaveCount(0);
});

test("stale legacy shim sessions are cleared instead of rebinding to an announced wallet", async ({ page }) => {
  await page.addInitScript(() => {
    window.localStorage.setItem("liberdus-airdrop-wallet-session", JSON.stringify({ walletId: "legacy:default" }));

    const icon = "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 1 1'%3E%3Crect width='1' height='1' fill='%2353f3c3'/%3E%3C/svg%3E";
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
            uuid: "unrelated-phantom-wallet",
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
  await expect(page.getByRole("button", { name: "Connect Wallet" })).toBeVisible();
  await expect.poll(async () => page.evaluate(() => window.localStorage.getItem("liberdus-airdrop-wallet-session"))).toBeNull();

  await page.getByRole("button", { name: "Connect Wallet" }).click();
  await expect(page.getByText("Last used")).toHaveCount(0);
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

test("connected claimant with an existing X recovery response sees the future rounds copy", async ({
  page,
  hardhatChain,
  mockWallet,
}) => {
  const sessionPayload = {
    expiresAt: Date.now() + 60 * 60 * 1000,
    csrfToken: "test-csrf-token",
    authenticatedAt: new Date().toISOString(),
    profile: {
      id: "12345",
      name: "Liberdus Fan",
      username: "liberdus_fan",
      profileImageUrl: "",
    },
    account: null,
    existingSubmission: {
      id: "submission-1",
      xUserId: "12345",
      usernameAtSubmission: "liberdus_fan",
      walletAddress: mockWallet.accounts.claimant,
      wasKnownFollower: true,
      wasRecoveryCandidate: true,
      status: "received",
      submittedAt: new Date().toISOString(),
    },
  };

  await enableXRecovery(page, hardhatChain.backendUrl);
  await mockXAuthSession(page, sessionPayload);

  await page.goto("index.html");
  await mockWallet.setAccount(page, mockWallet.accounts.claimant);
  await connectViaWalletPicker(page);

  await expect(page.getByRole("heading", { name: "Sign In With X" })).toBeVisible();
  await expect(page.getByText("@liberdus_fan")).toBeVisible();
  await expect(page.getByText(X_RECOVERY_RECEIVED_MESSAGE)).toBeVisible();
  await expect(page.getByText("We already received a response for this X account.")).toHaveCount(0);
  await expect(page.getByRole("heading", { name: "Available Claims" })).toHaveCount(0);
  await expect(page.getByText("Nothing available right now.")).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Verify Wallet And Save" })).toHaveCount(0);
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

test("claimant footer hides explorer link when airdrop address is unset", async ({ page }) => {
  await page.route("**/config.local.json", async (route) => {
    const response = await route.fetch();
    const config = await response.json();
    delete config.airdropAddress;

    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(config),
    });
  });

  await page.goto("index.html");

  await expect(page.locator("#tokenExplorerLink")).toBeHidden();
});
