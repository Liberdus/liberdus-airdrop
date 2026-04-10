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
import { loadClaimCatalog, fetchClaimSource } from "../shared/claims.js";
import { buildClaimRound } from "../shared/merkle.js";

const runtime = {
  provider: null,
  signer: null,
  account: null,
  chainId: null,
  owner: null,
  currentEpoch: 0,
  epochRows: [],
  claimCatalog: null,
  claimSourcesByEpoch: new Map(),
  uploadedRound: null,
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
  tokenSummary: document.getElementById("tokenSummary"),
  walletTokenBalance: document.getElementById("walletTokenBalance"),
  airdropTokenBalance: document.getElementById("airdropTokenBalance"),
  uploadClaimsFileInput: document.getElementById("uploadClaimsFileInput"),
  startAirdropForm: document.getElementById("startAirdropForm"),
  startRootInput: document.getElementById("startRootInput"),
  startDeadlineInput: document.getElementById("startDeadlineInput"),
  startDeadlineUtcInput: document.getElementById("startDeadlineUtcInput"),
  startDeadlineUnix: document.getElementById("startDeadlineUnix"),
  uploadedClaimCount: document.getElementById("uploadedClaimCount"),
  uploadedClaimTotal: document.getElementById("uploadedClaimTotal"),
  uploadPreviewBody: document.getElementById("uploadPreviewBody"),
  fundUploadedButton: document.getElementById("fundUploadedButton"),
  clearUploadedButton: document.getElementById("clearUploadedButton"),
  updateDeadlineForm: document.getElementById("updateDeadlineForm"),
  updateEpochInput: document.getElementById("updateEpochInput"),
  updateDeadlineInput: document.getElementById("updateDeadlineInput"),
  updateDeadlineUtcInput: document.getElementById("updateDeadlineUtcInput"),
  updateDeadlineUnix: document.getElementById("updateDeadlineUnix"),
  disableEpochButton: document.getElementById("disableEpochButton"),
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

function formatAdminDeadlineLocal(value) {
  return Number(value) === 0 ? "Disabled" : formatDeadlineLocal(value);
}

function formatAdminDeadlineUtc(value) {
  return Number(value) === 0 ? "Disabled" : formatDeadlineUtc(value);
}

function formatInputAmount(rawValue) {
  return ethers.formatUnits(rawValue, runtime.tokenDecimals).replace(/\.?0+$/, "");
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

function readRequiredEpoch(input, label = "Epoch") {
  const epoch = parseRequiredBigInt(input.value, label);
  if (epoch <= 0n) throw new Error(`${label} must be greater than zero.`);
  return epoch;
}

function applyDeadlineFields(localInput, utcInput, unixInput, unixValue) {
  const raw = String(unixValue || "").trim();
  unixInput.value = raw;
  localInput.value = raw ? formatDateTimeLocalValue(raw) : "";
  utcInput.value = raw ? formatUtcInputValue(raw) : "";
}

function syncDeadlineFromLocal(localInput, utcInput, unixInput) {
  const unix = getUnixFromDateTimeLocal(localInput.value);
  applyDeadlineFields(localInput, utcInput, unixInput, unix);
}

function syncDeadlineFromUtc(localInput, utcInput, unixInput) {
  const unix = getUnixFromUtcInput(utcInput.value);
  if (!unix) return;
  applyDeadlineFields(localInput, utcInput, unixInput, unix);
}

function bindNativePicker(input) {
  if (!input) return;

  input.addEventListener("click", () => {
    if (typeof input.showPicker === "function") {
      try {
        input.showPicker();
      } catch {
        // Some browsers reject repeated picker opens; fall back to native behavior.
      }
    }
  });
}

function validateDeadlineValue(deadlineUnix, { allowZero = false } = {}) {
  if (!Number.isFinite(deadlineUnix) || deadlineUnix < 0) {
    throw new Error("A valid deadline is required.");
  }

  return allowZero && deadlineUnix === 0;
}

async function validateFutureDeadlineAgainstChain(deadlineUnix, { allowZero = false } = {}) {
  const isExplicitZero = validateDeadlineValue(deadlineUnix, { allowZero });
  if (isExplicitZero) return;

  let now = Math.floor(Date.now() / 1000);
  if (runtime.provider) {
    const latestBlock = await runtime.provider.getBlock("latest");
    now = Number(latestBlock?.timestamp ?? now);
  }

  if (deadlineUnix <= now) {
    throw new Error("Deadline must be in the future.");
  }
}

function clearUploadedRoundState() {
  runtime.uploadedRound = null;
  els.startRootInput.value = "";
  els.uploadClaimsFileInput.value = "";
  renderUploadedRound();
}

function renderUploadedRound() {
  const round = runtime.uploadedRound;

  if (!round) {
    els.uploadedClaimCount.textContent = "-";
    els.uploadedClaimTotal.textContent = "-";
    els.uploadPreviewBody.innerHTML = '<tr><td colspan="3" class="empty-row">Upload a claims JSON file to preview it.</td></tr>';
    els.fundUploadedButton.disabled = true;
    els.clearUploadedButton.disabled = true;
    return;
  }

  const walletLabel = round.claimCount === 1 ? "1 wallet" : `${round.claimCount} wallets`;
  els.uploadedClaimCount.textContent = walletLabel;
  els.uploadedClaimTotal.textContent = formatTokenAmount(BigInt(round.totalAmountRaw), runtime.tokenDecimals, runtime.tokenSymbol);
  els.uploadPreviewBody.innerHTML = round.claims
    .map((claim) => `
      <tr>
        <td>${claim.index}</td>
        <td><code title="${claim.account}">${formatAddressShort(claim.account)}</code></td>
        <td>${formatTokenAmount(BigInt(claim.amountRaw), runtime.tokenDecimals, runtime.tokenSymbol)}</td>
      </tr>
    `)
    .join("");
  els.fundUploadedButton.disabled = false;
  els.clearUploadedButton.disabled = false;
}

async function loadUploadedClaimsFile(file) {
  const rawText = await file.text();
  runtime.uploadedRound = buildClaimRound(rawText, runtime.tokenDecimals);
  els.startRootInput.value = runtime.uploadedRound.root;
  els.fundAirdropAmount.value = formatInputAmount(BigInt(runtime.uploadedRound.totalAmountRaw));
  renderUploadedRound();
}

async function refreshCatalogRounds() {
  runtime.claimSourcesByEpoch = new Map();

  if (!runtime.config.claimsManifestPath) return;

  runtime.claimCatalog = await loadClaimCatalog(runtime.config.claimsManifestPath);
  if (!runtime.claimCatalog?.sources?.length) return;

  const roundEntries = await Promise.all(runtime.claimCatalog.sources.map(async (source) => {
    try {
      const round = await fetchClaimSource(source, runtime.claimCatalog.baseUrl, runtime.tokenDecimals);
      return { epoch: source.epoch, source, round, errorMessage: "" };
    } catch (error) {
      return { epoch: source.epoch, source, round: null, errorMessage: formatUiError(error, "Load round data", runtime) };
    }
  }));

  for (const entry of roundEntries) {
    runtime.claimSourcesByEpoch.set(entry.epoch, entry);
  }
}

function formatClaimedDisplay(claimedAmount, totalAmountRaw) {
  const claimedText = formatTokenAmount(claimedAmount, runtime.tokenDecimals, runtime.tokenSymbol);
  if (totalAmountRaw == null) return claimedText;
  return `${claimedText} / ${formatTokenAmount(totalAmountRaw, runtime.tokenDecimals, runtime.tokenSymbol)}`;
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
        <td>${formatAdminDeadlineLocal(row.deadline)}</td>
        <td>${formatAdminDeadlineUtc(row.deadline)}</td>
        <td>${formatClaimedDisplay(row.claimedAmount, row.totalAmountRaw)}</td>
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
      const localSource = runtime.claimSourcesByEpoch.get(epoch);
      const localRound = localSource?.round;
      const totalAmountRaw = localRound && localRound.root.toLowerCase() === root.toLowerCase()
        ? BigInt(localRound.totalAmountRaw)
        : null;

      return {
        epoch,
        root,
        deadline,
        claimedAmount,
        totalAmountRaw,
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

  await refreshCatalogRounds().catch(() => {
    runtime.claimSourcesByEpoch = new Map();
  });

  await refreshEpochRows().catch(() => {
    runtime.epochRows = [];
    renderEpochList();
  });

  renderUploadedRound();
  applyOwnerGate();
}

async function fundUploadedRound() {
  if (!runtime.uploadedRound) {
    throw new Error("Upload a claims JSON file first.");
  }

  const { token, airdropAddress } = getContracts({
    config: runtime.config,
    provider: runtime.provider,
    signer: runtime.signer,
    withSigner: true,
  });

  if (!token || !airdropAddress) {
    throw new Error("Token and airdrop addresses must be configured.");
  }

  const amountRaw = BigInt(runtime.uploadedRound.totalAmountRaw);
  await sendTransaction("Fund airdrop", () => token.transfer(airdropAddress, amountRaw), {
    log: logger.log,
    afterSuccess: async () => {
      await refreshPage();
    },
    formatError: (error, label) => formatUiError(error, label, runtime),
  });
}

async function updateEpochDeadline(newDeadline) {
  const { airdrop } = getContracts({
    config: runtime.config,
    provider: runtime.provider,
    signer: runtime.signer,
    withSigner: true,
  });
  if (!airdrop) throw new Error("Airdrop address is not configured.");

  const epoch = readRequiredEpoch(els.updateEpochInput, "Epoch");
  await sendTransaction(
    newDeadline === 0 ? "Disable epoch" : "Update deadline",
    () => airdrop.setEpochDeadline(epoch, newDeadline),
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

  els.uploadClaimsFileInput.addEventListener("change", async (event) => {
    const file = event.target.files?.[0];

    if (!file) {
      clearUploadedRoundState();
      return;
    }

    try {
      await loadUploadedClaimsFile(file);
      logger.log("Claims file loaded.", "success");
    } catch (error) {
      clearUploadedRoundState();
      reportError(error, "Load claims file");
    }
  });

  els.clearUploadedButton.addEventListener("click", () => {
    clearUploadedRoundState();
    logger.log("Claims file cleared.");
  });

  els.fundUploadedButton.addEventListener("click", async () => {
    try {
      await fundUploadedRound();
    } catch (error) {
      reportError(error, "Fund airdrop");
    }
  });

  els.startDeadlineInput.addEventListener("input", () => {
    syncDeadlineFromLocal(els.startDeadlineInput, els.startDeadlineUtcInput, els.startDeadlineUnix);
  });
  els.startDeadlineUtcInput.addEventListener("input", () => {
    syncDeadlineFromUtc(els.startDeadlineInput, els.startDeadlineUtcInput, els.startDeadlineUnix);
  });

  els.updateDeadlineInput.addEventListener("input", () => {
    syncDeadlineFromLocal(els.updateDeadlineInput, els.updateDeadlineUtcInput, els.updateDeadlineUnix);
  });
  els.updateDeadlineUtcInput.addEventListener("input", () => {
    syncDeadlineFromUtc(els.updateDeadlineInput, els.updateDeadlineUtcInput, els.updateDeadlineUnix);
  });

  bindNativePicker(els.startDeadlineInput);
  bindNativePicker(els.startDeadlineUtcInput);
  bindNativePicker(els.updateDeadlineInput);
  bindNativePicker(els.updateDeadlineUtcInput);

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
      if (!runtime.uploadedRound) throw new Error("Upload a claims JSON file first.");

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
      await validateFutureDeadlineAgainstChain(deadlineUnix);

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

  els.updateDeadlineForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    try {
      const deadlineUnix = Number(els.updateDeadlineUnix.value);
      await validateFutureDeadlineAgainstChain(deadlineUnix);
      await updateEpochDeadline(deadlineUnix);
    } catch (error) {
      reportError(error, "Update deadline");
    }
  });

  els.disableEpochButton.addEventListener("click", async () => {
    try {
      await updateEpochDeadline(0);
    } catch (error) {
      reportError(error, "Disable epoch");
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

      const epoch = readRequiredEpoch(els.queryEpochInput, "Epoch query");
      const [root, deadline, claimedAmount] = await airdrop.epochInfo(epoch);
      const localRound = runtime.claimSourcesByEpoch.get(Number(epoch))?.round;
      const totalAmountRaw = localRound && localRound.root.toLowerCase() === root.toLowerCase()
        ? localRound.totalAmountRaw
        : null;

      els.epochQueryResult.textContent = JSON.stringify(
        {
          epoch: epoch.toString(),
          merkleRoot: root,
          deadline: deadline.toString(),
          deadlineLocal: formatAdminDeadlineLocal(deadline),
          deadlineUtc: formatAdminDeadlineUtc(deadline),
          claimedAmount: claimedAmount.toString(),
          claimedFormatted: ethers.formatUnits(claimedAmount, runtime.tokenDecimals),
          totalAmount: totalAmountRaw,
          totalFormatted: totalAmountRaw ? ethers.formatUnits(totalAmountRaw, runtime.tokenDecimals) : null,
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

      const epoch = readRequiredEpoch(els.claimedEpochInput, "Claim status epoch");
      const index = parseRequiredBigInt(els.claimedIndexInput.value, "Claim status index");
      if (index < 0n) throw new Error("Claim status index must be zero or greater.");

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
