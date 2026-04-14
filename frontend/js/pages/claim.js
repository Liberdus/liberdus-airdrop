import { ethers } from "../shared/ethers.js";
import { loadUiConfig } from "../shared/config.js";
import { getContracts, fetchDashboardSnapshot } from "../shared/contracts.js";
import { createErrorReporter, bindGlobalErrorHandlers, formatUiError } from "../shared/errors.js";
import {
  normalizeAddress,
  formatAddressShort,
  formatDeadlineShort,
  formatTokenAmount,
} from "../shared/format.js";
import { sendTransaction } from "../shared/tx.js";
import { createToastController } from "../shared/toast.js";
import {
  ensureProvider,
  connectWallet,
  disconnectWallet,
  resetProvider,
  syncWalletState,
  switchConfiguredNetwork,
  bindWalletEvents,
  getAvailableWallets,
} from "../shared/wallet.js";
import { promptForWalletSelection } from "../shared/wallet-picker.js";
import { loadClaimCatalog, fetchClaimSource, findClaimEntry, isMissingClaimSourceError } from "../shared/claims.js";

const runtime = {
  provider: null,
  providerSource: null,
  readProvider: null,
  readProviderKey: null,
  signer: null,
  account: null,
  chainId: null,
  chainName: null,
  injectedProvider: null,
  selectedWalletId: null,
  selectedWalletName: null,
  selectedWalletRdns: null,
  owner: null,
  currentEpoch: 0,
  config: { chainId: null, networkName: "", rpcUrl: "", nativeCurrency: null, tokenAddress: "", dustTokenAddress: "", airdropAddress: "", claimsManifestPath: "./claims/index.json" },
  configSource: "template",
  tokenDecimals: 18,
  tokenSymbol: "LIB",
  claimCatalog: null,
  rounds: [],
  isConnectingWallet: false,
  noticeTimerId: null,
};

const els = {
  claimHeader: document.getElementById("claimHeader"),
  connectButton: document.getElementById("connectButton"),
  walletMenu: document.getElementById("walletMenu"),
  walletMenuAddress: document.getElementById("walletMenuAddress"),
  walletMenuChainId: document.getElementById("walletMenuChainId"),
  adminPageButton: document.getElementById("adminPageButton"),
  copyWalletAddressButton: document.getElementById("copyWalletAddressButton"),
  disconnectButton: document.getElementById("disconnectButton"),
  roundList: document.getElementById("roundList"),
  addTokenLink: document.getElementById("addTokenLink"),
  tokenExplorerLink: document.getElementById("tokenExplorerLink"),
  claimToast: document.getElementById("claimToast"),
  claimToastMessage: document.getElementById("claimToastMessage"),
  claimToastClose: document.getElementById("claimToastClose"),
  switchNetworkButton: document.getElementById("switchNetworkButton"),
};

const toast = createToastController({
  element: els.claimToast,
  messageElement: els.claimToastMessage,
  closeButton: els.claimToastClose,
});

function setMessage(message, type = "info") {
  if (!els.claimToast) return;

  let nextMessage = message;
  if (message.startsWith("Claim: submitted")) {
    nextMessage = "Claim submitted. Confirm it in your wallet.";
  } else if (message.startsWith("Claim: confirmed")) {
    nextMessage = "Claim complete.";
  } else if (message.startsWith("Connected ")) {
    nextMessage = "Wallet connected.";
  }

  toast.show(nextMessage, type);

  if (runtime.noticeTimerId) {
    window.clearTimeout(runtime.noticeTimerId);
  }

  runtime.noticeTimerId = window.setTimeout(() => {
    clearMessage();
  }, type === "error" ? 7000 : 5000);
}

function clearMessage() {
  if (runtime.noticeTimerId) {
    window.clearTimeout(runtime.noticeTimerId);
    runtime.noticeTimerId = null;
  }
  toast.hide();
}

