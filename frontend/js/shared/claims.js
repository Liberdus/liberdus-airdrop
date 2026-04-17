import { normalizeAddress } from "./format.js";

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
