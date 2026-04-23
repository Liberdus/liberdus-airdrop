const { expect, test, toHexChainId } = require("../../fixtures/testWithMockWallet");

test.describe("admin wallet discovery", () => {
  test.use({ walletDiscoveryMode: "manual-eip6963" });

  test("admin auto-switches the configured network through the selected wallet", async ({ page, mockWallet }) => {
    await page.addInitScript(() => {
      const icon = "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 1 1'%3E%3Crect width='1' height='1' fill='%23f6851b'/%3E%3C/svg%3E";
      window.localStorage.setItem("__wallet_switch_log__", "[]");

      function appendSwitch(walletName, method) {
        const current = JSON.parse(window.localStorage.getItem("__wallet_switch_log__") || "[]");
        current.push({ walletName, method });
        window.localStorage.setItem("__wallet_switch_log__", JSON.stringify(current));
      }

      function createProvider(walletName) {
        return {
          get isMetaMask() {
            return true;
          },
          request(args) {
            const method = String(args?.method || "");
            if (method.startsWith("wallet_")) {
              appendSwitch(walletName, method);
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

    await page.goto("admin.html");
    await page.getByRole("button", { name: "Connect Wallet" }).click();
    await page.getByRole("button", { name: /^MetaMask Secondary$/ }).click();
    await expect(page.getByText("Owner wallet detected. Admin controls are unlocked.")).toBeVisible();
    await mockWallet.setChainId(page, toHexChainId(31337));
    await expect(page.locator("#accountRole")).toHaveText("Wrong network");
    await page.getByRole("button", { name: "Switch to Configured Network" }).click();
    await expect(page.getByText("Switched to Hardhat Local.")).toBeVisible();
    await expect(page.getByText("Owner wallet detected. Admin controls are unlocked.")).toBeVisible();

    const switchLog = await page.evaluate(() => JSON.parse(window.localStorage.getItem("__wallet_switch_log__") || "[]"));
    expect(switchLog).toContainEqual({ walletName: "MetaMask Secondary", method: "wallet_switchEthereumChain" });
    expect([...new Set(switchLog.map((entry) => entry.walletName))]).toEqual(["MetaMask Secondary"]);
  });

  test("admin connects through the latest announced provider wrapper", async ({ page }) => {
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

    await page.goto("admin.html");
    await page.getByRole("button", { name: "Connect Wallet" }).click();
    await page.getByRole("button", { name: /^MetaMask$/ }).click();

    await expect(page.getByText("Owner wallet detected. Admin controls are unlocked.")).toBeVisible();
    await expect(page.getByRole("button", { name: /0xf39f\.\.\.2266/i })).toBeVisible();
  });
});
