const path = require("node:path");
const { expect, test: base } = require("@playwright/test");
const {
  createSnapshot,
  resetLocalChain,
  revertSnapshot,
  rpcCall,
  RPC_URL,
} = require("../helpers/hardhatChain");

const STORAGE_KEY = "liberdus-airdrop-ui-config";
const DEFAULT_UI_CONFIG = {
  claimsManifestPath: "./claims/e2e/index.json",
  explorerBaseUrl: "https://explorer.local.test",
};

const MOCK_WALLETS = {
  owner: "0xf39fd6e51aad88f6f4ce6ab8827279cfffb92266",
  claimant: "0x70997970c51812dc3a010c7d01b50e0d17dc79c8",
  secondary: "0x3c44cdddb6a900fa2b585dd299e03d12fa4293bc",
  outsider: "0x9965507d1a55bcc2695c58ba16fb37d819b0a4dc",
};

function toHexChainId(chainId) {
  if (typeof chainId === "string" && chainId.toLowerCase().startsWith("0x")) {
    return chainId.toLowerCase();
  }

  return `0x${Number.parseInt(String(chainId), 10).toString(16)}`;
}

function installHardhatBackedWalletMock(config) {
  const CONNECTED_STORAGE_KEY = "__liberdus_mock_wallet_connected__";
  const ACCOUNT_STORAGE_KEY = "__liberdus_mock_wallet_account__";
  const CHAIN_STORAGE_KEY = "__liberdus_mock_wallet_chain__";
  const listenerMap = new Map();
  const queuedFailures = new Map();
  const knownChains = new Set([String(config.chainId).toLowerCase()]);
  const globalWindow = window;
  let connected = localStorage.getItem(CONNECTED_STORAGE_KEY) === "true";
  let currentAccount = (localStorage.getItem(ACCOUNT_STORAGE_KEY) || config.account).toLowerCase();
  let currentChainId = (localStorage.getItem(CHAIN_STORAGE_KEY) || String(config.chainId)).toLowerCase();
  let nextId = 1;

  const normalizeChainId = (value) => {
    const normalized = String(value || "").toLowerCase();
    if (normalized.startsWith("0x")) return normalized;
    return `0x${Number.parseInt(normalized, 10).toString(16)}`;
  };

  const persistState = () => {
    localStorage.setItem(CONNECTED_STORAGE_KEY, connected ? "true" : "false");
    localStorage.setItem(ACCOUNT_STORAGE_KEY, currentAccount);
    localStorage.setItem(CHAIN_STORAGE_KEY, currentChainId);
  };

  const emit = (event, payload) => {
    const listeners = listenerMap.get(event);
    if (!listeners) return;

    for (const listener of listeners) {
      try {
        listener(payload);
      } catch {
        // Ignore listener errors to mirror wallet event emitters.
      }
    }
  };

  const rpcRequest = async (method, params = []) => {
    const response = await fetch(config.rpcUrl, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        id: nextId++,
        jsonrpc: "2.0",
        method,
        params,
      }),
    });

    const payload = await response.json();
    if (payload.error) {
      const error = new Error(payload.error.message || `RPC error for ${method}`);
      error.code = payload.error.code;
      error.data = payload.error.data;
      throw error;
    }

    return payload.result;
  };

  const buildMockError = (failure = {}, fallbackMethod = "wallet request") => {
    const error = new Error(failure.message || `Mocked failure for ${fallbackMethod}`);
    if (typeof failure.code === "number") error.code = failure.code;
    if (failure.data !== undefined) error.data = failure.data;
    if (failure.shortMessage) error.shortMessage = failure.shortMessage;
    if (failure.reason) error.reason = failure.reason;
    return error;
  };

  const maybeThrowQueuedFailure = (method) => {
    const queue = queuedFailures.get(method);
    if (!queue?.length) return;

    const failure = queue.shift();
    if (!queue.length) {
      queuedFailures.delete(method);
    }

    throw buildMockError(failure, method);
  };

  class HardhatBackedEthereumProvider {
    constructor() {
      this.isMetaMask = true;
      this.providers = [this];
      this._metamask = {
        isUnlocked: async () => true,
      };
    }

    get selectedAddress() {
      return connected ? currentAccount : null;
    }

    get chainId() {
      return currentChainId;
    }

    get networkVersion() {
      return String(Number.parseInt(currentChainId, 16));
    }

    isConnected() {
      return connected;
    }

    on(event, listener) {
      if (!listenerMap.has(event)) {
        listenerMap.set(event, new Set());
      }

      listenerMap.get(event).add(listener);
      return this;
    }

    removeListener(event, listener) {
      listenerMap.get(event)?.delete(listener);
      return this;
    }

    off(event, listener) {
      return this.removeListener(event, listener);
    }

    once(event, listener) {
      const wrapped = (payload) => {
        this.removeListener(event, wrapped);
        listener(payload);
      };

      return this.on(event, wrapped);
    }

    enable() {
      return this.request({ method: "eth_requestAccounts" });
    }

    async request(args = {}) {
      const method = args.method;
      const params = args.params ?? [];

      if (!method) {
        const error = new Error("Invalid request: method is required");
        error.code = -32600;
        throw error;
      }

      maybeThrowQueuedFailure(method);

      if (method === "eth_requestAccounts") {
        connected = true;
        persistState();
        emit("connect", { chainId: currentChainId });
        emit("accountsChanged", [currentAccount]);
        return [currentAccount];
      }

      if (method === "eth_accounts") {
        return connected ? [currentAccount] : [];
      }

      if (method === "eth_chainId") {
        return currentChainId;
      }

      if (method === "net_version") {
        return String(Number.parseInt(currentChainId, 16));
      }

      if (method === "wallet_watchAsset") {
        return true;
      }

      if (method === "wallet_addEthereumChain") {
        const target = params[0]?.chainId;
        if (!target) {
          const error = new Error("wallet_addEthereumChain requires chainId");
          error.code = -32602;
          throw error;
        }

        knownChains.add(normalizeChainId(target));
        return null;
      }

      if (method === "wallet_switchEthereumChain") {
        const target = params[0]?.chainId;
        if (!target) {
          const error = new Error("wallet_switchEthereumChain requires chainId");
          error.code = -32602;
          throw error;
        }

        const normalized = normalizeChainId(target);
        if (!knownChains.has(normalized)) {
          const error = new Error("Unrecognized chain");
          error.code = 4902;
          throw error;
        }

        currentChainId = normalized;
        persistState();
        emit("chainChanged", currentChainId);
        return null;
      }

      if (method === "eth_sendTransaction" && params[0] && !params[0].from) {
        params[0].from = currentAccount;
      }

      if (
        method.startsWith("eth_")
        || method.startsWith("net_")
        || method.startsWith("web3_")
        || method.startsWith("debug_")
        || method.startsWith("txpool_")
      ) {
        return rpcRequest(method, Array.isArray(params) ? params : [params]);
      }

      const error = new Error(`Unsupported wallet method: ${method}`);
      error.code = 4200;
      throw error;
    }
  }

  const provider = new HardhatBackedEthereumProvider();

  Object.defineProperty(globalWindow, "ethereum", {
    configurable: false,
    enumerable: true,
    writable: false,
    value: provider,
  });

  Object.defineProperty(globalWindow, "__liberdusMockWallet", {
    configurable: false,
    enumerable: false,
    writable: false,
    value: {
      setAccount(nextAccount) {
        currentAccount = String(nextAccount).toLowerCase();
        persistState();
        if (connected) {
          emit("accountsChanged", [currentAccount]);
        }
        return currentAccount;
      },
      setChainId(nextChainId) {
        currentChainId = normalizeChainId(nextChainId);
        knownChains.add(currentChainId);
        persistState();
        emit("chainChanged", currentChainId);
        return currentChainId;
      },
      setConnected(nextConnected) {
        connected = Boolean(nextConnected);
        persistState();
        emit("accountsChanged", connected ? [currentAccount] : []);
        return connected;
      },
      failNextRequest(method, failure) {
        const normalizedMethod = String(method || "");
        const queue = queuedFailures.get(normalizedMethod) || [];
        queue.push(failure || {});
        queuedFailures.set(normalizedMethod, queue);
        return queue.length;
      },
      reset() {
        connected = false;
        currentAccount = String(config.account).toLowerCase();
        currentChainId = String(config.chainId).toLowerCase();
        queuedFailures.clear();
        persistState();
      },
    },
  });

  let existingUiConfig = {};
  try {
    existingUiConfig = JSON.parse(localStorage.getItem(config.storageKey) || "{}");
  } catch {
    existingUiConfig = {};
  }

  localStorage.setItem(config.storageKey, JSON.stringify({
    claimsManifestPath: config.claimsManifestPath,
    explorerBaseUrl: config.explorerBaseUrl,
    ...existingUiConfig,
  }));

  window.dispatchEvent(new Event("ethereum#initialized"));
}