function ensureReadProvider() {
  const providerKey = `${runtime.config.rpcUrl || ""}|${runtime.config.chainId || ""}`;
  if (!runtime.readProvider || runtime.readProviderKey !== providerKey) {
    runtime.readProvider = new ethers.JsonRpcProvider(runtime.config.rpcUrl, runtime.config.chainId);
    runtime.readProviderKey = providerKey;
  }

  return runtime.readProvider;
}

const logger = { log: setMessage, clear: clearMessage };
const reportError = createErrorReporter(logger.log, () => runtime);
let pageInitPromise = Promise.resolve();

function updateToastOffset() {
  if (!els.claimHeader) return;
  const headerHeight = Math.ceil(els.claimHeader.getBoundingClientRect().height);
  document.documentElement.style.setProperty("--claim-toast-top", `${headerHeight + 14}px`);
}

function isReadyChain() {
  return runtime.chainId === runtime.config.chainId;
}

function setWalletMenuOpen(isOpen) {
  if (!els.walletMenu || !els.connectButton || !runtime.account) {
    els.walletMenu?.setAttribute("hidden", "");
    if (els.connectButton) els.connectButton.setAttribute("aria-expanded", "false");
    return;
  }

  if (isOpen) {
    els.walletMenu.removeAttribute("hidden");
    els.connectButton.setAttribute("aria-expanded", "true");
  } else {
    els.walletMenu.setAttribute("hidden", "");
    els.connectButton.setAttribute("aria-expanded", "false");
  }
}

function toggleWalletMenu() {
  if (!runtime.account) return;
  const isHidden = els.walletMenu?.hasAttribute("hidden");
  setWalletMenuOpen(Boolean(isHidden));
}

async function copyWalletAddress() {
  if (!runtime.account) return;

  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(runtime.account);
    logger.log("Wallet address copied.", "success");
    return;
  }

  const input = document.createElement("input");
  input.value = runtime.account;
  document.body.appendChild(input);
  input.select();
  document.execCommand("copy");
  input.remove();
  logger.log("Wallet address copied.", "success");
}

async function addTokenToMetaMask() {
  const injected = runtime.injectedProvider || window.ethereum;
  if (!injected?.request) {
    throw new Error("MetaMask was not detected in this browser.");
  }

  if (!runtime.config.tokenAddress) {
    throw new Error("Token address is not configured.");
  }

  const wasAdded = await injected.request({
    method: "wallet_watchAsset",
    params: {
      type: "ERC20",
      options: {
        address: runtime.config.tokenAddress,
        symbol: runtime.tokenSymbol || "LIB",
        decimals: runtime.tokenDecimals ?? 18,
      },
    },
  });

  if (wasAdded) {
    logger.log("Token added to MetaMask.", "success");
    return;
  }

  logger.log("Token import was closed.");
}

function isMetaMaskWalletSelected() {
  const walletName = String(runtime.selectedWalletName || "").toLowerCase();
  const walletRdns = String(runtime.selectedWalletRdns || "").toLowerCase();
  const provider = runtime.injectedProvider;

  if (
    walletRdns.includes("phantom")
    || provider?.isPhantom
    || provider?.isBraveWallet
    || provider?.isCoinbaseWallet
    || provider?.isRabby
  ) {
    return false;
  }

  if (walletRdns) return walletRdns.includes("metamask");
  if (walletName) return walletName.includes("metamask");

  return Boolean(provider?.isMetaMask);
}

function syncWalletButton() {
  const label = runtime.account
    ? formatAddressShort(runtime.account)
    : runtime.isConnectingWallet
      ? "Connecting..."
      : "Connect Wallet";
  els.connectButton.textContent = label;
  els.connectButton.disabled = runtime.isConnectingWallet;
  els.connectButton.setAttribute("aria-busy", runtime.isConnectingWallet ? "true" : "false");
  els.walletMenuAddress.textContent = runtime.account ? formatAddressShort(runtime.account) : "-";
  els.walletMenuAddress.title = runtime.account || "";
  els.walletMenuChainId.textContent = runtime.chainId == null ? "-" : String(runtime.chainId);
  if (els.switchNetworkButton) {
    els.switchNetworkButton.hidden = !runtime.account || isReadyChain();
  }
  const showAdminLink = Boolean(
    runtime.account
    && runtime.owner
    && normalizeAddress(runtime.account) === normalizeAddress(runtime.owner),
  );
  els.adminPageButton.hidden = !showAdminLink;
  setWalletMenuOpen(false);
}

