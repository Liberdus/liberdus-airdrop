export function toChainIdHex(chainId) {
  const numericChainId = Number(chainId);
  if (!Number.isInteger(numericChainId) || numericChainId < 0) {
    throw new Error("chainId must be a non-negative integer.");
  }

  return `0x${numericChainId.toString(16)}`;
}

export const STORAGE_KEY = "liberdus-airdrop-ui-config";
export const WALLET_SESSION_KEY = "liberdus-airdrop-wallet-session";
export const X_AUTH_PENDING_KEY = "liberdus-airdrop-x-auth-pending";
export const X_AUTH_SESSION_KEY = "liberdus-airdrop-x-auth-session";
export const UI_ROOT = new URL("../../", import.meta.url);
export const CHAIN_NAME_BY_ID = {
  1: "Ethereum",
  10: "OP Mainnet",
  56: "BNB Smart Chain",
  97: "BNB Smart Chain Testnet",
  137: "Polygon",
  42161: "Arbitrum One",
  43114: "Avalanche C-Chain",
  8453: "Base",
  11155111: "Sepolia",
  1337: "Localhost 8545",
  31337: "Hardhat Local",
};

export const AIRDROP_ABI = [
  "function owner() view returns (address)",
  "function pendingOwner() view returns (address)",
  "function currentEpoch() view returns (uint256)",
  "function merkleRoots(uint256) view returns (bytes32)",
  "function deadlines(uint256) view returns (uint256)",
  "function epochClaimedAmounts(uint256) view returns (uint256)",
  "function epochInfo(uint256) view returns (bytes32,uint256,uint256)",
  "function isClaimed(uint256,uint256) view returns (bool)",
  "function startNewAirdrop(bytes32,uint256)",
  "function setEpochDeadline(uint256,uint256)",
  "function transferOwnership(address)",
  "function acceptOwnership()",
  "function claim(uint256,uint256,address,uint256,bytes32[])",
  "function withdraw(address,uint256)",
  "function recoverERC20(address,address,uint256)",
];

export const AIRDROP_ERROR_ABI = [
  "error ZeroAddress()",
  "error InvalidMerkleRoot()",
  "error InvalidDeadline()",
  "error EpochNotStarted(uint256 epoch)",
  "error AlreadyClaimed(uint256 epoch, uint256 index)",
  "error InvalidProof()",
  "error ClaimWindowClosed(uint256 epoch, uint256 deadline)",
  "error InvalidRecoverToken()",
];

export const ERC20_ABI = [
  "function symbol() view returns (string)",
  "function decimals() view returns (uint8)",
  "function balanceOf(address) view returns (uint256)",
  "function transfer(address,uint256) returns (bool)",
  "function mint(address,uint256)",
];

export const ACCESS_CONTROL_ERROR_ABI = [
  "error OwnableUnauthorizedAccount(address account)",
  "error OwnableInvalidOwner(address owner)",
];

export const ERC20_ERROR_ABI = [
  "error ERC20InsufficientBalance(address sender, uint256 balance, uint256 needed)",
  "error ERC20InvalidSender(address sender)",
  "error ERC20InvalidReceiver(address receiver)",
  "error ERC20InsufficientAllowance(address spender, uint256 allowance, uint256 needed)",
  "error ERC20InvalidApprover(address approver)",
  "error ERC20InvalidSpender(address spender)",
  "error SafeERC20FailedOperation(address token)",
];
