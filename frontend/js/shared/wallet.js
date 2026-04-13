import { ethers } from "./ethers.js";
import { CHAIN_NAME_BY_ID, WALLET_SESSION_KEY, toChainIdHex } from "./constants.js";

const EIP6963_ANNOUNCE_EVENT = "eip6963:announceProvider";
const EIP6963_REQUEST_EVENT = "eip6963:requestProvider";
const LEGACY_WALLET_PREFIX = "legacy";
const LEGACY_DEFAULT_WALLET_ID = `${LEGACY_WALLET_PREFIX}:default`;

const discoveredWallets = new Map();
const providerIds = new WeakMap();
const walletEventSubscribers = new Set();

let discoveryInitialized = false;
let activeInjectedProvider = null;
let boundWalletEventProvider = null;
let boundAccountsChanged = null;
let boundChainChanged = null;

function createWalletId(source, name, fallback = "wallet") {
  return `${source}:${String(name || fallback).trim().toLowerCase().replace(/[^a-z0-9]+/g, "-") || fallback}`;
}

function normalizeWalletSession(rawSession) {
  if (!rawSession) return null;

  if (rawSession === "injected") {
    return { walletId: LEGACY_DEFAULT_WALLET_ID };
  }

  if (rawSession.trim().startsWith("{")) {
    try {
      const parsed = JSON.parse(rawSession);
      if (typeof parsed?.walletId === "string" && parsed.walletId) {
        return { walletId: parsed.walletId };
      }
    } catch {
      return null;
    }
  }

  return typeof rawSession === "string" && rawSession ? { walletId: rawSession } : null;
}

function saveWalletSession(walletId) {
  if (!walletId) {
    clearWalletSession();
    return;
  }

  window.localStorage.setItem(WALLET_SESSION_KEY, JSON.stringify({ walletId }));
}

function clearWalletSession() {
  window.localStorage.removeItem(WALLET_SESSION_KEY);
}

function getWalletSession() {
  return normalizeWalletSession(window.localStorage.getItem(WALLET_SESSION_KEY));
}

export function hasWalletSession() {
  return Boolean(getWalletSession()?.walletId);
}

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

function applyNetworkToRuntime(runtime, network) {
  runtime.chainId = Number(network.chainId);
  runtime.chainName = resolveChainName(runtime, runtime.chainId, network.name);
}

function guessLegacyWalletName(provider) {
  if (provider?.isPhantom) return "Phantom";
  if (provider?.isRabby) return "Rabby";
  if (provider?.isCoinbaseWallet) return "Coinbase Wallet";
  if (provider?.isMetaMask) return "MetaMask";
  if (provider?.isBraveWallet) return "Brave Wallet";
  if (provider?.isFrame) return "Frame";
  if (provider?.isTally) return "Taho";
  return "Injected Wallet";
}

function guessLegacyWalletRdns(provider) {
  if (provider?.isPhantom) return "app.phantom";
  if (provider?.isRabby) return "io.rabby";
  if (provider?.isCoinbaseWallet) return "com.coinbase.wallet";
  if (provider?.isMetaMask) return "io.metamask";
  if (provider?.isBraveWallet) return "com.brave.wallet";
  if (provider?.isFrame) return "sh.frame";
  if (provider?.isTally) return "so.tally";
  return "";
}

function getWalletSortLabel(wallet) {
  return `${wallet.info?.name || ""}|${wallet.info?.rdns || ""}|${wallet.id || ""}`.toLowerCase();
}

function listWalletsSnapshot() {
  return [...discoveredWallets.values()].sort((left, right) => getWalletSortLabel(left).localeCompare(getWalletSortLabel(right)));
}

function unbindWalletEventProvider() {
  if (boundWalletEventProvider?.removeListener && boundAccountsChanged && boundChainChanged) {
    boundWalletEventProvider.removeListener("accountsChanged", boundAccountsChanged);
    boundWalletEventProvider.removeListener("chainChanged", boundChainChanged);
  }

  boundWalletEventProvider = null;
  boundAccountsChanged = null;
  boundChainChanged = null;
}

async function notifyAccountsChanged() {
  for (const subscriber of walletEventSubscribers) {
    if (subscriber.onAccountsChanged) {
      await subscriber.onAccountsChanged();
    }
  }
}

async function notifyChainChanged(chainId) {
  for (const subscriber of walletEventSubscribers) {
    if (subscriber.onChainChanged) {
      await subscriber.onChainChanged(chainId);
    }
  }
}

function getReadOnlyInjectedProvider() {
  if (window.ethereum) return window.ethereum;
  return listWalletsSnapshot()[0]?.provider || null;
}

