const fs = require("node:fs");
const path = require("node:path");

const { parse } = require("csv-parse/sync");

function normalizeUsername(username) {
  return String(username || "").trim().replace(/^@+/u, "").toLowerCase();
}

function normalizeIsoDate(value, fallbackValue = null) {
  const rawValue = String(value || "").trim();
  if (!rawValue) return fallbackValue;

  const date = new Date(rawValue);
  if (Number.isNaN(date.getTime())) return fallbackValue;
  return date.toISOString();
}

function parseBoolean(value) {
  const rawValue = String(value || "").trim().toLowerCase();
  return rawValue === "true" || rawValue === "1" || rawValue === "yes";
}

function parseInteger(value, fallbackValue = 0) {
  const parsed = Number.parseInt(String(value || "").trim(), 10);
  if (!Number.isFinite(parsed)) return fallbackValue;
  return parsed;
}

function readJsonFile(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function parseSnapshotHistory(rawValue) {
  try {
    const parsed = JSON.parse(rawValue || "[]");
    if (!Array.isArray(parsed)) return [];
    return [...new Set(parsed.map((value) => normalizeIsoDate(value)).filter(Boolean))].sort();
  } catch {
    return [];
  }
}

function serializeSnapshotHistory(values) {
  return JSON.stringify([...new Set(values.filter(Boolean))].sort());
}

function buildSnapshotHistory(existingAccount, capturedAt) {
  const normalizedCapturedAt = normalizeIsoDate(capturedAt);
  const existingHistory = existingAccount?.snapshotHistory || [];
  const history = [...new Set([...existingHistory, normalizedCapturedAt].filter(Boolean))].sort();
  const previousCount = Number(existingAccount?.snapshotsSeenCount || 0);
  const previousLatest = normalizeIsoDate(existingAccount?.latestSnapshotCapturedAt);
  const isExistingLatest = Boolean(previousLatest && previousLatest === normalizedCapturedAt);

  return {
    history,
    historyJson: serializeSnapshotHistory(history),
    firstSeenFollowingAt: normalizeIsoDate(
      existingAccount?.firstSeenFollowingAt,
      history[0] || normalizedCapturedAt || null,
    ) || history[0] || normalizedCapturedAt || null,
    lastSeenFollowingAt: [existingAccount?.lastSeenFollowingAt, normalizedCapturedAt]
      .map((value) => normalizeIsoDate(value))
      .filter(Boolean)
      .sort()
      .at(-1) || null,
    snapshotsSeenCount: normalizedCapturedAt
      ? Math.max(history.length, previousCount + (isExistingLatest ? 0 : 1))
      : Math.max(history.length, previousCount),
    latestSnapshotCapturedAt: [previousLatest, normalizedCapturedAt]
      .filter(Boolean)
      .sort()
      .at(-1) || null,
  };
}

function resolveSnapshotRollup(existingAccount, input) {
  if (input.snapshotCapturedAt) {
    return buildSnapshotHistory(existingAccount, input.snapshotCapturedAt);
  }

  const explicitHistory = Array.isArray(input.snapshotHistory)
    ? [...new Set(input.snapshotHistory.map((value) => normalizeIsoDate(value)).filter(Boolean))].sort()
    : null;
  const history = explicitHistory || existingAccount?.snapshotHistory || [];

  return {
    history,
    historyJson: serializeSnapshotHistory(history),
    firstSeenFollowingAt: normalizeIsoDate(
      input.firstSeenFollowingAt,
      existingAccount?.firstSeenFollowingAt || history[0] || null,
    ),
    lastSeenFollowingAt: normalizeIsoDate(
      input.lastSeenFollowingAt,
      existingAccount?.lastSeenFollowingAt || history[history.length - 1] || null,
    ),
    snapshotsSeenCount: parseInteger(
      input.snapshotsSeenCount,
      existingAccount?.snapshotsSeenCount || history.length || 0,
    ),
    latestSnapshotCapturedAt: normalizeIsoDate(
      input.latestSnapshotCapturedAt,
      existingAccount?.latestSnapshotCapturedAt || history[history.length - 1] || null,
    ),
  };
}

function normalizeFollowerSnapshot(rawSnapshot, options = {}) {
  const importedAt = normalizeIsoDate(options.importedAt, new Date().toISOString());
  const sourceUsernameDisplay = String(
    rawSnapshot?.username
    || rawSnapshot?.sourceUser?.username
    || options.sourceUsername
    || "",
  ).trim();
  const sourceUsernameNorm = normalizeUsername(sourceUsernameDisplay);

  if (!sourceUsernameNorm) {
    throw new Error("Follower snapshot is missing the source account username.");
  }

  const capturedAt = normalizeIsoDate(
    rawSnapshot?.completedAt
    || rawSnapshot?.updatedAt
    || rawSnapshot?.startedAt,
    importedAt,
  );
  const rawFollowers = Array.isArray(rawSnapshot?.followers) ? rawSnapshot.followers : [];
  const dedupedFollowers = new Map();

  for (const follower of rawFollowers) {
    const xUserId = String(follower?.id || "").trim();
    const usernameDisplay = String(follower?.username || "").trim().replace(/^@+/u, "");
    const usernameNorm = normalizeUsername(usernameDisplay);
    if (!xUserId || !usernameNorm) continue;

    dedupedFollowers.set(xUserId, {
      xUserId,
      usernameDisplay: usernameDisplay || usernameNorm,
      xAccountCreatedAt: normalizeIsoDate(follower?.created_at),
    });
  }

  return {
    sourceUsernameNorm,
    sourceUsernameDisplay,
    capturedAt,
    importedAt,
    followers: [...dedupedFollowers.values()],
  };
}

function loadJsonCandidates(filePath) {
  const rawValue = readJsonFile(filePath);
  if (Array.isArray(rawValue)) {
    return rawValue;
  }
  if (Array.isArray(rawValue?.usernames)) {
    return rawValue.usernames;
  }
  if (Array.isArray(rawValue?.records)) {
    return rawValue.records;
  }
  throw new Error("Recovery candidates JSON must be an array or an object with a usernames array.");
}

function normalizeRecoveryCandidates(filePath, options = {}) {
  const importedAt = normalizeIsoDate(options.importedAt, new Date().toISOString());
  const extension = path.extname(filePath).toLowerCase();
  const dedupedCandidates = new Map();

  if (extension === ".csv") {
    const rows = parse(fs.readFileSync(filePath, "utf8"), {
      columns: true,
      bom: true,
      skip_empty_lines: true,
      relax_column_count: true,
      trim: true,
    });

    for (const row of rows) {
      const usernameDisplay = String(
        row.api_username
        || row.username
        || row.x_username
        || "",
      ).trim().replace(/^@+/u, "");
      const usernameNorm = normalizeUsername(usernameDisplay);
      if (!usernameNorm) continue;

      dedupedCandidates.set(usernameNorm, {
        xUserId: String(row.api_user_id || row.x_user_id || row.user_id || "").trim(),
        usernameDisplay: usernameDisplay || usernameNorm,
        xAccountCreatedAt: normalizeIsoDate(row.api_created_at || row.created_at),
        apiVerified: parseBoolean(row.api_verified || row.verified),
        isRecentAccount: parseBoolean(
          row.api_created_on_or_after_2026_03_25
          || row.created_on_or_after_cutoff
          || row.is_recent_account,
        ),
      });
    }
  } else {
    for (const candidate of loadJsonCandidates(filePath)) {
      if (typeof candidate === "string") {
        const usernameDisplay = String(candidate).trim().replace(/^@+/u, "");
        const usernameNorm = normalizeUsername(usernameDisplay);
        if (!usernameNorm) continue;
        dedupedCandidates.set(usernameNorm, {
          xUserId: "",
          usernameDisplay: usernameDisplay || usernameNorm,
          xAccountCreatedAt: null,
          apiVerified: false,
          isRecentAccount: false,
        });
        continue;
      }

      if (!candidate || typeof candidate !== "object") {
        continue;
      }

      const usernameDisplay = String(
        candidate.username
        || candidate.xUsername
        || "",
      ).trim().replace(/^@+/u, "");
      const usernameNorm = normalizeUsername(usernameDisplay);
      if (!usernameNorm) continue;

      dedupedCandidates.set(usernameNorm, {
        xUserId: String(candidate.xUserId || candidate.userId || "").trim(),
        usernameDisplay: usernameDisplay || usernameNorm,
        xAccountCreatedAt: normalizeIsoDate(candidate.xCreatedAt || candidate.createdAt),
        apiVerified: Boolean(candidate.apiVerified || candidate.verified),
        isRecentAccount: Boolean(candidate.createdOnOrAfterCutoff),
      });
    }
  }

  return {
    importedAt,
    candidates: [...dedupedCandidates.values()],
  };
}

function normalizeCombinedAccounts(filePath, options = {}) {
  const importedAt = normalizeIsoDate(options.importedAt, new Date().toISOString());
  const rows = parse(fs.readFileSync(filePath, "utf8"), {
    columns: true,
    bom: true,
    skip_empty_lines: true,
    relax_column_count: true,
    trim: true,
  });
  const dedupedAccounts = new Map();

  for (const row of rows) {
    const xUserId = String(row.x_user_id || row.user_id || "").trim();
    const usernameDisplay = String(
      row.x_username
      || row.username
      || row.api_username
      || "",
    ).trim().replace(/^@+/u, "");
    const usernameNorm = normalizeUsername(usernameDisplay);

    if (!xUserId && !usernameNorm) {
      continue;
    }

    dedupedAccounts.set(xUserId || usernameNorm, {
      xUserId,
      usernameDisplay: usernameDisplay || usernameNorm,
      xAccountCreatedAt: normalizeIsoDate(row.x_account_created_at || row.created_at),
      isFollower: parseBoolean(row.is_follower),
      needsRecovery: parseBoolean(row.needs_recovery),
      walletAddress: String(row.wallet_address || "").trim(),
      walletSource: String(row.wallet_address || "").trim() ? "form" : null,
      firstSeenFollowingAt: normalizeIsoDate(row.first_seen_following_at),
      lastSeenFollowingAt: normalizeIsoDate(row.last_seen_following_at),
      snapshotsSeenCount: parseInteger(row.snapshots_seen_count, 0),
      latestSnapshotCapturedAt: normalizeIsoDate(row.latest_snapshot_captured_at),
      updatedAt: importedAt,
    });
  }

  return {
    importedAt,
    accounts: [...dedupedAccounts.values()],
  };
}

function pickWallet(existingRow, nextWalletAddress, nextWalletSource) {
  if (existingRow?.walletAddress) {
    return {
      walletAddress: existingRow.walletAddress,
      walletSource: existingRow?.walletSource || null,
    };
  }

  if (!nextWalletAddress || !nextWalletSource) {
    return {
      walletAddress: existingRow?.walletAddress || null,
      walletSource: existingRow?.walletSource || null,
    };
  }

  return {
    walletAddress: nextWalletAddress,
    walletSource: nextWalletSource,
  };
}

function toSqlParams(record) {
  return Object.fromEntries(
    Object.entries(record).map(([key, value]) => {
      if (value === undefined) return [key, null];
      if (typeof value === "boolean") return [key, value ? 1 : 0];
      return [key, value];
    }),
  );
}

function createAccountStore(db) {
  const statements = {
    getGlobalLatestSnapshot: db.prepare(`
      SELECT MAX(latest_snapshot_captured_at) AS latestSnapshotCapturedAt
      FROM x_accounts
      WHERE latest_snapshot_captured_at IS NOT NULL
    `),
    clearFollowerFlags: db.prepare(`
      UPDATE x_accounts
      SET is_follower = 0,
          updated_at = @updatedAt
    `),
    clearRecoveryFlags: db.prepare(`
      UPDATE x_accounts
      SET needs_recovery = 0,
          updated_at = @updatedAt
    `),
    listByUsernameNorm: db.prepare(`
      SELECT *
      FROM x_accounts
      WHERE LOWER(username_display) = ?
      ORDER BY datetime(updated_at) DESC, id DESC
    `),
    getByXUserId: db.prepare(`
      SELECT *
      FROM x_accounts
      WHERE x_user_id = ?
    `),
    getById: db.prepare(`
      SELECT *
      FROM x_accounts
      WHERE id = ?
    `),
    insertAccount: db.prepare(`
      INSERT INTO x_accounts (
        x_user_id,
        username_display,
        x_account_created_at,
        is_follower,
        needs_recovery,
        wallet_address,
        wallet_source,
        first_seen_following_at,
        last_seen_following_at,
        snapshots_seen_count,
        latest_snapshot_captured_at,
        snapshot_history_json,
        created_at,
        updated_at
      ) VALUES (
        @xUserId,
        @usernameDisplay,
        @xAccountCreatedAt,
        @isFollower,
        @needsRecovery,
        @walletAddress,
        @walletSource,
        @firstSeenFollowingAt,
        @lastSeenFollowingAt,
        @snapshotsSeenCount,
        @latestSnapshotCapturedAt,
        @snapshotHistoryJson,
        @createdAt,
        @updatedAt
      )
    `),
    updateAccount: db.prepare(`
      UPDATE x_accounts
      SET x_user_id = @xUserId,
          username_display = @usernameDisplay,
          x_account_created_at = @xAccountCreatedAt,
          is_follower = @isFollower,
          needs_recovery = @needsRecovery,
          wallet_address = @walletAddress,
          wallet_source = @walletSource,
          first_seen_following_at = @firstSeenFollowingAt,
          last_seen_following_at = @lastSeenFollowingAt,
          snapshots_seen_count = @snapshotsSeenCount,
          latest_snapshot_captured_at = @latestSnapshotCapturedAt,
          snapshot_history_json = @snapshotHistoryJson,
          updated_at = @updatedAt
      WHERE id = @id
    `),
    deleteAccount: db.prepare(`
      DELETE FROM x_accounts
      WHERE id = ?
    `),
    reassignSubmissions: db.prepare(`
      UPDATE recovery_submissions
      SET account_id = ?
      WHERE account_id = ?
    `),
    getCounts: db.prepare(`
      SELECT
        COUNT(*) AS accountCount,
        SUM(CASE WHEN is_follower = 1 THEN 1 ELSE 0 END) AS followerCount,
        SUM(CASE WHEN needs_recovery = 1 THEN 1 ELSE 0 END) AS recoveryCandidateCount,
        MAX(latest_snapshot_captured_at) AS latestSnapshotCapturedAt
      FROM x_accounts
    `),
  };

  function toAccountRecord(row) {
    if (!row) return null;
    return {
      id: Number(row.id),
      xUserId: String(row.x_user_id || "").trim(),
      usernameDisplay: String(row.username_display || "").trim(),
      xAccountCreatedAt: normalizeIsoDate(row.x_account_created_at),
      isFollower: Boolean(row.is_follower),
      needsRecovery: Boolean(row.needs_recovery),
      walletAddress: String(row.wallet_address || "").trim(),
      walletSource: String(row.wallet_source || "").trim(),
      firstSeenFollowingAt: normalizeIsoDate(row.first_seen_following_at),
      lastSeenFollowingAt: normalizeIsoDate(row.last_seen_following_at),
      snapshotsSeenCount: Number(row.snapshots_seen_count || 0),
      latestSnapshotCapturedAt: normalizeIsoDate(row.latest_snapshot_captured_at),
      snapshotHistory: parseSnapshotHistory(row.snapshot_history_json),
      createdAt: normalizeIsoDate(row.created_at),
      updatedAt: normalizeIsoDate(row.updated_at),
    };
  }

  function mergeAccounts(primaryRow, secondaryRow, updatedAt) {
    if (!primaryRow || !secondaryRow || primaryRow.id === secondaryRow.id) {
      return primaryRow;
    }

    const history = [...new Set([...primaryRow.snapshotHistory, ...secondaryRow.snapshotHistory])].sort();
    const preferredWallet = primaryRow.walletSource === "form"
      ? primaryRow
      : secondaryRow.walletSource === "form"
        ? secondaryRow
        : primaryRow.walletSource === "recovery"
          ? primaryRow
          : secondaryRow.walletSource === "recovery"
            ? secondaryRow
            : primaryRow;

    statements.updateAccount.run(toSqlParams({
      id: primaryRow.id,
      xUserId: primaryRow.xUserId || secondaryRow.xUserId || null,
      usernameDisplay: primaryRow.usernameDisplay || secondaryRow.usernameDisplay || "",
      xAccountCreatedAt: normalizeIsoDate(primaryRow.xAccountCreatedAt || secondaryRow.xAccountCreatedAt),
      isFollower: primaryRow.isFollower || secondaryRow.isFollower ? 1 : 0,
      needsRecovery: primaryRow.needsRecovery || secondaryRow.needsRecovery ? 1 : 0,
      walletAddress: preferredWallet.walletAddress || null,
      walletSource: preferredWallet.walletSource || null,
      firstSeenFollowingAt: history[0] || normalizeIsoDate(primaryRow.firstSeenFollowingAt || secondaryRow.firstSeenFollowingAt),
      lastSeenFollowingAt: history[history.length - 1] || normalizeIsoDate(primaryRow.lastSeenFollowingAt || secondaryRow.lastSeenFollowingAt),
      snapshotsSeenCount: history.length,
      latestSnapshotCapturedAt: history[history.length - 1] || normalizeIsoDate(primaryRow.latestSnapshotCapturedAt || secondaryRow.latestSnapshotCapturedAt),
      snapshotHistoryJson: serializeSnapshotHistory(history),
      updatedAt,
    }));
    statements.reassignSubmissions.run(primaryRow.id, secondaryRow.id);
    statements.deleteAccount.run(secondaryRow.id);
    return toAccountRecord(statements.getById.get(primaryRow.id));
  }

  function resolveExistingAccount(xUserId, usernameLookup, updatedAt) {
    const byUserId = xUserId ? toAccountRecord(statements.getByXUserId.get(xUserId)) : null;
    const byUsername = usernameLookup ? toAccountRecord(statements.listByUsernameNorm.get(usernameLookup)) : null;

    if (byUserId && byUsername && byUserId.id !== byUsername.id) {
      return mergeAccounts(byUserId, byUsername, updatedAt);
    }

    return byUserId || byUsername || null;
  }

  function saveAccount(input) {
    const updatedAt = normalizeIsoDate(input.updatedAt, new Date().toISOString());
    const usernameLookup = normalizeUsername(input.usernameDisplay || input.usernameNorm);
    const usernameDisplay = String(input.usernameDisplay || input.usernameNorm || "").trim().replace(/^@+/u, "");
    if (!usernameDisplay && !String(input.xUserId || "").trim()) {
      throw new Error("Account row requires an X user id or username.");
    }

    let existing = resolveExistingAccount(String(input.xUserId || "").trim(), usernameLookup, updatedAt);
    const historyState = resolveSnapshotRollup(existing, input);
    const preferredWallet = pickWallet(existing, input.walletAddress, input.walletSource);
    const record = {
      xUserId: String(input.xUserId || existing?.xUserId || "").trim() || null,
      usernameDisplay: usernameDisplay || existing?.usernameDisplay || input.xUserId || "",
      xAccountCreatedAt: normalizeIsoDate(input.xAccountCreatedAt || existing?.xAccountCreatedAt),
      isFollower: input.isFollower ?? existing?.isFollower ?? false,
      needsRecovery: input.needsRecovery ?? existing?.needsRecovery ?? false,
      walletAddress: preferredWallet.walletAddress || null,
      walletSource: preferredWallet.walletSource || null,
      firstSeenFollowingAt: historyState.firstSeenFollowingAt || null,
      lastSeenFollowingAt: historyState.lastSeenFollowingAt || null,
      snapshotsSeenCount: historyState.snapshotsSeenCount || 0,
      latestSnapshotCapturedAt: historyState.latestSnapshotCapturedAt || null,
      snapshotHistoryJson: historyState.historyJson,
      createdAt: existing?.createdAt || updatedAt,
      updatedAt,
    };

    if (!existing) {
      const insertResult = statements.insertAccount.run(toSqlParams(record));
      return toAccountRecord(statements.getById.get(insertResult.lastInsertRowid));
    }

    statements.updateAccount.run(toSqlParams({
      id: existing.id,
      ...record,
    }));
    return toAccountRecord(statements.getById.get(existing.id));
  }

  const importFollowerSnapshot = db.transaction((snapshot) => {
    const updatedAt = snapshot.importedAt;
    const currentLatest = normalizeIsoDate(statements.getGlobalLatestSnapshot.get()?.latestSnapshotCapturedAt);
    const becomesLatest = !currentLatest || snapshot.capturedAt >= currentLatest;

    if (becomesLatest) {
      statements.clearFollowerFlags.run({ updatedAt });
    }

    let importedCount = 0;
    for (const follower of snapshot.followers) {
      saveAccount({
        xUserId: follower.xUserId,
        usernameDisplay: follower.usernameDisplay,
        xAccountCreatedAt: follower.xAccountCreatedAt,
        snapshotCapturedAt: snapshot.capturedAt,
        isFollower: becomesLatest ? true : undefined,
        updatedAt,
      });
      importedCount += 1;
    }

    return {
      importedCount,
      becameLatest: becomesLatest,
      capturedAt: snapshot.capturedAt,
    };
  });

  const importRecoveryCandidates = db.transaction((candidateImport) => {
    const updatedAt = candidateImport.importedAt;
    statements.clearRecoveryFlags.run({ updatedAt });

    let importedCount = 0;
    for (const candidate of candidateImport.candidates) {
      saveAccount({
        xUserId: candidate.xUserId,
        usernameDisplay: candidate.usernameDisplay,
        xAccountCreatedAt: candidate.xAccountCreatedAt,
        needsRecovery: true,
        updatedAt,
      });
      importedCount += 1;
    }

    return {
      importedCount,
      importedAt: candidateImport.importedAt,
    };
  });

  const importCombinedAccounts = db.transaction((accountImport) => {
    const updatedAt = accountImport.importedAt;
    statements.clearFollowerFlags.run({ updatedAt });
    statements.clearRecoveryFlags.run({ updatedAt });

    let importedCount = 0;
    for (const account of accountImport.accounts) {
      saveAccount({
        xUserId: account.xUserId,
        usernameDisplay: account.usernameDisplay,
        xAccountCreatedAt: account.xAccountCreatedAt,
        isFollower: account.isFollower,
        needsRecovery: account.needsRecovery,
        walletAddress: account.walletAddress,
        walletSource: account.walletSource,
        firstSeenFollowingAt: account.firstSeenFollowingAt,
        lastSeenFollowingAt: account.lastSeenFollowingAt,
        snapshotsSeenCount: account.snapshotsSeenCount,
        latestSnapshotCapturedAt: account.latestSnapshotCapturedAt,
        updatedAt,
      });
      importedCount += 1;
    }

    return {
      importedCount,
      importedAt: accountImport.importedAt,
    };
  });

  return {
    normalizeFollowerSnapshotFromFile(filePath, options = {}) {
      return normalizeFollowerSnapshot(readJsonFile(filePath), options);
    },

    normalizeRecoveryCandidatesFromFile(filePath, options = {}) {
      return normalizeRecoveryCandidates(filePath, options);
    },

    normalizeCombinedAccountsFromFile(filePath, options = {}) {
      return normalizeCombinedAccounts(filePath, options);
    },

    importFollowerSnapshotFromFile(filePath, options = {}) {
      const resolvedPath = path.resolve(filePath);
      return importFollowerSnapshot(this.normalizeFollowerSnapshotFromFile(resolvedPath, options));
    },

    importRecoveryCandidatesFromFile(filePath, options = {}) {
      const resolvedPath = path.resolve(filePath);
      return importRecoveryCandidates(this.normalizeRecoveryCandidatesFromFile(resolvedPath, options));
    },

    importCombinedAccountsFromFile(filePath, options = {}) {
      const resolvedPath = path.resolve(filePath);
      return importCombinedAccounts(this.normalizeCombinedAccountsFromFile(resolvedPath, options));
    },

    getAccountByProfile(profile = {}) {
      return resolveExistingAccount(String(profile.id || "").trim(), normalizeUsername(profile.username), new Date().toISOString());
    },

    getFlagsForProfile(profile = {}) {
      const account = this.getAccountByProfile(profile);
      return {
        account,
        isKnownFollower: Boolean(account && (account.isFollower || account.snapshotsSeenCount > 0)),
        isRecoveryCandidate: Boolean(account?.needsRecovery),
      };
    },

    upsertAuthenticatedProfile(profile = {}, updatedAt = new Date().toISOString()) {
      return saveAccount({
        xUserId: String(profile.id || "").trim(),
        usernameDisplay: String(profile.username || "").trim(),
        updatedAt,
      });
    },

    saveRecoveryWallet(profile = {}, walletAddress, updatedAt = new Date().toISOString()) {
      const account = this.getAccountByProfile(profile);
      if (!account?.needsRecovery || account?.walletAddress) {
        return account;
      }

      return saveAccount({
        xUserId: String(profile.id || account.xUserId || "").trim(),
        usernameDisplay: String(profile.username || account.usernameDisplay || "").trim(),
        walletAddress,
        walletSource: "recovery",
        updatedAt,
      });
    },

    getStats() {
      const row = statements.getCounts.get() || {};
      return {
        accountCount: Number(row.accountCount || 0),
        followerCount: Number(row.followerCount || 0),
        recoveryCandidateCount: Number(row.recoveryCandidateCount || 0),
        latestSnapshotCapturedAt: normalizeIsoDate(row.latestSnapshotCapturedAt),
      };
    },
  };
}

module.exports = {
  createAccountStore,
  normalizeIsoDate,
  normalizeUsername,
};
