import { ethers } from "./ethers.js";
import { HARDHAT_LOCAL, WALLET_SESSION_KEY } from "./constants.js";

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

export async function ensureProvider(runtime) {
  const injected = getInjectedProvider();
  if (!injected) throw new Error("MetaMask was not detected in this browser.");
  if (!runtime.provider) runtime.provider = new ethers.BrowserProvider(injected);
  return runtime.provider;
}

export async function connectWallet(runtime) {
  const provider = await ensureProvider(runtime);
  await provider.send("eth_requestAccounts", []);
  runtime.signer = await provider.getSigner();
  runtime.account = await runtime.signer.getAddress();
  const network = await provider.getNetwork();
  runtime.chainId = Number(network.chainId);
  saveWalletSession();
  return runtime.account;
}

export async function disconnectWallet(runtime) {
  clearWalletSession();
  runtime.account = null;
  runtime.signer = null;

  if (runtime.provider) {
    const network = await runtime.provider.getNetwork();
    runtime.chainId = Number(network.chainId);
  } else {
    runtime.chainId = null;
  }
}

export async function syncWalletState(runtime) {
  const injected = getInjectedProvider();
  if (!injected) {
    runtime.account = null;
    runtime.signer = null;
    runtime.chainId = null;
    runtime.provider = null;
    return;
  }

  const provider = await ensureProvider(runtime);
  const network = await provider.getNetwork();

  runtime.chainId = Number(network.chainId);

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

  await injected.request({
    method: "wallet_addEthereumChain",
    params: [
      {
        chainId: config.chainIdHex || HARDHAT_LOCAL.chainIdHex,
        chainName: config.networkName || HARDHAT_LOCAL.networkName,
        rpcUrls: [config.rpcUrl || HARDHAT_LOCAL.rpcUrl],
        nativeCurrency: config.nativeCurrency || HARDHAT_LOCAL.nativeCurrency,
      },
    ],
  });
}

export async function switchConfiguredNetwork(config) {
  const injected = getInjectedProvider();
  if (!injected) throw new Error("MetaMask was not detected.");

  try {
    await injected.request({
      method: "wallet_switchEthereumChain",
      params: [{ chainId: config.chainIdHex || HARDHAT_LOCAL.chainIdHex }],
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

  const handleChainChanged = async () => {
    if (onChainChanged) await onChainChanged();
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
