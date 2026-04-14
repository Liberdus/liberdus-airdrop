import { ethers } from "./ethers.js";
import { AIRDROP_ABI, ERC20_ABI } from "./constants.js";
import { normalizeAddress } from "./format.js";

export function getContracts({ config, provider, signer, withSigner = false }) {
  const airdropAddress = normalizeAddress(config.airdropAddress || "");
  const tokenAddress = normalizeAddress(config.tokenAddress || "");
  const dustTokenAddress = normalizeAddress(config.dustTokenAddress || "");
  const runner = withSigner ? signer : provider;

  if (!runner) throw new Error("Contract provider is not ready.");

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
  if (!provider) throw new Error("Contract provider is not ready.");

  const { airdrop, token, dustToken, airdropAddress } = getContracts({ config, provider });
  const snapshot = {
    owner: null,
    pendingOwner: null,
    currentEpoch: null,
    tokenSymbol: null,
    tokenDecimals: null,
    walletTokenBalance: null,
    airdropTokenBalance: null,
    dustSymbol: null,
    dustDecimals: null,
    walletDustBalance: null,
  };

  if (airdrop) {
    const [owner, pendingOwner, currentEpoch] = await Promise.all([
      airdrop.owner(),
      airdrop.pendingOwner(),
      airdrop.currentEpoch(),
    ]);

    snapshot.owner = owner;
    snapshot.pendingOwner = pendingOwner;
    snapshot.currentEpoch = currentEpoch;
  }

  if (token) {
    try {
      const [symbol, decimals] = await Promise.all([token.symbol(), token.decimals()]);
      snapshot.tokenSymbol = symbol;
      snapshot.tokenDecimals = Number(decimals);

      if (account) {
        snapshot.walletTokenBalance = await token.balanceOf(account);
      }

      if (airdropAddress) {
        snapshot.airdropTokenBalance = await token.balanceOf(airdropAddress);
      }
    } catch {
      // Keep owner/currentEpoch available even if token metadata or balances fail.
    }
  }

  if (dustToken && account) {
    try {
      const [symbol, decimals, balance] = await Promise.all([
        dustToken.symbol(),
        dustToken.decimals(),
        dustToken.balanceOf(account),
      ]);

      snapshot.dustSymbol = symbol;
      snapshot.dustDecimals = Number(decimals);
      snapshot.walletDustBalance = balance;
    } catch {
      // Dust token data is non-critical for the dashboard.
    }
  }

  return snapshot;
}
