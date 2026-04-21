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
  fetchStoredRoundClaims,
  fetchStoredClaimsByWallet,
  isClaimsApiConfigured,
  saveAirdropRound,
  deploySavedAirdropRound,
  requestAirdropSaveChallenge,
} from "../shared/claims.js";
import {
  requestAdminAccessChallenge,
  completeAdminAccess,
  fetchAdminAccounts,
  importAdminAccounts,
  reconcileAdminAirdropClaims,
  saveAdminAccount,
  fetchAdminRecoverySubmissions,
  importAdminRecoverySubmissions,
  exportAdminRecoverySubmissions,
} from "../shared/admin-data.js";
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
  storedRounds: [],
  storedRoundsByEpoch: new Map(),
  storedRoundsByRoot: new Map(),
  roundRows: [],
  selectedRoundId: null,
  selectedRoundClaims: [],
  claimLookupRows: [],
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
  activeAdminTab: "prepare",
  adminAccessToken: "",
  adminAccessExpiresAt: 0,
  adminAccessPromise: null,
  managementSummary: {
    accountCount: 0,
    followerCount: 0,
    recoveryCandidateCount: 0,
    latestSnapshotCapturedAt: null,
    recoverySubmissionCount: 0,
  },
  claimSyncSummary: {
    totalClaimedCount: 0,
    totalClaimedAmountRaw: "0",
    claimsLastReconciledAt: null,
  },
  accountsRows: [],
  accountsPagination: {
    page: 1,
    pageSize: 50,
    total: 0,
    totalPages: 0,
    hasNextPage: false,
    hasPreviousPage: false,
  },
  accountsSearch: "",
  recoverySubmissionRows: [],
  recoveryPagination: {
    page: 1,
    pageSize: 50,
    total: 0,
    totalPages: 0,
    hasNextPage: false,
    hasPreviousPage: false,
  },
  recoverySearch: "",
  hasLoadedAccountsTab: false,
  isConnectingWallet: false,
  noticeTimerId: null,
};

const els = {
  adminHeader: document.getElementById("adminHeader"),
  refreshButton: document.getElementById("refreshButton"),
  reconcileClaimsButton: document.getElementById("reconcileClaimsButton"),
  claimSyncStatus: document.getElementById("claimSyncStatus"),
  adminClaimedTotal: document.getElementById("adminClaimedTotal"),
  connectButton: document.getElementById("connectButton"),
  walletMenu: document.getElementById("walletMenu"),
  walletMenuAddress: document.getElementById("walletMenuAddress"),
  walletMenuChainId: document.getElementById("walletMenuChainId"),
  switchNetworkButton: document.getElementById("switchNetworkButton"),
  claimPageButton: document.getElementById("claimPageButton"),
  copyWalletAddressButton: document.getElementById("copyWalletAddressButton"),
  disconnectButton: document.getElementById("disconnectButton"),
  adminTabButtons: [...document.querySelectorAll("[data-admin-tab]")],
  adminTabPanels: [...document.querySelectorAll("[data-admin-panel]")],
  connectedAccount: document.getElementById("connectedAccount"),
  ownerAddress: document.getElementById("ownerAddress"),
  pendingOwnerShell: document.getElementById("pendingOwnerShell"),
  pendingOwnershipCurrentOwner: document.getElementById("pendingOwnershipCurrentOwner"),
  pendingOwnershipPendingOwner: document.getElementById("pendingOwnershipPendingOwner"),
  pendingAcceptOwnershipButton: document.getElementById("pendingAcceptOwnershipButton"),
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
  builderUniformAmountInput: document.getElementById("builderUniformAmountInput"),
  addBuilderRowButton: document.getElementById("addBuilderRowButton"),
  clearBuilderButton: document.getElementById("clearBuilderButton"),
  loadWalletAccountsButton: document.getElementById("loadWalletAccountsButton"),
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
  roundClaimsSection: document.getElementById("roundClaimsSection"),
  selectedRoundLabel: document.getElementById("selectedRoundLabel"),
  selectedRoundMeta: document.getElementById("selectedRoundMeta"),
  selectedRoundClaimCount: document.getElementById("selectedRoundClaimCount"),
  selectedRoundTotal: document.getElementById("selectedRoundTotal"),
  roundClaimsBody: document.getElementById("roundClaimsBody"),
  epochQueryForm: document.getElementById("epochQueryForm"),
  queryEpochInput: document.getElementById("queryEpochInput"),
  epochQueryResult: document.getElementById("epochQueryResult"),
  claimStatusForm: document.getElementById("claimStatusForm"),
  claimLookupInput: document.getElementById("claimLookupInput"),
  claimLookupBody: document.getElementById("claimLookupBody"),
  managementAccountCount: document.getElementById("managementAccountCount"),
  managementFollowerCount: document.getElementById("managementFollowerCount"),
  managementRecoveryCandidateCount: document.getElementById("managementRecoveryCandidateCount"),
  managementSubmissionCount: document.getElementById("managementSubmissionCount"),
  managementLatestSnapshot: document.getElementById("managementLatestSnapshot"),
  accountsImportForm: document.getElementById("accountsImportForm"),
  accountsImportFileInput: document.getElementById("accountsImportFileInput"),
  downloadAccountsTemplateButton: document.getElementById("downloadAccountsTemplateButton"),
  singleAccountForm: document.getElementById("singleAccountForm"),
  singleAccountUsernameInput: document.getElementById("singleAccountUsernameInput"),
  singleAccountUserIdInput: document.getElementById("singleAccountUserIdInput"),
  singleAccountWalletInput: document.getElementById("singleAccountWalletInput"),
  singleAccountIsFollowerInput: document.getElementById("singleAccountIsFollowerInput"),
  singleAccountNeedsRecoveryInput: document.getElementById("singleAccountNeedsRecoveryInput"),
  accountsQueryForm: document.getElementById("accountsQueryForm"),
  accountsSearchInput: document.getElementById("accountsSearchInput"),
  accountsPageSizeSelect: document.getElementById("accountsPageSizeSelect"),
  accountsClearSearchButton: document.getElementById("accountsClearSearchButton"),
  accountsPaginationLabel: document.getElementById("accountsPaginationLabel"),
  accountsPreviousPageButton: document.getElementById("accountsPreviousPageButton"),
  accountsNextPageButton: document.getElementById("accountsNextPageButton"),
  accountsTableBody: document.getElementById("accountsTableBody"),
  recoveryImportForm: document.getElementById("recoveryImportForm"),
  recoveryImportFileInput: document.getElementById("recoveryImportFileInput"),
  exportRecoveryJsonButton: document.getElementById("exportRecoveryJsonButton"),
  exportRecoveryCsvButton: document.getElementById("exportRecoveryCsvButton"),
  recoveryQueryForm: document.getElementById("recoveryQueryForm"),
  recoverySearchInput: document.getElementById("recoverySearchInput"),
  recoveryPageSizeSelect: document.getElementById("recoveryPageSizeSelect"),
  recoveryClearSearchButton: document.getElementById("recoveryClearSearchButton"),
  recoveryPaginationLabel: document.getElementById("recoveryPaginationLabel"),
  recoveryPreviousPageButton: document.getElementById("recoveryPreviousPageButton"),
  recoveryNextPageButton: document.getElementById("recoveryNextPageButton"),
  recoverySubmissionsBody: document.getElementById("recoverySubmissionsBody"),
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
const ADMIN_LINKED_WALLET_PAGE_SIZE = 200;
const ADMIN_ACCOUNTS_TEMPLATE_CSV = [
  "x_username,wallet_address,x_user_id,is_follower,needs_recovery,snapshot_history_json",
  "example_user,0x0000000000000000000000000000000000000001,123456789,true,false,\"[\"\"2026-04-15T17:38:57.616Z\"\", \"\"2026-04-20T15:59:46.289Z\"\"]\"",
].join("\n");

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

function formatManagementDateTime(value) {
  if (!value) return "-";

  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return String(value);
  }

  return parsed.toLocaleString();
}

