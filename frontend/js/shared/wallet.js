import { ethers } from "./ethers.js";
import { CHAIN_NAME_BY_ID, WALLET_SESSION_KEY } from "./constants.js";
import { createWalletCore } from "../../vendor/liberdus-wallet-module/index.js";
import { switchOrAddEthereumChain } from "../../vendor/liberdus-wallet-module/adapters/chain.js";

const walletCore = createWalletCore({
  walletSessionKey: WALLET_SESSION_KEY,
  discoveryWaitMs: 250,
});

function resolveChainName(runtime, chainId, networkName) {
  const numericChainId = Number(chainId);
  if (!Number.isFinite(numericChainId)) return null;
  if (runtime?.config?.chainId === numericChainId && runtime?.config?.networkName) {
    return runtime.config.networkName;
  }

  if (typeof networkName === "string" && networkName && networkName !== "unknown") {
    return networkName;
  }

  return CHAIN_NAME_BY_ID[numericChainId] || null;
}

export function parseWalletChainId(rawChainId) {
  if (typeof rawChainId === "number" && Number.isFinite(rawChainId)) {
    return rawChainId;
  }

  if (typeof rawChainId === "bigint") {
    return Number(rawChainId);
  }

  if (typeof rawChainId === "string" && rawChainId.trim()) {
    const normalized = rawChainId.trim().toLowerCase();
    const chainId = normalized.startsWith("0x")
      ? Number.parseInt(normalized, 16)
      : Number(normalized);
    return Number.isFinite(chainId) ? chainId : null;
  }

  return null;
}

async function syncRuntimeChainFromInjected(runtime) {
  const state = walletCore.getState();
  const stateChainId = parseWalletChainId(state.chainId);
  if (stateChainId !== null && Number.isFinite(stateChainId)) {
    runtime.chainId = stateChainId;
    runtime.chainName = resolveChainName(runtime, stateChainId, state.chainName);
    return true;
  }

  const injected = getInjectedProviderForRuntime(runtime);
  if (!injected?.request) return false;

  try {
    const chainId = parseWalletChainId(await injected.request({ method: "eth_chainId" }));
    if (chainId === null || !Number.isFinite(chainId)) return false;
    runtime.chainId = chainId;
    runtime.chainName = resolveChainName(runtime, chainId, null);
    return true;
  } catch {
    return false;
  }
}

function normalizeWalletIdentityValue(value) {
  return String(value || "").trim().toLowerCase();
}

function isBnbChainConfig(config) {
  const chainId = Number(config?.chainId);
  return chainId === 56 || chainId === 97;
}

function getConfiguredNetworkLabel(config) {
  return String(config?.networkName || "").trim() || "the configured network";
}

function isPhantomWallet(wallet) {
  if (!wallet) return false;

  const name = normalizeWalletIdentityValue(wallet.info?.name);
  const rdns = normalizeWalletIdentityValue(wallet.info?.rdns);
  return name.includes("phantom")
    || rdns.includes("phantom")
    || Boolean(wallet.provider?.isPhantom);
}

function getWalletCompatibility(config, wallet) {
  if (!wallet) {
    return {
      isSupported: true,
      isDisabled: false,
      disabledReason: "",
      errorMessage: "",
    };
  }

  if (isBnbChainConfig(config) && isPhantomWallet(wallet)) {
    const networkLabel = getConfiguredNetworkLabel(config);
    const walletName = wallet.info?.name || "This wallet";
    return {
      isSupported: false,
      isDisabled: true,
      disabledReason: `Doesn't support ${networkLabel}.`,
      errorMessage: `${walletName} does not support ${networkLabel}.`,
    };
  }

  return {
    isSupported: true,
    isDisabled: false,
    disabledReason: "",
    errorMessage: "",
  };
}

function assertWalletSupported(config, wallet) {
  const compatibility = getWalletCompatibility(config, wallet);
  if (!compatibility.isSupported) {
    throw new Error(compatibility.errorMessage);
  }

  return compatibility;
}

function resetProviderIfChanged(runtime, injectedProvider) {
  if (runtime.providerSource === injectedProvider) return;

  runtime.provider = null;
  runtime.providerSource = null;
  runtime.signer = null;
}

function syncWalletCoreStateToRuntime(runtime) {
  const state = walletCore.getState();
  const selectedProvider = state.selectedWalletId ? walletCore.getEip1193Provider() : null;

  runtime.account = state.account ? ethers.getAddress(state.account) : null;
  runtime.selectedWalletId = state.selectedWalletId || null;
  runtime.selectedWalletName = state.selectedWalletName || null;
  runtime.selectedWalletRdns = state.selectedWalletRdns || null;
  runtime.selectedWalletIcon = state.selectedWalletIcon || null;
  runtime.injectedProvider = selectedProvider;

  if (state.chainId !== null && state.chainId !== undefined) {
    runtime.chainId = Number(state.chainId);
    runtime.chainName = resolveChainName(runtime, runtime.chainId, state.chainName);
  }

  resetProviderIfChanged(runtime, selectedProvider || runtime.providerSource);
}

function getInjectedProviderForRuntime(runtime) {
  if (runtime?.selectedWalletId) {
    return runtime.injectedProvider || walletCore.getEip1193Provider();
  }

  return walletCore.getEip1193Provider();
}