const test = base.extend({
  hardhatChain: [async ({}, use) => {
    await resetLocalChain();
    let baseSnapshotId = await createSnapshot(RPC_URL);

    await use({
      rpcCall: (method, params = []) => rpcCall(method, params, RPC_URL),
      async resetToBase(testTitle = "test") {
        const reverted = await revertSnapshot(baseSnapshotId, RPC_URL);
        if (!reverted) {
          throw new Error(`Failed to revert Hardhat snapshot ${baseSnapshotId} before ${testTitle}.`);
        }

        baseSnapshotId = await createSnapshot(RPC_URL);
        return baseSnapshotId;
      },
      rpcUrl: RPC_URL,
    });
  }, { scope: "worker" }],
  isolatedChain: [
    async ({ hardhatChain }, use, testInfo) => {
      await hardhatChain.resetToBase(testInfo.title);
      await use();
    },
    { auto: true },
  ],
  context: async ({ context }, use) => {
    await context.addInitScript(installHardhatBackedWalletMock, {
      account: MOCK_WALLETS.owner,
      chainId: toHexChainId(1337),
      rpcUrl: RPC_URL,
      storageKey: STORAGE_KEY,
      claimsManifestPath: "./claims/e2e/index.json",
      explorerBaseUrl: "https://explorer.local.test",
    });

    await use(context);
  },
  mockWallet: async ({}, use) => {
    await use({
      accounts: { ...MOCK_WALLETS },
      async setAccount(page, account) {
        return page.evaluate(
          (nextAccount) => window.__liberdusMockWallet.setAccount(nextAccount),
          account,
        );
      },
      async setChainId(page, chainId) {
        return page.evaluate(
          (nextChainId) => window.__liberdusMockWallet.setChainId(nextChainId),
          chainId,
        );
      },
      async setConnected(page, connected) {
        return page.evaluate(
          (nextConnected) => window.__liberdusMockWallet.setConnected(nextConnected),
          connected,
        );
      },
      async connect(page) {
        return page.evaluate(() => window.ethereum.request({ method: "eth_requestAccounts" }));
      },
      async failNextRequest(page, method, failure) {
        return page.evaluate(
          ({ nextMethod, nextFailure }) => window.__liberdusMockWallet.failNextRequest(nextMethod, nextFailure),
          { nextMethod: method, nextFailure: failure },
        );
      },
      async setUiConfig(page, overrides) {
        return page.evaluate(
          ({ storageKey, nextOverrides }) => {
            const current = JSON.parse(window.localStorage.getItem(storageKey) || "{}");
            const merged = { ...current, ...nextOverrides };
            window.localStorage.setItem(storageKey, JSON.stringify(merged));
            return merged;
          },
          { storageKey: STORAGE_KEY, nextOverrides: overrides },
        );
      },
      async resetUiConfig(page) {
        return page.evaluate(
          ({ storageKey, defaults }) => {
            window.localStorage.setItem(storageKey, JSON.stringify(defaults));
            return defaults;
          },
          { storageKey: STORAGE_KEY, defaults: DEFAULT_UI_CONFIG },
        );
      },
    });
  },
  e2eClaimsFile: async ({}, use) => {
    await use(path.join(process.cwd(), "frontend", "claims", "e2e", "epoch-1.claims.json"));
  },
  e2eClaimsFileEpoch2: async ({}, use) => {
    await use(path.join(process.cwd(), "frontend", "claims", "e2e", "epoch-2.claims.json"));
  },
  e2eMultiEpochManifest: async ({}, use) => {
    await use("./claims/e2e/index.multi-epoch.json");
  },
});

module.exports = {
  expect,
  test,
  toHexChainId,
};