function createFlagBadge(value, { positiveLabel = "Yes", negativeLabel = "No" } = {}) {
  const label = value ? positiveLabel : negativeLabel;
  const tone = value ? "positive" : "muted";
  return `<span class="table-flag" data-tone="${tone}">${escapeHtml(label)}</span>`;
}

function formatPaginationLabel(pagination, singularLabel, pluralLabel) {
  const total = Number(pagination?.total || 0);
  if (!total) {
    return `0 ${pluralLabel}`;
  }

  const page = Number(pagination?.page || 1);
  const totalPages = Number(pagination?.totalPages || 1);
  const pageSize = Number(pagination?.pageSize || total);
  const start = ((page - 1) * pageSize) + 1;
  const end = Math.min(start + pageSize - 1, total);
  const itemLabel = total === 1 ? singularLabel : pluralLabel;
  return `Showing ${start}-${end} of ${total} ${itemLabel} (page ${page}/${Math.max(totalPages, 1)})`;
}

function downloadTextFile(fileName, content, contentType) {
  const blob = new Blob([content], { type: contentType });
  const downloadUrl = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = downloadUrl;
  link.download = fileName;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(downloadUrl);
}

function getExplorerAddressUrl(address) {
  const normalizedAddress = normalizeAddress(address);
  const explorerBaseUrl = String(runtime.config.explorerBaseUrl || "").trim().replace(/\/+$/u, "");

  if (!normalizedAddress || !explorerBaseUrl) {
    return "";
  }

  return `${explorerBaseUrl}/address/${normalizedAddress}`;
}

function renderExplorerAddress(address) {
  const normalizedAddress = normalizeAddress(address);
  if (!normalizedAddress) {
    return "-";
  }

  const explorerUrl = getExplorerAddressUrl(normalizedAddress);
  const label = formatAddressShort(normalizedAddress);
  const codeLabel = `<code title="${normalizedAddress}">${label}</code>`;

  if (!explorerUrl) {
    return codeLabel;
  }

  return `<a class="table-address-link" href="${explorerUrl}" target="_blank" rel="noreferrer noopener">${codeLabel}</a>`;
}

function renderTokenSummary(symbol, tokenAddress) {
  const normalizedSymbol = String(symbol || "").trim();
  if (!normalizedSymbol) {
    return "-";
  }

  const explorerUrl = getExplorerAddressUrl(tokenAddress);
  const label = escapeHtml(normalizedSymbol);
  if (!explorerUrl) {
    return label;
  }

  return `<a class="table-address-link" href="${explorerUrl}" target="_blank" rel="noreferrer noopener">${label}</a>`;
}

function resetAdminAccess() {
  runtime.adminAccessToken = "";
  runtime.adminAccessExpiresAt = 0;
  runtime.adminAccessPromise = null;
}

function isAdminAccessError(error) {
  const message = String(error?.message || "");
  return /admin access|current contract owner/i.test(message);
}

async function ensureAdminAccess() {
  if (!isOwner()) {
    throw new Error("Only the current owner can access follower management.");
  }

  const tokenIsFresh = runtime.adminAccessToken
    && Number(runtime.adminAccessExpiresAt || 0) > (Date.now() + 30_000);
  if (tokenIsFresh) {
    return runtime.adminAccessToken;
  }

  if (runtime.adminAccessPromise) {
    return runtime.adminAccessPromise;
  }

  runtime.adminAccessPromise = (async () => {
    const challenge = await requestAdminAccessChallenge(runtime.config, {
      walletAddress: runtime.account,
    });
    const signature = await runtime.signer.signMessage(challenge.message);
    const session = await completeAdminAccess(runtime.config, {
      walletAddress: runtime.account,
      challengeId: challenge.challengeId,
      signature,
    });

    runtime.adminAccessToken = String(session.accessToken || "").trim();
    runtime.adminAccessExpiresAt = Number(session.expiresAt || 0);
    return runtime.adminAccessToken;
  })();

  try {
    return await runtime.adminAccessPromise;
  } finally {
    runtime.adminAccessPromise = null;
  }
}

