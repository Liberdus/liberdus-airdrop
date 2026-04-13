const fs = require("node:fs");
const path = require("node:path");
const hre = require("hardhat");
const { getDeploymentPath, getNetworkConfig, requireEnv } = require("./lib/deployment-config");

async function main() {
  const repoRoot = path.join(__dirname, "..");
  const networkName = hre.network.name;

  getNetworkConfig(networkName);
  requireEnv("BSCSCAN_API_KEY");

  const deploymentPath = getDeploymentPath(repoRoot, networkName);
  if (!fs.existsSync(deploymentPath)) {
    throw new Error(`Deployment record not found: ${deploymentPath}`);
  }

  const deployment = JSON.parse(fs.readFileSync(deploymentPath, "utf8"));

  await hre.run("verify:verify", {
    address: deployment.airdropAddress,
    constructorArguments: deployment.constructorArguments,
  });

  console.log(`Verified ${deployment.airdropAddress} on ${networkName}.`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
