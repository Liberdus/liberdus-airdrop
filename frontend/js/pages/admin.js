import { ethers } from "../shared/ethers.js";
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
  resetProvider,
  syncWalletState,
  switchConfiguredNetwork,
  bindWalletEvents,
  getAvailableWallets,
} from "../shared/wallet.js";
import { promptForWalletSelection } from "../shared/wallet-picker.js";
import {
  fetchStoredAirdropRounds,
  fetchStoredClaimByEpochAndIndex,
  isClaimsApiConfigured,
  persistAirdropRound,
  requestAirdropFinalizeChallenge,
} from "../shared/claims.js";
import { buildClaimRound } from "../shared/merkle.js";

const runtime = {
  provider: null,
  providerSource: null,
  signer: null,
  account: null,
  chainId: null,
  chainName: null,
  injectedProvider: null,
  selectedWalletId: null,
  selectedWalletName: null,
  owner: null,
  pendingOwner: null,
  currentEpoch: 0,
  epochRows: [],
  claimSourcesByEpoch: new Map(),
  claimSourcesByRoot: new Map(),
  uploadedRound: null,
  builderRows: [],
  nextBuilderRowId: 1,
  config: {
    chainId: null,
    networkName: "",
    rpcUrl: "",
    nativeCurrency: null,
    tokenAddress: "",
    dustTokenAddress: "",
    airdropAddress: "",
    apiBaseUrl: "",
  },
  configSource: "template",
  tokenDecimals: 18,
  tokenSymbol: "LIB",
  chainTimestamp: 0,
  startRequiresNewUpload: false,
  isConnectingWallet: false,
  noticeTimerId: null,
};