async function callAdminApi(callback, { retryOnAuthFailure = true } = {}) {
  let accessToken = await ensureAdminAccess();

  try {
    return await callback(accessToken);
  } catch (error) {
    if (!retryOnAuthFailure || !isAdminAccessError(error)) {
      throw error;
    }

    resetAdminAccess();
    accessToken = await ensureAdminAccess();
    return callback(accessToken);
  }
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
  runtime.uploadedRound = {
    storedRoundId: round?.storedRoundId || null,
    ...round,
  };
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

async function fetchAllLinkedWalletAccounts() {
  const accounts = [];
  let page = 1;

  while (true) {
    const payload = await callAdminApi((accessToken) => fetchAdminAccounts(runtime.config, accessToken, {
      page,
      pageSize: ADMIN_LINKED_WALLET_PAGE_SIZE,
      walletOnly: true,
    }));

    if (page === 1) {
      applyManagementResponse(payload);
      renderManagementSummary();
    }

    accounts.push(...(Array.isArray(payload?.accounts) ? payload.accounts : []));

    if (!payload?.pagination?.hasNextPage) {
      return {
        accounts,
        total: Number(payload?.pagination?.total || accounts.length),
      };
    }

    page += 1;
  }
}

function buildBuilderRowsFromLinkedWalletAccounts(accounts, amount) {
  const rows = [];
  const seenWallets = new Set();
  let invalidCount = 0;
  let duplicateCount = 0;

  for (const account of accounts) {
    const normalizedWallet = normalizeAddress(account?.walletAddress);
    if (!normalizedWallet || normalizedWallet === ethers.ZeroAddress) {
      invalidCount += 1;
      continue;
    }

    if (seenWallets.has(normalizedWallet)) {
      duplicateCount += 1;
      continue;
    }

    seenWallets.add(normalizedWallet);
    rows.push(createBuilderRow({
      account: normalizedWallet,
      amount,
    }));
  }

  return {
    rows,
    invalidCount,
    duplicateCount,
  };
}

function formatLinkedWalletLoadMessage({ loadedCount, invalidCount = 0, duplicateCount = 0 }) {
  const segments = [
    `${loadedCount} linked ${loadedCount === 1 ? "wallet" : "wallets"} loaded`,
  ];

  if (invalidCount) {
    segments.push(`${invalidCount} invalid skipped`);
  }

  if (duplicateCount) {
    segments.push(`${duplicateCount} duplicate skipped`);
  }

  return `${segments.join("; ")}.`;
}

async function loadAllLinkedWalletClaimsIntoBuilder() {
  const amount = String(els.builderUniformAmountInput?.value || "").trim();
  if (!amount) {
    throw new Error("Enter an amount to use for every linked wallet.");
  }

  try {
    parseHumanAmount(amount, runtime.tokenDecimals);
  } catch {
    throw new Error("Enter a valid amount to use for every linked wallet.");
  }

  els.builderUniformAmountInput.value = amount;

  const { accounts, total } = await fetchAllLinkedWalletAccounts();
  if (!total) {
    throw new Error("No accounts with saved wallets were found.");
  }

  const {
    rows,
    invalidCount,
    duplicateCount,
  } = buildBuilderRowsFromLinkedWalletAccounts(accounts, amount);

  if (!rows.length) {
    throw new Error("No valid linked wallets were found.");
  }

  runtime.builderRows = rows;
  ensureClaimsBuilderFileName();
  renderClaimsBuilderRows();

  const artifact = buildClaimsBuilderArtifact();
  if (!artifact) {
    throw new Error("Unable to build claims from linked wallets.");
  }

  applyUploadedRound(artifact.round, { clearUploadInput: true });

  return {
    loadedCount: rows.length,
    invalidCount,
    duplicateCount,
  };
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

function getStoredRoundsForRoot(root) {
  if (!ethers.isHexString(root, 32)) return [];
  return runtime.storedRoundsByRoot.get(root.toLowerCase()) || [];
}

function formatStoredRoundLabel(round) {
  if (!round) return "-";
  if (round.status === "draft") return "Draft";
  if (round.epoch != null) return `Epoch ${round.epoch}`;
  return "Saved";
}

function formatSelectedRoundLabel(round) {
  const baseLabel = formatStoredRoundLabel(round);
  if (!round?.merkleRoot) return baseLabel;
  return `${baseLabel} - ${formatHexShort(round.merkleRoot)}`;
}

function scrollRoundClaimsSectionIntoView() {
  if (!els.roundClaimsSection) return;

  window.requestAnimationFrame(() => {
    els.roundClaimsSection.scrollIntoView({
      behavior: "smooth",
      block: "start",
    });
  });
}

function updateStartRootWarning() {
  if (!els.startRootWarning) return;

  const root = els.startRootInput.value.trim();
  const matchingEpochs = getMatchingEpochsForRoot(root);
  const matchingStoredRounds = getStoredRoundsForRoot(root);
  const matchingDrafts = matchingStoredRounds.filter((round) => round.status === "draft");
  const matchingSavedRound = runtime.uploadedRound?.storedRoundId
    ? runtime.storedRounds.find((round) => round.id === runtime.uploadedRound.storedRoundId) || null
    : null;
  const epochLabel = matchingEpochs.length === 1
    ? `epoch ${matchingEpochs[0]}`
    : `epochs ${matchingEpochs.join(", ")}`;

  let message = "";
  let tone = "warn";

  if (matchingSavedRound) {
    const savedLabel = matchingSavedRound.status === "draft"
      ? "a saved draft"
      : formatStoredRoundLabel(matchingSavedRound).toLowerCase();
    message = `This claims file is already saved as ${savedLabel}. Deploy it from the rounds tab when you are ready.`;
    tone = "info";
  } else if (matchingDrafts.length) {
    const draftLabel = matchingDrafts.length === 1
      ? "another saved draft"
      : `${matchingDrafts.length} saved drafts`;
    message = `Warning: this Merkle root already exists in ${draftLabel}. Saving another draft is allowed, but drafts do not reserve an epoch.`;
  } else if (matchingEpochs.length) {
    message = `Warning: this Merkle root already exists on chain in ${epochLabel}. Saving it again is allowed, but verify you are not re-submitting the same airdrop.`;
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
  const alreadySaved = Boolean(runtime.uploadedRound?.storedRoundId);
  const canSubmit = isOwner()
    && isReadyChain()
    && isClaimsApiConfigured(runtime.config)
    && hasRound
    && hasRoot
    && hasDeadline
    && !alreadySaved;
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
  els.clearUploadedButton.disabled = false;
}

async function loadUploadedClaimsFile(file) {
  const rawText = await file.text();
  applyUploadedRound(buildClaimRound(rawText, runtime.tokenDecimals));
}

async function refreshStoredRounds() {
  runtime.storedRounds = [];
  runtime.storedRoundsByEpoch = new Map();
  runtime.storedRoundsByRoot = new Map();
  runtime.claimSyncSummary = {
    totalClaimedCount: 0,
    totalClaimedAmountRaw: "0",
    claimsLastReconciledAt: null,
  };

  if (!isClaimsApiConfigured(runtime.config)) return;

  const payload = await fetchStoredAirdropRounds(runtime.config);
  const rounds = Array.isArray(payload?.rounds) ? payload.rounds : [];
  runtime.storedRounds = rounds;
  runtime.claimSyncSummary = {
    totalClaimedCount: Number(payload?.summary?.totalClaimedCount || 0),
    totalClaimedAmountRaw: String(payload?.summary?.totalClaimedAmountRaw || "0"),
    claimsLastReconciledAt: payload?.summary?.claimsLastReconciledAt || null,
  };

  for (const round of rounds) {
    if (round.status === "deployed" && Number.isInteger(round.epoch)) {
      runtime.storedRoundsByEpoch.set(Number(round.epoch), round);
    }

    if (round?.merkleRoot) {
      const rootKey = round.merkleRoot.toLowerCase();
      const rootMatches = runtime.storedRoundsByRoot.get(rootKey) || [];
      rootMatches.push(round);
      runtime.storedRoundsByRoot.set(rootKey, rootMatches);
    }
  }
}

function formatClaimedDisplay(claimedAmount, totalAmountRaw) {
  const claimedText = formatTokenAmount(claimedAmount, runtime.tokenDecimals, runtime.tokenSymbol);
  if (totalAmountRaw == null) return claimedText;
  return `${claimedText} / ${formatTokenAmount(totalAmountRaw, runtime.tokenDecimals, runtime.tokenSymbol)}`;
}

function formatRoundTotalDisplay(row) {
  if (row.claimedAmount != null) {
    return formatClaimedDisplay(row.claimedAmount, row.totalAmountRaw);
  }

  if (row.totalAmountRaw != null) {
    return formatTokenAmount(row.totalAmountRaw, runtime.tokenDecimals, runtime.tokenSymbol);
  }

  return "-";
}

function doesStoredRoundMatchChainRow(storedRound, chainRow) {
  if (!storedRound || !chainRow) return false;

  return String(storedRound.merkleRoot || "").toLowerCase() === String(chainRow.root || "").toLowerCase();
}

function getRoundRowStatus(row) {
  if (row.rowType === "draft") {
    return { tone: "neutral", text: "Draft" };
  }

  if (row.rowType === "stored-only") {
    return { tone: "error", text: "Missing on chain" };
  }

  return {
    tone: getEpochStatusTone(row.deadline),
    text: getEpochStatus(row.deadline),
  };
}

function sortDraftRounds(left, right) {
  return String(right.updatedAt || "").localeCompare(String(left.updatedAt || ""));
}

function sortDeployedRounds(left, right) {
  const leftEpoch = Number(left.epoch || 0);
  const rightEpoch = Number(right.epoch || 0);
  if (leftEpoch !== rightEpoch) {
    return rightEpoch - leftEpoch;
  }

  return String(right.updatedAt || "").localeCompare(String(left.updatedAt || ""));
}

function buildRoundRows() {
  const rows = [];
  const matchedStoredRoundIds = new Set();
  const draftRounds = runtime.storedRounds
    .filter((round) => round.status === "draft")
    .sort(sortDraftRounds);

  for (const round of draftRounds) {
    rows.push({
      key: `draft-${round.id}`,
      rowType: "draft",
      roundId: round.id,
      label: "Draft",
      root: round.merkleRoot,
      deadline: Number(round.deadline || 0),
      claimedAmount: null,
      totalAmountRaw: BigInt(round.totalAmountRaw),
      sourceText: "DB draft",
      canFundTotal: true,
      canDeploy: true,
      canViewClaims: true,
    });
  }

  for (const chainRow of runtime.epochRows) {
    const storedRound = runtime.storedRoundsByEpoch.get(Number(chainRow.epoch)) || null;
    const matchesStoredRound = doesStoredRoundMatchChainRow(storedRound, chainRow);
    if (matchesStoredRound) {
      matchedStoredRoundIds.add(storedRound.id);
    }

    rows.push({
      key: matchesStoredRound ? `round-${storedRound.id}` : `chain-${chainRow.epoch}`,
      rowType: matchesStoredRound ? "deployed" : "chain-only",
      roundId: matchesStoredRound ? storedRound.id : null,
      label: `Epoch ${chainRow.epoch}`,
      root: chainRow.root,
      deadline: Number(chainRow.deadline || 0),
      claimedAmount: matchesStoredRound
        ? BigInt(storedRound.claimedAmountRaw || "0")
        : chainRow.claimedAmount,
      totalAmountRaw: matchesStoredRound ? BigInt(storedRound.totalAmountRaw) : chainRow.totalAmountRaw,
      sourceText: matchesStoredRound ? "DB + Chain" : "Chain only",
      canFundTotal: matchesStoredRound,
      canDeploy: false,
      canViewClaims: Boolean(matchesStoredRound),
    });
  }

  const storedOnlyRounds = runtime.storedRounds
    .filter((round) => round.status === "deployed" && !matchedStoredRoundIds.has(round.id))
    .sort(sortDeployedRounds);

  for (const round of storedOnlyRounds) {
    rows.push({
      key: `stored-${round.id}`,
      rowType: "stored-only",
      roundId: round.id,
      label: formatStoredRoundLabel(round),
      root: round.merkleRoot,
      deadline: Number(round.deadline || 0),
      claimedAmount: BigInt(round.claimedAmountRaw || "0"),
      totalAmountRaw: BigInt(round.totalAmountRaw),
      sourceText: "DB only",
      canFundTotal: true,
      canDeploy: false,
      canViewClaims: true,
    });
  }

  return rows;
}

function formatClaimState(record) {
  if (record.entry?.claimedAt || record.entry?.claimedTxHash) {
    return "Claimed";
  }

  if (record.round?.status === "draft") {
    return "Draft";
  }

  if (record.round?.claimsLastReconciledAt) {
    return "Unclaimed";
  }

  return "Not synced";
}

function renderSelectedRoundClaims() {
  if (!runtime.selectedRoundId) {
    els.selectedRoundLabel.textContent = "None selected";
    els.selectedRoundLabel.title = "";
    els.selectedRoundMeta.textContent = "Choose a stored round to inspect its claim entries.";
    els.selectedRoundClaimCount.textContent = "-";
    els.selectedRoundTotal.textContent = "-";
    els.roundClaimsBody.innerHTML = '<tr><td colspan="5" class="empty-row">Select a stored round to view its claims.</td></tr>';
    return;
  }

  const selectedRound = runtime.storedRounds.find((round) => round.id === runtime.selectedRoundId) || null;
  if (!selectedRound) {
    runtime.selectedRoundId = null;
    runtime.selectedRoundClaims = [];
    renderSelectedRoundClaims();
    return;
  }

  const claimCount = runtime.selectedRoundClaims.length;
  els.selectedRoundLabel.textContent = formatSelectedRoundLabel(selectedRound);
  els.selectedRoundLabel.title = selectedRound.merkleRoot || formatStoredRoundLabel(selectedRound);
  els.selectedRoundMeta.textContent = selectedRound.status === "draft"
    ? "Claim indexes match the contract leaf indexes. Claim sync only applies after deployment."
    : (selectedRound.claimsLastReconciledAt
      ? `Claim status comes from manual backend reconciliation. Last reconciled ${formatManagementDateTime(selectedRound.claimsLastReconciledAt)}.`
      : "Claim status comes from manual backend reconciliation. Claims have not been reconciled yet for this round.");
  els.selectedRoundClaimCount.textContent = claimCount === 1 ? "1 claim" : `${claimCount} claims`;
  els.selectedRoundTotal.textContent = formatTokenAmount(
    BigInt(selectedRound.totalAmountRaw),
    runtime.tokenDecimals,
    runtime.tokenSymbol,
  );

  if (!claimCount) {
    els.roundClaimsBody.innerHTML = '<tr><td colspan="5" class="empty-row">No claims were found for this round.</td></tr>';
    return;
  }

  els.roundClaimsBody.innerHTML = runtime.selectedRoundClaims
    .map((record) => `
      <tr>
        <td>${record.entry?.index ?? "-"}</td>
        <td>${escapeHtml(record.entry?.usernameDisplay || "-")}</td>
        <td><code title="${record.entry?.account || ""}">${record.entry?.account ? formatAddressShort(record.entry.account) : "-"}</code></td>
        <td>${record.entry?.amountRaw ? formatTokenAmount(BigInt(record.entry.amountRaw), runtime.tokenDecimals, runtime.tokenSymbol) : "-"}</td>
        <td>${formatClaimState(record)}</td>
      </tr>
    `)
    .join("");
}

function renderClaimLookupResults() {
  if (!runtime.claimLookupRows.length) {
    els.claimLookupBody.innerHTML = '<tr><td colspan="6" class="empty-row">Run a wallet lookup to view stored claims.</td></tr>';
    return;
  }

  els.claimLookupBody.innerHTML = runtime.claimLookupRows
    .map((record) => {
      const roundLabel = formatStoredRoundLabel(record.round);

      return `
        <tr>
          <td>${escapeHtml(roundLabel)}</td>
          <td>${record.entry?.index ?? "-"}</td>
          <td>${escapeHtml(record.entry?.usernameDisplay || "-")}</td>
          <td><code title="${record.entry?.account || ""}">${record.entry?.account ? formatAddressShort(record.entry.account) : "-"}</code></td>
          <td>${record.entry?.amountRaw ? formatTokenAmount(BigInt(record.entry.amountRaw), runtime.tokenDecimals, runtime.tokenSymbol) : "-"}</td>
          <td>${formatClaimState(record)}</td>
        </tr>
      `;
    })
    .join("");
}

function renderManagementSummary() {
  els.managementAccountCount.textContent = String(runtime.managementSummary.accountCount || 0);
  els.managementFollowerCount.textContent = String(runtime.managementSummary.followerCount || 0);
  els.managementRecoveryCandidateCount.textContent = String(runtime.managementSummary.recoveryCandidateCount || 0);
  els.managementSubmissionCount.textContent = String(runtime.managementSummary.recoverySubmissionCount || 0);
  els.managementLatestSnapshot.textContent = runtime.managementSummary.latestSnapshotCapturedAt
    ? formatManagementDateTime(runtime.managementSummary.latestSnapshotCapturedAt)
    : "-";
}

function formatClaimSyncStatus() {
  if (!runtime.claimSyncSummary?.claimsLastReconciledAt) {
    return "Claims have not been reconciled yet.";
  }

  return `Last reconciled ${formatManagementDateTime(runtime.claimSyncSummary.claimsLastReconciledAt)}.`;
}

function renderClaimSyncSummary() {
  els.adminClaimedTotal.textContent = formatTokenAmount(
    BigInt(runtime.claimSyncSummary?.totalClaimedAmountRaw || "0"),
    runtime.tokenDecimals,
    runtime.tokenSymbol,
  );
  els.claimSyncStatus.textContent = formatClaimSyncStatus();
}

function renderAccountsPagination() {
  els.accountsPaginationLabel.textContent = formatPaginationLabel(
    runtime.accountsPagination,
    "account",
    "accounts",
  );
  els.accountsPreviousPageButton.disabled = !runtime.accountsPagination.hasPreviousPage;
  els.accountsNextPageButton.disabled = !runtime.accountsPagination.hasNextPage;
}

function renderAccountsTable() {
  renderAccountsPagination();

  if (!runtime.accountsRows.length) {
    els.accountsTableBody.innerHTML = '<tr><td colspan="9" class="empty-row">No matching accounts were found.</td></tr>';
    return;
  }

  els.accountsTableBody.innerHTML = runtime.accountsRows
    .map((account) => `
      <tr>
        <td><strong>${escapeHtml(account.username || "-")}</strong></td>
        <td>${escapeHtml(account.xUserId || "-")}</td>
        <td>${renderExplorerAddress(account.walletAddress)}</td>
        <td>
          <div class="management-meta-stack">
            <strong>${formatTokenAmount(BigInt(account.totalClaimedAmountRaw || "0"), runtime.tokenDecimals, runtime.tokenSymbol)}</strong>
            <span>${Number(account.claimedRoundCount || 0)} claimed ${Number(account.claimedRoundCount || 0) === 1 ? "round" : "rounds"}</span>
          </div>
        </td>
        <td>${escapeHtml(account.walletSource || "-")}</td>
        <td>${createFlagBadge(account.isFollower)}</td>
        <td>${createFlagBadge(account.needsRecovery, { positiveLabel: "Needs action", negativeLabel: "Clear" })}</td>
        <td>
          <div class="management-meta-stack">
            <strong>${Number(account.snapshotsSeenCount || 0)}</strong>
            <span>${escapeHtml(account.firstSeenFollowingAt ? `First: ${formatManagementDateTime(account.firstSeenFollowingAt)}` : "No snapshot history")}</span>
          </div>
        </td>
        <td>
          <div class="management-meta-stack">
            <strong>${escapeHtml(account.latestSnapshotCapturedAt ? formatManagementDateTime(account.latestSnapshotCapturedAt) : "No snapshot")}</strong>
            <span>${escapeHtml(`Updated: ${formatManagementDateTime(account.updatedAt)}`)}</span>
          </div>
        </td>
      </tr>
    `)
    .join("");
}

function renderRecoveryPagination() {
  els.recoveryPaginationLabel.textContent = formatPaginationLabel(
    runtime.recoveryPagination,
    "submission",
    "submissions",
  );
  els.recoveryPreviousPageButton.disabled = !runtime.recoveryPagination.hasPreviousPage;
  els.recoveryNextPageButton.disabled = !runtime.recoveryPagination.hasNextPage;
}

function renderRecoverySubmissionsTable() {
  renderRecoveryPagination();

  if (!runtime.recoverySubmissionRows.length) {
    els.recoverySubmissionsBody.innerHTML = '<tr><td colspan="7" class="empty-row">No matching recovery submissions were found.</td></tr>';
    return;
  }

  els.recoverySubmissionsBody.innerHTML = runtime.recoverySubmissionRows
    .map((submission) => `
      <tr>
        <td>${escapeHtml(formatManagementDateTime(submission.submittedAt))}</td>
        <td><strong>${escapeHtml(submission.usernameAtSubmission || "-")}</strong></td>
        <td>${escapeHtml(submission.xUserId || "-")}</td>
        <td>${renderExplorerAddress(submission.walletAddress)}</td>
        <td>${createFlagBadge(submission.wasKnownFollower)}</td>
        <td>${createFlagBadge(submission.wasRecoveryCandidate, { positiveLabel: "Needs action", negativeLabel: "Clear" })}</td>
        <td>${escapeHtml(submission.status || "-")}</td>
      </tr>
    `)
    .join("");
}

function applyManagementResponse(payload) {
  runtime.managementSummary = payload?.summary || runtime.managementSummary;
}

async function loadAccountsPage(page = 1) {
  const payload = await callAdminApi((accessToken) => fetchAdminAccounts(runtime.config, accessToken, {
    page,
    pageSize: Number(els.accountsPageSizeSelect?.value || runtime.accountsPagination.pageSize || 50),
    search: runtime.accountsSearch,
  }));

  applyManagementResponse(payload);
  runtime.accountsRows = Array.isArray(payload?.accounts) ? payload.accounts : [];
  runtime.accountsPagination = payload?.pagination || runtime.accountsPagination;
  renderManagementSummary();
  renderAccountsTable();
}

async function loadRecoverySubmissionsPage(page = 1) {
  const payload = await callAdminApi((accessToken) => fetchAdminRecoverySubmissions(runtime.config, accessToken, {
    page,
    pageSize: Number(els.recoveryPageSizeSelect?.value || runtime.recoveryPagination.pageSize || 50),
    search: runtime.recoverySearch,
  }));

  applyManagementResponse(payload);
  runtime.recoverySubmissionRows = Array.isArray(payload?.submissions) ? payload.submissions : [];
  runtime.recoveryPagination = payload?.pagination || runtime.recoveryPagination;
  renderManagementSummary();
  renderRecoverySubmissionsTable();
}

async function refreshAccountManagementData() {
  if (!isOwner()) {
    runtime.managementSummary = {
      accountCount: 0,
      followerCount: 0,
      recoveryCandidateCount: 0,
      latestSnapshotCapturedAt: null,
      recoverySubmissionCount: 0,
    };
    runtime.accountsRows = [];
    runtime.recoverySubmissionRows = [];
    runtime.hasLoadedAccountsTab = false;
    renderManagementSummary();
    renderAccountsTable();
    renderRecoverySubmissionsTable();
    return;
  }

  await Promise.all([
    loadAccountsPage(runtime.accountsPagination.page || 1),
    loadRecoverySubmissionsPage(runtime.recoveryPagination.page || 1),
  ]);
  runtime.hasLoadedAccountsTab = true;
}

async function handleAccountsTemplateDownload() {
  downloadTextFile("accounts-template.csv", `${ADMIN_ACCOUNTS_TEMPLATE_CSV}\n`, "text/csv");
}

async function handleRecoveryExport(format) {
  const payload = await callAdminApi((accessToken) => exportAdminRecoverySubmissions(runtime.config, accessToken, format));
  const fileName = String(payload?.fileName || `recovery-submissions.${format === "csv" ? "csv" : "json"}`).trim();
  const content = String(payload?.content || "");
  const contentType = String(payload?.contentType || (format === "csv" ? "text/csv" : "application/json")).trim();

  downloadTextFile(fileName, content, contentType);
  logger.log(`Recovery submissions exported as ${fileName}.`, "success");
}

function renderEpochList() {
  runtime.roundRows = buildRoundRows();

  if (!runtime.roundRows.length) {
    els.epochListBody.innerHTML = '<tr><td colspan="7" class="empty-row">No rounds found yet.</td></tr>';
    return;
  }

  els.epochListBody.innerHTML = runtime.roundRows
    .map((row) => {
      const status = getRoundRowStatus(row);
      return `
        <tr>
          <td>${escapeHtml(row.label)}</td>
          <td><code title="${row.root}">${formatHexShort(row.root)}</code></td>
          <td>
            <div class="deadline-stack">
              <div><span>Local:</span> ${formatAdminDeadlineLocal(row.deadline)}</div>
              <div><span>UTC:</span> ${formatAdminDeadlineUtc(row.deadline)}</div>
            </div>
          </td>
          <td><span class="status-chip" data-tone="${status.tone}">${status.text}</span></td>
          <td>${formatRoundTotalDisplay(row)}</td>
          <td>${escapeHtml(row.sourceText)}</td>
          <td class="round-action-cell">
            ${row.canDeploy ? `<button type="button" class="secondary table-action-button" data-round-deploy="${row.roundId}">Deploy</button>` : ""}
            ${row.canFundTotal ? `<button type="button" class="ghost table-action-button" data-round-fund="${row.roundId}">Fund Total</button>` : ""}
            ${row.canViewClaims ? `<button type="button" class="ghost table-action-button" data-round-claims="${row.roundId}">View Claims</button>` : ""}
            ${!row.canDeploy && !row.canFundTotal && !row.canViewClaims ? '<span class="hint">No DB record</span>' : ""}
          </td>
        </tr>
      `;
    })
    .join("");

  els.epochListBody.querySelectorAll("[data-round-deploy]").forEach((button) => {
    button.addEventListener("click", async () => {
      try {
        await deployStoredRound(Number(button.getAttribute("data-round-deploy")));
      } catch (error) {
        reportError(error, "Deploy saved round");
      }
    });
  });

  els.epochListBody.querySelectorAll("[data-round-fund]").forEach((button) => {
    button.addEventListener("click", async () => {
      try {
        await fundStoredRoundTotal(Number(button.getAttribute("data-round-fund")));
      } catch (error) {
        reportError(error, "Fund round total");
      }
    });
  });

  els.epochListBody.querySelectorAll("[data-round-claims]").forEach((button) => {
    button.addEventListener("click", async () => {
      try {
        await loadRoundClaims(Number(button.getAttribute("data-round-claims")), { scrollIntoView: true });
      } catch (error) {
        reportError(error, "Load round claims");
      }
    });
  });
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

function applyPendingOwnerSection() {
  if (!els.pendingOwnerShell) return;

  const normalizedPendingOwner = normalizeAddress(runtime.pendingOwner);
  const hasPendingOwner = Boolean(normalizedPendingOwner && normalizedPendingOwner !== ethers.ZeroAddress);
  const canAccept = Boolean(runtime.provider && runtime.account && isReadyChain() && isPendingOwner());

  els.pendingOwnerShell.hidden = !canAccept;
  els.pendingOwnershipCurrentOwner.textContent = runtime.owner || "-";
  els.pendingOwnershipPendingOwner.textContent = hasPendingOwner ? normalizedPendingOwner : "No pending owner";
  els.pendingAcceptOwnershipButton.disabled = !canAccept;
}

async function refreshEpochRows() {
  runtime.epochRows = [];

  if (!runtime.provider || runtime.currentEpoch <= 0) {
    return;
  }

  const { airdrop } = getContracts({ config: runtime.config, provider: runtime.provider });
  if (!airdrop) {
    return;
  }

  const epochIds = Array.from({ length: runtime.currentEpoch }, (_, index) => runtime.currentEpoch - index);
  runtime.epochRows = await Promise.all(
    epochIds.map(async (epoch) => {
      const [root, deadline, claimedAmount] = await airdrop.epochInfo(BigInt(epoch));
      const localRound = runtime.storedRoundsByEpoch.get(epoch) || null;
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
}

function syncAdminTabs() {
  const activeTab = runtime.activeAdminTab || "prepare";

  els.adminTabButtons.forEach((button) => {
    const isActive = button.getAttribute("data-admin-tab") === activeTab;
    button.setAttribute("aria-selected", isActive ? "true" : "false");
    button.classList.toggle("is-active", isActive);
  });

  els.adminTabPanels.forEach((panel) => {
    panel.hidden = panel.getAttribute("data-admin-panel") !== activeTab;
  });
}

function setAdminTab(tabId) {
  runtime.activeAdminTab = tabId;
  syncAdminTabs();
  if (tabId === "accounts" && isOwner()) {
    void refreshAccountManagementData().catch((error) => {
      reportError(error, "Load follower management");
    });
  }
}

function applyOwnerGate() {
  els.ownerAddress.textContent = runtime.owner || "-";
  els.connectedAccount.textContent = runtime.config.airdropAddress || "No contract configured";

  if (!runtime.provider) {
      resetAdminAccess();
      els.accountRole.textContent = "Wallet missing";
      els.adminGateMessage.textContent = "Install a compatible browser wallet to manage the airdrop.";
      els.switchNetworkGateButton.hidden = true;
      els.adminShell.hidden = true;
      els.pendingOwnerShell.hidden = true;
      return;
  }

  if (!runtime.account) {
      resetAdminAccess();
      els.accountRole.textContent = "Disconnected";
      els.adminGateMessage.textContent = "Connect the owner or pending owner wallet to view admin controls.";
      els.switchNetworkGateButton.hidden = true;
      els.adminShell.hidden = true;
      els.pendingOwnerShell.hidden = true;
      return;
  }

  if (!isReadyChain()) {
      resetAdminAccess();
      els.accountRole.textContent = "Wrong network";
      els.adminGateMessage.textContent = "Switch the connected wallet to the configured network to manage the airdrop.";
      els.switchNetworkGateButton.hidden = false;
      els.adminShell.hidden = true;
      els.pendingOwnerShell.hidden = true;
      return;
  }

  if (!runtime.owner) {
      resetAdminAccess();
      els.accountRole.textContent = "Connected wallet";
      els.adminGateMessage.textContent = "Owner address is not available yet. Check the contract config.";
      els.switchNetworkGateButton.hidden = true;
      els.adminShell.hidden = true;
      els.pendingOwnerShell.hidden = true;
      return;
  }

  if (!hasOwnershipAccess()) {
      resetAdminAccess();
      els.accountRole.textContent = "Connected wallet";
      els.adminGateMessage.textContent = "This page only unlocks for the current owner or pending owner address.";
      els.switchNetworkGateButton.hidden = true;
      els.adminShell.hidden = true;
      els.pendingOwnerShell.hidden = true;
      return;
  }

  if (!isOwner()) {
    resetAdminAccess();
  }

  els.accountRole.textContent = isOwner() ? "Owner connected" : "Pending owner connected";
  els.adminGateMessage.textContent = isOwner()
    ? "Owner wallet detected. Admin controls are unlocked."
    : "Pending owner wallet detected. Accept ownership below to unlock the full admin workspace.";
  els.switchNetworkGateButton.hidden = true;
  els.adminShell.hidden = !isOwner();
  els.pendingOwnerShell.hidden = !isPendingOwner();
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
    els.tokenSummary.innerHTML = renderTokenSummary(snapshot.tokenSymbol, runtime.config.tokenAddress);
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

  await refreshStoredRounds().catch(() => {
    runtime.storedRounds = [];
    runtime.storedRoundsByEpoch = new Map();
    runtime.storedRoundsByRoot = new Map();
  });

  await refreshEpochRows().catch(() => {
    runtime.epochRows = [];
  });

  renderEpochList();
  renderSelectedRoundClaims();
  syncAdminTabs();

  if (!runtime.builderRows.length) {
    resetClaimsBuilder();
  } else {
    ensureClaimsBuilderFileName();
    refreshClaimsBuilderStatus();
  }

  renderUploadedRound();
  applyOwnerGate();
  applyOwnershipSection();
  applyPendingOwnerSection();
  updateStartAirdropButtonState();

  if (runtime.activeAdminTab === "accounts" && isOwner()) {
    await refreshAccountManagementData();
  }

  renderClaimSyncSummary();
}

function formatClaimReconcileMessage(summary) {
  const appliedCount = Number(summary?.appliedCount || 0);
  const clearedCount = Number(summary?.clearedCount || 0);
  const mismatchCount = Number(summary?.mismatchCount || 0);
  const missingClaimCount = Number(summary?.missingClaimCount || 0);
  const segments = [
    `${appliedCount} applied`,
  ];

  if (clearedCount) {
    segments.push(`${clearedCount} cleared`);
  }
  if (missingClaimCount) {
    segments.push(`${missingClaimCount} missing`);
  }
  if (mismatchCount) {
    segments.push(`${mismatchCount} mismatches`);
  }

  return `Claims reconciled: ${segments.join(", ")}.`;
}

async function refreshClaimLookupResults() {
  const walletAddress = String(els.claimLookupInput?.value || "").trim();
  if (!walletAddress || !isClaimsApiConfigured(runtime.config)) {
    if (!walletAddress) {
      runtime.claimLookupRows = [];
      renderClaimLookupResults();
    }
    return;
  }

  const payload = await fetchStoredClaimsByWallet(runtime.config, walletAddress);
  runtime.claimLookupRows = Array.isArray(payload?.claims) ? payload.claims : [];
  renderClaimLookupResults();
}

async function reconcileClaimMirror() {
  const selectedRoundId = runtime.selectedRoundId;
  const currentLookupValue = String(els.claimLookupInput?.value || "").trim();
  const response = await callAdminApi((accessToken) => reconcileAdminAirdropClaims(runtime.config, accessToken));

  if (response?.claimSummary) {
    runtime.claimSyncSummary = {
      totalClaimedCount: Number(response.claimSummary.totalClaimedCount || 0),
      totalClaimedAmountRaw: String(response.claimSummary.totalClaimedAmountRaw || "0"),
      claimsLastReconciledAt: response.claimSummary.claimsLastReconciledAt || null,
    };
  }

  await refreshPage();

  if (selectedRoundId) {
    await loadRoundClaims(selectedRoundId);
  }

  if (currentLookupValue) {
    await refreshClaimLookupResults();
  }

  logger.log(formatClaimReconcileMessage(response?.summary), "success");
}

async function acceptOwnershipTransaction() {
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
}

async function fundAirdropAmountRaw(amountRaw, label = "Fund airdrop") {
  const { token, airdropAddress } = getContracts({
    config: runtime.config,
    provider: runtime.provider,
    signer: runtime.signer,
    withSigner: true,
  });

  if (!token || !airdropAddress) {
    throw new Error("Token and airdrop addresses must be configured.");
  }

  await sendTransaction(label, () => token.transfer(airdropAddress, amountRaw), {
    log: logger.log,
    afterSuccess: async () => {
      await refreshPage();
    },
    formatError: (error, label) => formatUiError(error, label, runtime),
  });
}

async function fundStoredRoundTotal(roundId) {
  const storedRound = runtime.storedRounds.find((round) => round.id === roundId) || null;
  if (!storedRound) {
    throw new Error("The selected stored round could not be found.");
  }

  await fundAirdropAmountRaw(BigInt(storedRound.totalAmountRaw));
}

async function loadRoundClaims(roundId, { scrollIntoView = false } = {}) {
  if (!isClaimsApiConfigured(runtime.config)) {
    throw new Error("Backend API URL is not configured.");
  }

  const payload = await fetchStoredRoundClaims(runtime.config, roundId);
  runtime.selectedRoundId = Number(roundId);
  runtime.selectedRoundClaims = Array.isArray(payload?.claims) ? payload.claims : [];
  setAdminTab("rounds");
  renderSelectedRoundClaims();
  if (scrollIntoView) {
    scrollRoundClaimsSectionIntoView();
  }
}

async function saveDraftRoundToBackend() {
  if (!runtime.uploadedRound) {
    throw new Error("Prepare a claims JSON file first.");
  }

  if (!isClaimsApiConfigured(runtime.config)) {
    throw new Error("Backend API URL is not configured.");
  }

  const root = els.startRootInput.value.trim();
  if (!ethers.isHexString(root, 32)) {
    throw new Error("Merkle root must be a bytes32 hex string.");
  }

  const deadlineUnix = Number(els.startDeadlineUnix.value);
  await validateFutureDeadlineAgainstChain(deadlineUnix);

  const saveChallenge = await requestAirdropSaveChallenge(runtime.config, {
    walletAddress: runtime.account,
    merkleRoot: runtime.uploadedRound.root,
    deadline: deadlineUnix,
  });
  const saveSignature = await runtime.signer.signMessage(saveChallenge.message);
  const persisted = await saveAirdropRound(runtime.config, {
    deadline: deadlineUnix,
    walletAddress: runtime.account,
    challengeId: saveChallenge.challengeId,
    signature: saveSignature,
    decimals: runtime.tokenDecimals,
    claims: runtime.uploadedRound.claims.map((claim) => ({
      index: claim.index,
      account: claim.account,
      amountRaw: claim.amountRaw,
    })),
  });

  if (persisted?.round?.id) {
    applyUploadedRound({
      ...runtime.uploadedRound,
      storedRoundId: persisted.round.id,
    });
    await refreshPage();
    await loadRoundClaims(persisted.round.id);
    logger.log("Draft saved to the backend.", "success");
  }
}

async function deployStoredRound(roundId) {
  const selectedRound = runtime.storedRounds.find((round) => round.id === roundId) || null;
  if (!selectedRound) {
    throw new Error("The selected saved round could not be found.");
  }

  if (selectedRound.status !== "draft") {
    throw new Error("Only saved draft rounds can be deployed.");
  }

  if (!isClaimsApiConfigured(runtime.config)) {
    throw new Error("Backend API URL is not configured.");
  }

  await validateFutureDeadlineAgainstChain(Number(selectedRound.deadline));

  const { airdrop } = getContracts({
    config: runtime.config,
    provider: runtime.provider,
    signer: runtime.signer,
    withSigner: true,
  });

  if (!airdrop) {
    throw new Error("Airdrop address is not configured.");
  }

  const tx = await airdrop.startNewAirdrop(selectedRound.merkleRoot, Number(selectedRound.deadline));
  logger.log(`Deploy saved round: submitted ${tx.hash}`);
  const receipt = await tx.wait();
  logger.log(`Deploy saved round: confirmed in block ${receipt.blockNumber}`, "success");

  const persisted = await deploySavedAirdropRound(runtime.config, roundId, {
    txHash: tx.hash,
  });

  await refreshPage();
  if (persisted?.round?.id) {
    runtime.selectedRoundId = persisted.round.id;
    await loadRoundClaims(persisted.round.id);
  }

  if (persisted?.round?.epoch != null) {
    logger.log(`Draft deployed as epoch ${persisted.round.epoch}.`, "success");
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
  els.adminTabButtons.forEach((button) => {
    button.addEventListener("click", () => {
      const nextTab = button.getAttribute("data-admin-tab");
      if (!nextTab) return;
      setAdminTab(nextTab);
    });
  });

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

  els.reconcileClaimsButton?.addEventListener("click", async () => {
    try {
      await reconcileClaimMirror();
    } catch (error) {
      reportError(error, "Reconcile claims");
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

  els.loadWalletAccountsButton?.addEventListener("click", async () => {
    const originalLabel = els.loadWalletAccountsButton.textContent;
    els.loadWalletAccountsButton.disabled = true;
    els.loadWalletAccountsButton.textContent = "Loading...";

    try {
      const result = await loadAllLinkedWalletClaimsIntoBuilder();
      logger.log(formatLinkedWalletLoadMessage(result), "success");
    } catch (error) {
      reportError(error, "Use all linked wallets");
    } finally {
      els.loadWalletAccountsButton.disabled = false;
      els.loadWalletAccountsButton.textContent = originalLabel;
    }
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
      const amountRaw = parseHumanAmount(els.fundAirdropAmount.value, runtime.tokenDecimals);
      await fundAirdropAmountRaw(amountRaw);
    } catch (error) {
      reportError(error, "Fund airdrop");
    }
  });

  els.startAirdropForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    try {
      await saveDraftRoundToBackend();
    } catch (error) {
      reportError(error, "Save airdrop draft");
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
      await acceptOwnershipTransaction();
    } catch (error) {
      reportError(error, "Accept ownership");
    }
  });

  els.pendingAcceptOwnershipButton?.addEventListener("click", async () => {
    try {
      await acceptOwnershipTransaction();
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
      const localRound = runtime.storedRoundsByEpoch.get(Number(epoch)) || null;
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
      if (!isClaimsApiConfigured(runtime.config)) {
        throw new Error("Backend API URL is not configured.");
      }

      const rawQuery = String(els.claimLookupInput.value || "").trim();
      if (!rawQuery) {
        throw new Error("Enter a wallet address.");
      }

      const payload = await fetchStoredClaimsByWallet(runtime.config, rawQuery);
      const rows = Array.isArray(payload?.claims) ? payload.claims : [];

      runtime.claimLookupRows = rows;
      renderClaimLookupResults();
    } catch (error) {
      runtime.claimLookupRows = [];
      renderClaimLookupResults();
      reportError(error, "Lookup claims");
    }
  });

  els.accountsImportForm?.addEventListener("submit", async (event) => {
    event.preventDefault();

    try {
      const file = els.accountsImportFileInput?.files?.[0];
      if (!file) {
        throw new Error("Choose a combined accounts CSV file.");
      }

      const content = await file.text();
      await callAdminApi((accessToken) => importAdminAccounts(runtime.config, accessToken, {
        fileName: file.name,
        content,
      }));

      els.accountsImportFileInput.value = "";
      runtime.accountsPagination.page = 1;
      await loadAccountsPage(1);
      logger.log(`Accounts imported from ${file.name}.`, "success");
    } catch (error) {
      reportError(error, "Import accounts");
    }
  });

  els.downloadAccountsTemplateButton?.addEventListener("click", async () => {
    try {
      await handleAccountsTemplateDownload();
      logger.log("Accounts CSV template downloaded.", "success");
    } catch (error) {
      reportError(error, "Download accounts template");
    }
  });

  els.singleAccountForm?.addEventListener("submit", async (event) => {
    event.preventDefault();

    try {
      const payload = await callAdminApi((accessToken) => saveAdminAccount(runtime.config, accessToken, {
        username: els.singleAccountUsernameInput?.value,
        xUserId: els.singleAccountUserIdInput?.value,
        walletAddress: els.singleAccountWalletInput?.value,
        isFollower: Boolean(els.singleAccountIsFollowerInput?.checked),
        needsRecovery: Boolean(els.singleAccountNeedsRecoveryInput?.checked),
      }));

      applyManagementResponse(payload);
      els.singleAccountUsernameInput.value = "";
      els.singleAccountUserIdInput.value = "";
      els.singleAccountWalletInput.value = "";
      els.singleAccountIsFollowerInput.checked = false;
      els.singleAccountNeedsRecoveryInput.checked = false;

      await loadAccountsPage(runtime.accountsPagination.page || 1);
      logger.log("Account saved.", "success");
    } catch (error) {
      reportError(error, "Save account");
    }
  });

  els.accountsQueryForm?.addEventListener("submit", async (event) => {
    event.preventDefault();

    try {
      runtime.accountsSearch = String(els.accountsSearchInput?.value || "").trim();
      runtime.accountsPagination.page = 1;
      await loadAccountsPage(1);
      logger.log("Account filter applied.", "success");
    } catch (error) {
      reportError(error, "Filter accounts");
    }
  });

  els.accountsClearSearchButton?.addEventListener("click", async () => {
    try {
      els.accountsSearchInput.value = "";
      runtime.accountsSearch = "";
      runtime.accountsPagination.page = 1;
      await loadAccountsPage(1);
      logger.log("Account filter cleared.", "success");
    } catch (error) {
      reportError(error, "Clear account filter");
    }
  });

  els.accountsPageSizeSelect?.addEventListener("change", async () => {
    try {
      runtime.accountsPagination.page = 1;
      await loadAccountsPage(1);
    } catch (error) {
      reportError(error, "Change accounts page size");
    }
  });

  els.accountsPreviousPageButton?.addEventListener("click", async () => {
    try {
      if (!runtime.accountsPagination.hasPreviousPage) return;
      await loadAccountsPage((runtime.accountsPagination.page || 1) - 1);
    } catch (error) {
      reportError(error, "Load previous accounts page");
    }
  });

  els.accountsNextPageButton?.addEventListener("click", async () => {
    try {
      if (!runtime.accountsPagination.hasNextPage) return;
      await loadAccountsPage((runtime.accountsPagination.page || 1) + 1);
    } catch (error) {
      reportError(error, "Load next accounts page");
    }
  });

  els.recoveryImportForm?.addEventListener("submit", async (event) => {
    event.preventDefault();

    try {
      const file = els.recoveryImportFileInput?.files?.[0];
      if (!file) {
        throw new Error("Choose a recovery submissions JSON file.");
      }

      const content = await file.text();
      await callAdminApi((accessToken) => importAdminRecoverySubmissions(runtime.config, accessToken, {
        fileName: file.name,
        content,
      }));

      els.recoveryImportFileInput.value = "";
      runtime.accountsPagination.page = 1;
      runtime.recoveryPagination.page = 1;
      await Promise.all([
        loadAccountsPage(1),
        loadRecoverySubmissionsPage(1),
      ]);
      logger.log(`Recovery submissions imported from ${file.name}.`, "success");
    } catch (error) {
      reportError(error, "Import recovery submissions");
    }
  });

  els.exportRecoveryJsonButton?.addEventListener("click", async () => {
    try {
      await handleRecoveryExport("json");
    } catch (error) {
      reportError(error, "Export recovery submissions JSON");
    }
  });

  els.exportRecoveryCsvButton?.addEventListener("click", async () => {
    try {
      await handleRecoveryExport("csv");
    } catch (error) {
      reportError(error, "Export recovery submissions CSV");
    }
  });

  els.recoveryQueryForm?.addEventListener("submit", async (event) => {
    event.preventDefault();

    try {
      runtime.recoverySearch = String(els.recoverySearchInput?.value || "").trim();
      runtime.recoveryPagination.page = 1;
      await loadRecoverySubmissionsPage(1);
      logger.log("Recovery submission filter applied.", "success");
    } catch (error) {
      reportError(error, "Filter recovery submissions");
    }
  });

  els.recoveryClearSearchButton?.addEventListener("click", async () => {
    try {
      els.recoverySearchInput.value = "";
      runtime.recoverySearch = "";
      runtime.recoveryPagination.page = 1;
      await loadRecoverySubmissionsPage(1);
      logger.log("Recovery submission filter cleared.", "success");
    } catch (error) {
      reportError(error, "Clear recovery submission filter");
    }
  });

  els.recoveryPageSizeSelect?.addEventListener("change", async () => {
    try {
      runtime.recoveryPagination.page = 1;
      await loadRecoverySubmissionsPage(1);
    } catch (error) {
      reportError(error, "Change recovery submissions page size");
    }
  });

  els.recoveryPreviousPageButton?.addEventListener("click", async () => {
    try {
      if (!runtime.recoveryPagination.hasPreviousPage) return;
      await loadRecoverySubmissionsPage((runtime.recoveryPagination.page || 1) - 1);
    } catch (error) {
      reportError(error, "Load previous recovery submissions page");
    }
  });

  els.recoveryNextPageButton?.addEventListener("click", async () => {
    try {
      if (!runtime.recoveryPagination.hasNextPage) return;
      await loadRecoverySubmissionsPage((runtime.recoveryPagination.page || 1) + 1);
    } catch (error) {
      reportError(error, "Load next recovery submissions page");
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
  renderManagementSummary();
  renderClaimSyncSummary();
  renderAccountsTable();
  renderRecoverySubmissionsTable();
  renderSelectedRoundClaims();
  renderClaimLookupResults();
  syncAdminTabs();

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
