const fs = require("node:fs");
const path = require("node:path");
const hre = require("hardhat");

function isPlainObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function mergeConfig(baseValue, nextValue) {
  if (!isPlainObject(baseValue) || !isPlainObject(nextValue)) {
    return nextValue;
  }

  const merged = { ...baseValue };
  for (const [key, value] of Object.entries(nextValue)) {
    merged[key] = key in merged ? mergeConfig(merged[key], value) : value;
  }
  return merged;
}

function loadJsonIfExists(filePath) {
  if (!fs.existsSync(filePath)) return null;
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

async function main() {
  const { ethers } = hre;
  const [deployer] = await ethers.getSigners();

  const mockTokenFactory = await ethers.getContractFactory("MockERC20");
  const token = await mockTokenFactory.deploy("Liberdus", "LIB");
  await token.waitForDeployment();

  const dustToken = await mockTokenFactory.deploy("Dust", "DST");
  await dustToken.waitForDeployment();

  const airdropFactory = await ethers.getContractFactory("EpochMerkleAirdrop");
  const airdrop = await airdropFactory.deploy(await token.getAddress());
  await airdrop.waitForDeployment();

  const network = await ethers.provider.getNetwork();
  const config = {
    chainId: Number(network.chainId),
    networkName: "Hardhat Local",
    rpcUrl: "http://127.0.0.1:8545",
    explorerBaseUrl: "",
    nativeCurrency: {
      name: "ETH",
      symbol: "ETH",
      decimals: 18,
    },
    deployer: deployer.address,
    tokenAddress: await token.getAddress(),
    dustTokenAddress: await dustToken.getAddress(),
    airdropAddress: await airdrop.getAddress(),
    generatedAt: new Date().toISOString(),
  };

  const frontendDir = path.join(__dirname, "..", "frontend");
  const configLocalPath = path.join(frontendDir, "config.local.json");
  const configLocalTemplatePath = path.join(frontendDir, "config.local.template.json");
  const existingConfig = loadJsonIfExists(configLocalPath)
    || loadJsonIfExists(configLocalTemplatePath)
    || {};
  fs.mkdirSync(frontendDir, { recursive: true });
  const mergedConfig = mergeConfig(existingConfig, config);
  fs.writeFileSync(configLocalPath, `${JSON.stringify(mergedConfig, null, 2)}\n`);

  console.log("Local deployment complete.");
  console.log(`Deployer:    ${config.deployer}`);
  console.log(`Token:       ${config.tokenAddress}`);
  console.log(`Dust token:  ${config.dustTokenAddress}`);
  console.log(`Airdrop:     ${config.airdropAddress}`);
  console.log(`Frontend config: ${configLocalPath}`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
