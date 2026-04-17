const { ethers } = require("ethers");

function normalizeIsoDate(value, fallbackValue = null) {
  const rawValue = String(value || "").trim();
  if (!rawValue) return fallbackValue;

  const date = new Date(rawValue);
  if (Number.isNaN(date.getTime())) return fallbackValue;
  return date.toISOString();
}

function normalizeRoundRecord(row) {
  if (!row) return null;

  return {
    id: Number(row.id),
    deploymentKey: String(row.deployment_key || "").trim(),
    epoch: Number(row.epoch),
    merkleRoot: String(row.merkle_root || "").trim(),
    deadline: Number(row.deadline || 0),
    claimCount: Number(row.claim_count || 0),
    totalAmountRaw: String(row.total_amount_raw || "0"),
    decimals: Number(row.decimals || 18),
    chainId: Number(row.chain_id || 0),
    contractAddress: String(row.contract_address || "").trim(),
    sourceKind: String(row.source_kind || "").trim(),
    startTxHash: String(row.start_tx_hash || "").trim(),
    startBlockNumber: row.start_block_number == null ? null : Number(row.start_block_number),
    startBlockHash: String(row.start_block_hash || "").trim(),
    createdAt: normalizeIsoDate(row.created_at),
    updatedAt: normalizeIsoDate(row.updated_at),
  };
}

function normalizeClaimRecord(row) {
  if (!row) return null;

  return {
    roundId: Number(row.round_id),
    index: String(row.claim_index),
    account: ethers.getAddress(String(row.wallet_address || "").trim()),
    amountRaw: String(row.amount_raw || "0"),
    proof: JSON.parse(String(row.proof_json || "[]")),
  };
}

function normalizeDeploymentKey(value) {
  const normalized = String(value || "").trim();
  if (!normalized) {
    throw new Error("A deployment key is required for stored airdrop rounds.");
  }

  return normalized;
}

