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
    claimAmountRaw: row.claim_amount_raw == null ? null : String(row.claim_amount_raw),
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
    id: Number(row.claim_id ?? row.id),
    roundId: Number(row.round_id),
    index: String(row.claim_index),
    account: ethers.getAddress(String(row.wallet_address || "").trim()),
    amountRaw: String(row.amount_raw || "0"),
    proof: JSON.parse(String(row.proof_json || "[]")),
    usernameDisplay: String(row.username_display || "").trim() || null,
    claimedAt: normalizeIsoDate(row.claimed_at),
    claimedTxHash: String(row.claimed_tx_hash || "").trim() || null,
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
          updated_at = @updatedAt
      WHERE id = @id
    `),
    updateDraftDeadline: db.prepare(`
      UPDATE airdrop_rounds
      SET deadline = @deadline,
          updated_at = @updatedAt
      WHERE id = @id
        AND deployment_key = @deploymentKey
        AND status = 'draft'
    `),
    updateDeployedDeadlineByEpoch: db.prepare(`
      UPDATE airdrop_rounds
      SET deadline = @deadline,
          updated_at = @updatedAt
      WHERE deployment_key = @deploymentKey
        AND status = 'deployed'
        AND epoch = @epoch
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
        @createdAt,
        @updatedAt
      )
    `),
    listRounds: db.prepare(`
      SELECT
        r.*,
        (
          SELECT CASE
            WHEN COUNT(*) > 0 AND COUNT(DISTINCT c.amount_raw) = 1 THEN MIN(c.amount_raw)
            ELSE NULL
          END
          FROM airdrop_claims c
          WHERE c.round_id = r.id
        ) AS claim_amount_raw
      FROM airdrop_rounds r
      WHERE r.deployment_key = ?
      ORDER BY
        CASE WHEN r.status = 'draft' THEN 0 ELSE 1 END,
        COALESCE(r.epoch, 0) DESC,
        datetime(r.updated_at) DESC,
        r.id DESC
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
      createdAt: existing.createdAt,
      updatedAt,
    });

    return normalizeRoundRecord(statements.getRoundByIdAndDeployment.get(existing.id, existing.deploymentKey));
  });

  const updateDraftRoundDeadline = db.transaction((roundId, deploymentKey, deadline, updatedAt = null) => {
    const normalizedDeploymentKey = normalizeDeploymentKey(deploymentKey);
    const normalizedRoundId = Number(roundId);
    const existing = normalizeRoundRecord(
      statements.getRoundByIdAndDeployment.get(normalizedRoundId, normalizedDeploymentKey),
    );

    if (!existing) {
      throw new Error("Stored airdrop round was not found.");
    }

    if (existing.status !== "draft") {
      throw new Error("Only draft rounds can be edited before deployment.");
    }

    const timestamp = normalizeIsoDate(updatedAt, new Date().toISOString());
    statements.updateDraftDeadline.run({
      id: existing.id,
      deploymentKey: existing.deploymentKey,
      deadline: Number(deadline),
      updatedAt: timestamp,
    });

    return normalizeRoundRecord(statements.getRoundByIdAndDeployment.get(existing.id, existing.deploymentKey));
  });

  const updateDeployedRoundDeadlineByEpoch = db.transaction((deploymentKey, epoch, deadline, updatedAt = null) => {
    const normalizedDeploymentKey = normalizeDeploymentKey(deploymentKey);
    const normalizedEpoch = Number(epoch);
    const existing = normalizeRoundRecord(
      statements.getRoundByDeploymentAndEpoch.get(normalizedDeploymentKey, normalizedEpoch),
    );

    if (!existing) {
      throw new Error("Stored deployed round was not found for this epoch.");
    }

    if (existing.status !== "deployed") {
      throw new Error("Only deployed rounds can be synced by epoch.");
    }

    const timestamp = normalizeIsoDate(updatedAt, new Date().toISOString());
    statements.updateDeployedDeadlineByEpoch.run({
      deploymentKey: normalizedDeploymentKey,
      epoch: normalizedEpoch,
      deadline: Number(deadline),
      updatedAt: timestamp,
    });

    return normalizeRoundRecord(statements.getRoundByDeploymentAndEpoch.get(normalizedDeploymentKey, normalizedEpoch));
  });

  return {
    saveDraftRound(round) {
      return saveDraftRound(round);
    },

    finalizeRoundDeployment(roundId, deploymentKey, deployment) {
      return finalizeRoundDeployment(roundId, deploymentKey, deployment);
    },

    updateDraftRoundDeadline(roundId, deploymentKey, deadline, updatedAt = null) {
      return updateDraftRoundDeadline(roundId, deploymentKey, deadline, updatedAt);
    },

    updateDeployedRoundDeadlineByEpoch(deploymentKey, epoch, deadline, updatedAt = null) {
      return updateDeployedRoundDeadlineByEpoch(deploymentKey, epoch, deadline, updatedAt);
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

    getRoundByEpoch(epoch, deploymentKey) {
      return normalizeRoundRecord(
        statements.getRoundByDeploymentAndEpoch.get(normalizeDeploymentKey(deploymentKey), Number(epoch)),
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