function getCurrentInjectedProvider() {
  return activeInjectedProvider || getReadOnlyInjectedProvider();
}

function syncWalletEventProvider() {
  const nextProvider = walletEventSubscribers.size ? getCurrentInjectedProvider() : null;

  if (!nextProvider?.on) {
    unbindWalletEventProvider();
    return;
  }

  if (boundWalletEventProvider === nextProvider) {
    return;
  }

  unbindWalletEventProvider();

  boundAccountsChanged = async () => {
    await notifyAccountsChanged();
  };

  boundChainChanged = async (chainId) => {
    await notifyChainChanged(chainId);
  };

  nextProvider.on("accountsChanged", boundAccountsChanged);
  nextProvider.on("chainChanged", boundChainChanged);
  boundWalletEventProvider = nextProvider;
}

function registerWallet(candidate) {
  const provider = candidate?.provider;
  if (!provider || typeof provider.request !== "function") return null;

  const existingId = providerIds.get(provider);
  const info = candidate?.info || {};
  const nextId = existingId
    || candidate?.id
    || info.uuid
    || info.rdns
    || createWalletId(candidate?.source || LEGACY_WALLET_PREFIX, info.name, "wallet");
  const previous = discoveredWallets.get(nextId);

  const descriptor = {
    id: nextId,
    provider,
    source: candidate?.source || previous?.source || LEGACY_WALLET_PREFIX,
    info: {
      uuid: info.uuid || previous?.info?.uuid || "",
      name: info.name || previous?.info?.name || "Injected Wallet",
      icon: info.icon || previous?.info?.icon || "",
      rdns: info.rdns || previous?.info?.rdns || "",
    },
  };

  discoveredWallets.set(nextId, descriptor);
  providerIds.set(provider, nextId);
  syncWalletEventProvider();
  return descriptor;
}

function registerLegacyWallet(provider, index = 0) {
  return registerWallet({
    id: index === 0 ? LEGACY_DEFAULT_WALLET_ID : createWalletId(LEGACY_WALLET_PREFIX, `${guessLegacyWalletName(provider)}-${index + 1}`),
    provider,
    source: LEGACY_WALLET_PREFIX,
    info: {
      name: guessLegacyWalletName(provider),
      rdns: guessLegacyWalletRdns(provider),
      icon: "",
      uuid: "",
    },
  });
}

function collectLegacyWallets() {
  if (!window.ethereum) return [];

  const rawProviders = Array.isArray(window.ethereum.providers) && window.ethereum.providers.length
    ? window.ethereum.providers
    : [window.ethereum];
  const uniqueProviders = [...new Set(rawProviders.filter(Boolean))];

  return uniqueProviders
    .map((provider, index) => registerLegacyWallet(provider, index))
    .filter(Boolean);
}

function requestWalletAnnouncements() {
  try {
    window.dispatchEvent(new Event(EIP6963_REQUEST_EVENT));
  } catch {
    // Some browsers may reject synthetic events during teardown.
  }
}

function initWalletDiscovery() {
  if (discoveryInitialized || typeof window === "undefined") return;

  discoveryInitialized = true;
  window.addEventListener(EIP6963_ANNOUNCE_EVENT, (event) => {
    const detail = event?.detail;
    if (!detail?.provider) return;

    registerWallet({
      id: detail.info?.uuid || detail.info?.rdns || createWalletId("eip6963", detail.info?.name, "wallet"),
      provider: detail.provider,
      source: "eip6963",
      info: detail.info || {},
    });
  });

  collectLegacyWallets();
  requestWalletAnnouncements();
}

function wait(ms) {
  return new Promise((resolve) => {
    window.setTimeout(resolve, ms);
  });
}

async function discoverWallets(waitMs = 250) {
  initWalletDiscovery();
  collectLegacyWallets();
  requestWalletAnnouncements();

  if (waitMs > 0) {
    await wait(waitMs);
    collectLegacyWallets();
  }

  return listWalletsSnapshot();
}

function applyActiveWallet(runtime, wallet) {
  const nextInjectedProvider = wallet?.provider || null;

  activeInjectedProvider = nextInjectedProvider;
  runtime.selectedWalletId = wallet?.id || null;
  runtime.selectedWalletName = wallet?.info?.name || null;
  runtime.selectedWalletRdns = wallet?.info?.rdns || null;
  runtime.injectedProvider = nextInjectedProvider;

  if (runtime.providerSource !== nextInjectedProvider) {
    runtime.provider = null;
    runtime.providerSource = null;
    runtime.signer = null;
  }

  syncWalletEventProvider();
}

