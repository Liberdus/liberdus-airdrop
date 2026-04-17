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
  const loadedXAuth = loaded?.xAuth && typeof loaded.xAuth === "object" ? loaded.xAuth : {};
  const overrideXAuth = overrides?.xAuth && typeof overrides.xAuth === "object" ? overrides.xAuth : {};
  const hasOverrideExplorerBaseUrl = Object.prototype.hasOwnProperty.call(overrides, "explorerBaseUrl");

  const config = {
    apiBaseUrl: "",
    deploymentKey: "",
    ...loaded,
    ...overrides,
    tokenAddress: normalizeAddress(overrides.tokenAddress || loaded.tokenAddress || ""),
    dustTokenAddress: normalizeAddress(overrides.dustTokenAddress || loaded.dustTokenAddress || ""),
    airdropAddress: normalizeAddress(overrides.airdropAddress || loaded.airdropAddress || ""),
    apiBaseUrl: String(
      overrides.apiBaseUrl
      || loaded.apiBaseUrl
      || overrideXAuth.backendUrl
      || loadedXAuth.backendUrl
      || loaded.xBackendUrl
      || ""
    ).trim(),
    deploymentKey: String(loaded.deploymentKey || "").trim(),
    explorerBaseUrl: String(
      hasOverrideExplorerBaseUrl
        ? overrides.explorerBaseUrl
        : (loaded.explorerBaseUrl || "")
    ).trim(),
    xAuth: {
      enabled: overrideXAuth.enabled ?? loadedXAuth.enabled ?? true,
      redirectUri: String(overrideXAuth.redirectUri || loadedXAuth.redirectUri || loaded.xRedirectUri || "").trim(),
      backendUrl: String(
        overrideXAuth.backendUrl
        || loadedXAuth.backendUrl
        || overrides.apiBaseUrl
        || loaded.apiBaseUrl
        || loaded.xBackendUrl
        || ""
      ).trim(),
    },
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
      apiBaseUrl: String(overrides.apiBaseUrl || "").trim(),
    }),
  );
}

export function clearAddressOverrides() {
  window.localStorage.removeItem(STORAGE_KEY);
}
