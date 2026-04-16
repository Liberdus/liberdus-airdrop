import { UI_ROOT } from "./constants.js";
import { ethers } from "./ethers.js";
import { normalizeAddress } from "./format.js";
import { buildClaimRound } from "./merkle.js";

function getBackendBaseUrl(configOrUrl) {
  if (typeof configOrUrl === "string") {
    return String(configOrUrl || "").trim().replace(/\/+$/u, "");
  }

  return String(
    configOrUrl?.apiBaseUrl
    || configOrUrl?.xAuth?.backendUrl
    || "",
  ).trim().replace(/\/+$/u, "");
}

async function fetchBackendJson(url, options = {}) {
  const response = await fetch(url, {
    cache: "no-store",
    credentials: options.credentials || "same-origin",
    ...options,
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
    throw new Error(parsed?.error || `Request failed (${response.status}).`);
  }

  return parsed;
}

export function isClaimsApiConfigured(config) {
  return Boolean(getBackendBaseUrl(config));
}

export async function fetchWalletClaimRounds(config, walletAddress) {
  const backendBaseUrl = getBackendBaseUrl(config);
  if (!backendBaseUrl) {
    throw new Error("Claim backend URL is not configured.");
  }

  const normalizedWalletAddress = normalizeAddress(walletAddress);
  if (!normalizedWalletAddress) {
    throw new Error("Wallet address is invalid.");
  }

  return fetchBackendJson(
    `${backendBaseUrl}/api/claims/wallet/${encodeURIComponent(normalizedWalletAddress)}`,
  );
}

export async function fetchStoredAirdropRounds(config) {
  const backendBaseUrl = getBackendBaseUrl(config);
  if (!backendBaseUrl) {
    throw new Error("Claim backend URL is not configured.");
  }

  return fetchBackendJson(`${backendBaseUrl}/api/airdrop/rounds`);
}

export async function fetchStoredClaimByEpochAndIndex(config, epoch, claimIndex) {
  const backendBaseUrl = getBackendBaseUrl(config);
  if (!backendBaseUrl) {
    throw new Error("Claim backend URL is not configured.");
  }

  return fetchBackendJson(
    `${backendBaseUrl}/api/airdrop/epochs/${encodeURIComponent(epoch)}/claims/${encodeURIComponent(claimIndex)}`,
  );
}

export async function persistAirdropRound(config, payload) {
  const backendBaseUrl = getBackendBaseUrl(config);
  if (!backendBaseUrl) {
    throw new Error("Claim backend URL is not configured.");
  }

  return fetchBackendJson(`${backendBaseUrl}/api/admin/airdrop-rounds/finalize`, {
    method: "POST",
    credentials: "include",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
  });
}

export async function requestAirdropFinalizeChallenge(config, payload) {
  const backendBaseUrl = getBackendBaseUrl(config);
  if (!backendBaseUrl) {
    throw new Error("Claim backend URL is not configured.");
  }

  return fetchBackendJson(`${backendBaseUrl}/api/admin/airdrop-rounds/challenge`, {
    method: "POST",
    credentials: "include",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
  });
}

export function normalizeClaimCatalog(rawCatalog) {
  const sourceRows = Array.isArray(rawCatalog)
    ? rawCatalog
    : rawCatalog?.epochs || rawCatalog?.rounds || rawCatalog?.claims || [];

  if (!Array.isArray(sourceRows)) {
    throw new Error("Claims catalog must be an array or an object with an epochs array.");
  }

  return sourceRows.map((row, idx) => {
    const epoch = Number(row?.epoch);
    if (!Number.isInteger(epoch) || epoch <= 0) {
      throw new Error(`Claims catalog row ${idx} has an invalid epoch.`);
    }

    const file = String(row?.file || row?.path || row?.url || "").trim();
    if (!file) {
      throw new Error(`Claims catalog row ${idx} is missing a file path.`);
    }

    return { epoch, file };
  });
}

export async function loadClaimCatalog(manifestPath = "./claims/index.json") {
  const manifestUrl = new URL(manifestPath, UI_ROOT);
  const response = await fetch(manifestUrl, { cache: "no-store" });

  if (!response.ok) {
    if (response.status === 404) {
      return {
        manifestUrl: manifestUrl.toString(),
        baseUrl: new URL(".", manifestUrl).toString(),
        sources: [],
      };
    }

    throw new Error(`Failed to load claims catalog (${response.status}).`);
  }

  return {
    manifestUrl: manifestUrl.toString(),
    baseUrl: new URL(".", manifestUrl).toString(),
    sources: normalizeClaimCatalog(await response.json()),
  };
}

export async function fetchClaimSource(source, catalogBaseUrl, tokenDecimals) {
  const sourceUrl = new URL(source.file, catalogBaseUrl);
  const response = await fetch(sourceUrl, { cache: "no-store" });
  if (!response.ok) {
    const error = new Error(`Failed to load claim file ${source.file} (${response.status}).`);
    error.status = response.status;
    error.sourceFile = source.file;
    if (response.status === 404) {
      error.name = "ClaimSourceNotFoundError";
    }
    throw error;
  }

  const rawText = await response.text();
  return {
    ...buildClaimRound(rawText, tokenDecimals),
    source,
    artifactUrl: sourceUrl.toString(),
  };
}

export function isMissingClaimSourceError(error) {
  return error?.name === "ClaimSourceNotFoundError" || error?.status === 404;
}

export function findClaimEntry(round, account) {
  if (!account) return null;
  const normalizedAccount = normalizeAddress(account);
  if (!normalizedAccount) return null;

  const matches = round.claims.filter(
    (entry) => normalizeAddress(entry.account)?.toLowerCase() === normalizedAccount.toLowerCase(),
  );

  if (matches.length === 0) return null;
  if (matches.length > 1) {
    throw new Error(`Found ${matches.length} claim rows for ${normalizedAccount} in ${round.source.file}. Each account should appear only once per round.`);
  }

  const [entry] = matches;
  return {
    ...entry,
    account: ethers.getAddress(entry.account),
    index: String(entry.index),
    amountRaw: String(entry.amountRaw),
    proof: Array.isArray(entry.proof) ? [...entry.proof] : [],
  };
}
