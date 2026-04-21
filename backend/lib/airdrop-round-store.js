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
    status: String(row.status || "draft").trim(),
    epoch: row.epoch == null ? null : Number(row.epoch),
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
    claimedCount: Number(row.claimed_count || 0),
    claimedAmountRaw: String(row.claimed_amount_raw || "0"),
    claimsSyncedThroughBlock: row.claims_synced_through_block == null
      ? null
      : Number(row.claims_synced_through_block),
    claimsLastReconciledAt: normalizeIsoDate(row.claims_last_reconciled_at),
    createdAt: normalizeIsoDate(row.created_at),
    updatedAt: normalizeIsoDate(row.updated_at),
  };
}

function normalizeClaimRecord(row) {
  if (!row) return null;

  return {
    id: Number(row.claim_id ?? row.id),
    roundId: Number(row.round_id),
    index: String(row.claim_index),
    account: ethers.getAddress(String(row.wallet_address || "").trim()),
    amountRaw: String(row.amount_raw || "0"),
    proof: JSON.parse(String(row.proof_json || "[]")),
    usernameDisplay: String(row.username_display || "").trim() || null,
    claimedAt: normalizeIsoDate(row.claimed_at),
    claimedTxHash: String(row.claimed_tx_hash || "").trim() || null,
    claimedBlockNumber: row.claimed_block_number == null ? null : Number(row.claimed_block_number),
    claimedBlockHash: String(row.claimed_block_hash || "").trim() || null,
    claimedLogIndex: row.claimed_log_index == null ? null : Number(row.claimed_log_index),
    createdAt: normalizeIsoDate(row.claim_created_at ?? row.created_at),
    updatedAt: normalizeIsoDate(row.claim_updated_at ?? row.updated_at),
  };
}

function normalizeDeploymentKey(value) {
  const normalized = String(value || "").trim();
  if (!normalized) {
    throw new Error("A deployment key is required for stored airdrop rounds.");
  }

  return normalized;
}

function normalizeClaimInsertRecord(roundId, claim, timestamp) {
  return {
    roundId,
    claimIndex: Number(claim.index),
    walletAddress: ethers.getAddress(String(claim.account || "").trim()).toLowerCase(),
    amountRaw: String(claim.amountRaw || "0"),
    proofJson: JSON.stringify(Array.isArray(claim.proof) ? claim.proof : []),
    claimedAt: normalizeIsoDate(claim.claimedAt),
    claimedTxHash: String(claim.claimedTxHash || "").trim().toLowerCase() || null,
    claimedBlockNumber: claim.claimedBlockNumber == null ? null : Number(claim.claimedBlockNumber),
    claimedBlockHash: String(claim.claimedBlockHash || "").trim().toLowerCase() || null,
    claimedLogIndex: claim.claimedLogIndex == null ? null : Number(claim.claimedLogIndex),
    createdAt: normalizeIsoDate(claim.createdAt, timestamp),
    updatedAt: normalizeIsoDate(claim.updatedAt, timestamp),
  };
}

