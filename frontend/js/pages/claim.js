import { ethers } from "../shared/ethers.js";
import { HARDHAT_LOCAL } from "../shared/constants.js";
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
  syncWalletState,
  bindWalletEvents,
} from "../shared/wallet.js";
import { loadClaimCatalog, fetchClaimSource, findClaimEntry } from "../shared/claims.js";

const runtime = {
  provider: null,
  signer: null,
  account: null,
  chainId: null,
  owner: null,
  currentEpoch: 0,
  config: { ...HARDHAT_LOCAL, tokenAddress: "", dustTokenAddress: "", airdropAddress: "", claimsManifestPath: "./claims/index.json" },
  configSource: "template",
  tokenDecimals: 18,
  tokenSymbol: "LIB",
  claimCatalog: null,
  rounds: [],
  noticeTimerId: null,
};

const els = {
  claimHeader: document.getElementById("claimHeader"),
  connectButton: document.getElementById("connectButton"),
  walletMenu: document.getElementById("walletMenu"),
  walletMenuAddress: document.getElementById("walletMenuAddress"),
  copyWalletAddressButton: document.getElementById("copyWalletAddressButton"),
  disconnectButton: document.getElementById("disconnectButton"),
  roundList: document.getElementById("roundList"),
  claimToast: document.getElementById("claimToast"),
  claimToastMessage: document.getElementById("claimToastMessage"),
  claimToastClose: document.getElementById("claimToastClose"),
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

const logger = { log: setMessage, clear: clearMessage };
const reportError = createErrorReporter(logger.log, () => runtime);

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

function syncWalletButton() {
  const label = runtime.account ? formatAddressShort(runtime.account) : "Connect Wallet";
  els.connectButton.textContent = label;
  els.walletMenuAddress.textContent = runtime.account ? formatAddressShort(runtime.account) : "-";
  els.walletMenuAddress.title = runtime.account || "";
  setWalletMenuOpen(false);
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
      return { label: isReadyChain() ? "Claim" : "Wrong Network", disabled: !isReadyChain() };
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
  const artifact = await fetchClaimSource(source, runtime.claimCatalog.baseUrl, runtime.tokenDecimals);
  const entry = runtime.account ? findClaimEntry(artifact, runtime.account) : null;
  const amountRaw = entry ? BigInt(entry.amountRaw) : 0n;
  const epoch = source.epoch;

  let onchainRoot = ethers.ZeroHash;
  let deadline = 0n;
  let claimed = false;
  let errorMessage = "";

  try {
    if (runtime.provider) {
      const { airdrop } = getContracts({ config: runtime.config, provider: runtime.provider });
      if (airdrop && epoch) {
        [onchainRoot, deadline] = await Promise.all([
          airdrop.merkleRoots(BigInt(epoch)),
          airdrop.deadlines(BigInt(epoch)),
        ]);

        if (entry) {
          claimed = await airdrop.isClaimed(BigInt(epoch), BigInt(entry.index));
        }
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
  syncWalletButton();

  try {
    const snapshot = await fetchDashboardSnapshot({
      config: runtime.config,
      provider: runtime.provider,
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

  await refreshRounds();
}

async function claimRound(roundEpoch) {
  const round = getVisibleRounds().find((candidate) => candidate.epoch === roundEpoch);
  if (!round || round.status !== "claimable" || !round.entry) {
    throw new Error("This claim is not available right now.");
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
      await connectWallet(runtime);
      await refreshPage();
      logger.log("Wallet connected.", "success");
    } catch (error) {
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

  els.copyWalletAddressButton?.addEventListener("click", async () => {
    try {
      await copyWalletAddress();
    } catch (error) {
      reportError(error, "Copy wallet address");
    }
  });

  bindWalletEvents({
    onAccountsChanged: async () => {
      await refreshPage();
      clearMessage();
    },
    onChainChanged: async () => {
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
  try {
    updateToastOffset();
    const loaded = await loadUiConfig();
    runtime.config = loaded.config;
    runtime.configSource = loaded.source;
    await ensureProvider(runtime).catch(() => null);
    runtime.claimCatalog = await loadClaimCatalog(runtime.config.claimsManifestPath);
    await refreshPage();
  } catch (error) {
    reportError(error, "Initialize claimant page");
  }

  bindEvents();
  updateToastOffset();
}

bindGlobalErrorHandlers(reportError);
init();
