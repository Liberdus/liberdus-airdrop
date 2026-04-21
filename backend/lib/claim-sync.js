const { ethers } = require("ethers");

const { createAirdropContract, createAirdropProvider } = require("./airdrop-chain");
const { requireChainConfig } = require("./app-config");

function parseNonNegativeInteger(value, fallbackValue) {
  const parsed = Number.parseInt(String(value ?? "").trim(), 10);
  if (!Number.isInteger(parsed) || parsed < 0) {
    return fallbackValue;
  }

  return parsed;
}

function createNoopLogger() {
  return {
    info() {},
    warn() {},
    error() {},
  };
}

function createClaimSyncService(options = {}) {
  const appConfig = requireChainConfig(options.appConfig);
  const airdropRoundStore = options.airdropRoundStore;
  if (!airdropRoundStore) {
    throw new Error("Airdrop round store is required for claim sync.");
  }

  const provider = options.provider || createAirdropProvider(appConfig);
  const contract = options.contract || createAirdropContract(appConfig, provider);
  const logger = options.logger || createNoopLogger();
  const now = typeof options.now === "function" ? options.now : (() => new Date().toISOString());
  const confirmations = parseNonNegativeInteger(
    options.confirmations ?? process.env.CLAIM_SYNC_CONFIRMATIONS,
    0,
  );
  const reorgLookback = Math.max(0, parseNonNegativeInteger(
    options.reorgLookback ?? process.env.CLAIM_SYNC_REORG_LOOKBACK,
    20,
  ));
  const maxBlockRange = Math.max(1, parseNonNegativeInteger(
    options.maxBlockRange ?? process.env.CLAIM_SYNC_MAX_BLOCK_RANGE,
    2000,
  ));
  const pollIntervalMs = Math.max(1000, parseNonNegativeInteger(
    options.pollIntervalMs ?? process.env.CLAIM_SYNC_POLL_INTERVAL_MS,
    15000,
  ));
  const deploymentKey = String(options.deploymentKey || appConfig.deploymentKey || "").trim();
  let loopTimer = null;
  let stopped = false;
  let runInFlight = null;

  function createClaimFilter(epoch) {
    const filter = contract.filters.Claimed(BigInt(epoch), null, null);
    return {
      address: filter.address,
      topics: filter.topics,
    };
  }

  async function loadClaimedEventsForChunk(round, fromBlock, toBlock) {
    const filter = createClaimFilter(round.epoch);
    const logs = await provider.getLogs({
      ...filter,
      fromBlock,
      toBlock,
    });
    const blockTimestampCache = new Map();
    const events = [];

    for (const log of logs) {
      let parsedLog = null;
      try {
        parsedLog = contract.interface.parseLog(log);
      } catch {
        parsedLog = null;
      }

      if (!parsedLog || parsedLog.name !== "Claimed") {
        continue;
      }

      const blockCacheKey = String(log.blockHash || log.blockNumber || "");
      if (!blockTimestampCache.has(blockCacheKey)) {
        const block = await provider.getBlock(log.blockHash || log.blockNumber);
        const blockTimestamp = Number(block?.timestamp || 0);
        blockTimestampCache.set(
          blockCacheKey,
          blockTimestamp > 0
            ? new Date(blockTimestamp * 1000).toISOString()
            : now(),
        );
      }

      events.push({
        claimIndex: Number(parsedLog.args.index),
        walletAddress: ethers.getAddress(String(parsedLog.args.account || "").trim()).toLowerCase(),
        amountRaw: String(parsedLog.args.amount || "0"),
        txHash: String(log.transactionHash || "").trim().toLowerCase(),
        blockNumber: Number(log.blockNumber || 0),
        blockHash: String(log.blockHash || "").trim().toLowerCase() || null,
        logIndex: Number(log.index ?? log.logIndex ?? 0),
        claimedAt: blockTimestampCache.get(blockCacheKey),
      });
    }

    return events;
  }

  async function reconcileRound(round, safeBlock, reason) {
    const startedFrom = round.claimsSyncedThroughBlock == null
      ? Number(round.startBlockNumber || 0)
      : Math.max(Number(round.startBlockNumber || 0), Number(round.claimsSyncedThroughBlock || 0) - reorgLookback);
    const startedAt = now();
    const summary = {
      roundId: round.id,
      epoch: round.epoch,
      scannedFromBlock: startedFrom,
      scannedToBlock: safeBlock,
      scannedChunkCount: 0,
      clearedCount: 0,
      appliedCount: 0,
      missingClaimCount: 0,
      mismatchCount: 0,
    };

    if (!Number.isInteger(round.epoch) || !Number.isInteger(round.startBlockNumber) || startedFrom > safeBlock) {
      return summary;
    }

    for (let chunkStart = startedFrom; chunkStart <= safeBlock; chunkStart += maxBlockRange) {
      const chunkEnd = Math.min(chunkStart + maxBlockRange - 1, safeBlock);
      const chunkEvents = await loadClaimedEventsForChunk(round, chunkStart, chunkEnd);
      const chunkResult = airdropRoundStore.applyClaimSyncChunk(round.id, deploymentKey, {
        fromBlock: chunkStart,
        toBlock: chunkEnd,
        claimsSyncedThroughBlock: chunkEnd,
        claimsLastReconciledAt: startedAt,
        updatedAt: startedAt,
        claims: chunkEvents,
      });

      summary.scannedChunkCount += 1;
      summary.clearedCount += Number(chunkResult.clearedCount || 0);
      summary.appliedCount += Number(chunkResult.appliedCount || 0);
      summary.missingClaimCount += Number(chunkResult.missingClaimCount || 0);
      summary.mismatchCount += Number(chunkResult.mismatchCount || 0);
    }

    if (summary.appliedCount || summary.clearedCount || summary.missingClaimCount || summary.mismatchCount) {
      logger.info(
        `[claim-sync] ${reason} epoch ${round.epoch}: applied=${summary.appliedCount}, cleared=${summary.clearedCount}, missing=${summary.missingClaimCount}, mismatches=${summary.mismatchCount}, blocks=${startedFrom}-${safeBlock}`,
      );
    }

    return summary;
  }

  async function reconcileDeployment(options = {}) {
    const reason = String(options.reason || "manual").trim() || "manual";
    if (!deploymentKey) {
      throw new Error("Claim sync requires a deployment key.");
    }

    const latestBlock = Number(await provider.getBlockNumber());
    const safeBlock = Math.max(0, latestBlock - confirmations);
    const rounds = airdropRoundStore
      .listRounds(deploymentKey)
      .filter((round) => round.status === "deployed");
    const summary = {
      reason,
      latestBlock,
      safeBlock,
      roundCount: rounds.length,
      roundSyncs: [],
      appliedCount: 0,
      clearedCount: 0,
      missingClaimCount: 0,
      mismatchCount: 0,
      reconciledAt: now(),
    };

    for (const round of rounds) {
      const roundSummary = await reconcileRound(round, safeBlock, reason);
      summary.roundSyncs.push(roundSummary);
      summary.appliedCount += roundSummary.appliedCount;
      summary.clearedCount += roundSummary.clearedCount;
      summary.missingClaimCount += roundSummary.missingClaimCount;
      summary.mismatchCount += roundSummary.mismatchCount;
    }

    if (summary.appliedCount || summary.clearedCount || summary.mismatchCount || summary.missingClaimCount) {
      logger.info(
        `[claim-sync] ${reason} summary: rounds=${summary.roundCount}, applied=${summary.appliedCount}, cleared=${summary.clearedCount}, missing=${summary.missingClaimCount}, mismatches=${summary.mismatchCount}, safeBlock=${summary.safeBlock}`,
      );
    }

    return summary;
  }

  function scheduleNextRun(delayMs = pollIntervalMs) {
    if (stopped) {
      return;
    }

    loopTimer = setTimeout(async () => {
      if (stopped) {
        return;
      }

      if (runInFlight) {
        scheduleNextRun();
        return;
      }

      runInFlight = reconcileDeployment({ reason: "worker" })
        .catch((error) => {
          logger.error(`[claim-sync] worker reconcile failed: ${error?.message || error}`);
        })
        .finally(() => {
          runInFlight = null;
          scheduleNextRun();
        });

      await runInFlight;
    }, delayMs);

    if (typeof loopTimer.unref === "function") {
      loopTimer.unref();
    }
  }

  return {
    getConfig() {
      return {
        confirmations,
        deploymentKey,
        maxBlockRange,
        pollIntervalMs,
        reorgLookback,
      };
    },

    async reconcileDeployment(options = {}) {
      return reconcileDeployment(options);
    },

    start() {
      if (loopTimer || stopped) {
        return;
      }

      logger.info(
        `[claim-sync] worker started: deployment=${deploymentKey}, intervalMs=${pollIntervalMs}, maxBlockRange=${maxBlockRange}, lookback=${reorgLookback}, confirmations=${confirmations}`,
      );
      scheduleNextRun(0);
    },

    stop() {
      stopped = true;
      if (loopTimer) {
        clearTimeout(loopTimer);
        loopTimer = null;
      }
    },
  };
}

module.exports = {
  createClaimSyncService,
};
