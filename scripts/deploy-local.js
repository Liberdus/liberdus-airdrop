const fs = require("node:fs");
const path = require("node:path");
const hre = require("hardhat");

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
  fs.mkdirSync(frontendDir, { recursive: true });
  fs.writeFileSync(path.join(frontendDir, "config.local.json"), `${JSON.stringify(config, null, 2)}\n`);

  console.log("Local deployment complete.");
  console.log(`Deployer:    ${config.deployer}`);
  console.log(`Token:       ${config.tokenAddress}`);
  console.log(`Dust token:  ${config.dustTokenAddress}`);
  console.log(`Airdrop:     ${config.airdropAddress}`);
  console.log(`Frontend config: ${path.join(frontendDir, "config.local.json")}`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
