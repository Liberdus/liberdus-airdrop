import { ethers } from "./ethers.js";
import { AIRDROP_ABI, ERC20_ABI } from "./constants.js";
import { normalizeAddress } from "./format.js";

export function getContracts({ config, provider, signer, withSigner = false }) {
  const airdropAddress = normalizeAddress(config.airdropAddress || "");
  const tokenAddress = normalizeAddress(config.tokenAddress || "");
  const dustTokenAddress = normalizeAddress(config.dustTokenAddress || "");
  const runner = withSigner ? signer : provider;

  if (!runner) throw new Error("Wallet provider is not ready.");

  return {
    airdropAddress,
    tokenAddress,
    dustTokenAddress,
    airdrop: airdropAddress ? new ethers.Contract(airdropAddress, AIRDROP_ABI, runner) : null,
    token: tokenAddress ? new ethers.Contract(tokenAddress, ERC20_ABI, runner) : null,
    dustToken: dustTokenAddress ? new ethers.Contract(dustTokenAddress, ERC20_ABI, runner) : null,
  };
}

export async function fetchDashboardSnapshot({ config, provider, account }) {
  if (!provider) throw new Error("Wallet provider is not ready.");

  const { airdrop, token, dustToken, airdropAddress } = getContracts({ config, provider });
  const snapshot = {
    owner: null,
    currentEpoch: null,
    latestDeadline: null,
    latestDeadlineEpoch: null,
    tokenSymbol: null,
    tokenDecimals: null,
    walletTokenBalance: null,
    airdropTokenBalance: null,
    dustSymbol: null,
    dustDecimals: null,
    walletDustBalance: null,
  };

  if (airdrop) {
    const [owner, currentEpoch, latestDeadline, latestDeadlineEpoch] = await Promise.all([
      airdrop.owner(),
      airdrop.currentEpoch(),
      airdrop.latestDeadline(),
      airdrop.latestDeadlineEpoch(),
    ]);

    snapshot.owner = owner;
    snapshot.currentEpoch = currentEpoch;
    snapshot.latestDeadline = latestDeadline;
    snapshot.latestDeadlineEpoch = latestDeadlineEpoch;
  }

  if (token) {
    const [symbol, decimals] = await Promise.all([token.symbol(), token.decimals()]);
    snapshot.tokenSymbol = symbol;
    snapshot.tokenDecimals = Number(decimals);

    if (account) {
      snapshot.walletTokenBalance = await token.balanceOf(account);
    }

    if (airdropAddress) {
      snapshot.airdropTokenBalance = await token.balanceOf(airdropAddress);
    }
  }

  if (dustToken && account) {
    const [symbol, decimals, balance] = await Promise.all([
      dustToken.symbol(),
      dustToken.decimals(),
      dustToken.balanceOf(account),
    ]);

    snapshot.dustSymbol = symbol;
    snapshot.dustDecimals = Number(decimals);
    snapshot.walletDustBalance = balance;
  }

  return snapshot;
}
