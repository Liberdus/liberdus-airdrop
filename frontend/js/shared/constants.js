export const HARDHAT_LOCAL = {
  chainId: 31337,
  chainIdHex: "0x7a69",
  networkName: "Hardhat Local",
  rpcUrl: "http://127.0.0.1:8545",
  nativeCurrency: {
    name: "ETH",
    symbol: "ETH",
    decimals: 18,
  },
};

export const STORAGE_KEY = "liberdus-airdrop-ui-config";
export const WALLET_SESSION_KEY = "liberdus-airdrop-wallet-session";
export const UI_ROOT = new URL("../../", import.meta.url);

export const AIRDROP_ABI = [
  "function owner() view returns (address)",
  "function currentEpoch() view returns (uint256)",
  "function latestDeadline() view returns (uint256)",
  "function latestDeadlineEpoch() view returns (uint256)",
  "function merkleRoots(uint256) view returns (bytes32)",
  "function deadlines(uint256) view returns (uint256)",
  "function epochClaimedAmounts(uint256) view returns (uint256)",
  "function epochInfo(uint256) view returns (bytes32,uint256,uint256)",
  "function isClaimed(uint256,uint256) view returns (bool)",
  "function startNewAirdrop(bytes32,uint256)",
  "function claim(uint256,uint256,address,uint256,bytes32[])",
  "function withdraw(address,uint256)",
  "function recoverERC20(address,address,uint256)",
];

export const AIRDROP_ERROR_ABI = [
  "error ZeroAddress()",
  "error InvalidMerkleRoot()",
  "error InvalidDeadline()",
  "error DeadlineTooFar()",
  "error EpochNotStarted(uint256 epoch)",
  "error AlreadyClaimed(uint256 epoch, uint256 index)",
  "error InvalidProof()",
  "error ClaimWindowClosed(uint256 epoch, uint256 deadline)",
  "error ActiveEpoch(uint256 epoch, uint256 deadline)",
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
