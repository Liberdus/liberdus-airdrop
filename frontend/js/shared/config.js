import { STORAGE_KEY, UI_ROOT, toChainIdHex } from "./constants.js";
import { normalizeAddress } from "./format.js";

function isLocalhost() {
  return window.location.hostname === "localhost" || window.location.hostname === "127.0.0.1";
}

export async function loadUiConfig() {
  let loaded = null;
  let source = "config.json";

  if (isLocalhost()) {
    try {
      const localResponse = await fetch(new URL("./config.local.json", UI_ROOT), { cache: "no-store" });
      if (localResponse.ok) {
        loaded = await localResponse.json();
        source = "config.local.json";
      }
    } catch {
      // Fall through to config.json.
    }
  }

  if (!loaded) {
    const configResponse = await fetch(new URL("./config.json", UI_ROOT), { cache: "no-store" });
    if (!configResponse.ok) {
      throw new Error("Unable to load frontend config.json.");
    }
    loaded = await configResponse.json();
  }

  const savedOverrides = window.localStorage.getItem(STORAGE_KEY);
  const overrides = savedOverrides ? JSON.parse(savedOverrides) : {};

  const config = {
    claimsManifestPath: "./claims/index.json",
    ...loaded,
    ...overrides,
    tokenAddress: normalizeAddress(overrides.tokenAddress || loaded.tokenAddress || ""),
    dustTokenAddress: normalizeAddress(overrides.dustTokenAddress || loaded.dustTokenAddress || ""),
    airdropAddress: normalizeAddress(overrides.airdropAddress || loaded.airdropAddress || ""),
    claimsManifestPath: String(overrides.claimsManifestPath || loaded.claimsManifestPath || "./claims/index.json"),
    explorerBaseUrl: String(overrides.explorerBaseUrl || loaded.explorerBaseUrl || "").trim(),
  };

  config.chainId = Number(config.chainId);
  if (!Number.isInteger(config.chainId) || config.chainId < 0) {
    throw new Error("UI config must define a valid numeric chainId.");
  }
  config.chainIdHex = toChainIdHex(config.chainId);

  if (!config.networkName || !config.rpcUrl || !config.nativeCurrency) {
    throw new Error("UI config must define networkName, rpcUrl, and nativeCurrency.");
  }

  return {
    config,
    source: savedOverrides ? `${source} + local overrides` : source,
  };
}

export function saveAddressOverrides(overrides) {
  window.localStorage.setItem(
    STORAGE_KEY,
    JSON.stringify({
      airdropAddress: normalizeAddress(overrides.airdropAddress || ""),
      tokenAddress: normalizeAddress(overrides.tokenAddress || ""),
      dustTokenAddress: normalizeAddress(overrides.dustTokenAddress || ""),
      claimsManifestPath: String(overrides.claimsManifestPath || "./claims/index.json"),
    }),
  );
}

export function clearAddressOverrides() {
  window.localStorage.removeItem(STORAGE_KEY);
}
