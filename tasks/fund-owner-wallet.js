const { task, types } = require("hardhat/config");
const { fundOwnerWallet } = require("../scripts/lib/fund-owner-wallet");

task("fund-owner-wallet", "Mint the airdrop token to the current owner wallet")
  .addOptionalPositionalParam("amount", "Mint amount in token units", "1000000", types.string)
  .addOptionalParam("owner", "Override owner wallet address", undefined, types.string)
  .addOptionalParam("token", "Override token address", undefined, types.string)
  .addOptionalParam("localConfig", "Override path to config.local.json", undefined, types.string)
  .setAction(async (taskArgs, hre) => {
    await fundOwnerWallet(hre, {
      amount: taskArgs.amount,
      owner: taskArgs.owner,
      token: taskArgs.token,
      configPath: taskArgs.localConfig,
    });
  });