async function resolveWalletById(walletId) {
  if (!walletId) return null;
  const cachedWallet = discoveredWallets.get(walletId);
  if (cachedWallet) return cachedWallet;
  const wallets = await discoverWallets();
  return wallets.find((wallet) => wallet.id === walletId) || null;
}

export async function getAvailableWallets() {
  const wallets = await discoverWallets();
  return wallets.map((wallet) => ({
    id: wallet.id,
    source: wallet.source,
    info: { ...wallet.info },
  }));
}

export async function ensureProvider(runtime) {
  await discoverWallets();
  const injected = runtime.injectedProvider || getReadOnlyInjectedProvider();
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
  runtime.chainName = null;
}

export async function connectWallet(runtime, walletId) {
  const wallet = await resolveWalletById(walletId);
  if (!wallet) {
    throw new Error("The selected wallet is no longer available. Refresh the page and try again.");
  }

  applyActiveWallet(runtime, wallet);

  const provider = await ensureProvider(runtime);
  await provider.send("eth_requestAccounts", []);
  runtime.signer = await provider.getSigner();
  runtime.account = await runtime.signer.getAddress();
  const network = await provider.getNetwork();
  applyNetworkToRuntime(runtime, network);
  saveWalletSession(wallet.id);
  return runtime.account;
}

export async function disconnectWallet(runtime) {
  clearWalletSession();
  runtime.account = null;
  runtime.signer = null;
  applyActiveWallet(runtime, null);

  try {
    const provider = await ensureProvider(runtime);
    const network = await provider.getNetwork();
    applyNetworkToRuntime(runtime, network);
  } catch {
    runtime.chainId = null;
    runtime.chainName = null;
  }
}

export async function syncWalletState(runtime) {
  const session = getWalletSession();
  const selectedWallet = session?.walletId ? await resolveWalletById(session.walletId) : null;

  if (session?.walletId && !selectedWallet) {
    clearWalletSession();
  }

  applyActiveWallet(runtime, selectedWallet);

  const injected = runtime.injectedProvider || getReadOnlyInjectedProvider();
  if (!injected) {
    runtime.account = null;
    runtime.signer = null;
    runtime.chainId = null;
    runtime.chainName = null;
    runtime.provider = null;
    runtime.providerSource = null;
    return;
  }

  const provider = await ensureProvider(runtime);
  const network = await provider.getNetwork();

  applyNetworkToRuntime(runtime, network);

  if (!hasWalletSession()) {
    runtime.account = null;
    runtime.signer = null;
    return;
  }

  const accounts = await provider.send("eth_accounts", []);
  runtime.account = accounts[0] ? ethers.getAddress(accounts[0]) : null;
  runtime.signer = runtime.account ? await provider.getSigner() : null;

  if (!runtime.account) {
    clearWalletSession();
  }
}

function getRequestCapableProvider() {
  return getCurrentInjectedProvider();
}

export async function addConfiguredNetwork(config) {
  const injected = getRequestCapableProvider();
  if (!injected) throw new Error("No compatible wallet was detected.");
  if (!Number.isInteger(Number(config.chainId))) throw new Error("Configured chainId is required.");
  if (!config.networkName || !config.rpcUrl || !config.nativeCurrency) {
    throw new Error("Configured networkName, rpcUrl, and nativeCurrency are required.");
  }

  const chainIdHex = toChainIdHex(config.chainId);

  await injected.request({
    method: "wallet_addEthereumChain",
    params: [
      {
        chainId: chainIdHex,
        chainName: config.networkName,
        rpcUrls: [config.rpcUrl],
        nativeCurrency: config.nativeCurrency,
      },
    ],
  });
}

export async function switchConfiguredNetwork(config) {
  const injected = getRequestCapableProvider();
  if (!injected) throw new Error("No compatible wallet was detected.");
  if (!Number.isInteger(Number(config.chainId))) throw new Error("Configured chainId is required.");

  const chainIdHex = toChainIdHex(config.chainId);

  try {
    await injected.request({
      method: "wallet_switchEthereumChain",
      params: [{ chainId: chainIdHex }],
    });
  } catch (error) {
    if (error?.code === 4902) {
      await addConfiguredNetwork(config);
      await switchConfiguredNetwork(config);
      return;
    }

    throw error;
  }
}

export function bindWalletEvents({ onAccountsChanged, onChainChanged }) {
  const subscriber = { onAccountsChanged, onChainChanged };
  walletEventSubscribers.add(subscriber);
  initWalletDiscovery();
  syncWalletEventProvider();

  return () => {
    walletEventSubscribers.delete(subscriber);
    syncWalletEventProvider();
  };
}
