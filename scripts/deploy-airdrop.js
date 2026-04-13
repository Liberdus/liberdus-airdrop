const fs = require("node:fs");
const path = require("node:path");
const hre = require("hardhat");
const { getDeploymentPath, getNetworkConfig, requireEnv } = require("./lib/deployment-config");

async function maybeVerify(address, constructorArguments) {
  if (!process.env.BSCSCAN_API_KEY) {
    console.log("Skipping explorer verification because BSCSCAN_API_KEY is not set.");
    return false;
  }

  try {
    await hre.run("verify:verify", {
      address,
      constructorArguments,
    });
    console.log("Explorer verification succeeded.");
    return true;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);

    if (/already verified/i.test(message)) {
      console.log("Explorer verification skipped because the contract is already verified.");
      return true;
    }

    throw error;
  }
}

async function main() {
  const repoRoot = path.join(__dirname, "..");
  const networkName = hre.network.name;
  const networkConfig = getNetworkConfig(networkName);

  requireEnv("DEPLOYER_PRIVATE_KEY");
  const tokenAddress = requireEnv(networkConfig.tokenEnvKey);
  const confirmationCount = Number.parseInt(process.env.DEPLOY_CONFIRMATIONS || "5", 10);

  const { ethers } = hre;
  const [deployer] = await ethers.getSigners();
  const airdropFactory = await ethers.getContractFactory("EpochMerkleAirdrop");

  console.log(`Deploying EpochMerkleAirdrop to ${networkConfig.displayName}...`);
  console.log(`Deployer: ${deployer.address}`);
  console.log(`Token:    ${tokenAddress}`);

  const airdrop = await airdropFactory.deploy(tokenAddress);
  await airdrop.waitForDeployment();

  const deploymentTx = airdrop.deploymentTransaction();
  const receipt = deploymentTx ? await deploymentTx.wait(confirmationCount) : null;
  const airdropAddress = await airdrop.getAddress();
  const chainId = Number((await ethers.provider.getNetwork()).chainId);

  console.log(`Airdrop deployed at ${airdropAddress}`);
  if (receipt) {
    console.log(`Deployment tx: ${receipt.hash}`);
    console.log(`Block number:  ${receipt.blockNumber}`);
  }

  const deployment = {
    contractName: "EpochMerkleAirdrop",
    network: networkName,
    chainId,
    deployer: deployer.address,
    tokenAddress,
    airdropAddress,
    constructorArguments: [tokenAddress],
    deploymentTxHash: receipt ? receipt.hash : deploymentTx?.hash ?? null,
    deployedAt: new Date().toISOString(),
    explorerUrl: `${networkConfig.explorerBaseUrl}/address/${airdropAddress}`,
  };

  const deploymentPath = getDeploymentPath(repoRoot, networkName);
  fs.mkdirSync(path.dirname(deploymentPath), { recursive: true });
  fs.writeFileSync(deploymentPath, `${JSON.stringify(deployment, null, 2)}\n`);

  console.log(`Deployment record written to ${deploymentPath}`);

  const verified = await maybeVerify(airdropAddress, [tokenAddress]);
  if (verified) {
    console.log(`Explorer: ${deployment.explorerUrl}#code`);
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