function createAirdropRoundStore(db) {
  const claimSelect = `
    c.id AS claim_id,
    c.round_id,
    c.claim_index,
    c.wallet_address,
    c.amount_raw,
    c.proof_json,
    c.claimed_at,
    c.claimed_tx_hash,
    c.claimed_block_number,
    c.claimed_block_hash,
    c.claimed_log_index,
    c.created_at AS claim_created_at,
    c.updated_at AS claim_updated_at,
    (
      SELECT xa.username_display
      FROM x_accounts xa
      WHERE LOWER(xa.wallet_address) = LOWER(c.wallet_address)
      ORDER BY datetime(xa.updated_at) DESC, xa.id DESC
      LIMIT 1
    ) AS username_display
  `;

  const statements = {
    getRoundByIdAndDeployment: db.prepare(`
      SELECT *
      FROM airdrop_rounds
      WHERE id = ?
        AND deployment_key = ?
      LIMIT 1
    `),
    getRoundByDeploymentAndEpoch: db.prepare(`
      SELECT *
      FROM airdrop_rounds
      WHERE deployment_key = ?
        AND epoch = ?
      LIMIT 1
    `),
    getMatchingDraft: db.prepare(`
      SELECT *
      FROM airdrop_rounds
      WHERE deployment_key = ?
        AND status = 'draft'
        AND LOWER(merkle_root) = LOWER(?)
        AND deadline = ?
        AND claim_count = ?
        AND total_amount_raw = ?
      ORDER BY datetime(updated_at) DESC, id DESC
      LIMIT 1
    `),
    insertRound: db.prepare(`
      INSERT INTO airdrop_rounds (
        deployment_key,
        status,
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
        claimed_count,
        claimed_amount_raw,
        claims_synced_through_block,
        claims_last_reconciled_at,
        created_at,
        updated_at
      ) VALUES (
        @deploymentKey,
        @status,
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
        @claimedCount,
        @claimedAmountRaw,
        @claimsSyncedThroughBlock,
        @claimsLastReconciledAt,
        @createdAt,
        @updatedAt
      )
    `),
    updateRound: db.prepare(`
      UPDATE airdrop_rounds
      SET deployment_key = @deploymentKey,
          status = @status,
          epoch = @epoch,
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
          claimed_count = @claimedCount,
          claimed_amount_raw = @claimedAmountRaw,
          claims_synced_through_block = @claimsSyncedThroughBlock,
          claims_last_reconciled_at = @claimsLastReconciledAt,
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
        claimed_at,
        claimed_tx_hash,
        claimed_block_number,
        claimed_block_hash,
        claimed_log_index,
        created_at,
        updated_at
      ) VALUES (
        @roundId,
        @claimIndex,
        @walletAddress,
        @amountRaw,
        @proofJson,
        @claimedAt,
        @claimedTxHash,
        @claimedBlockNumber,
        @claimedBlockHash,
        @claimedLogIndex,
        @createdAt,
        @updatedAt
      )
    `),
    getClaimByRoundAndIndex: db.prepare(`
      SELECT *
      FROM airdrop_claims
      WHERE round_id = ?
        AND claim_index = ?
      LIMIT 1
    `),
    clearClaimSyncRange: db.prepare(`
      UPDATE airdrop_claims
      SET claimed_at = NULL,
          claimed_tx_hash = NULL,
          claimed_block_number = NULL,
          claimed_block_hash = NULL,
          claimed_log_index = NULL,
          updated_at = @updatedAt
      WHERE round_id = @roundId
        AND claimed_block_number IS NOT NULL
        AND claimed_block_number BETWEEN @fromBlock AND @toBlock
    `),
    updateClaimSyncMetadata: db.prepare(`
      UPDATE airdrop_claims
      SET claimed_at = @claimedAt,
          claimed_tx_hash = @claimedTxHash,
          claimed_block_number = @claimedBlockNumber,
          claimed_block_hash = @claimedBlockHash,
          claimed_log_index = @claimedLogIndex,
          updated_at = @updatedAt
      WHERE id = @id
    `),
    listClaimedAmountsByRound: db.prepare(`
      SELECT amount_raw
      FROM airdrop_claims
      WHERE round_id = ?
        AND claimed_tx_hash IS NOT NULL
      ORDER BY claim_index ASC
    `),
    updateRoundClaimSyncStatus: db.prepare(`
      UPDATE airdrop_rounds
      SET claimed_count = @claimedCount,
          claimed_amount_raw = @claimedAmountRaw,
          claims_synced_through_block = @claimsSyncedThroughBlock,
          claims_last_reconciled_at = @claimsLastReconciledAt,
          updated_at = @updatedAt
      WHERE id = @id
    `),
    listRounds: db.prepare(`
      SELECT *
      FROM airdrop_rounds
      WHERE deployment_key = ?
      ORDER BY
        CASE WHEN status = 'draft' THEN 0 ELSE 1 END,
        COALESCE(epoch, 0) DESC,
        datetime(updated_at) DESC,
        id DESC
    `),
    listWalletRounds: db.prepare(`
      SELECT
        r.*,
        ${claimSelect}
      FROM airdrop_claims c
      INNER JOIN airdrop_rounds r
        ON r.id = c.round_id
      WHERE r.deployment_key = ?
        AND r.status = 'deployed'
        AND LOWER(c.wallet_address) = LOWER(?)
      ORDER BY r.epoch DESC, r.id DESC
    `),
    getClaimByEpochAndIndex: db.prepare(`
      SELECT
        r.*,
        ${claimSelect}
      FROM airdrop_claims c
      INNER JOIN airdrop_rounds r
        ON r.id = c.round_id
      WHERE r.deployment_key = ?
        AND r.status = 'deployed'
        AND r.epoch = ?
        AND c.claim_index = ?
      LIMIT 1
    `),
    listClaimsByRound: db.prepare(`
      SELECT
        r.*,
        ${claimSelect}
      FROM airdrop_claims c
      INNER JOIN airdrop_rounds r
        ON r.id = c.round_id
      WHERE r.deployment_key = ?
        AND r.id = ?
      ORDER BY c.claim_index ASC, c.id ASC
    `),
    getClaimById: db.prepare(`
      SELECT
        r.*,
        ${claimSelect}
      FROM airdrop_claims c
      INNER JOIN airdrop_rounds r
        ON r.id = c.round_id
      WHERE r.deployment_key = ?
        AND c.id = ?
      LIMIT 1
    `),
    listClaimsByWallet: db.prepare(`
      SELECT
        r.*,
        ${claimSelect}
      FROM airdrop_claims c
      INNER JOIN airdrop_rounds r
        ON r.id = c.round_id
      WHERE r.deployment_key = ?
        AND LOWER(c.wallet_address) = LOWER(?)
      ORDER BY
        CASE WHEN r.status = 'draft' THEN 0 ELSE 1 END,
        COALESCE(r.epoch, 0) DESC,
        c.claim_index ASC,
        c.id ASC
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

  function rebuildClaimedTotals(roundId) {
    const claimedRows = statements.listClaimedAmountsByRound.all(Number(roundId));
    return {
      claimedCount: claimedRows.length,
      claimedAmountRaw: claimedRows
        .reduce((total, row) => total + BigInt(String(row.amount_raw || "0")), 0n)
        .toString(),
    };
  }

  function replaceClaimsForRound(roundId, claims, timestamp) {
    statements.deleteClaimsByRoundId.run(roundId);
    for (const claim of claims) {
      statements.insertClaim.run(normalizeClaimInsertRecord(roundId, claim, timestamp));
    }
  }

  const saveDraftRound = db.transaction((round) => {
    const deploymentKey = normalizeDeploymentKey(round.deploymentKey);
    const updatedAt = normalizeIsoDate(round.updatedAt, new Date().toISOString());
    const normalizedMerkleRoot = String(round.merkleRoot || "").trim().toLowerCase();
    const normalizedDeadline = Number(round.deadline || 0);
    const normalizedClaimCount = Number(round.claimCount || 0);
    const normalizedTotalAmountRaw = String(round.totalAmountRaw || "0");
    const existing = normalizeRoundRecord(
      statements.getMatchingDraft.get(
        deploymentKey,
        normalizedMerkleRoot,
        normalizedDeadline,
        normalizedClaimCount,
        normalizedTotalAmountRaw,
      ),
    );

    const baseRecord = {
      deploymentKey,
      status: "draft",
      epoch: null,
      merkleRoot: normalizedMerkleRoot,
      deadline: normalizedDeadline,
      claimCount: normalizedClaimCount,
      totalAmountRaw: normalizedTotalAmountRaw,
      decimals: Number(round.decimals || 18),
      chainId: Number(round.chainId || 0),
      contractAddress: ethers.getAddress(String(round.contractAddress || "").trim()).toLowerCase(),
      sourceKind: String(round.sourceKind || "admin-draft").trim(),
      startTxHash: null,
      startBlockNumber: null,
      startBlockHash: null,
      claimedCount: 0,
      claimedAmountRaw: "0",
      claimsSyncedThroughBlock: null,
      claimsLastReconciledAt: null,
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

    replaceClaimsForRound(roundId, round.claims, updatedAt);
    return normalizeRoundRecord(statements.getRoundByIdAndDeployment.get(roundId, deploymentKey));
  });

  const finalizeRoundDeployment = db.transaction((roundId, deploymentKey, deployment) => {
    const existing = normalizeRoundRecord(
      statements.getRoundByIdAndDeployment.get(Number(roundId), normalizeDeploymentKey(deploymentKey)),
    );

    if (!existing) {
      throw new Error("Stored airdrop round was not found.");
    }

    const normalizedEpoch = Number(deployment.epoch);
    const conflictingRound = normalizeRoundRecord(
      statements.getRoundByDeploymentAndEpoch.get(existing.deploymentKey, normalizedEpoch),
    );
    if (conflictingRound && conflictingRound.id !== existing.id) {
      throw new Error(`Epoch ${normalizedEpoch} is already linked to another stored round.`);
    }

    const updatedAt = normalizeIsoDate(deployment.updatedAt, new Date().toISOString());
    statements.updateRound.run({
      id: existing.id,
      deploymentKey: existing.deploymentKey,
      status: "deployed",
      epoch: normalizedEpoch,
      merkleRoot: String(deployment.merkleRoot || existing.merkleRoot).trim().toLowerCase(),
      deadline: Number(deployment.deadline || existing.deadline),
      claimCount: existing.claimCount,
      totalAmountRaw: existing.totalAmountRaw,
      decimals: existing.decimals,
      chainId: Number(deployment.chainId || existing.chainId || 0),
      contractAddress: ethers.getAddress(String(deployment.contractAddress || existing.contractAddress).trim()).toLowerCase(),
      sourceKind: String(deployment.sourceKind || existing.sourceKind || "admin-draft").trim(),
      startTxHash: String(deployment.startTxHash || "").trim().toLowerCase() || null,
      startBlockNumber: deployment.startBlockNumber == null ? null : Number(deployment.startBlockNumber),
      startBlockHash: String(deployment.startBlockHash || "").trim().toLowerCase() || null,
      claimedCount: Number(existing.claimedCount || 0),
      claimedAmountRaw: String(existing.claimedAmountRaw || "0"),
      claimsSyncedThroughBlock: existing.claimsSyncedThroughBlock == null
        ? null
        : Number(existing.claimsSyncedThroughBlock),
      claimsLastReconciledAt: existing.claimsLastReconciledAt || null,
      createdAt: existing.createdAt,
      updatedAt,
    });

    return normalizeRoundRecord(statements.getRoundByIdAndDeployment.get(existing.id, existing.deploymentKey));
  });

  return {
    saveDraftRound(round) {
      return saveDraftRound(round);
    },

    finalizeRoundDeployment(roundId, deploymentKey, deployment) {
      return finalizeRoundDeployment(roundId, deploymentKey, deployment);
    },

    applyClaimSyncChunk(roundId, deploymentKey, chunk = {}) {
      return db.transaction(() => {
        const round = normalizeRoundRecord(
          statements.getRoundByIdAndDeployment.get(Number(roundId), normalizeDeploymentKey(deploymentKey)),
        );

        if (!round) {
          throw new Error("Stored airdrop round was not found.");
        }

        const updatedAt = normalizeIsoDate(chunk.updatedAt, new Date().toISOString());
        const fromBlock = Number(chunk.fromBlock);
        const toBlock = Number(chunk.toBlock);
        const claims = Array.isArray(chunk.claims) ? chunk.claims : [];
        let clearedCount = 0;
        let appliedCount = 0;
        let missingClaimCount = 0;
        let mismatchCount = 0;

        if (Number.isInteger(fromBlock) && Number.isInteger(toBlock) && fromBlock <= toBlock) {
          clearedCount = Number(statements.clearClaimSyncRange.run({
            roundId: round.id,
            fromBlock,
            toBlock,
            updatedAt,
          }).changes || 0);
        }

        for (const claimEvent of claims) {
          const claimRow = statements.getClaimByRoundAndIndex.get(round.id, Number(claimEvent.claimIndex));
          if (!claimRow) {
            missingClaimCount += 1;
            continue;
          }

          const expectedWallet = ethers.getAddress(String(claimRow.wallet_address || "").trim()).toLowerCase();
          const actualWallet = ethers.getAddress(String(claimEvent.walletAddress || "").trim()).toLowerCase();
          const expectedAmountRaw = String(claimRow.amount_raw || "0");
          const actualAmountRaw = String(claimEvent.amountRaw || "0");

          if (expectedWallet !== actualWallet || expectedAmountRaw !== actualAmountRaw) {
            mismatchCount += 1;
            continue;
          }

          statements.updateClaimSyncMetadata.run({
            id: Number(claimRow.id),
            claimedAt: normalizeIsoDate(claimEvent.claimedAt, updatedAt),
            claimedTxHash: String(claimEvent.txHash || "").trim().toLowerCase() || null,
            claimedBlockNumber: claimEvent.blockNumber == null ? null : Number(claimEvent.blockNumber),
            claimedBlockHash: String(claimEvent.blockHash || "").trim().toLowerCase() || null,
            claimedLogIndex: claimEvent.logIndex == null ? null : Number(claimEvent.logIndex),
            updatedAt,
          });
          appliedCount += 1;
        }

        const totals = rebuildClaimedTotals(round.id);
        statements.updateRoundClaimSyncStatus.run({
          id: round.id,
          claimedCount: totals.claimedCount,
          claimedAmountRaw: totals.claimedAmountRaw,
          claimsSyncedThroughBlock: chunk.claimsSyncedThroughBlock == null
            ? round.claimsSyncedThroughBlock
            : Number(chunk.claimsSyncedThroughBlock),
          claimsLastReconciledAt: normalizeIsoDate(chunk.claimsLastReconciledAt, updatedAt),
          updatedAt,
        });

        return {
          round: normalizeRoundRecord(statements.getRoundByIdAndDeployment.get(round.id, round.deploymentKey)),
          clearedCount,
          appliedCount,
          missingClaimCount,
          mismatchCount,
        };
      })();
    },

    listRounds(deploymentKey) {
      const normalizedDeploymentKey = normalizeDeploymentKey(deploymentKey);
      return statements.listRounds.all(normalizedDeploymentKey).map((row) => normalizeRoundRecord(row));
    },

    getRoundById(roundId, deploymentKey) {
      return normalizeRoundRecord(
        statements.getRoundByIdAndDeployment.get(Number(roundId), normalizeDeploymentKey(deploymentKey)),
      );
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

    listClaimsByRound(roundId, deploymentKey) {
      const normalizedDeploymentKey = normalizeDeploymentKey(deploymentKey);
      return statements.listClaimsByRound.all(normalizedDeploymentKey, Number(roundId)).map((row) => ({
        round: normalizeRoundRecord(row),
        entry: normalizeClaimRecord(row),
      }));
    },

    getClaimById(claimId, deploymentKey) {
      const normalizedDeploymentKey = normalizeDeploymentKey(deploymentKey);
      const row = statements.getClaimById.get(normalizedDeploymentKey, Number(claimId));
      if (!row) {
        return null;
      }

      return {
        round: normalizeRoundRecord(row),
        entry: normalizeClaimRecord(row),
      };
    },

    findClaimsByWallet(walletAddress, deploymentKey) {
      const normalizedDeploymentKey = normalizeDeploymentKey(deploymentKey);
      return statements.listClaimsByWallet.all(normalizedDeploymentKey, walletAddress).map((row) => ({
        round: normalizeRoundRecord(row),
        entry: normalizeClaimRecord(row),
      }));
    },

    getWalletClaimSummaries(walletAddresses, deploymentKey) {
      const normalizedDeploymentKey = normalizeDeploymentKey(deploymentKey);
      const normalizedWallets = [...new Set(
        (Array.isArray(walletAddresses) ? walletAddresses : [])
          .map((walletAddress) => {
            try {
              return ethers.getAddress(String(walletAddress || "").trim()).toLowerCase();
            } catch {
              return "";
            }
          })
          .filter(Boolean),
      )];

      if (!normalizedWallets.length) {
        return new Map();
      }

      const placeholders = normalizedWallets.map((_, index) => `@wallet${index}`).join(", ");
      const sqlParams = normalizedWallets.reduce((params, walletAddress, index) => ({
        ...params,
        [`wallet${index}`]: walletAddress,
      }), { deploymentKey: normalizedDeploymentKey });
      const rows = db.prepare(`
        SELECT LOWER(c.wallet_address) AS wallet_address, c.amount_raw
        FROM airdrop_claims c
        INNER JOIN airdrop_rounds r
          ON r.id = c.round_id
        WHERE r.deployment_key = @deploymentKey
          AND c.claimed_tx_hash IS NOT NULL
          AND LOWER(c.wallet_address) IN (${placeholders})
      `).all(sqlParams);
      const summaries = new Map();

      for (const walletAddress of normalizedWallets) {
        summaries.set(walletAddress, {
          claimedCount: 0,
          totalClaimedAmountRaw: "0",
        });
      }

      for (const row of rows) {
        const walletAddress = String(row.wallet_address || "").trim().toLowerCase();
        const existing = summaries.get(walletAddress) || {
          claimedCount: 0,
          totalClaimedAmountRaw: "0",
        };
        existing.claimedCount += 1;
        existing.totalClaimedAmountRaw = (
          BigInt(existing.totalClaimedAmountRaw)
          + BigInt(String(row.amount_raw || "0"))
        ).toString();
        summaries.set(walletAddress, existing);
      }

      return summaries;
    },

    getClaimSyncSummary(deploymentKey) {
      const rounds = this.listRounds(deploymentKey).filter((round) => round.status === "deployed");
      let totalClaimedCount = 0;
      let totalClaimedAmountRaw = 0n;
      let claimsLastReconciledAt = null;

      for (const round of rounds) {
        totalClaimedCount += Number(round.claimedCount || 0);
        totalClaimedAmountRaw += BigInt(String(round.claimedAmountRaw || "0"));

        if (round.claimsLastReconciledAt && (!claimsLastReconciledAt || round.claimsLastReconciledAt > claimsLastReconciledAt)) {
          claimsLastReconciledAt = round.claimsLastReconciledAt;
        }
      }

      return {
        totalClaimedCount,
        totalClaimedAmountRaw: totalClaimedAmountRaw.toString(),
        claimsLastReconciledAt,
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
