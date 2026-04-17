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
import { fetchWalletClaimRounds, isClaimsApiConfigured } from "../shared/claims.js";
import {
  getXSession,
  clearXSession,
  saveXSession,
  isXAuthConfigured,
  isXSessionExpired,
  startXLogin,
  logoutXSession,
  completeXLoginIfPresent,
} from "../shared/x-auth.js";

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
  config: {
    chainId: null,
    networkName: "",
    rpcUrl: "",
    nativeCurrency: null,
    tokenAddress: "",
    dustTokenAddress: "",
    airdropAddress: "",
    apiBaseUrl: "",
    xAuth: {
      enabled: true,
      redirectUri: "",
      backendUrl: "",
    },
  },
  configSource: "template",
  tokenDecimals: 18,
  tokenSymbol: "LIB",
  rounds: [],
  isConnectingWallet: false,
  isConnectingX: false,
  isSubmittingXWalletLink: false,
  xSession: null,
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
  xAuthCard: document.getElementById("xAuthCard"),
  xAuthHint: document.getElementById("xAuthHint"),
  xAuthIdentity: document.getElementById("xAuthIdentity"),
  xAuthAvatar: document.getElementById("xAuthAvatar"),
  xAuthProfileLink: document.getElementById("xAuthProfileLink"),
  xAuthStatus: document.getElementById("xAuthStatus"),
  xAuthLinkStatus: document.getElementById("xAuthLinkStatus"),
  xAuthButton: document.getElementById("xAuthButton"),
  xVerifyButton: document.getElementById("xVerifyButton"),
  xDisconnectButton: document.getElementById("xDisconnectButton"),
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

function hasAnyOnchainClaimEntry() {
  return runtime.rounds.some((round) => {
    if (!round.entry) return false;
    return !["not-live", "mismatch", "error"].includes(round.status);
  });
}

function shouldOfferXRecovery() {
  if (!runtime.account) return false;
  if (!isClaimsApiConfigured(runtime.config)) return false;
  return !hasAnyOnchainClaimEntry();
}

function formatXLinkStatus(linkResult) {
  if (!linkResult) {
    return "";
  }

  return "Thanks. We received your wallet and X account and will review it.";
}

function getSignedInXAccount() {
  return runtime.xSession?.account || null;
}

function getExistingXSubmission() {
  return runtime.xSession?.existingSubmission || null;
}

function hasWalletOnFileForXAccount(account = getSignedInXAccount()) {
  return Boolean(String(account?.walletAddress || "").trim());
}

function formatExistingFormWalletStatus(account = getSignedInXAccount()) {
  const walletAddress = String(account?.walletAddress || "").trim();
  if (!walletAddress) {
    return "We already have a wallet on file for this X account.";
  }

  const isConnectedWalletMatch = Boolean(
    runtime.account
    && normalizeAddress(walletAddress) === normalizeAddress(runtime.account),
  );

  if (isConnectedWalletMatch) {
    return `We already have this X account linked to ${walletAddress}. Use this wallet to claim when eligible rounds are available.`;
  }

  return `We already have this X account linked to ${walletAddress}. Switch to that wallet to claim.`;
}

function formatExistingRecoveryStatus() {
  return "We already received a response for this X account.";
}

function syncXSessionFromStorage() {
  const session = getXSession();
  if (session && isXSessionExpired(session)) {
    clearXSession();
    runtime.xSession = null;
    return false;
  }

  runtime.xSession = session;
  return Boolean(session);
}

