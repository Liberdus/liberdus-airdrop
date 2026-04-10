import { HARDHAT_LOCAL, STORAGE_KEY, UI_ROOT } from "./constants.js";
import { normalizeAddress } from "./format.js";

export async function loadUiConfig() {
  let loaded = null;
  let source = "template";

  try {
    const localResponse = await fetch(new URL("./config.local.json", UI_ROOT), { cache: "no-store" });
    if (localResponse.ok) {
      loaded = await localResponse.json();
      source = "config.local.json";
    }
  } catch {
    // Fall through to template.
  }

  if (!loaded) {
    const templateResponse = await fetch(new URL("./config.local.template.json", UI_ROOT), { cache: "no-store" });
    loaded = await templateResponse.json();
  }

  const savedOverrides = window.localStorage.getItem(STORAGE_KEY);
  const overrides = savedOverrides ? JSON.parse(savedOverrides) : {};

  const config = {
    ...HARDHAT_LOCAL,
    claimsManifestPath: "./claims/index.json",
    ...loaded,
    ...overrides,
    tokenAddress: normalizeAddress(overrides.tokenAddress || loaded.tokenAddress || ""),
    dustTokenAddress: normalizeAddress(overrides.dustTokenAddress || loaded.dustTokenAddress || ""),
    airdropAddress: normalizeAddress(overrides.airdropAddress || loaded.airdropAddress || ""),
    claimsManifestPath: String(overrides.claimsManifestPath || loaded.claimsManifestPath || "./claims/index.json"),
  };

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