function updateFooterLinks() {
  const hasTokenAddress = Boolean(runtime.config.tokenAddress);
  const showAddToWallet = hasTokenAddress && runtime.account && isMetaMaskWalletSelected();
  els.addTokenLink.hidden = !showAddToWallet;
  if (showAddToWallet) {
    els.addTokenLink.href = "#";
  } else {
    els.addTokenLink.removeAttribute("href");
  }

  const explorerBaseUrl = String(runtime.config.explorerBaseUrl || "").trim().replace(/\/+$/, "");
  if (explorerBaseUrl && hasTokenAddress) {
    els.tokenExplorerLink.href = `${explorerBaseUrl}/address/${runtime.config.tokenAddress}`;
    els.tokenExplorerLink.hidden = false;
  } else {
    els.tokenExplorerLink.hidden = true;
    els.tokenExplorerLink.removeAttribute("href");
  }
}

async function switchNetwork() {
  await switchConfiguredNetwork(runtime.config);
  resetProvider(runtime, runtime.config.chainId);
  await refreshPage();
  logger.log(`Switched to ${runtime.config.networkName}.`, "success");
}

function getVisibleRounds() {
  return runtime.rounds
    .filter(
      (round) => !["not-live", "closed", "no-allocation", "connect", "mismatch", "error"].includes(round.status),
    )
    .sort((left, right) => {
      const leftEpoch = Number(left.epoch || left.source.epoch || 0);
      const rightEpoch = Number(right.epoch || right.source.epoch || 0);
      return rightEpoch - leftEpoch;
    });
}

function getRoundActionMeta(round) {
  switch (round.status) {
    case "claimable":
      return { label: isReadyChain() ? "Claim" : "Switch Network to Claim", disabled: false };
    case "claimed":
      return { label: "Already Claimed", disabled: true };
    case "mismatch":
      return { label: "Unavailable", disabled: true };
    case "ambiguous":
      return { label: "Unavailable", disabled: true };
    case "no-allocation":
      return { label: "Not Eligible", disabled: true };
    case "connect":
      return { label: "Connect Wallet", disabled: true };
    default:
      return { label: "Unavailable", disabled: true };
  }
}

function renderRoundList() {
  const visibleRounds = getVisibleRounds();

  if (!visibleRounds.length) {
    const title = runtime.account
      ? "Nothing available right now."
      : "Connect your wallet to check for claims.";
    const description = runtime.account
      ? "If anything is available for this wallet, it will appear here."
      : "Available claims will appear here after you connect.";

    els.roundList.innerHTML = `
      <article class="round-card muted">
        <p class="round-title">${title}</p>
        <p class="round-meta">${description}</p>
      </article>
    `;
    return;
  }

  els.roundList.innerHTML = visibleRounds
    .map((round) => {
      const action = getRoundActionMeta(round);
      const amountText = round.entry
        ? formatTokenAmount(round.amountRaw, runtime.tokenDecimals, runtime.tokenSymbol)
        : "Not eligible";

      return `
        <article class="round-card">
          <p class="round-amount">${amountText}</p>
          <p class="round-meta">${round.deadline ? `Ends ${formatDeadlineShort(round.deadline)}` : "Not scheduled"}</p>
          <button
            type="button"
            class="round-claim-button"
            data-round-claim="${round.epoch || ""}"
            ${action.disabled ? "disabled" : ""}
          >${action.label}</button>
        </article>
      `;
    })
    .join("");

  document.querySelectorAll("[data-round-claim]").forEach((button) => {
    button.addEventListener("click", () => {
      claimRound(Number(button.dataset.roundClaim)).catch((error) => {
        reportError(error, "Claim");
      });
    });
  });
}