function getRequestCapableProvider() {
  return walletCore.getEip1193Provider();
}

export function hasWalletSession() {
  return walletCore.hasWalletSession();
}

export async function getAvailableWallets(config = null) {
  const wallets = await walletCore.discoverWallets();
  return wallets.map((wallet) => {
    const compatibility = getWalletCompatibility(config, wallet);
    return {
      id: wallet.id,
      source: wallet.source,
      info: { ...wallet.info },
      isDisabled: compatibility.isDisabled,
      disabledReason: compatibility.disabledReason,
    };
  });
}

export async function ensureProvider(runtime) {
  if (!getInjectedProviderForRuntime(runtime)) {
    await walletCore.discoverWallets();
  }
  const injected = getInjectedProviderForRuntime(runtime);
  if (!injected) throw new Error("No compatible wallet was detected in this browser.");

  if (!runtime.provider || runtime.providerSource !== injected) {
    runtime.provider = new ethers.BrowserProvider(injected);
    runtime.providerSource = injected;
  }

  return runtime.provider;
}

export function resetProvider(runtime, nextChainId = null) {
  runtime.provider = null;
  runtime.providerSource = null;
  runtime.signer = null;
  if (nextChainId !== null && nextChainId !== undefined) {
    runtime.chainId = Number(nextChainId);
    runtime.chainName = resolveChainName(runtime, runtime.chainId, null);
    return;
  }
  runtime.chainId = null;
  runtime.chainName = null;
}

export async function connectWallet(runtime, walletId) {
  const wallet = await walletCore.resolveWalletById(walletId);
  if (!wallet) {
    throw new Error("The selected wallet is no longer available. Refresh the page and try again.");
  }

  assertWalletSupported(runtime?.config, wallet);

  await walletCore.connect({ walletId: wallet.id });
  syncWalletCoreStateToRuntime(runtime);
  await syncRuntimeChainFromInjected(runtime);

  const provider = await ensureProvider(runtime);
  runtime.signer = await provider.getSigner();
  runtime.account = ethers.getAddress(await runtime.signer.getAddress());
  return runtime.account;
}

export async function disconnectWallet(runtime) {
  await walletCore.disconnect();
  syncWalletCoreStateToRuntime(runtime);
  runtime.account = null;
  runtime.signer = null;

  const hasChain = await syncRuntimeChainFromInjected(runtime);
  if (!hasChain) {
    runtime.chainId = null;
    runtime.chainName = null;
  }
}

export async function syncWalletState(runtime) {
  if (!hasWalletSession()) {
    await walletCore.discoverWallets();
  }
  await walletCore.sync();

  const restoredWalletId = walletCore.getState().selectedWalletId;
  const restoredWallet = restoredWalletId
    ? await walletCore.resolveWalletById(restoredWalletId)
    : null;
  if (restoredWallet) {
    try {
      assertWalletSupported(runtime?.config, restoredWallet);
    } catch {
      await walletCore.disconnect();
    }
  }

  syncWalletCoreStateToRuntime(runtime);

  const injected = getInjectedProviderForRuntime(runtime);
  if (!injected) {
    runtime.account = null;
    runtime.signer = null;
    runtime.chainId = null;
    runtime.chainName = null;
    runtime.provider = null;
    runtime.providerSource = null;
    return;
  }

  await syncRuntimeChainFromInjected(runtime);

  if (!hasWalletSession()) {
    runtime.account = null;
    runtime.signer = null;
    return;
  }

  runtime.account = walletCore.getState().account
    ? ethers.getAddress(walletCore.getState().account)
    : null;
  const provider = await ensureProvider(runtime);
  runtime.signer = runtime.account ? await provider.getSigner() : null;

  if (!runtime.account) {
    await walletCore.disconnect();
    syncWalletCoreStateToRuntime(runtime);
  }
}

export async function addConfiguredNetwork(config) {
  const injected = getRequestCapableProvider();
  if (!injected) throw new Error("No compatible wallet was detected.");
  await switchOrAddEthereumChain(injected, {
    chainId: config?.chainId,
    chainName: config?.networkName,
    rpcUrls: [config?.rpcUrl],
    nativeCurrency: config?.nativeCurrency,
  });
}

export async function switchConfiguredNetwork(config) {
  const injected = getRequestCapableProvider();
  if (!injected) throw new Error("No compatible wallet was detected.");
  await switchOrAddEthereumChain(injected, {
    chainId: config?.chainId,
    chainName: config?.networkName,
    rpcUrls: [config?.rpcUrl],
    nativeCurrency: config?.nativeCurrency,
  });
}

export function bindWalletEvents({ onAccountsChanged, onChainChanged }) {
  const scheduleEventHandler = (handler, data) => {
    if (!handler) return;

    const run = () => {
      Promise.resolve(handler(data)).catch(() => {});
    };

    if (typeof window !== "undefined" && typeof window.setTimeout === "function") {
      window.setTimeout(run, 0);
      return;
    }

    run();
  };

  return walletCore.subscribe((event, data) => {
    if (event === "accountChanged") {
      scheduleEventHandler(onAccountsChanged, data);
      return;
    }

    if (event === "chainChanged") {
      scheduleEventHandler(onChainChanged, data);
    }
  });
}
