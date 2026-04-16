const { ethers } = require("ethers");

const AIRDROP_ABI = [
  "event AirdropStarted(uint256 indexed epoch, bytes32 indexed merkleRoot, uint256 deadline)",
  "function epochInfo(uint256) view returns (bytes32,uint256,uint256)",
  "function owner() view returns (address)",
];

function createAirdropProvider(appConfig) {
  return new ethers.JsonRpcProvider(appConfig.rpcUrl, appConfig.chainId);
}

function createAirdropContract(appConfig, runner) {
  return new ethers.Contract(appConfig.airdropAddress, AIRDROP_ABI, runner);
}

async function fetchEpochMetadata(appConfig, epoch) {
  const provider = createAirdropProvider(appConfig);
  const contract = createAirdropContract(appConfig, provider);
  const [merkleRoot, deadline, claimedAmount] = await contract.epochInfo(BigInt(epoch));

  return {
    epoch: Number(epoch),
    merkleRoot: String(merkleRoot || "").trim().toLowerCase(),
    deadline: Number(deadline || 0),
    claimedAmount: String(claimedAmount || "0"),
  };
}

async function verifyAirdropStartTransaction(appConfig, txHash, expectedMerkleRoot) {
  const provider = createAirdropProvider(appConfig);
  const contract = createAirdropContract(appConfig, provider);
  const normalizedTxHash = String(txHash || "").trim();

  if (!ethers.isHexString(normalizedTxHash, 32)) {
    throw new Error("Transaction hash must be a 32-byte hex string.");
  }

  const receipt = await provider.getTransactionReceipt(normalizedTxHash);
  if (!receipt) {
    throw new Error("Transaction receipt was not found yet.");
  }

  if (Number(receipt.status || 0) !== 1) {
    throw new Error("Transaction did not succeed on chain.");
  }

  const normalizedContractAddress = appConfig.airdropAddress.toLowerCase();
  const matchingLogs = receipt.logs
    .filter((log) => String(log.address || "").toLowerCase() === normalizedContractAddress)
    .map((log) => {
      try {
        return contract.interface.parseLog(log);
      } catch {
        return null;
      }
    })
    .filter(Boolean)
    .filter((parsed) => parsed.name === "AirdropStarted");

  if (matchingLogs.length !== 1) {
    throw new Error("Expected exactly one AirdropStarted event in the transaction receipt.");
  }

  const [event] = matchingLogs;
  const epoch = Number(event.args.epoch);
  const merkleRoot = String(event.args.merkleRoot || "").trim().toLowerCase();
  const deadline = Number(event.args.deadline || 0);

  if (expectedMerkleRoot && merkleRoot !== String(expectedMerkleRoot).trim().toLowerCase()) {
    throw new Error("Merkle root from the transaction did not match the submitted claims.");
  }

  const onchain = await fetchEpochMetadata(appConfig, epoch);
  if (onchain.merkleRoot !== merkleRoot || onchain.deadline !== deadline) {
    throw new Error("On-chain epoch data did not match the transaction event.");
  }

  return {
    epoch,
    merkleRoot,
    deadline,
    txHash: normalizedTxHash.toLowerCase(),
    blockNumber: Number(receipt.blockNumber || 0),
    blockHash: String(receipt.blockHash || "").trim().toLowerCase(),
  };
}

async function fetchAirdropOwner(appConfig) {
  const provider = createAirdropProvider(appConfig);
  const contract = createAirdropContract(appConfig, provider);
  const owner = await contract.owner();
  return ethers.getAddress(String(owner || "").trim());
}

module.exports = {
  createAirdropProvider,
  fetchAirdropOwner,
  fetchEpochMetadata,
  verifyAirdropStartTransaction,
};