async function buildRoundView(source) {
  let artifact;
  try {
    artifact = await fetchClaimSource(source, runtime.claimCatalog.baseUrl, runtime.tokenDecimals);
  } catch (error) {
    if (isMissingClaimSourceError(error)) {
      console.warn(
        `[Claims] Claim file not found for epoch ${source.epoch}: ${source.file}`,
        error,
      );

      return {
        source,
        artifact: null,
        entry: null,
        epoch: source.epoch,
        amountRaw: 0n,
        onchainRoot: ethers.ZeroHash,
        deadline: 0n,
        claimed: false,
        status: "error",
        errorMessage: "",
      };
    }

    throw error;
  }

  const entry = runtime.account ? findClaimEntry(artifact, runtime.account) : null;
  const amountRaw = entry ? BigInt(entry.amountRaw) : 0n;
  const epoch = source.epoch;

  let onchainRoot = ethers.ZeroHash;
  let deadline = 0n;
  let claimed = false;
  let errorMessage = "";

  try {
    const readProvider = ensureReadProvider();
    const { airdrop } = getContracts({ config: runtime.config, provider: readProvider });
    if (airdrop && epoch) {
      [onchainRoot, deadline] = await Promise.all([
        airdrop.merkleRoots(BigInt(epoch)),
        airdrop.deadlines(BigInt(epoch)),
      ]);

      if (entry) {
        claimed = await airdrop.isClaimed(BigInt(epoch), BigInt(entry.index));
      }
    }
  } catch (error) {
    errorMessage = formatUiError(error, "Round lookup", runtime);
  }

  let status = "connect";
  if (errorMessage) {
    status = "error";
  } else if (!epoch || !onchainRoot || onchainRoot === ethers.ZeroHash) {
    status = "not-live";
  } else if (String(artifact.root || "").toLowerCase() !== onchainRoot.toLowerCase()) {
    status = "mismatch";
  } else if (deadline === 0n || BigInt(Math.floor(Date.now() / 1000)) >= deadline) {
    status = "closed";
  } else if (!runtime.account) {
    status = "connect";
  } else if (!entry) {
    status = "no-allocation";
  } else if (claimed) {
    status = "claimed";
  } else {
    status = "claimable";
  }

  return {
    source,
    artifact,
    entry,
    epoch,
    amountRaw,
    onchainRoot,
    deadline,
    claimed,
    status,
    errorMessage,
  };
}

async function refreshRounds() {
  if (!runtime.claimCatalog?.sources?.length) {
    runtime.rounds = [];
    renderRoundList();
    return;
  }

  runtime.rounds = await Promise.all(runtime.claimCatalog.sources.map((source) => buildRoundView(source)));

  renderRoundList();
}

async function refreshPage() {
  await syncWalletState(runtime);

  try {
    const snapshot = await fetchDashboardSnapshot({
      config: runtime.config,
      provider: ensureReadProvider(),
      account: runtime.account,
    });

    runtime.owner = snapshot.owner;
    runtime.currentEpoch = Number(snapshot.currentEpoch ?? 0);
    runtime.tokenSymbol = snapshot.tokenSymbol || runtime.tokenSymbol;
    runtime.tokenDecimals = snapshot.tokenDecimals ?? runtime.tokenDecimals;
  } catch {
    runtime.owner = null;
    runtime.currentEpoch = 0;
  }

  syncWalletButton();
  updateFooterLinks();
  await refreshRounds();
}

