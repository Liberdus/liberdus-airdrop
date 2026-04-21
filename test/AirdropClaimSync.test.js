const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const { expect } = require("chai");
const { ethers } = require("ethers");

const { AIRDROP_ABI } = require("../backend/lib/airdrop-chain");
const { createClaimSyncService } = require("../backend/lib/claim-sync");
const { buildClaimRound } = require("../backend/lib/claim-round");
const { openDatabase } = require("../backend/lib/db");
const { createAirdropRoundStore } = require("../backend/lib/airdrop-round-store");

const CONTRACT_ADDRESS = "0x1111111111111111111111111111111111111111";
const DEPLOYMENT_KEY = `1337:${CONTRACT_ADDRESS.toLowerCase()}`;
const FIXED_SYNC_TIME = "2026-04-20T18:00:00.000Z";
const CLAIM_EVENT_TIME = "2026-04-20T18:01:40.000Z";

function createTempDatabasePath() {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "liberdus-claim-sync-"));
  return {
    dirPath: tempDir,
    dbPath: path.join(tempDir, "claims.sqlite"),
  };
}

function buildClaimEventLog({ epoch, claimIndex, account, amountRaw, blockNumber, blockHash, txHash, logIndex = 0 }) {
  const iface = new ethers.Interface(AIRDROP_ABI);
  const event = iface.getEvent("Claimed");
  const encoded = iface.encodeEventLog(event, [
    BigInt(epoch),
    BigInt(claimIndex),
    account,
    BigInt(amountRaw),
  ]);

  return {
    address: CONTRACT_ADDRESS,
    blockNumber,
    blockHash,
    transactionHash: txHash,
    index: logIndex,
    data: encoded.data,
    topics: encoded.topics,
  };
}

function createFakeProvider({ latestBlock = 0, logs = [], blocks = {} }) {
  return {
    async getBlockNumber() {
      return latestBlock;
    },
    async getLogs(filter) {
      return logs.filter((log) => {
        const fromBlock = Number(filter.fromBlock || 0);
        const toBlock = Number(filter.toBlock || latestBlock);
        return Number(log.blockNumber) >= fromBlock && Number(log.blockNumber) <= toBlock;
      });
    },
    async getBlock(blockRef) {
      const key = String(blockRef);
      return blocks[key] || blocks[String(Number(blockRef))] || null;
    },
  };
}

function createTestRoundStore() {
  const originalDbPath = process.env.LIBERDUS_DB_PATH;
  const { dirPath, dbPath } = createTempDatabasePath();
  process.env.LIBERDUS_DB_PATH = dbPath;

  const db = openDatabase();
  const store = createAirdropRoundStore(db);

  const cleanup = () => {
    db.close();
    if (originalDbPath == null) {
      delete process.env.LIBERDUS_DB_PATH;
    } else {
      process.env.LIBERDUS_DB_PATH = originalDbPath;
    }
    fs.rmSync(dirPath, { recursive: true, force: true });
  };

  return {
    db,
    store,
    cleanup,
  };
}

function seedDeployedRound(store, claims) {
  const builtRound = buildClaimRound(claims, 18);
  const draftRound = store.saveDraftRound({
    deploymentKey: DEPLOYMENT_KEY,
    merkleRoot: builtRound.root,
    deadline: 1_900_000_000,
    claimCount: builtRound.claimCount,
    totalAmountRaw: builtRound.totalAmountRaw,
    decimals: builtRound.decimals,
    chainId: 1337,
    contractAddress: CONTRACT_ADDRESS,
    sourceKind: "admin-draft",
    claims: builtRound.claims,
    updatedAt: "2026-04-20T17:55:00.000Z",
  });

  return store.finalizeRoundDeployment(draftRound.id, DEPLOYMENT_KEY, {
    epoch: 1,
    merkleRoot: builtRound.root,
    deadline: 1_900_000_000,
    chainId: 1337,
    contractAddress: CONTRACT_ADDRESS,
    sourceKind: "admin-draft",
    startTxHash: "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    startBlockNumber: 100,
    startBlockHash: "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
    updatedAt: "2026-04-20T17:56:00.000Z",
  });
}

function createClaimSyncTestService(store, provider) {
  return createClaimSyncService({
    appConfig: {
      chainId: 1337,
      rpcUrl: "http://127.0.0.1:8545",
      airdropAddress: CONTRACT_ADDRESS,
      deploymentKey: DEPLOYMENT_KEY,
    },
    airdropRoundStore: store,
    provider,
    confirmations: 0,
    maxBlockRange: 1000,
    reorgLookback: 20,
    now: () => FIXED_SYNC_TIME,
    logger: {
      info() {},
      warn() {},
      error() {},
    },
  });
}

