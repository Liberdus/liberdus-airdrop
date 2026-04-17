const fs = require("node:fs");
const path = require("node:path");

const { ethers } = require("ethers");

function getRepoRoot() {
  return path.resolve(__dirname, "..", "..");
}

function resolveRepoPath(filePath) {
  return path.resolve(getRepoRoot(), filePath);
}

function resolveFrontendConfigPath() {
  const explicitPath = String(process.env.LIBERDUS_FRONTEND_CONFIG || "").trim();
  if (explicitPath) {
    return resolveRepoPath(explicitPath);
  }

  const candidatePaths = [
    path.join("frontend", "config.local.json"),
    path.join("frontend", "config.json"),
    path.join("frontend", "config.prod.json"),
    path.join("frontend", "config.test.json"),
    path.join("frontend", "config.local.template.json"),
  ];

  for (const candidatePath of candidatePaths) {
    const resolvedPath = resolveRepoPath(candidatePath);
    if (fs.existsSync(resolvedPath)) {
      return resolvedPath;
    }
  }

  return "";
}

function readJsonFile(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function normalizeAddress(value) {
  const rawValue = String(value || "").trim();
  if (!rawValue) return "";

  try {
    return ethers.getAddress(rawValue);
  } catch {
    return "";
  }
}

function normalizeInteger(value, fallbackValue = null) {
  const parsed = Number.parseInt(String(value || "").trim(), 10);
  if (!Number.isInteger(parsed)) return fallbackValue;
  return parsed;
}

function normalizeClaimsManifestPath(value) {
  const rawValue = String(value || "").trim();
  if (!rawValue) return "";

  if (path.isAbsolute(rawValue)) {
    return rawValue;
  }

  const withoutPrefix = rawValue.replace(/^\.\//u, "");
  if (withoutPrefix.startsWith("frontend/") || withoutPrefix.startsWith("frontend\\")) {
    return withoutPrefix;
  }

  return path.join("frontend", withoutPrefix);
}

function normalizeDeploymentKey(value) {
  return String(value || "").trim();
}

function getDefaultDeploymentKey(chainId, airdropAddress) {
  if (!Number.isInteger(chainId) || !airdropAddress) {
    return "";
  }

  return `${chainId}:${String(airdropAddress).toLowerCase()}`;
}

function loadAppConfig() {
  const frontendConfigPath = resolveFrontendConfigPath();
  const frontendConfig = frontendConfigPath ? readJsonFile(frontendConfigPath) : {};
  const xAuthConfig = frontendConfig?.xAuth && typeof frontendConfig.xAuth === "object"
    ? frontendConfig.xAuth
    : {};
  const chainId = normalizeInteger(process.env.LIBERDUS_CHAIN_ID, normalizeInteger(frontendConfig.chainId, null));
  const airdropAddress = normalizeAddress(process.env.LIBERDUS_AIRDROP_ADDRESS || frontendConfig.airdropAddress || "");

  return {
    sourcePath: frontendConfigPath,
    chainId,
    rpcUrl: String(process.env.LIBERDUS_RPC_URL || frontendConfig.rpcUrl || "").trim(),
    airdropAddress,
    tokenAddress: normalizeAddress(process.env.LIBERDUS_TOKEN_ADDRESS || frontendConfig.tokenAddress || ""),
    apiBaseUrl: String(
      process.env.LIBERDUS_API_BASE_URL
      || frontendConfig.apiBaseUrl
      || xAuthConfig.backendUrl
      || ""
    ).trim(),
    claimsManifestPath: normalizeClaimsManifestPath(process.env.LIBERDUS_CLAIMS_MANIFEST || frontendConfig.claimsManifestPath || ""),
    tokenDecimals: normalizeInteger(process.env.LIBERDUS_TOKEN_DECIMALS, 18),
    deploymentKey: normalizeDeploymentKey(
      process.env.LIBERDUS_DEPLOYMENT_KEY
      || frontendConfig.deploymentKey
      || getDefaultDeploymentKey(chainId, airdropAddress),
    ),
  };
}

function requireChainConfig(appConfig = loadAppConfig()) {
  if (!appConfig.rpcUrl || !appConfig.airdropAddress || !Number.isInteger(appConfig.chainId)) {
    throw new Error(
      "Backend chain config is incomplete. Set LIBERDUS_RPC_URL, LIBERDUS_CHAIN_ID, and LIBERDUS_AIRDROP_ADDRESS or provide them in the frontend config file.",
    );
  }

  return appConfig;
}

module.exports = {
  loadAppConfig,
  requireChainConfig,
  resolveFrontendConfigPath,
  resolveRepoPath,
};