async function claimRound(roundEpoch) {
  let round = getVisibleRounds().find((candidate) => candidate.epoch === roundEpoch);
  if (!round || round.status !== "claimable" || !round.entry) {
    throw new Error("This claim is not available right now.");
  }

  if (!isReadyChain()) {
    await switchConfiguredNetwork(runtime.config);
    resetProvider(runtime, runtime.config.chainId);
    await refreshPage();

    round = getVisibleRounds().find((candidate) => candidate.epoch === roundEpoch);
    if (!round || round.status !== "claimable" || !round.entry) {
      throw new Error("This claim is not available right now.");
    }
  }

  const { airdrop } = getContracts({
    config: runtime.config,
    provider: runtime.provider,
    signer: runtime.signer,
    withSigner: true,
  });

  if (!airdrop) throw new Error("Airdrop address is not configured.");

  await sendTransaction(
    "Claim",
    () => airdrop.claim(
      BigInt(round.epoch),
      BigInt(round.entry.index),
      normalizeAddress(round.entry.account),
      BigInt(round.entry.amountRaw),
      round.entry.proof,
    ),
    {
      log: logger.log,
      afterSuccess: async () => {
        await refreshPage();
      },
      formatError: (error, label) => formatUiError(error, label, runtime),
    },
  );
}

function bindEvents() {
  els.connectButton.addEventListener("click", async () => {
    if (runtime.account) {
      toggleWalletMenu();
      return;
    }

    try {
      const wallets = await getAvailableWallets();
      const selectedWalletId = await promptForWalletSelection({
        wallets,
        selectedWalletId: runtime.selectedWalletId,
        title: "Select Wallet",
      });

      if (!selectedWalletId) return;

      runtime.isConnectingWallet = true;
      syncWalletButton();
      await connectWallet(runtime, selectedWalletId);
      await pageInitPromise;
      runtime.isConnectingWallet = false;
      syncWalletButton();
      logger.log("Wallet connected.", "success");
      await refreshPage();
    } catch (error) {
      runtime.isConnectingWallet = false;
      syncWalletButton();
      reportError(error, "Connect wallet");
    }
  });

  els.disconnectButton?.addEventListener("click", async () => {
    try {
      await disconnectWallet(runtime);
      await refreshPage();
      logger.log("Wallet disconnected.");
    } catch (error) {
      reportError(error, "Disconnect wallet");
    }
  });

  els.switchNetworkButton?.addEventListener("click", async () => {
    try {
      await switchNetwork();
    } catch (error) {
      reportError(error, "Switch network");
    }
  });

  els.copyWalletAddressButton?.addEventListener("click", async () => {
    try {
      await copyWalletAddress();
    } catch (error) {
      reportError(error, "Copy wallet address");
    }
  });

  els.adminPageButton?.addEventListener("click", () => {
    window.location.href = "./admin.html";
  });

  els.addTokenLink?.addEventListener("click", async (event) => {
    event.preventDefault();
    try {
      await addTokenToMetaMask();
    } catch (error) {
      reportError(error, "Add token");
    }
  });

  bindWalletEvents({
    onAccountsChanged: async () => {
      await refreshPage();
      clearMessage();
    },
    onChainChanged: async (chainId) => {
      resetProvider(runtime, chainId ? Number.parseInt(chainId, 16) : null);
      await refreshPage();
      clearMessage();
    },
  });

  window.addEventListener("resize", updateToastOffset);
  document.addEventListener("click", (event) => {
    if (!runtime.account || !els.walletMenu || els.walletMenu.hasAttribute("hidden")) return;
    const target = event.target;
    if (!(target instanceof Node)) return;
    if (els.walletMenu.contains(target) || els.connectButton.contains(target)) return;
    setWalletMenuOpen(false);
  });
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape") setWalletMenuOpen(false);
  });
}

async function init() {
  renderRoundList();
  bindEvents();
  updateToastOffset();

  pageInitPromise = (async () => {
    updateToastOffset();
    try {
      const loaded = await loadUiConfig();
      runtime.config = loaded.config;
      runtime.configSource = loaded.source;
      runtime.readProvider = null;
      runtime.readProviderKey = null;
      await ensureProvider(runtime).catch(() => null);
      runtime.claimCatalog = await loadClaimCatalog(runtime.config.claimsManifestPath);
      await refreshPage();
    } catch (error) {
      reportError(error, "Initialize claimant page");
    }
  })();

  await pageInitPromise;
  updateToastOffset();
}

bindGlobalErrorHandlers(reportError);
init();