function syncXAuthCard() {
  if (!els.xAuthCard) return;

  const xAuthEnabled = runtime.config?.xAuth?.enabled !== false && shouldOfferXRecovery();
  els.xAuthCard.hidden = !xAuthEnabled;
  if (!xAuthEnabled) return;

  const isConfigured = isXAuthConfigured(runtime.config);
  const profile = runtime.xSession?.profile || null;
  const account = getSignedInXAccount();
  const existingSubmission = getExistingXSubmission();
  const isSignedIn = Boolean(profile?.username);
  const hasWalletOnFile = hasWalletOnFileForXAccount(account);
  const hasSavedFormWallet = hasWalletOnFile && account?.walletSource === "form";
  const hasSavedRecoveryWallet = Boolean(existingSubmission) || (hasWalletOnFile && account?.walletSource !== "form");

  els.xAuthIdentity.hidden = !isSignedIn;
  els.xDisconnectButton.hidden = !isSignedIn;
  els.xAuthButton.hidden = isSignedIn;
  els.xVerifyButton.hidden = !isSignedIn || hasWalletOnFile || Boolean(existingSubmission);
  els.xAuthStatus.hidden = false;

  if (isSignedIn) {
    els.xAuthProfileLink.textContent = `@${profile.username}`;
    els.xAuthProfileLink.href = `https://x.com/${encodeURIComponent(profile.username)}`;
    els.xAuthProfileLink.hidden = false;
    els.xAuthHint.hidden = true;
    els.xAuthStatus.textContent = "Signed in on x.com.";
    els.xAuthStatus.dataset.tone = "";

    if (profile.profileImageUrl) {
      els.xAuthAvatar.src = profile.profileImageUrl;
      els.xAuthAvatar.alt = `${profile.username} avatar`;
      els.xAuthAvatar.hidden = false;
    } else {
      els.xAuthAvatar.hidden = true;
      els.xAuthAvatar.removeAttribute("src");
      els.xAuthAvatar.alt = "";
    }

    if (hasSavedFormWallet) {
      els.xAuthHint.hidden = true;
      els.xAuthStatus.hidden = true;
      els.xVerifyButton.hidden = true;
      els.xVerifyButton.disabled = true;
      els.xAuthLinkStatus.hidden = false;
      els.xAuthLinkStatus.textContent = formatExistingFormWalletStatus(account);
      return;
    }

    if (hasSavedRecoveryWallet) {
      els.xAuthHint.hidden = true;
      els.xAuthStatus.hidden = true;
      els.xVerifyButton.hidden = true;
      els.xVerifyButton.disabled = true;
      els.xAuthLinkStatus.hidden = false;
      els.xAuthLinkStatus.textContent = formatExistingRecoveryStatus();
      return;
    }

    if (runtime.isSubmittingXWalletLink) {
      els.xVerifyButton.textContent = "Verifying...";
      els.xVerifyButton.disabled = true;
      els.xAuthLinkStatus.hidden = false;
      els.xAuthLinkStatus.textContent = "Confirm the wallet signature to save this recovery request.";
      return;
    }

    els.xVerifyButton.textContent = "Verify Wallet And Save";
    els.xVerifyButton.disabled = !runtime.account || !runtime.signer;
    els.xAuthLinkStatus.hidden = false;
    els.xAuthLinkStatus.textContent = "Sign a wallet message to prove ownership and save your recovery request.";

    return;
  }

  els.xAuthProfileLink.textContent = "@-";
  els.xAuthProfileLink.href = "#";
  els.xAuthProfileLink.hidden = true;
  els.xAuthAvatar.hidden = true;
  els.xAuthAvatar.removeAttribute("src");
  els.xAuthAvatar.alt = "";
  els.xVerifyButton.textContent = "Verify Wallet And Save";
  els.xVerifyButton.disabled = true;
  els.xAuthLinkStatus.hidden = true;
  els.xAuthLinkStatus.textContent = "";

  if (runtime.isConnectingX) {
    els.xAuthStatus.hidden = false;
    els.xAuthHint.hidden = false;
    els.xAuthHint.textContent = "Complete the X approval flow to return here.";
    els.xAuthStatus.textContent = "Finishing X sign-in...";
    els.xAuthStatus.dataset.tone = "";
    els.xAuthButton.textContent = "Signing in...";
    els.xAuthButton.disabled = true;
    return;
  }

  if (!isConfigured) {
    els.xAuthStatus.hidden = false;
    els.xAuthHint.hidden = false;
    els.xAuthHint.textContent = "This deployment still needs the X auth backend and callback configured.";
    els.xAuthStatus.textContent = "X sign-in is not configured yet.";
    els.xAuthStatus.dataset.tone = "warn";
    els.xAuthButton.textContent = "Sign in with X";
    els.xAuthButton.disabled = true;
    return;
  }

  els.xAuthStatus.hidden = false;
  els.xAuthHint.hidden = false;
  els.xAuthHint.textContent = "No claim was found for this wallet. Sign in with X to start follower recovery.";
  els.xAuthStatus.textContent = "Not signed in.";
  els.xAuthStatus.dataset.tone = "";
  els.xAuthButton.textContent = "Sign in with X";
  els.xAuthButton.disabled = false;
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

async function postXBackend(path, payload) {
  const baseUrl = String(runtime.config?.xAuth?.backendUrl || "").trim().replace(/\/+$/u, "");
  if (!baseUrl) {
    throw new Error("X sign-in backend URL is not configured.");
  }

  const csrfToken = String(runtime.xSession?.csrfToken || "").trim();
  if (!csrfToken) {
    throw new Error("X sign-in session expired. Sign in again.");
  }

  const response = await fetch(`${baseUrl}${path}`, {
    method: "POST",
    credentials: "include",
    cache: "no-store",
    headers: {
      "Content-Type": "application/json",
      "X-CSRF-Token": csrfToken,
    },
    body: JSON.stringify(payload),
  });

  const text = await response.text();
  let parsed = {};
  if (text) {
    try {
      parsed = JSON.parse(text);
    } catch {
      parsed = { error: text };
    }
  }

  if (!response.ok) {
    throw new Error(parsed?.error || "Request failed.");
  }

  return parsed;
}

async function verifyWalletAndSaveRecovery() {
  if (!runtime.account || !runtime.signer) {
    throw new Error("Connect the wallet you want to recover first.");
  }

  if (!shouldOfferXRecovery()) {
    throw new Error("Recovery is only available when this wallet has no claim entries.");
  }

  if (!runtime.xSession?.profile?.username || !runtime.xSession?.csrfToken) {
    throw new Error("Sign in with X first.");
  }

  const existingAccount = getSignedInXAccount();
  const existingSubmission = getExistingXSubmission();
  if (hasWalletOnFileForXAccount(existingAccount)) {
    if (existingAccount?.walletSource === "form") {
      throw new Error(formatExistingFormWalletStatus(existingAccount));
    }
    throw new Error(formatExistingRecoveryStatus());
  }

  if (existingSubmission) {
    throw new Error(formatExistingRecoveryStatus());
  }

  runtime.isSubmittingXWalletLink = true;
  syncXAuthCard();

  try {
    const challenge = await postXBackend("/api/x/link/challenge", {
      walletAddress: runtime.account,
    });

    if (!challenge?.challengeId || !challenge?.message) {
      throw new Error("Recovery challenge was not created.");
    }

    const signature = await runtime.signer.signMessage(challenge.message);
    const result = await postXBackend("/api/x/link/complete", {
      challengeId: challenge.challengeId,
      walletAddress: runtime.account,
      signature,
    });

    runtime.xSession = {
      ...runtime.xSession,
      account: result?.account || runtime.xSession?.account || null,
      existingSubmission: result?.existingSubmission || runtime.xSession?.existingSubmission || null,
      linkResult: result,
    };
    saveXSession(runtime.xSession);
    syncXAuthCard();

    const status = formatXLinkStatus(result);
    logger.log(status, "success");
  } finally {
    runtime.isSubmittingXWalletLink = false;
    syncXAuthCard();
  }
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

async function buildRoundView(storedRound) {
  const entry = storedRound?.entry || null;
  const amountRaw = entry ? BigInt(entry.amountRaw) : 0n;
  const epoch = Number(storedRound?.epoch || 0);

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
  } else if (String(storedRound?.merkleRoot || "").toLowerCase() !== onchainRoot.toLowerCase()) {
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
    source: { epoch },
    artifact: storedRound,
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
  if (!runtime.account || !isClaimsApiConfigured(runtime.config)) {
    runtime.rounds = [];
    renderRoundList();
    syncXAuthCard();
    return;
  }

  const payload = await fetchWalletClaimRounds(runtime.config, runtime.account);
  const storedRounds = Array.isArray(payload?.rounds) ? payload.rounds : [];
  runtime.rounds = await Promise.all(storedRounds.map((round) => buildRoundView(round)));

  renderRoundList();
  syncXAuthCard();
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

  els.xAuthButton?.addEventListener("click", async () => {
    try {
      runtime.isConnectingX = true;
      syncXAuthCard();
      await startXLogin(runtime.config);
    } catch (error) {
      runtime.isConnectingX = false;
      syncXAuthCard();
      reportError(error, "Start X sign-in");
    }
  });

  els.xDisconnectButton?.addEventListener("click", async () => {
    try {
      await logoutXSession(runtime.config, runtime.xSession);
      runtime.xSession = null;
      syncXAuthCard();
      logger.log("X account disconnected.");
    } catch (error) {
      reportError(error, "Disconnect X account");
    }
  });

  els.xVerifyButton?.addEventListener("click", async () => {
    try {
      await verifyWalletAndSaveRecovery();
    } catch (error) {
      reportError(error, "Verify X recovery");
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
  syncXSessionFromStorage();
  syncXAuthCard();
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
      syncXSessionFromStorage();
      syncXAuthCard();

      try {
        const xAuthResult = await completeXLoginIfPresent(runtime.config);
        runtime.xSession = xAuthResult.session || runtime.xSession;
        if (xAuthResult.handled) {
          logger.log("X account connected.", "success");
        }
      } catch (error) {
        clearXSession();
        runtime.xSession = null;
        reportError(error, "Complete X sign-in");
      }

      runtime.isConnectingX = false;
      syncXAuthCard();
      await ensureProvider(runtime).catch(() => null);
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