describe("claim sync service", function () {
  it("reconciles claimed events into stored claim rows and round rollups", async function () {
    const { store, cleanup } = createTestRoundStore();

    try {
      const claimant = "0x70997970C51812dc3A010C7d01b50e0d17dc79C8";
      const unclaimed = "0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC";
      const deployedRound = seedDeployedRound(store, [
        { index: 0, account: claimant, amount: "125" },
        { index: 1, account: unclaimed, amount: "90" },
      ]);
      const claimedAmountRaw = ethers.parseEther("125").toString();
      const blockHash = "0xcccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc";
      const txHash = "0xdddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd";
      const service = createClaimSyncTestService(store, createFakeProvider({
        latestBlock: 105,
        logs: [
          buildClaimEventLog({
            epoch: 1,
            claimIndex: 0,
            account: claimant,
            amountRaw: claimedAmountRaw,
            blockNumber: 103,
            blockHash,
            txHash,
          }),
        ],
        blocks: {
          [blockHash]: { timestamp: Math.floor(new Date(CLAIM_EVENT_TIME).getTime() / 1000) },
        },
      }));

      const summary = await service.reconcileDeployment({ reason: "test" });
      const claim = store.getClaimByEpochAndIndex(1, 0, DEPLOYMENT_KEY);
      const round = store.getRoundById(deployedRound.id, DEPLOYMENT_KEY);
      const claimSummary = store.getClaimSyncSummary(DEPLOYMENT_KEY);
      const walletSummaries = store.getWalletClaimSummaries([claimant, unclaimed], DEPLOYMENT_KEY);

      expect(summary.appliedCount).to.equal(1);
      expect(claim.entry.claimedAt).to.equal(CLAIM_EVENT_TIME);
      expect(claim.entry.claimedTxHash).to.equal(txHash);
      expect(claim.entry.claimedBlockNumber).to.equal(103);
      expect(claim.entry.claimedBlockHash).to.equal(blockHash);
      expect(claim.entry.claimedLogIndex).to.equal(0);
      expect(round.claimedCount).to.equal(1);
      expect(round.claimedAmountRaw).to.equal(claimedAmountRaw);
      expect(round.claimsSyncedThroughBlock).to.equal(105);
      expect(round.claimsLastReconciledAt).to.equal(FIXED_SYNC_TIME);
      expect(claimSummary.totalClaimedCount).to.equal(1);
      expect(claimSummary.totalClaimedAmountRaw).to.equal(claimedAmountRaw);
      expect(claimSummary.claimsLastReconciledAt).to.equal(FIXED_SYNC_TIME);
      expect(walletSummaries.get(claimant.toLowerCase())).to.deep.equal({
        claimedCount: 1,
        totalClaimedAmountRaw: claimedAmountRaw,
      });
      expect(walletSummaries.get(unclaimed.toLowerCase())).to.deep.equal({
        claimedCount: 0,
        totalClaimedAmountRaw: "0",
      });
    } finally {
      cleanup();
    }
  });

  it("clears mirrored claim state when a rescanned window no longer contains the event", async function () {
    const { store, cleanup } = createTestRoundStore();

    try {
      const claimant = "0x70997970C51812dc3A010C7d01b50e0d17dc79C8";
      seedDeployedRound(store, [
        { index: 0, account: claimant, amount: "125" },
      ]);
      const claimedAmountRaw = ethers.parseEther("125").toString();
      const blockHash = "0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee";
      const txHash = "0xffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff";
      const firstService = createClaimSyncTestService(store, createFakeProvider({
        latestBlock: 105,
        logs: [
          buildClaimEventLog({
            epoch: 1,
            claimIndex: 0,
            account: claimant,
            amountRaw: claimedAmountRaw,
            blockNumber: 103,
            blockHash,
            txHash,
          }),
        ],
        blocks: {
          [blockHash]: { timestamp: Math.floor(new Date(CLAIM_EVENT_TIME).getTime() / 1000) },
        },
      }));
      const secondService = createClaimSyncTestService(store, createFakeProvider({
        latestBlock: 105,
        logs: [],
      }));

      await firstService.reconcileDeployment({ reason: "seed" });
      const summary = await secondService.reconcileDeployment({ reason: "rescan" });
      const claim = store.getClaimByEpochAndIndex(1, 0, DEPLOYMENT_KEY);
      const round = store.getRoundById(1, DEPLOYMENT_KEY);

      expect(summary.clearedCount).to.equal(1);
      expect(claim.entry.claimedAt).to.equal(null);
      expect(claim.entry.claimedTxHash).to.equal(null);
      expect(claim.entry.claimedBlockNumber).to.equal(null);
      expect(round.claimedCount).to.equal(0);
      expect(round.claimedAmountRaw).to.equal("0");
    } finally {
      cleanup();
    }
  });

  it("skips mismatched claim logs instead of mutating stored allocations", async function () {
    const { store, cleanup } = createTestRoundStore();

    try {
      const claimant = "0x70997970C51812dc3A010C7d01b50e0d17dc79C8";
      seedDeployedRound(store, [
        { index: 0, account: claimant, amount: "125" },
      ]);
      const service = createClaimSyncTestService(store, createFakeProvider({
        latestBlock: 104,
        logs: [
          buildClaimEventLog({
            epoch: 1,
            claimIndex: 0,
            account: claimant,
            amountRaw: ethers.parseEther("999").toString(),
            blockNumber: 104,
            blockHash: "0x9999999999999999999999999999999999999999999999999999999999999999",
            txHash: "0x8888888888888888888888888888888888888888888888888888888888888888",
          }),
        ],
      }));

      const summary = await service.reconcileDeployment({ reason: "mismatch" });
      const claim = store.getClaimByEpochAndIndex(1, 0, DEPLOYMENT_KEY);
      const round = store.getRoundById(1, DEPLOYMENT_KEY);

      expect(summary.mismatchCount).to.equal(1);
      expect(claim.entry.claimedTxHash).to.equal(null);
      expect(round.claimedCount).to.equal(0);
      expect(round.claimedAmountRaw).to.equal("0");
    } finally {
      cleanup();
    }
  });
});