function createAirdropRoundStore(db) {
  const statements = {
    getRoundByDeploymentAndEpoch: db.prepare(`
      SELECT *
      FROM airdrop_rounds
      WHERE deployment_key = ?
        AND epoch = ?
    `),
    getRoundById: db.prepare(`
      SELECT *
      FROM airdrop_rounds
      WHERE id = ?
    `),
    insertRound: db.prepare(`
      INSERT INTO airdrop_rounds (
        deployment_key,
        epoch,
        merkle_root,
        deadline,
        claim_count,
        total_amount_raw,
        decimals,
        chain_id,
        contract_address,
        source_kind,
        start_tx_hash,
        start_block_number,
        start_block_hash,
        created_at,
        updated_at
      ) VALUES (
        @deploymentKey,
        @epoch,
        @merkleRoot,
        @deadline,
        @claimCount,
        @totalAmountRaw,
        @decimals,
        @chainId,
        @contractAddress,
        @sourceKind,
        @startTxHash,
        @startBlockNumber,
        @startBlockHash,
        @createdAt,
        @updatedAt
      )
    `),
    updateRound: db.prepare(`
      UPDATE airdrop_rounds
      SET deployment_key = @deploymentKey,
          merkle_root = @merkleRoot,
          deadline = @deadline,
          claim_count = @claimCount,
          total_amount_raw = @totalAmountRaw,
          decimals = @decimals,
          chain_id = @chainId,
          contract_address = @contractAddress,
          source_kind = @sourceKind,
          start_tx_hash = @startTxHash,
          start_block_number = @startBlockNumber,
          start_block_hash = @startBlockHash,
          updated_at = @updatedAt
      WHERE id = @id
    `),
    deleteClaimsByRoundId: db.prepare(`
      DELETE FROM airdrop_claims
      WHERE round_id = ?
    `),
    insertClaim: db.prepare(`
      INSERT INTO airdrop_claims (
        round_id,
        claim_index,
        wallet_address,
        amount_raw,
        proof_json,
        created_at
      ) VALUES (
        @roundId,
        @claimIndex,
        @walletAddress,
        @amountRaw,
        @proofJson,
        @createdAt
      )
    `),
    listRounds: db.prepare(`
      SELECT *
      FROM airdrop_rounds
      WHERE deployment_key = ?
      ORDER BY epoch DESC, id DESC
    `),
    listWalletRounds: db.prepare(`
      SELECT
        r.*,
        c.round_id,
        c.claim_index,
        c.wallet_address,
        c.amount_raw,
        c.proof_json
      FROM airdrop_claims c
      INNER JOIN airdrop_rounds r
        ON r.id = c.round_id
      WHERE r.deployment_key = ?
        AND LOWER(c.wallet_address) = LOWER(?)
      ORDER BY r.epoch DESC, r.id DESC
    `),
    getClaimByEpochAndIndex: db.prepare(`
      SELECT
        r.*,
        c.round_id,
        c.claim_index,
        c.wallet_address,
        c.amount_raw,
        c.proof_json
      FROM airdrop_claims c
      INNER JOIN airdrop_rounds r
        ON r.id = c.round_id
      WHERE r.deployment_key = ?
        AND r.epoch = ?
        AND c.claim_index = ?
      LIMIT 1
    `),
    getStats: db.prepare(`
      SELECT
        COUNT(*) AS roundCount,
        COALESCE(SUM(claim_count), 0) AS claimCount
      FROM airdrop_rounds
      WHERE deployment_key = ?
    `),
    getAllStats: db.prepare(`
      SELECT
        COUNT(*) AS roundCount,
        COALESCE(SUM(claim_count), 0) AS claimCount
      FROM airdrop_rounds
    `),
  };

  const upsertRound = db.transaction((round) => {
    const deploymentKey = normalizeDeploymentKey(round.deploymentKey);
    const existing = normalizeRoundRecord(
      statements.getRoundByDeploymentAndEpoch.get(deploymentKey, round.epoch),
    );
    const updatedAt = normalizeIsoDate(round.updatedAt, new Date().toISOString());
    const baseRecord = {
      deploymentKey,
      epoch: Number(round.epoch),
      merkleRoot: String(round.merkleRoot || "").trim().toLowerCase(),
      deadline: Number(round.deadline || 0),
      claimCount: Number(round.claimCount || 0),
      totalAmountRaw: String(round.totalAmountRaw || "0"),
      decimals: Number(round.decimals || 18),
      chainId: Number(round.chainId || 0),
      contractAddress: ethers.getAddress(String(round.contractAddress || "").trim()).toLowerCase(),
      sourceKind: String(round.sourceKind || "manual").trim(),
      startTxHash: String(round.startTxHash || "").trim().toLowerCase() || null,
      startBlockNumber: round.startBlockNumber == null ? null : Number(round.startBlockNumber),
      startBlockHash: String(round.startBlockHash || "").trim().toLowerCase() || null,
      createdAt: existing?.createdAt || updatedAt,
      updatedAt,
    };

    let roundId = existing?.id || null;
    if (!existing) {
      const insertResult = statements.insertRound.run(baseRecord);
      roundId = Number(insertResult.lastInsertRowid);
    } else {
      statements.updateRound.run({
        id: existing.id,
        ...baseRecord,
      });
      roundId = existing.id;
    }

    statements.deleteClaimsByRoundId.run(roundId);
    for (const claim of round.claims) {
      statements.insertClaim.run({
        roundId,
        claimIndex: Number(claim.index),
        walletAddress: ethers.getAddress(String(claim.account || "").trim()).toLowerCase(),
        amountRaw: String(claim.amountRaw || "0"),
        proofJson: JSON.stringify(Array.isArray(claim.proof) ? claim.proof : []),
        createdAt: updatedAt,
      });
    }

    return normalizeRoundRecord(statements.getRoundById.get(roundId));
  });

  return {
    upsertRound(round) {
      return upsertRound(round);
    },

    listRounds(deploymentKey) {
      const normalizedDeploymentKey = normalizeDeploymentKey(deploymentKey);
      return statements.listRounds.all(normalizedDeploymentKey).map((row) => normalizeRoundRecord(row));
    },

    getWalletRounds(walletAddress, deploymentKey) {
      const normalizedDeploymentKey = normalizeDeploymentKey(deploymentKey);
      return statements.listWalletRounds.all(normalizedDeploymentKey, walletAddress).map((row) => {
        const round = normalizeRoundRecord(row);
        const entry = normalizeClaimRecord(row);
        return {
          ...round,
          entry,
        };
      });
    },

    getClaimByEpochAndIndex(epoch, index, deploymentKey) {
      const normalizedDeploymentKey = normalizeDeploymentKey(deploymentKey);
      const row = statements.getClaimByEpochAndIndex.get(
        normalizedDeploymentKey,
        Number(epoch),
        Number(index),
      );
      if (!row) {
        return null;
      }

      return {
        ...normalizeRoundRecord(row),
        entry: normalizeClaimRecord(row),
      };
    },

    getStats(deploymentKey = null) {
      const row = deploymentKey
        ? (statements.getStats.get(normalizeDeploymentKey(deploymentKey)) || {})
        : (statements.getAllStats.get() || {});
      return {
        roundCount: Number(row.roundCount || 0),
        claimCount: Number(row.claimCount || 0),
      };
    },
  };
}

module.exports = {
  createAirdropRoundStore,
};
