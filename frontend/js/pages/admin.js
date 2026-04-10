import { ethers } from "../shared/ethers.js";
import { HARDHAT_LOCAL } from "../shared/constants.js";
import { loadUiConfig } from "../shared/config.js";
import { getContracts, fetchDashboardSnapshot } from "../shared/contracts.js";
import { createErrorReporter, bindGlobalErrorHandlers, formatUiError } from "../shared/errors.js";
import {
  normalizeAddress,
  formatAddressShort,
  formatDeadlineLocal,
  formatDeadlineUtc,
  formatTokenAmount,
  parseHumanAmount,
  parseRequiredBigInt,
  getUnixFromDateTimeLocal,
  getUnixFromUtcInput,
  formatDateTimeLocalValue,
  formatUtcInputValue,
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

const runtime = {
  provider: null,
  signer: null,
  account: null,
  chainId: null,
  owner: null,
  currentEpoch: 0,
  epochRows: [],
  config: { ...HARDHAT_LOCAL, tokenAddress: "", dustTokenAddress: "", airdropAddress: "", claimsManifestPath: "./claims/index.json" },
  configSource: "template",
  tokenDecimals: 18,
  tokenSymbol: "LIB",
  noticeTimerId: null,
};

const els = {
  adminHeader: document.getElementById("adminHeader"),
  refreshButton: document.getElementById("refreshButton"),
  connectButton: document.getElementById("connectButton"),
  walletMenu: document.getElementById("walletMenu"),
  walletMenuAddress: document.getElementById("walletMenuAddress"),
  copyWalletAddressButton: document.getElementById("copyWalletAddressButton"),
  disconnectButton: document.getElementById("disconnectButton"),
  connectedAccount: document.getElementById("connectedAccount"),
  ownerAddress: document.getElementById("ownerAddress"),
  accountRole: document.getElementById("accountRole"),
  adminGateMessage: document.getElementById("adminGateMessage"),
  adminShell: document.getElementById("adminShell"),
  currentEpoch: document.getElementById("currentEpoch"),
  latestDeadlineLocalValue: document.getElementById("latestDeadlineLocalValue"),
  latestDeadlineUtcValue: document.getElementById("latestDeadlineUtcValue"),
  latestDeadlineEpochValue: document.getElementById("latestDeadlineEpochValue"),
  tokenSummary: document.getElementById("tokenSummary"),
  walletTokenBalance: document.getElementById("walletTokenBalance"),
  airdropTokenBalance: document.getElementById("airdropTokenBalance"),
  startAirdropForm: document.getElementById("startAirdropForm"),
  startRootInput: document.getElementById("startRootInput"),
  startDeadlineInput: document.getElementById("startDeadlineInput"),
  startDeadlineUtcInput: document.getElementById("startDeadlineUtcInput"),
  startDeadlineUnix: document.getElementById("startDeadlineUnix"),
  fundAirdropForm: document.getElementById("fundAirdropForm"),
  fundAirdropAmount: document.getElementById("fundAirdropAmount"),
  withdrawForm: document.getElementById("withdrawForm"),
  withdrawRecipient: document.getElementById("withdrawRecipient"),
  withdrawAmount: document.getElementById("withdrawAmount"),
  recoverForm: document.getElementById("recoverForm"),
  recoverTokenAddress: document.getElementById("recoverTokenAddress"),
  recoverRecipient: document.getElementById("recoverRecipient"),
  recoverAmount: document.getElementById("recoverAmount"),
  epochListBody: document.getElementById("epochListBody"),
  epochQueryForm: document.getElementById("epochQueryForm"),
  queryEpochInput: document.getElementById("queryEpochInput"),
  epochQueryResult: document.getElementById("epochQueryResult"),
  claimStatusForm: document.getElementById("claimStatusForm"),
  claimedEpochInput: document.getElementById("claimedEpochInput"),
  claimedIndexInput: document.getElementById("claimedIndexInput"),
  claimStatusResult: document.getElementById("claimStatusResult"),
  adminToast: document.getElementById("adminToast"),
  adminToastMessage: document.getElementById("adminToastMessage"),
  adminToastClose: document.getElementById("adminToastClose"),
};

const toast = createToastController({
  element: els.adminToast,
  messageElement: els.adminToastMessage,
  closeButton: els.adminToastClose,
});

function setMessage(message, type = "info") {
  if (!els.adminToast) return;

  let nextMessage = message;
  const submittedMatch = message.match(/^([^:]+): submitted /);
  const confirmedMatch = message.match(/^([^:]+): confirmed /);

  if (submittedMatch) {
    nextMessage = `${submittedMatch[1]} submitted. Confirm it in your wallet.`;
  } else if (confirmedMatch) {
    nextMessage = `${confirmedMatch[1]} complete.`;
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
  if (!els.adminHeader) return;
  const headerHeight = Math.ceil(els.adminHeader.getBoundingClientRect().height);
  document.documentElement.style.setProperty("--claim-toast-top", `${headerHeight + 14}px`);
}

function formatHexShort(value) {
  if (!value || typeof value !== "string") return "-";
  if (value.length <= 22) return value;
  return `${value.slice(0, 10)}...${value.slice(-8)}`;
}

function isReadyChain() {
  return runtime.chainId === runtime.config.chainId;
}

function isOwner() {
  return Boolean(runtime.account && runtime.owner && normalizeAddress(runtime.account) === normalizeAddress(runtime.owner));
}

function setWalletMenuOpen(isOpen) {
  if (!els.walletMenu || !els.connectButton || !runtime.account) {
    els.walletMenu?.setAttribute("hidden", "");
    els.connectButton?.setAttribute("aria-expanded", "false");
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

function readRequiredAddress(input) {
  const address = normalizeAddress(input.value);
  if (!address || address === ethers.ZeroAddress) {
    throw new Error("A non-zero address is required.");
  }
  return address;
}

function applyDeadlineUnix(unixValue) {
  const raw = String(unixValue || "").trim();
  els.startDeadlineUnix.value = raw;
  els.startDeadlineInput.value = raw ? formatDateTimeLocalValue(raw) : "";
  els.startDeadlineUtcInput.value = raw ? formatUtcInputValue(raw) : "";
}

function syncDeadlineFromLocal() {
  const unix = getUnixFromDateTimeLocal(els.startDeadlineInput.value);
  applyDeadlineUnix(unix);
}

function syncDeadlineFromUtc() {
  const unix = getUnixFromUtcInput(els.startDeadlineUtcInput.value);
  if (!unix) return;
  applyDeadlineUnix(unix);
}

function renderEpochList() {
  if (!runtime.epochRows.length) {
    els.epochListBody.innerHTML = '<tr><td colspan="5" class="empty-row">No epochs started yet.</td></tr>';
    return;
  }

  els.epochListBody.innerHTML = runtime.epochRows
    .map((row) => `
      <tr>
        <td>${row.epoch}</td>
        <td><code title="${row.root}">${formatHexShort(row.root)}</code></td>
        <td>${formatDeadlineLocal(row.deadline)}</td>
        <td>${formatDeadlineUtc(row.deadline)}</td>
        <td>${formatTokenAmount(row.claimedAmount, runtime.tokenDecimals, runtime.tokenSymbol)}</td>
      </tr>
    `)
    .join("");
}

async function refreshEpochRows() {
  runtime.epochRows = [];

  if (!runtime.provider || runtime.currentEpoch <= 0) {
    renderEpochList();
    return;
  }

  const { airdrop } = getContracts({ config: runtime.config, provider: runtime.provider });
  if (!airdrop) {
    renderEpochList();
    return;
  }

  const epochIds = Array.from({ length: runtime.currentEpoch }, (_, index) => runtime.currentEpoch - index);
  runtime.epochRows = await Promise.all(
    epochIds.map(async (epoch) => {
      const [root, deadline, claimedAmount] = await airdrop.epochInfo(BigInt(epoch));
      return {
        epoch,
        root,
        deadline,
        claimedAmount,
      };
    }),
  );

  renderEpochList();
}

function applyOwnerGate() {
  els.ownerAddress.textContent = runtime.owner || "-";
  els.connectedAccount.textContent = runtime.account || "No wallet connected";

  if (!window.ethereum) {
    els.accountRole.textContent = "MetaMask missing";
    els.adminGateMessage.textContent = "Install MetaMask to manage the airdrop.";
    els.adminShell.hidden = true;
    return;
  }

  if (!runtime.account) {
    els.accountRole.textContent = "Disconnected";
    els.adminGateMessage.textContent = "Connect the owner wallet to view admin controls.";
    els.adminShell.hidden = true;
    return;
  }

  if (!isReadyChain()) {
    els.accountRole.textContent = "Wrong network";
    els.adminGateMessage.textContent = "Switch MetaMask to the configured network to manage the airdrop.";
    els.adminShell.hidden = true;
    return;
  }

  if (!runtime.owner) {
    els.accountRole.textContent = "Connected wallet";
    els.adminGateMessage.textContent = "Owner address is not available yet. Check the contract config.";
    els.adminShell.hidden = true;
    return;
  }

  if (!isOwner()) {
    els.accountRole.textContent = "Connected wallet";
    els.adminGateMessage.textContent = "This page only unlocks for the current owner address.";
    els.adminShell.hidden = true;
    return;
  }

  els.accountRole.textContent = "Owner connected";
  els.adminGateMessage.textContent = "Owner wallet detected. Admin controls are unlocked.";
  els.adminShell.hidden = false;
}

async function refreshPage() {
  await syncWalletState(runtime);
  syncWalletButton();

  runtime.owner = null;
  runtime.currentEpoch = 0;
  runtime.epochRows = [];
  els.currentEpoch.textContent = "-";
  els.latestDeadlineLocalValue.textContent = "Not scheduled";
  els.latestDeadlineUtcValue.textContent = "Not scheduled";
  els.latestDeadlineEpochValue.textContent = "-";
  els.tokenSummary.textContent = "-";
  els.walletTokenBalance.textContent = "-";
  els.airdropTokenBalance.textContent = "-";

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

    els.currentEpoch.textContent = snapshot.currentEpoch?.toString() || "-";
    els.latestDeadlineLocalValue.textContent = formatDeadlineLocal(snapshot.latestDeadline || 0);
    els.latestDeadlineUtcValue.textContent = formatDeadlineUtc(snapshot.latestDeadline || 0);
    els.latestDeadlineEpochValue.textContent = snapshot.latestDeadlineEpoch?.toString() || "-";
    els.tokenSummary.textContent = snapshot.tokenSymbol
      ? `${snapshot.tokenSymbol} (${runtime.tokenDecimals} decimals)`
      : "-";
    els.walletTokenBalance.textContent = snapshot.walletTokenBalance != null
      ? formatTokenAmount(snapshot.walletTokenBalance, runtime.tokenDecimals, runtime.tokenSymbol)
      : "-";
    els.airdropTokenBalance.textContent = snapshot.airdropTokenBalance != null
      ? formatTokenAmount(snapshot.airdropTokenBalance, runtime.tokenDecimals, runtime.tokenSymbol)
      : "-";
  } catch {
    runtime.owner = null;
    runtime.currentEpoch = 0;
  }

  await refreshEpochRows().catch(() => {
    runtime.epochRows = [];
    renderEpochList();
  });

  applyOwnerGate();
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

  els.copyWalletAddressButton?.addEventListener("click", async () => {
    try {
      await copyWalletAddress();
    } catch (error) {
      reportError(error, "Copy wallet address");
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

  els.refreshButton.addEventListener("click", async () => {
    try {
      await refreshPage();
      logger.log("Admin state refreshed.");
    } catch (error) {
      reportError(error, "Refresh page");
    }
  });

  els.startDeadlineInput.addEventListener("input", syncDeadlineFromLocal);
  els.startDeadlineUtcInput.addEventListener("input", syncDeadlineFromUtc);

  els.fundAirdropForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    try {
      const { token, airdropAddress } = getContracts({
        config: runtime.config,
        provider: runtime.provider,
        signer: runtime.signer,
        withSigner: true,
      });
      if (!token || !airdropAddress) throw new Error("Token and airdrop addresses must be configured.");

      const amountRaw = parseHumanAmount(els.fundAirdropAmount.value, runtime.tokenDecimals);
      await sendTransaction("Fund airdrop", () => token.transfer(airdropAddress, amountRaw), {
        log: logger.log,
        afterSuccess: async () => {
          await refreshPage();
        },
        formatError: (error, label) => formatUiError(error, label, runtime),
      });
    } catch (error) {
      reportError(error, "Fund airdrop");
    }
  });

  els.startAirdropForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    try {
      const { airdrop } = getContracts({
        config: runtime.config,
        provider: runtime.provider,
        signer: runtime.signer,
        withSigner: true,
      });

      if (!airdrop) throw new Error("Airdrop address is not configured.");
      const root = els.startRootInput.value.trim();
      if (!ethers.isHexString(root, 32)) throw new Error("Merkle root must be a bytes32 hex string.");
      const deadlineUnix = Number(els.startDeadlineUnix.value);
      if (!Number.isFinite(deadlineUnix) || deadlineUnix <= 0) throw new Error("A valid deadline is required.");

      await sendTransaction("Start airdrop", () => airdrop.startNewAirdrop(root, deadlineUnix), {
        log: logger.log,
        afterSuccess: async () => {
          await refreshPage();
        },
        formatError: (error, label) => formatUiError(error, label, runtime),
      });
    } catch (error) {
      reportError(error, "Start airdrop");
    }
  });

  els.withdrawForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    try {
      const { airdrop } = getContracts({
        config: runtime.config,
        provider: runtime.provider,
        signer: runtime.signer,
        withSigner: true,
      });
      if (!airdrop) throw new Error("Airdrop address is not configured.");

      const recipient = readRequiredAddress(els.withdrawRecipient);
      const amountRaw = parseHumanAmount(els.withdrawAmount.value, runtime.tokenDecimals);
      await sendTransaction("Withdraw", () => airdrop.withdraw(recipient, amountRaw), {
        log: logger.log,
        afterSuccess: async () => {
          await refreshPage();
        },
        formatError: (error, label) => formatUiError(error, label, runtime),
      });
    } catch (error) {
      reportError(error, "Withdraw");
    }
  });

  els.recoverForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    try {
      const { airdrop } = getContracts({
        config: runtime.config,
        provider: runtime.provider,
        signer: runtime.signer,
        withSigner: true,
      });
      if (!airdrop) throw new Error("Airdrop address is not configured.");

      const tokenAddress = readRequiredAddress(els.recoverTokenAddress);
      const recipient = readRequiredAddress(els.recoverRecipient);
      const amountRaw = parseHumanAmount(els.recoverAmount.value, runtime.tokenDecimals);
      await sendTransaction("Recover ERC20", () => airdrop.recoverERC20(tokenAddress, recipient, amountRaw), {
        log: logger.log,
        afterSuccess: async () => {
          await refreshPage();
        },
        formatError: (error, label) => formatUiError(error, label, runtime),
      });
    } catch (error) {
      reportError(error, "Recover ERC20");
    }
  });

  els.epochQueryForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    try {
      const { airdrop } = getContracts({ config: runtime.config, provider: runtime.provider });
      if (!airdrop) throw new Error("Airdrop address is not configured.");

      const epoch = parseRequiredBigInt(els.queryEpochInput.value, "Epoch query");
      const [root, deadline, claimedAmount] = await airdrop.epochInfo(epoch);
      els.epochQueryResult.textContent = JSON.stringify(
        {
          epoch: epoch.toString(),
          merkleRoot: root,
          deadline: deadline.toString(),
          deadlineLocal: formatDeadlineLocal(deadline),
          deadlineUtc: formatDeadlineUtc(deadline),
          claimedAmount: claimedAmount.toString(),
          claimedFormatted: ethers.formatUnits(claimedAmount, runtime.tokenDecimals),
        },
        null,
        2,
      );
    } catch (error) {
      reportError(error, "Read epoch info");
    }
  });

  els.claimStatusForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    try {
      const { airdrop } = getContracts({ config: runtime.config, provider: runtime.provider });
      if (!airdrop) throw new Error("Airdrop address is not configured.");

      const epoch = parseRequiredBigInt(els.claimedEpochInput.value, "Claim status epoch");
      const index = parseRequiredBigInt(els.claimedIndexInput.value, "Claim status index");
      const claimed = await airdrop.isClaimed(epoch, index);
      els.claimStatusResult.textContent = JSON.stringify(
        {
          epoch: epoch.toString(),
          index: index.toString(),
          claimed,
        },
        null,
        2,
      );
    } catch (error) {
      reportError(error, "Read claim status");
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
    await refreshPage();
  } catch (error) {
    reportError(error, "Initialize admin page");
  }

  bindEvents();
  updateToastOffset();
}

bindGlobalErrorHandlers(reportError);
init();