const els = {
  adminHeader: document.getElementById("adminHeader"),
  refreshButton: document.getElementById("refreshButton"),
  connectButton: document.getElementById("connectButton"),
  walletMenu: document.getElementById("walletMenu"),
  walletMenuAddress: document.getElementById("walletMenuAddress"),
  walletMenuChainId: document.getElementById("walletMenuChainId"),
  switchNetworkButton: document.getElementById("switchNetworkButton"),
  claimPageButton: document.getElementById("claimPageButton"),
  copyWalletAddressButton: document.getElementById("copyWalletAddressButton"),
  disconnectButton: document.getElementById("disconnectButton"),
  connectedAccount: document.getElementById("connectedAccount"),
  ownerAddress: document.getElementById("ownerAddress"),
  ownershipShell: document.getElementById("ownershipShell"),
  ownershipCurrentOwner: document.getElementById("ownershipCurrentOwner"),
  ownershipPendingOwner: document.getElementById("ownershipPendingOwner"),
  ownershipConnectedWallet: document.getElementById("ownershipConnectedWallet"),
  ownershipStatusMessage: document.getElementById("ownershipStatusMessage"),
  transferOwnershipForm: document.getElementById("transferOwnershipForm"),
  transferOwnershipAddress: document.getElementById("transferOwnershipAddress"),
  transferOwnershipButton: document.getElementById("transferOwnershipButton"),
  acceptOwnershipForm: document.getElementById("acceptOwnershipForm"),
  acceptOwnershipButton: document.getElementById("acceptOwnershipButton"),
  accountRole: document.getElementById("accountRole"),
  adminGateMessage: document.getElementById("adminGateMessage"),
  switchNetworkGateButton: document.getElementById("switchNetworkGateButton"),
  adminShell: document.getElementById("adminShell"),
  currentEpoch: document.getElementById("currentEpoch"),
  tokenSummary: document.getElementById("tokenSummary"),
  walletTokenBalance: document.getElementById("walletTokenBalance"),
  airdropTokenBalance: document.getElementById("airdropTokenBalance"),
  claimsBuilderForm: document.getElementById("claimsBuilderForm"),
  builderFileNameInput: document.getElementById("builderFileNameInput"),
  addBuilderRowButton: document.getElementById("addBuilderRowButton"),
  clearBuilderButton: document.getElementById("clearBuilderButton"),
  loadBuilderButton: document.getElementById("loadBuilderButton"),
  downloadBuilderButton: document.getElementById("downloadBuilderButton"),
  builderValidationMessage: document.getElementById("builderValidationMessage"),
  builderClaimCount: document.getElementById("builderClaimCount"),
  builderClaimTotal: document.getElementById("builderClaimTotal"),
  builderMerkleRoot: document.getElementById("builderMerkleRoot"),
  claimsBuilderBody: document.getElementById("claimsBuilderBody"),
  uploadClaimsFileInput: document.getElementById("uploadClaimsFileInput"),
  startAirdropForm: document.getElementById("startAirdropForm"),
  startAirdropButton: document.getElementById("startAirdropButton"),
  startRootInput: document.getElementById("startRootInput"),
  startRootWarning: document.getElementById("startRootWarning"),
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
let pageInitPromise = Promise.resolve();

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

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function createBuilderRow(overrides = {}) {
  const row = {
    id: runtime.nextBuilderRowId,
    account: "",
    amount: "",
    ...overrides,
  };

  runtime.nextBuilderRowId += 1;
  return row;
}

function isBuilderRowBlank(row) {
  return !String(row?.account ?? "").trim() && !String(row?.amount ?? "").trim();
}

function getClaimsBuilderDefaultFileName() {
  const nextEpoch = runtime.currentEpoch > 0 ? runtime.currentEpoch + 1 : 1;
  return `round-${nextEpoch}.claims.json`;
}

function normalizeClaimsBuilderFileName(rawValue) {
  let fileName = String(rawValue ?? "").trim() || getClaimsBuilderDefaultFileName();
  if (!fileName.toLowerCase().endsWith(".json")) {
    fileName = `${fileName}.json`;
  }

  fileName = fileName.replace(/[<>:"/\\|?*\u0000-\u001f]+/g, "-").trim();
  return fileName || getClaimsBuilderDefaultFileName();
}

function ensureClaimsBuilderFileName() {
  if (!els.builderFileNameInput) return;
  if (!els.builderFileNameInput.value.trim()) {
    els.builderFileNameInput.value = getClaimsBuilderDefaultFileName();
  }
}

function buildClaimsBuilderArtifact() {
  const populatedRows = [];

  for (const [position, row] of runtime.builderRows.entries()) {
    const account = String(row.account ?? "").trim();
    const amount = String(row.amount ?? "").trim();

    if (!account && !amount) continue;

    if (!account || !amount) {
      throw new Error(`Row ${position + 1} must include both a wallet address and amount.`);
    }

    const normalizedAccount = normalizeAddress(account);
    if (!normalizedAccount || normalizedAccount === ethers.ZeroAddress) {
      throw new Error(`Row ${position + 1} has an invalid wallet address.`);
    }

    try {
      parseHumanAmount(amount, runtime.tokenDecimals);
    } catch {
      throw new Error(`Row ${position + 1} has an invalid amount.`);
    }

    populatedRows.push({
      index: populatedRows.length,
      account: normalizedAccount,
      amount,
    });
  }

  if (!populatedRows.length) return null;

  const round = buildClaimRound(populatedRows, runtime.tokenDecimals);
  const rawClaims = round.claims.map((claim) => ({
    index: Number.parseInt(claim.index, 10),
    account: claim.account,
    amount: formatInputAmount(BigInt(claim.amountRaw)),
  }));

  return {
    round,
    rawClaims,
    rawJson: `${JSON.stringify(rawClaims, null, 2)}\n`,
    fileName: normalizeClaimsBuilderFileName(els.builderFileNameInput?.value),
  };
}

function setBuilderValidationMessage(message = "") {
  if (!els.builderValidationMessage) return;

  if (!message) {
    els.builderValidationMessage.hidden = true;
    els.builderValidationMessage.textContent = "";
    return;
  }

  els.builderValidationMessage.hidden = false;
  els.builderValidationMessage.textContent = message;
}

function refreshClaimsBuilderStatus() {
  let artifact = null;
  let errorMessage = "";

  try {
    artifact = buildClaimsBuilderArtifact();
  } catch (error) {
    errorMessage = error?.message || "Unable to build the claims JSON.";
  }

  let generatedIndex = 0;
  for (const row of runtime.builderRows) {
    const indexElement = els.claimsBuilderBody?.querySelector(`[data-builder-index="${row.id}"]`);
    if (!indexElement) continue;

    if (isBuilderRowBlank(row)) {
      indexElement.textContent = "-";
      continue;
    }

    indexElement.textContent = String(generatedIndex);
    generatedIndex += 1;
  }

  if (artifact) {
    const walletLabel = artifact.round.claimCount === 1 ? "1 wallet" : `${artifact.round.claimCount} wallets`;
    els.builderClaimCount.textContent = walletLabel;
    els.builderClaimTotal.textContent = formatTokenAmount(
      BigInt(artifact.round.totalAmountRaw),
      runtime.tokenDecimals,
      runtime.tokenSymbol,
    );
    els.builderMerkleRoot.textContent = artifact.round.root;
    els.builderMerkleRoot.title = artifact.round.root;
    setBuilderValidationMessage("");
  } else {
    els.builderClaimCount.textContent = "-";
    els.builderClaimTotal.textContent = "-";
    els.builderMerkleRoot.textContent = "-";
    els.builderMerkleRoot.title = "";
    setBuilderValidationMessage(errorMessage);
  }

  const hasAnyInput = runtime.builderRows.some((row) => !isBuilderRowBlank(row));
  els.downloadBuilderButton.disabled = !artifact;
  els.loadBuilderButton.disabled = !artifact;
  els.clearBuilderButton.disabled = !hasAnyInput && runtime.builderRows.length === 1;

  return artifact;
}

function renderClaimsBuilderRows() {
  if (!runtime.builderRows.length) {
    runtime.builderRows = [createBuilderRow()];
  }

  els.claimsBuilderBody.innerHTML = runtime.builderRows
    .map((row) => `
      <tr data-builder-row-id="${row.id}">
        <td><span class="builder-index" data-builder-index="${row.id}">-</span></td>
        <td>
          <input
            class="builder-input"
            data-builder-row-id="${row.id}"
            data-builder-field="account"
            type="text"
            placeholder="0x..."
            value="${escapeHtml(row.account)}"
          >
        </td>
        <td>
          <input
            class="builder-input"
            data-builder-row-id="${row.id}"
            data-builder-field="amount"
            type="text"
            placeholder="100"
            value="${escapeHtml(row.amount)}"
          >
        </td>
        <td class="builder-row-action">
          <button
            type="button"
            class="ghost table-action-button"
            data-builder-remove="${row.id}"
            ${runtime.builderRows.length === 1 ? "disabled" : ""}
          >Remove</button>
        </td>
      </tr>
    `)
    .join("");

  refreshClaimsBuilderStatus();
}

function resetClaimsBuilder({ preserveFileName = false } = {}) {
  runtime.builderRows = [createBuilderRow()];
  if (preserveFileName) {
    ensureClaimsBuilderFileName();
  } else {
    els.builderFileNameInput.value = getClaimsBuilderDefaultFileName();
  }
  renderClaimsBuilderRows();
}

function applyUploadedRound(round, { clearUploadInput = false } = {}) {
  runtime.uploadedRound = round;
  runtime.startRequiresNewUpload = false;
  if (clearUploadInput) {
    els.uploadClaimsFileInput.value = "";
  }
  els.startRootInput.value = runtime.uploadedRound.root;
  els.fundAirdropAmount.value = formatInputAmount(BigInt(runtime.uploadedRound.totalAmountRaw));
  renderUploadedRound();
  updateStartAirdropButtonState();
}

function downloadClaimsBuilderJson() {
  const artifact = buildClaimsBuilderArtifact();
  if (!artifact) {
    throw new Error("Add at least one valid wallet row before downloading JSON.");
  }

  els.builderFileNameInput.value = artifact.fileName;
  const blob = new Blob([artifact.rawJson], { type: "application/json" });
  const downloadUrl = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = downloadUrl;
  link.download = artifact.fileName;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(downloadUrl);
}

function getEpochStatus(deadline) {
  const deadlineNumber = Number(deadline ?? 0);
  if (deadlineNumber === 0) return "Disabled";
  if (deadlineNumber <= runtime.chainTimestamp) return "Ended";
  return "Active";
}

function getEpochStatusTone(deadline) {
  const status = getEpochStatus(deadline);
  if (status === "Active") return "ready";
  if (status === "Disabled") return "error";
  return "neutral";
}

function getMatchingEpochsForRoot(root) {
  if (!ethers.isHexString(root, 32)) return [];
  const normalizedRoot = root.toLowerCase();
  return runtime.epochRows
    .filter((row) => row.root.toLowerCase() === normalizedRoot)
    .map((row) => row.epoch)
    .sort((left, right) => right - left);
}

function updateStartRootWarning() {
  if (!els.startRootWarning) return;

  const root = els.startRootInput.value.trim();
  const matchingEpochs = getMatchingEpochsForRoot(root);
  const epochLabel = matchingEpochs.length === 1
    ? `epoch ${matchingEpochs[0]}`
    : `epochs ${matchingEpochs.join(", ")}`;

  let message = "";
  let tone = "warn";

  if (runtime.startRequiresNewUpload && runtime.uploadedRound) {
    message = "This claims file was already started successfully. Prepare a new claims file before starting another airdrop.";
    if (matchingEpochs.length) {
      message += ` Matching Merkle root found in ${epochLabel}.`;
    }
    tone = "info";
  } else if (matchingEpochs.length) {
    message = `Warning: this Merkle root already exists in ${epochLabel}. Starting it again is allowed, but verify you are not re-submitting the same airdrop.`;
  }

  if (!message) {
    els.startRootWarning.hidden = true;
    els.startRootWarning.textContent = "";
    delete els.startRootWarning.dataset.tone;
    return;
  }

  els.startRootWarning.textContent = message;
  els.startRootWarning.dataset.tone = tone;
  els.startRootWarning.hidden = false;
}

function updateStartAirdropButtonState() {
  const hasRound = Boolean(runtime.uploadedRound);
  const hasRoot = ethers.isHexString(els.startRootInput.value.trim(), 32);
  const hasDeadline = Number.isFinite(Number(els.startDeadlineUnix.value)) && Number(els.startDeadlineUnix.value) > 0;
  const canSubmit = isOwner()
    && isReadyChain()
    && isClaimsApiConfigured(runtime.config)
    && hasRound
    && hasRoot
    && hasDeadline
    && !runtime.startRequiresNewUpload;
  els.startAirdropButton.disabled = !canSubmit;
  updateStartRootWarning();
}

function isReadyChain() {
  return runtime.chainId === runtime.config.chainId;
}

function isOwner() {
  return Boolean(runtime.account && runtime.owner && normalizeAddress(runtime.account) === normalizeAddress(runtime.owner));
}

function isPendingOwner() {
  return Boolean(
    runtime.account
    && runtime.pendingOwner
    && normalizeAddress(runtime.pendingOwner) !== ethers.ZeroAddress
    && normalizeAddress(runtime.account) === normalizeAddress(runtime.pendingOwner),
  );
}

function hasOwnershipAccess() {
  return Boolean(runtime.account && isReadyChain() && (isOwner() || isPendingOwner()));
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
  setWalletMenuOpen(false);
}

async function switchNetwork() {
  await switchConfiguredNetwork(runtime.config);
  await refreshPage();
  logger.log(`Switched to ${runtime.config.networkName}.`, "success");
}

async function tryAutoSwitchAfterConnect() {
  if (isReadyChain()) return;

  try {
    await switchConfiguredNetwork(runtime.config);
  } catch (error) {
    reportError(error, "Switch network");
  }
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
  runtime.startRequiresNewUpload = false;
  els.startRootInput.value = "";
  els.uploadClaimsFileInput.value = "";
  renderUploadedRound();
  updateStartAirdropButtonState();
}

function renderUploadedRound() {
  const round = runtime.uploadedRound;

  if (!round) {
    els.uploadedClaimCount.textContent = "-";
    els.uploadedClaimTotal.textContent = "-";
    els.uploadPreviewBody.innerHTML = '<tr><td colspan="3" class="empty-row">Upload or build a claims JSON file to preview it.</td></tr>';
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
  applyUploadedRound(buildClaimRound(rawText, runtime.tokenDecimals));
}

async function refreshCatalogRounds() {
  runtime.claimSourcesByEpoch = new Map();
  runtime.claimSourcesByRoot = new Map();

  if (!isClaimsApiConfigured(runtime.config)) return;

  const payload = await fetchStoredAirdropRounds(runtime.config);
  const rounds = Array.isArray(payload?.rounds) ? payload.rounds : [];

  for (const round of rounds) {
    const entry = { epoch: round.epoch, source: null, round, errorMessage: "" };
    runtime.claimSourcesByEpoch.set(round.epoch, entry);
    if (round?.merkleRoot) {
      runtime.claimSourcesByRoot.set(round.merkleRoot.toLowerCase(), entry);
    }
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
        <td>
          <div class="deadline-stack">
            <div><span>Local:</span> ${formatAdminDeadlineLocal(row.deadline)}</div>
            <div><span>UTC:</span> ${formatAdminDeadlineUtc(row.deadline)}</div>
          </div>
        </td>
        <td><span class="status-chip" data-tone="${getEpochStatusTone(row.deadline)}">${getEpochStatus(row.deadline)}</span></td>
        <td>${formatClaimedDisplay(row.claimedAmount, row.totalAmountRaw)}</td>
      </tr>
    `)
    .join("");
}

function applyOwnershipSection() {
  if (!els.ownershipShell) return;

  const normalizedPendingOwner = normalizeAddress(runtime.pendingOwner);
  const hasPendingOwner = Boolean(normalizedPendingOwner && normalizedPendingOwner !== ethers.ZeroAddress);

  els.ownershipCurrentOwner.textContent = runtime.owner || "-";
  els.ownershipPendingOwner.textContent = hasPendingOwner ? normalizedPendingOwner : "No pending owner";
  els.ownershipConnectedWallet.textContent = runtime.account || "No wallet connected";

  if (!runtime.provider || !runtime.account) {
    els.ownershipShell.hidden = true;
    return;
  }

  if (!isReadyChain()) {
    els.ownershipShell.hidden = true;
    return;
  }

  const canTransfer = isOwner();
  const canAccept = isPendingOwner();

  els.ownershipShell.hidden = !(canTransfer || canAccept);
  els.transferOwnershipButton.disabled = !canTransfer;
  els.transferOwnershipAddress.disabled = !canTransfer;
  els.acceptOwnershipButton.disabled = !canAccept;

  if (canTransfer) {
    els.ownershipStatusMessage.textContent = hasPendingOwner
      ? "The current owner can replace the pending owner by submitting a new transfer. The pending owner must still accept from their own wallet."
      : "Submit a new owner address to start the two-step transfer. The recipient must then connect and accept ownership.";
  } else if (canAccept) {
    els.ownershipStatusMessage.textContent = "This wallet is the pending owner. Submit Accept Ownership to complete the transfer.";
  }
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
      const localSource = runtime.claimSourcesByEpoch.get(epoch)
        || runtime.claimSourcesByRoot.get(root.toLowerCase())
        || null;
      const localRound = localSource?.round;
      const totalAmountRaw = localRound && localRound.merkleRoot.toLowerCase() === root.toLowerCase()
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

  if (!runtime.provider) {
    els.accountRole.textContent = "Wallet missing";
    els.adminGateMessage.textContent = "Install a compatible browser wallet to manage the airdrop.";
    els.switchNetworkGateButton.hidden = true;
    els.adminShell.hidden = true;
    return;
  }

  if (!runtime.account) {
    els.accountRole.textContent = "Disconnected";
    els.adminGateMessage.textContent = "Connect the owner wallet to view admin controls.";
    els.switchNetworkGateButton.hidden = true;
    els.adminShell.hidden = true;
    return;
  }

  if (!isReadyChain()) {
    els.accountRole.textContent = "Wrong network";
    els.adminGateMessage.textContent = "Switch the connected wallet to the configured network to manage the airdrop.";
    els.switchNetworkGateButton.hidden = false;
    els.adminShell.hidden = true;
    return;
  }

  if (!runtime.owner) {
    els.accountRole.textContent = "Connected wallet";
    els.adminGateMessage.textContent = "Owner address is not available yet. Check the contract config.";
    els.switchNetworkGateButton.hidden = true;
    els.adminShell.hidden = true;
    return;
  }

  if (!isOwner()) {
    els.accountRole.textContent = "Connected wallet";
    els.adminGateMessage.textContent = "This page only unlocks for the current owner address.";
    els.switchNetworkGateButton.hidden = true;
    els.adminShell.hidden = true;
    return;
  }

  els.accountRole.textContent = "Owner connected";
  els.adminGateMessage.textContent = "Owner wallet detected. Admin controls are unlocked.";
  els.switchNetworkGateButton.hidden = true;
  els.adminShell.hidden = false;
  updateStartAirdropButtonState();
}

async function refreshPage() {
  await syncWalletState(runtime);
  syncWalletButton();

  runtime.owner = null;
  runtime.pendingOwner = null;
  runtime.currentEpoch = 0;
  runtime.epochRows = [];
  runtime.chainTimestamp = Math.floor(Date.now() / 1000);
  els.currentEpoch.textContent = "-";
  els.tokenSummary.textContent = "-";
  els.walletTokenBalance.textContent = "-";
  els.airdropTokenBalance.textContent = "-";

  try {
    if (runtime.provider) {
      const latestBlock = await runtime.provider.getBlock("latest");
      runtime.chainTimestamp = Number(latestBlock?.timestamp ?? 0);
    }

    const snapshot = await fetchDashboardSnapshot({
      config: runtime.config,
      provider: runtime.provider,
      account: runtime.account,
    });

    runtime.owner = snapshot.owner;
    runtime.pendingOwner = snapshot.pendingOwner;
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
    runtime.pendingOwner = null;
    runtime.currentEpoch = 0;
  }

  await refreshCatalogRounds().catch(() => {
    runtime.claimSourcesByEpoch = new Map();
  });

  await refreshEpochRows().catch(() => {
    runtime.epochRows = [];
    renderEpochList();
  });

  if (!runtime.builderRows.length) {
    resetClaimsBuilder();
  } else {
    ensureClaimsBuilderFileName();
    refreshClaimsBuilderStatus();
  }

  renderUploadedRound();
  applyOwnerGate();
  applyOwnershipSection();
  updateStartAirdropButtonState();
}

async function fundUploadedRound() {
  if (!runtime.uploadedRound) {
    throw new Error("Prepare a claims JSON file first.");
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

async function startAirdropAndPersistRound() {
  if (!runtime.uploadedRound) {
    throw new Error("Prepare a claims JSON file first.");
  }

  if (!isClaimsApiConfigured(runtime.config)) {
    throw new Error("Backend API URL is not configured.");
  }

  const { airdrop } = getContracts({
    config: runtime.config,
    provider: runtime.provider,
    signer: runtime.signer,
    withSigner: true,
  });

  if (!airdrop) {
    throw new Error("Airdrop address is not configured.");
  }

  const root = els.startRootInput.value.trim();
  if (!ethers.isHexString(root, 32)) {
    throw new Error("Merkle root must be a bytes32 hex string.");
  }

  const deadlineUnix = Number(els.startDeadlineUnix.value);
  await validateFutureDeadlineAgainstChain(deadlineUnix);

  const tx = await airdrop.startNewAirdrop(root, deadlineUnix);
  logger.log(`Start airdrop: submitted ${tx.hash}`);
  const receipt = await tx.wait();
  logger.log(`Start airdrop: confirmed in block ${receipt.blockNumber}`, "success");

  try {
    const finalizeChallenge = await requestAirdropFinalizeChallenge(runtime.config, {
      walletAddress: runtime.account,
      txHash: tx.hash,
      merkleRoot: runtime.uploadedRound.root,
    });
    const finalizeSignature = await runtime.signer.signMessage(finalizeChallenge.message);

    const persisted = await persistAirdropRound(runtime.config, {
      txHash: tx.hash,
      walletAddress: runtime.account,
      challengeId: finalizeChallenge.challengeId,
      signature: finalizeSignature,
      decimals: runtime.tokenDecimals,
      claims: runtime.uploadedRound.claims.map((claim) => ({
        index: claim.index,
        account: claim.account,
        amountRaw: claim.amountRaw,
      })),
    });

    runtime.startRequiresNewUpload = true;
    await refreshPage();
    updateStartAirdropButtonState();

    if (persisted?.round?.epoch) {
      logger.log(`Round ${persisted.round.epoch} saved to the backend.`, "success");
    }
  } catch (error) {
    runtime.startRequiresNewUpload = true;
    await refreshPage().catch(() => {});
    updateStartAirdropButtonState();
    throw new Error(
      `Airdrop was started on chain, but saving the round to the backend failed. ${error?.message || String(error)}`,
    );
  }
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
      await tryAutoSwitchAfterConnect();
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

  els.switchNetworkButton?.addEventListener("click", async () => {
    try {
      await switchNetwork();
    } catch (error) {
      reportError(error, "Switch network");
    }
  });

  els.switchNetworkGateButton?.addEventListener("click", async () => {
    try {
      await switchNetwork();
    } catch (error) {
      reportError(error, "Switch network");
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

  els.claimPageButton?.addEventListener("click", () => {
    window.location.href = "./index.html";
  });

  els.builderFileNameInput?.addEventListener("blur", () => {
    els.builderFileNameInput.value = normalizeClaimsBuilderFileName(els.builderFileNameInput.value);
  });

  els.addBuilderRowButton?.addEventListener("click", () => {
    const nextRow = createBuilderRow();
    runtime.builderRows.push(nextRow);
    renderClaimsBuilderRows();
    els.claimsBuilderBody
      ?.querySelector(`input[data-builder-row-id="${nextRow.id}"][data-builder-field="account"]`)
      ?.focus();
  });

  els.claimsBuilderBody?.addEventListener("input", (event) => {
    const target = event.target;
    if (!(target instanceof HTMLInputElement)) return;

    const rowId = Number(target.dataset.builderRowId);
    const field = target.dataset.builderField;
    if (!Number.isInteger(rowId) || (field !== "account" && field !== "amount")) return;

    const row = runtime.builderRows.find((item) => item.id === rowId);
    if (!row) return;

    row[field] = target.value;
    refreshClaimsBuilderStatus();
  });

  els.claimsBuilderBody?.addEventListener("click", (event) => {
    const target = event.target;
    if (!(target instanceof HTMLElement)) return;

    const removeButton = target.closest("[data-builder-remove]");
    if (!removeButton) return;

    const rowId = Number(removeButton.getAttribute("data-builder-remove"));
    if (!Number.isInteger(rowId)) return;

    runtime.builderRows = runtime.builderRows.filter((row) => row.id !== rowId);
    if (!runtime.builderRows.length) {
      runtime.builderRows = [createBuilderRow()];
    }
    renderClaimsBuilderRows();
  });

  els.clearBuilderButton?.addEventListener("click", () => {
    resetClaimsBuilder({ preserveFileName: true });
    logger.log("Claims builder cleared.");
  });

  els.loadBuilderButton?.addEventListener("click", async () => {
    try {
      const artifact = buildClaimsBuilderArtifact();
      if (!artifact) throw new Error("Add at least one valid wallet row before loading claims.");

      applyUploadedRound(artifact.round, { clearUploadInput: true });
      logger.log("Built claims loaded.", "success");
    } catch (error) {
      reportError(error, "Use built claims");
    }
  });

  els.downloadBuilderButton?.addEventListener("click", async () => {
    try {
      downloadClaimsBuilderJson();
      logger.log(`Claims JSON downloaded as ${normalizeClaimsBuilderFileName(els.builderFileNameInput.value)}.`, "success");
    } catch (error) {
      reportError(error, "Download claims JSON");
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
    logger.log("Prepared claims cleared.");
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
    updateStartAirdropButtonState();
  });
  els.startDeadlineUtcInput.addEventListener("input", () => {
    syncDeadlineFromUtc(els.startDeadlineInput, els.startDeadlineUtcInput, els.startDeadlineUnix);
    updateStartAirdropButtonState();
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
      await startAirdropAndPersistRound();
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

  els.transferOwnershipForm?.addEventListener("submit", async (event) => {
    event.preventDefault();
    try {
      const { airdrop } = getContracts({
        config: runtime.config,
        provider: runtime.provider,
        signer: runtime.signer,
        withSigner: true,
      });
      if (!airdrop) throw new Error("Airdrop address is not configured.");
      if (!isOwner()) throw new Error("Only the current owner can nominate a new owner.");

      const nextOwner = readRequiredAddress(els.transferOwnershipAddress);
      await sendTransaction("Transfer ownership", () => airdrop.transferOwnership(nextOwner), {
        log: logger.log,
        afterSuccess: async () => {
          els.transferOwnershipAddress.value = "";
          await refreshPage();
        },
        formatError: (error, label) => formatUiError(error, label, runtime),
      });
    } catch (error) {
      reportError(error, "Transfer ownership");
    }
  });

  els.acceptOwnershipForm?.addEventListener("submit", async (event) => {
    event.preventDefault();
    try {
      const { airdrop } = getContracts({
        config: runtime.config,
        provider: runtime.provider,
        signer: runtime.signer,
        withSigner: true,
      });
      if (!airdrop) throw new Error("Airdrop address is not configured.");
      if (!isPendingOwner()) throw new Error("Only the pending owner can accept ownership.");

      await sendTransaction("Accept ownership", () => airdrop.acceptOwnership(), {
        log: logger.log,
        afterSuccess: async () => {
          await refreshPage();
        },
        formatError: (error, label) => formatUiError(error, label, runtime),
      });
    } catch (error) {
      reportError(error, "Accept ownership");
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
      const totalAmountRaw = localRound && localRound.merkleRoot.toLowerCase() === root.toLowerCase()
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
      const localClaim = isClaimsApiConfigured(runtime.config)
        ? await fetchStoredClaimByEpochAndIndex(runtime.config, epoch.toString(), index.toString()).catch(() => null)
        : null;
      els.claimStatusResult.textContent = JSON.stringify(
        {
          epoch: epoch.toString(),
          index: index.toString(),
          account: localClaim?.entry?.account || null,
          amountRaw: localClaim?.entry?.amountRaw || null,
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
  bindEvents();
  updateToastOffset();

  pageInitPromise = (async () => {
    updateToastOffset();
    try {
      const loaded = await loadUiConfig();
      runtime.config = loaded.config;
      runtime.configSource = loaded.source;
      await ensureProvider(runtime).catch(() => null);
      await refreshPage();
    } catch (error) {
      reportError(error, "Initialize admin page");
    }
  })();

  await pageInitPromise;
  updateToastOffset();
}

bindGlobalErrorHandlers(reportError);
init();
