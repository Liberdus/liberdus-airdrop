const hre = require("hardhat");
const { fundOwnerWallet } = require("./lib/fund-owner-wallet");

async function main() {
  await fundOwnerWallet(hre, {
    amount: process.env.MINT_AMOUNT,
    owner: process.env.OWNER_ADDRESS,
    token: process.env.TOKEN_ADDRESS,
    configPath: process.env.LOCAL_CONFIG_PATH,
  });
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
