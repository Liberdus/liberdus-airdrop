import { ethers } from "./ethers.js";
import { AIRDROP_ERROR_ABI, ACCESS_CONTROL_ERROR_ABI, ERC20_ERROR_ABI } from "./constants.js";
import { formatAddressShort, formatDeadline, formatDisplayAmount, sameAddress } from "./format.js";

const KNOWN_ERROR_INTERFACES = [
  new ethers.Interface(AIRDROP_ERROR_ABI),
  new ethers.Interface(ACCESS_CONTROL_ERROR_ABI),
  new ethers.Interface(ERC20_ERROR_ABI),
];
const GENERIC_RPC_MESSAGES = new Set([
  "(unknown custom error)",
  "unknown custom error",
  "execution reverted",
  "could not decode result data",
  "missing revert data",
]);
const CUSTOM_ERROR_NAME_PATTERN = /custom error '([A-Za-z0-9_]+)\([^)]*\)'/i;
const RETURN_DATA_PATTERN = /return data:\s*(0x[0-9a-fA-F]+)/i;
const ERC20_INSUFFICIENT_BALANCE_PATTERN = /ERC20InsufficientBalance\("?(0x[a-fA-F0-9]{40})"?,\s*(\d+),\s*(\d+)\)/;
const ERC20_INSUFFICIENT_ALLOWANCE_PATTERN = /ERC20InsufficientAllowance\(/;

function findFirstNumber(candidates) {
  for (const candidate of candidates) {
    if (typeof candidate === "number") return candidate;
  }

  return null;
}

function extractErrorCode(error) {
  return findFirstNumber([
    error?.code,
    error?.data?.code,
    error?.data?.data?.code,
    error?.error?.code,
    error?.error?.error?.code,
    error?.info?.error?.code,
    error?.cause?.code,
  ]);
}

function isNetworkChangedError(error) {
  return getMessageCandidates(error).some(
    (candidate) => typeof candidate === "string" && /network changed:\s*\d+\s*=>\s*\d+/i.test(candidate),
  );
}

function isHexData(value) {
  return typeof value === "string" && /^0x[0-9a-fA-F]*$/.test(value) && value.length >= 10;
}

function extractHexDataFromMessage(message) {
  if (typeof message !== "string") return null;
  const match = message.match(RETURN_DATA_PATTERN);
  return match ? match[1] : null;
}

// Wallet providers, ethers, and browser runtimes wrap RPC failures differently.
// Walk a bounded portion of the object graph so we can recover nested `message`
// and `data` fields without coupling the UI to one exact wrapper shape.
function collectNestedValues(root, key, limit = 24) {
  const results = [];
  const queue = [root];
  const seen = new Set();

  while (queue.length && results.length < limit) {
    const current = queue.shift();
    if (!current || typeof current !== "object") continue;
    if (seen.has(current)) continue;
    seen.add(current);

    if (key in current) {
      results.push(current[key]);
    }

    for (const value of Object.values(current)) {
      if (value && typeof value === "object") queue.push(value);
    }
  }

  return results;
}

// Prefer the common top-level fields first, then fall back to a bounded nested
// scan for wrapper-specific placements.
function getMessageCandidates(error) {
  return [
    error?.shortMessage,
    error?.reason,
    error?.data?.data?.message,
    error?.data?.message,
    error?.error?.message,
    error?.error?.data?.message,
    error?.info?.error?.message,
    error?.cause?.message,
    ...collectNestedValues(error, "message"),
  ];
}

function getDataCandidates(error) {
  return [
    error?.data?.data,
    error?.data?.data?.data,
    error?.data,
    error?.error?.data,
    error?.error?.error?.data,
    error?.info?.error?.data,
    error?.cause?.data,
    ...collectNestedValues(error, "data"),
  ];
}

function extractRevertData(error) {
  const dataCandidates = getDataCandidates(error);
  const messageCandidates = getMessageCandidates(error).map(extractHexDataFromMessage);

  for (const candidate of [...dataCandidates, ...messageCandidates]) {
    if (isHexData(candidate)) return candidate;
  }

  return null;
}

function cleanRpcMessage(message) {
  if (!message) return "";

  return String(message)
    .replace(/^Error:\s*/i, "")
    .replace(/^execution reverted(?::\s*)?/i, "")
    .replace(/^VM Exception while processing transaction:\s*/i, "")
    .replace(/^reverted with custom error\s*/i, "")
    .replace(/^Internal JSON-RPC error\.?\s*/i, "")
    .trim();
}

function isGenericErrorMessage(message) {
  if (!message) return true;

  const normalized = String(message).trim().toLowerCase();
  return GENERIC_RPC_MESSAGES.has(normalized)
    || normalized.startsWith("(unknown custom error)")
    || normalized.startsWith("unknown custom error")
    || normalized.startsWith("execution reverted");
}

function extractErrorMessage(error) {
  for (const candidate of getMessageCandidates(error)) {
    const cleaned = cleanRpcMessage(candidate);
    if (cleaned && !isGenericErrorMessage(cleaned)) return cleaned;
  }

  return "";
}

function parseNamedCustomError(message) {
  const customErrorMatch = String(message || "").match(CUSTOM_ERROR_NAME_PATTERN);
  if (!customErrorMatch) return null;

  return { name: customErrorMatch[1], args: [] };
}

// Try each ABI set until one recognizes the selector. `parseError()` returns
// null when an ABI does not match, so only a truthy parsed error should end
// the search.
function parseKnownRevertData(revertData) {
  if (!isHexData(revertData)) return null;

  for (const iface of KNOWN_ERROR_INTERFACES) {
    try {
      const parsed = iface.parseError(revertData);
      if (parsed) return parsed;
    } catch {
      // Try the next interface.
    }
  }

  return null;
}

function decodeKnownError(error) {
  return parseKnownRevertData(extractRevertData(error)) ?? parseNamedCustomError(extractErrorMessage(error));
}

function decodeKnownErrorFromMessage(message) {
  return parseKnownRevertData(extractHexDataFromMessage(message)) ?? parseNamedCustomError(message);
}

function formatInsufficientBalanceMessage(sender, balance, needed, context, runtime) {
  const tokenSymbol = runtime.tokenSymbol || "tokens";
  const tokenDecimals = runtime.tokenDecimals ?? 18;
  const availableFormatted = formatDisplayAmount(balance, tokenDecimals, tokenSymbol);
  const neededFormatted = formatDisplayAmount(needed, tokenDecimals, tokenSymbol);

  if (context === "Claim" && sameAddress(sender, runtime.config?.airdropAddress)) {
    return `The airdrop contract does not have enough ${tokenSymbol} for this claim. It has ${availableFormatted}, but this claim needs ${neededFormatted}. Fund the airdrop contract and try again.`;
  }

  if (sameAddress(sender, runtime.account)) {
    return `Your connected wallet does not have enough ${tokenSymbol}. Available ${availableFormatted}, needed ${neededFormatted}.`;
  }

  if (sameAddress(sender, runtime.config?.airdropAddress)) {
    return `The airdrop contract balance is too low for this transfer. It has ${availableFormatted}, but the transfer needs ${neededFormatted}.`;
  }

  return `The token balance at ${formatAddressShort(sender)} is too low for this transfer. Available ${availableFormatted}, needed ${neededFormatted}.`;
}

function formatDecodedError(decoded, context, runtime) {
  if (!decoded) return "";

  switch (decoded.name) {
    case "ZeroAddress":
    case "ERC20InvalidReceiver":
    case "ERC20InvalidSender":
    case "OwnableInvalidOwner":
      return "A non-zero address is required.";
    case "InvalidMerkleRoot":
      return "Merkle root must be a non-zero bytes32 value.";
    case "InvalidDeadline":
      return "Deadline must be in the future.";
    case "EpochNotStarted":
      return `Epoch ${decoded.args[0].toString()} has not been started yet.`;
    case "AlreadyClaimed":
      return `Claim index ${decoded.args[1].toString()} for epoch ${decoded.args[0].toString()} has already been used.`;
    case "InvalidProof":
      return "Claim data is invalid. Refresh your round data and try again.";
    case "ClaimWindowClosed":
      return Number(decoded.args[1]) === 0
        ? "This round is closed."
        : `This round is closed. Claims ended at ${formatDeadline(decoded.args[1])}.`;
    case "InvalidRecoverToken":
      return "The primary airdrop token cannot be recovered with recoverERC20.";
    case "OwnableUnauthorizedAccount":
      return runtime.owner
        ? `This wallet is not the contract owner. Connect ${formatAddressShort(runtime.owner)} to perform this action.`
        : "This wallet is not the contract owner.";
    case "ERC20InsufficientBalance":
      return formatInsufficientBalanceMessage(decoded.args[0], decoded.args[1], decoded.args[2], context, runtime);
    case "ERC20InsufficientAllowance":
      return "The token allowance is too low for this transfer.";
    case "ERC20InvalidApprover":
    case "ERC20InvalidSpender":
      return "The ERC20 approval parameters are invalid.";
    case "SafeERC20FailedOperation":
      return `ERC20 transfer failed for token ${formatAddressShort(decoded.args[0])}.`;
    default:
      return "";
  }
}

// Some providers flatten revert details into plain strings before the UI sees
// them. Recover the important known cases here so users still get actionable
// messages instead of provider-specific fallback text.
function formatMessageFallbackError(message, context, runtime) {
  if (!message) return "";

  const decoded = decodeKnownErrorFromMessage(message);
  const decodedMessage = formatDecodedError(decoded, context, runtime);
  if (decodedMessage) return decodedMessage;

  const insufficientBalanceMatch = message.match(ERC20_INSUFFICIENT_BALANCE_PATTERN);
  if (insufficientBalanceMatch) {
    return formatInsufficientBalanceMessage(
      insufficientBalanceMatch[1],
      BigInt(insufficientBalanceMatch[2]),
      BigInt(insufficientBalanceMatch[3]),
      context,
      runtime,
    );
  }

  const hasInsufficientAllowanceMessage = ERC20_INSUFFICIENT_ALLOWANCE_PATTERN.test(message);
  if (hasInsufficientAllowanceMessage) {
    return "The token allowance is too low for this transfer.";
  }

  if (message.includes("InvalidProof(")) {
    return "Claim data is invalid. Refresh your round data and try again.";
  }

  return "";
}

// Prefer machine-readable wallet/RPC signals first, then decoded revert data,
// and only fall back to raw strings when no structured path is available.
export function formatUiError(error, context = "Action", runtime = {}) {
  const code = extractErrorCode(error);
  if (code === 4001) {
    return `${context}: request rejected in the wallet.`;
  }

  if (code === -32002) {
    return `${context}: the wallet already has a pending request.`;
  }

  const decoded = decodeKnownError(error);
  const decodedMessage = formatDecodedError(decoded, context, runtime);
  if (decodedMessage) return `${context}: ${decodedMessage}`;

  const message = extractErrorMessage(error);
  const fallbackMessage = formatMessageFallbackError(message, context, runtime);
  if (fallbackMessage) return `${context}: ${fallbackMessage}`;
  if (message) return `${context}: ${message}`;

  return `${context}: ${String(error)}`;
}

export function createErrorReporter(log, getRuntime) {
  return function reportError(error, context) {
    const runtime = typeof getRuntime === "function" ? getRuntime() : {};
    const message = error instanceof Error && typeof error.message === "string" && error.message.startsWith(`${context}:`)
      ? error.message
      : formatUiError(error, context, runtime);
    console.error(`[${context}]`, error);
    log(message, "error");
  };
}

export function bindGlobalErrorHandlers(reportError) {
  window.addEventListener("error", (event) => {
    if (!event.error && !event.message) return;
    console.error("[Browser error event]", event.error ?? event.message, event);
    reportError(event.error ?? new Error(event.message), "Browser error");
  });

  window.addEventListener("unhandledrejection", (event) => {
    if (isNetworkChangedError(event.reason)) {
      event.preventDefault();
      return;
    }
    console.error("[Unhandled rejection]", event.reason, event);
    reportError(event.reason ?? new Error("Unhandled promise rejection."), "Unhandled rejection");
  });
}
