const fs = require("node:fs");
const path = require("node:path");

function resolveConfigPath(configArg) {
  if (!configArg) {
    return path.join(process.cwd(), "frontend", "config.local.json");
  }

  return path.isAbsolute(configArg)
    ? configArg
    : path.resolve(process.cwd(), configArg);
}

function loadConfig(configPath) {
  if (!fs.existsSync(configPath)) {
    return null;
  }

  return JSON.parse(fs.readFileSync(configPath, "utf8"));
}

function requireAddress(hre, value, label) {
  if (!value || !hre.ethers.isAddress(value)) {
    throw new Error(`${label} must be a valid EVM address.`);
  }

  return hre.ethers.getAddress(value);
}

async function resolveOwnerAddress(hre, signer, { owner, config }) {
  if (owner) {
    return {
      address: requireAddress(hre, owner, "Owner address"),
      source: "override",
    };
  }

  if (config?.airdropAddress) {
    const airdropAddress = requireAddress(hre, config.airdropAddress, "Config airdrop address");
    const airdrop = await hre.ethers.getContractAt("EpochMerkleAirdrop", airdropAddress, signer);
    return {
      address: requireAddress(hre, await airdrop.owner(), "Airdrop owner"),
      source: "airdrop.owner()",
    };
  }

  if (config?.deployer) {
    return {
      address: requireAddress(hre, config.deployer, "Config deployer"),
      source: "config.deployer",
    };
  }

  return {
    address: signer.address,
    source: "signer",
  };
}

function formatAmount(hre, amount, decimals) {
  return hre.ethers.formatUnits(amount, decimals).replace(/\.?0+$/, "");
}

async function fundOwnerWallet(hre, options = {}) {
  const { ethers } = hre;
  const [signer] = await ethers.getSigners();

  const configPath = resolveConfigPath(options.configPath);
  const config = loadConfig(configPath);
  const tokenAddress = requireAddress(hre, options.token || config?.tokenAddress, "Token address");

  const token = await ethers.getContractAt("MockERC20", tokenAddress, signer);
  const tokenSymbol = await token.symbol();
  const tokenDecimals = Number(await token.decimals());
  const amountInput = options.amount || "1000000";
  const amount = ethers.parseUnits(amountInput, tokenDecimals);

  if (amount <= 0n) {
    throw new Error("Mint amount must be greater than zero.");
  }

  const owner = await resolveOwnerAddress(hre, signer, { owner: options.owner, config });
  const beforeBalance = await token.balanceOf(owner.address);

  const mintTx = await token.mint(owner.address, amount);
  await mintTx.wait();

  const afterBalance = await token.balanceOf(owner.address);

  console.log("Owner wallet funded.");
  console.log(`Signer:         ${signer.address}`);
  console.log(`Owner:          ${owner.address}`);
  console.log(`Owner source:   ${owner.source}`);
  console.log(`Token:          ${tokenAddress}`);
  console.log(`Minted:         ${formatAmount(hre, amount, tokenDecimals)} ${tokenSymbol}`);
  console.log(`Balance before: ${formatAmount(hre, beforeBalance, tokenDecimals)} ${tokenSymbol}`);
  console.log(`Balance after:  ${formatAmount(hre, afterBalance, tokenDecimals)} ${tokenSymbol}`);
  if (config) {
    console.log(`Config:         ${configPath}`);
  }

  return {
    signer: signer.address,
    owner: owner.address,
    tokenAddress,
    amount,
    tokenSymbol,
    tokenDecimals,
    txHash: mintTx.hash,
  };
}

module.exports = {
  fundOwnerWallet,
};
