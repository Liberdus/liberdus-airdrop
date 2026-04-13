import { ethers } from "./ethers.js";
import { CHAIN_NAME_BY_ID, WALLET_SESSION_KEY, toChainIdHex } from "./constants.js";

function getInjectedProvider() {
  // Placeholder for future EIP-6963 wallet selection. For now we use the legacy injected provider.
  return window.ethereum || null;
}

function saveWalletSession(sessionValue = "injected") {
  window.localStorage.setItem(WALLET_SESSION_KEY, sessionValue);
}

function clearWalletSession() {
  window.localStorage.removeItem(WALLET_SESSION_KEY);
}

function getWalletSession() {
  return window.localStorage.getItem(WALLET_SESSION_KEY);
}

export function hasWalletSession() {
  return Boolean(getWalletSession());
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

export async function ensureProvider(runtime) {
  const injected = getInjectedProvider();
  if (!injected) throw new Error("MetaMask was not detected in this browser.");
  if (!runtime.provider) runtime.provider = new ethers.BrowserProvider(injected);
  return runtime.provider;
}

export function resetProvider(runtime, nextChainId = null) {
  runtime.provider = null;
  runtime.signer = null;
  if (nextChainId !== null && nextChainId !== undefined) {
    runtime.chainId = Number(nextChainId);
    runtime.chainName = resolveChainName(runtime, runtime.chainId, null);
    return;
  }
  runtime.chainName = null;
}

export async function connectWallet(runtime) {
  const provider = await ensureProvider(runtime);
  await provider.send("eth_requestAccounts", []);
  runtime.signer = await provider.getSigner();
  runtime.account = await runtime.signer.getAddress();
  const network = await provider.getNetwork();
  applyNetworkToRuntime(runtime, network);
  saveWalletSession();
  return runtime.account;
}

export async function disconnectWallet(runtime) {
  clearWalletSession();
  runtime.account = null;
  runtime.signer = null;

  if (runtime.provider) {
    const network = await runtime.provider.getNetwork();
    applyNetworkToRuntime(runtime, network);
  } else {
    runtime.chainId = null;
    runtime.chainName = null;
  }
}

export async function syncWalletState(runtime) {
  const injected = getInjectedProvider();
  if (!injected) {
    runtime.account = null;
    runtime.signer = null;
    runtime.chainId = null;
    runtime.chainName = null;
    runtime.provider = null;
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

export async function addConfiguredNetwork(config) {
  const injected = getInjectedProvider();
  if (!injected) throw new Error("MetaMask was not detected.");
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
  const injected = getInjectedProvider();
  if (!injected) throw new Error("MetaMask was not detected.");
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
  const injected = getInjectedProvider();
  if (!injected?.on) return () => {};

  const handleAccountsChanged = async () => {
    if (onAccountsChanged) await onAccountsChanged();
  };

  const handleChainChanged = async (chainId) => {
    if (onChainChanged) await onChainChanged(chainId);
  };

  injected.on("accountsChanged", handleAccountsChanged);
  injected.on("chainChanged", handleChainChanged);

  return () => {
    if (injected.removeListener) {
      injected.removeListener("accountsChanged", handleAccountsChanged);
      injected.removeListener("chainChanged", handleChainChanged);
    }
  };
}
