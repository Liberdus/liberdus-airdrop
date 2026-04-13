const path = require("node:path");

const NETWORKS = {
  bscTestnet: {
    displayName: "BSC Testnet",
    tokenEnvKey: "BSC_TESTNET_TOKEN_ADDRESS",
    explorerBaseUrl: "https://testnet.bscscan.com",
  },
  bsc: {
    displayName: "BSC Mainnet",
    tokenEnvKey: "BSC_MAINNET_TOKEN_ADDRESS",
    explorerBaseUrl: "https://bscscan.com",
  },
};

function getNetworkConfig(networkName) {
  const config = NETWORKS[networkName];

  if (!config) {
    throw new Error(
      `Unsupported network "${networkName}". Use one of: ${Object.keys(NETWORKS).join(", ")}.`
    );
  }

  return config;
}

function requireEnv(key) {
  const value = process.env[key];

  if (value == null || value.trim() === "") {
    throw new Error(`Missing required environment variable: ${key}`);
  }

  return value.trim();
}

function getDeploymentPath(repoRoot, networkName) {
  return path.join(repoRoot, "deployments", networkName, "EpochMerkleAirdrop.json");
}

module.exports = {
  getDeploymentPath,
  getNetworkConfig,
  requireEnv,
};
