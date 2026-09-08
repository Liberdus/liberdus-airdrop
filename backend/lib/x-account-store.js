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

function parseCsvText(csvText) {
  return parse(String(csvText || ""), {
    columns: true,
    bom: true,
    skip_empty_lines: true,
    relax_column_count: true,
    trim: true,
  });
}

const CAMPAIGN_HEADERS = {
  xProfile: "Follow @Liberdus on X, then please provided the link to your X profile page.",
  wallet: "What is your Binance Smart Chain address?",
  email: "Email Address",
};

function xUsernameFromProfile(value) {
  const rawValue = String(value || "").trim();
  const urlMatch = rawValue.match(/^(?:https?:\/\/)?(?:www\.)?(?:x|twitter)\.com\/([A-Za-z0-9_]{1,15})(?:[/?#].*)?$/iu);
  const usernameMatch = rawValue.match(/^@?([A-Za-z0-9_]{1,15})$/u);
  return normalizeUsername(urlMatch?.[1] || usernameMatch?.[1] || "");
}

function normalizeCampaignAccountsCsv(rows, headers, importedAt) {
  const missingHeaders = [CAMPAIGN_HEADERS.xProfile, CAMPAIGN_HEADERS.wallet]
    .filter((header) => !headers.includes(header));
  if (missingHeaders.length) {
    throw new Error(`Campaign CSV is missing required column(s): ${missingHeaders.join(", ")}`);
  }

  const rejected = [];
  const dedupedAccounts = new Map();
  for (const [index, row] of rows.entries()) {
    const usernameDisplay = xUsernameFromProfile(row[CAMPAIGN_HEADERS.xProfile]);
    const walletAddress = String(row[CAMPAIGN_HEADERS.wallet] || "").trim();
    const discordStatus = String(row["Discord Community Status"] || "").trim();
    const reasons = [];
    if (!usernameDisplay) reasons.push("invalid X profile");
    if (!/^0x[a-fA-F0-9]{40}$/u.test(walletAddress)) reasons.push("invalid wallet address");
    if (headers.includes("Discord Community Status") && discordStatus !== "CONFIRMED_MEMBER") {
      reasons.push("Discord membership is not confirmed");
    }
    if (reasons.length) {
      rejected.push({ rowNumber: index + 2, reasons });
      continue;
    }

    if (dedupedAccounts.has(usernameDisplay)) {
      rejected.push({ rowNumber: index + 2, reasons: ["duplicate X username"] });
      continue;
    }

    dedupedAccounts.set(usernameDisplay, {
      xUserId: "",
      usernameDisplay,
      isFollower: undefined,
      needsRecovery: undefined,
      walletAddress,
      walletSource: "form",
      updatedAt: importedAt,
      campaignCandidate: {
        submittedXUsername: usernameDisplay,
        submittedWalletAddress: walletAddress,
        submittedEmail: String(row[CAMPAIGN_HEADERS.email] || "").trim(),
        submissionJson: JSON.stringify(row),
        complianceStatus: "prevalidated",
        importedAt,
      },
    });
  }

  if (!dedupedAccounts.size) {
    throw new Error("Campaign CSV contained no importable candidates.");
  }

  return { accounts: [...dedupedAccounts.values()], rejected };
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
    const rows = parseCsvText(fs.readFileSync(filePath, "utf8"));

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

function normalizeCombinedAccountsCsv(csvText, options = {}) {
  const importedAt = normalizeIsoDate(options.importedAt, new Date().toISOString());
  const rows = parseCsvText(csvText);
  const headers = rows.length ? Object.keys(rows[0]) : [];
  const isCampaignCsv = headers.includes(CAMPAIGN_HEADERS.xProfile) || headers.includes(CAMPAIGN_HEADERS.wallet);

  if (isCampaignCsv) {
    const campaignImport = normalizeCampaignAccountsCsv(rows, headers, importedAt);
    return {
      importedAt,
      sourceFormat: "social-rewards-campaign",
      rejected: campaignImport.rejected,
      accounts: campaignImport.accounts,
    };
  }

  const hasAccountIdentityHeader = headers.some((header) => [
    "x_user_id", "user_id", "x_username", "username", "api_username",
  ].includes(header));
  if (!hasAccountIdentityHeader) {
    throw new Error("Accounts CSV must include an X username or X user ID column.");
  }
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
      snapshotHistory: parseSnapshotHistory(row.snapshot_history_json),
      firstSeenFollowingAt: normalizeIsoDate(row.first_seen_following_at),
      lastSeenFollowingAt: normalizeIsoDate(row.last_seen_following_at),
      snapshotsSeenCount: parseInteger(row.snapshots_seen_count, undefined),
      latestSnapshotCapturedAt: normalizeIsoDate(row.latest_snapshot_captured_at),
      updatedAt: importedAt,
    });
  }

  return {
    importedAt,
    sourceFormat: "combined-accounts",
    rejected: [],
    accounts: [...dedupedAccounts.values()],
  };
}

function normalizeCombinedAccounts(filePath, options = {}) {
  return normalizeCombinedAccountsCsv(fs.readFileSync(filePath, "utf8"), options);
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
    upsertCampaignCandidate: db.prepare(`
      INSERT INTO social_reward_candidates (
        account_id, submitted_x_username, submitted_wallet_address,
        submitted_email, submission_json, compliance_status,
        x_verification_status, follower_status, imported_at, updated_at
      ) VALUES (
        @accountId, @submittedXUsername, @submittedWalletAddress,
        @submittedEmail, @submissionJson, @complianceStatus,
        'pending', 'pending', @importedAt, @updatedAt
      )
      ON CONFLICT(submitted_x_username) DO UPDATE SET
        account_id = excluded.account_id,
        submitted_wallet_address = excluded.submitted_wallet_address,
        submitted_email = excluded.submitted_email,
        submission_json = excluded.submission_json,
        compliance_status = excluded.compliance_status,
        updated_at = excluded.updated_at
    `),
    getCampaignCandidateByAccountId: db.prepare(`
      SELECT * FROM social_reward_candidates WHERE account_id = ?
    `),
    verifyCampaignCandidate: db.prepare(`
      UPDATE social_reward_candidates
      SET authenticated_x_user_id = @xUserId,
          authenticated_x_username = @usernameDisplay,
          x_verification_status = 'verified',
          follower_status = @followerStatus,
          x_verified_at = @verifiedAt,
          follower_checked_at = @followerCheckedAt,
          updated_at = @verifiedAt
      WHERE account_id = @accountId
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
      campaignCandidate: row.campaign_x_verification_status == null ? null : {
        complianceStatus: String(row.campaign_compliance_status || ""),
        xVerificationStatus: String(row.campaign_x_verification_status || "pending"),
        followerStatus: String(row.campaign_follower_status || "pending"),
        xVerifiedAt: normalizeIsoDate(row.campaign_x_verified_at),
        followerCheckedAt: normalizeIsoDate(row.campaign_follower_checked_at),
      },
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

  function normalizeAccountQueryOptions(options = {}) {
    const requestedPage = Number.parseInt(String(options.page || "1").trim(), 10);
    const requestedPageSize = Number.parseInt(String(options.pageSize || "50").trim(), 10);
    const search = String(options.search || options.query || "").trim().toLowerCase();
    const walletOnly = parseBoolean(options.walletOnly || options.hasWallet);

    return {
      page: Number.isInteger(requestedPage) && requestedPage > 0 ? requestedPage : 1,
      pageSize: Number.isInteger(requestedPageSize)
        ? Math.min(Math.max(requestedPageSize, 1), 200)
        : 50,
      search,
      walletOnly,
    };
  }

  function buildAccountSearchState(options = {}) {
    const normalized = normalizeAccountQueryOptions(options);
    const hasSearch = Boolean(normalized.search);
    const filters = [];
    const sqlParams = {};

    if (hasSearch) {
      sqlParams.search = `%${normalized.search}%`;
      filters.push(`
        (
          LOWER(username_display) LIKE @search
          OR LOWER(COALESCE(x_user_id, '')) LIKE @search
          OR LOWER(COALESCE(wallet_address, '')) LIKE @search
        )
      `);
    }

    if (normalized.walletOnly) {
      filters.push(`TRIM(COALESCE(x_accounts.wallet_address, '')) <> ''`);
      filters.push(`
        (
          social_reward_candidates.id IS NULL
          OR (
            social_reward_candidates.x_verification_status = 'verified'
            AND social_reward_candidates.follower_status = 'confirmed'
          )
        )
      `);
    }

    return {
      ...normalized,
      sqlParams,
      whereClause: filters.length ? `WHERE ${filters.join("\n          AND ")}` : "",
    };
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
    if (accountImport.sourceFormat !== "social-rewards-campaign") {
      statements.clearFollowerFlags.run({ updatedAt });
      statements.clearRecoveryFlags.run({ updatedAt });
    }

    let importedCount = 0;
    for (const account of accountImport.accounts) {
      const savedAccount = saveAccount({
        xUserId: account.xUserId,
        usernameDisplay: account.usernameDisplay,
        xAccountCreatedAt: account.xAccountCreatedAt,
        isFollower: account.isFollower,
        needsRecovery: account.needsRecovery,
        walletAddress: account.walletAddress,
        walletSource: account.walletSource,
        snapshotHistory: account.snapshotHistory,
        firstSeenFollowingAt: account.firstSeenFollowingAt,
        lastSeenFollowingAt: account.lastSeenFollowingAt,
        snapshotsSeenCount: account.snapshotsSeenCount,
        latestSnapshotCapturedAt: account.latestSnapshotCapturedAt,
        updatedAt,
      });
      if (account.campaignCandidate) {
        statements.upsertCampaignCandidate.run({
          accountId: savedAccount.id,
          ...account.campaignCandidate,
          updatedAt,
        });
      }
      importedCount += 1;
    }

    return {
      importedCount,
      importedAt: accountImport.importedAt,
      sourceFormat: accountImport.sourceFormat,
      rejectedCount: accountImport.rejected?.length || 0,
      rejected: accountImport.rejected || [],
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

    normalizeCombinedAccountsCsv(csvText, options = {}) {
      return normalizeCombinedAccountsCsv(csvText, options);
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

    importCombinedAccountsCsv(csvText, options = {}) {
      return importCombinedAccounts(this.normalizeCombinedAccountsCsv(csvText, options));
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

    isCampaignCandidate(profile = {}) {
      const account = this.getAccountByProfile(profile);
      return Boolean(account && statements.getCampaignCandidateByAccountId.get(account.id));
    },

    verifyCampaignProfile(profile = {}, followerCheck = {}, verifiedAt = new Date().toISOString()) {
      const account = this.getAccountByProfile(profile);
      if (!account) return null;
      const candidate = statements.getCampaignCandidateByAccountId.get(account.id);
      if (!candidate) return null;

      const resolved = ["confirmed", "not_following"].includes(followerCheck.status);
      const followerStatus = resolved ? followerCheck.status : candidate.follower_status;
      const savedAccount = saveAccount({
        xUserId: String(profile.id || "").trim(),
        usernameDisplay: String(profile.username || "").trim(),
        isFollower: resolved ? followerCheck.status === "confirmed" : undefined,
        snapshotCapturedAt: followerCheck.status === "confirmed" ? verifiedAt : undefined,
        updatedAt: verifiedAt,
      });
      statements.verifyCampaignCandidate.run({
        accountId: savedAccount.id,
        xUserId: String(profile.id || "").trim(),
        usernameDisplay: String(profile.username || "").trim(),
        followerStatus,
        followerCheckedAt: resolved ? (followerCheck.checkedAt || verifiedAt) : candidate.follower_checked_at,
        verifiedAt,
      });
      return {
        account: savedAccount,
        followerStatus,
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

    saveAccount(input = {}) {
      return saveAccount(input);
    },

    listAccounts(options = {}) {
      const searchState = buildAccountSearchState(options);
      const totalRow = db.prepare(`
        SELECT COUNT(*) AS total
        FROM x_accounts
        LEFT JOIN social_reward_candidates
          ON social_reward_candidates.account_id = x_accounts.id
        ${searchState.whereClause}
      `).get(searchState.sqlParams) || {};
      const total = Number(totalRow.total || 0);
      const totalPages = total > 0 ? Math.ceil(total / searchState.pageSize) : 0;
      const page = totalPages > 0 ? Math.min(searchState.page, totalPages) : 1;
      const offset = (page - 1) * searchState.pageSize;
      const rows = db.prepare(`
        SELECT x_accounts.*,
               social_reward_candidates.compliance_status AS campaign_compliance_status,
               social_reward_candidates.x_verification_status AS campaign_x_verification_status,
               social_reward_candidates.follower_status AS campaign_follower_status,
               social_reward_candidates.x_verified_at AS campaign_x_verified_at,
               social_reward_candidates.follower_checked_at AS campaign_follower_checked_at
        FROM x_accounts
        LEFT JOIN social_reward_candidates
          ON social_reward_candidates.account_id = x_accounts.id
        ${searchState.whereClause}
        ORDER BY LOWER(username_display) ASC, x_accounts.id ASC
        LIMIT @limit OFFSET @offset
      `).all({
        ...searchState.sqlParams,
        limit: searchState.pageSize,
        offset,
      });

      return {
        accounts: rows.map((row) => toAccountRecord(row)),
        pagination: {
          page,
          pageSize: searchState.pageSize,
          total,
          totalPages,
          hasNextPage: totalPages > 0 && page < totalPages,
          hasPreviousPage: page > 1,
        },
      };
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

    getCampaignCandidateForProfile(profile = {}) {
      const account = this.getAccountByProfile(profile);
      if (!account) return null;
      const row = statements.getCampaignCandidateByAccountId.get(account.id);
      if (!row) return null;
      return {
        complianceStatus: String(row.compliance_status || ""),
        xVerificationStatus: String(row.x_verification_status || "pending"),
        followerStatus: String(row.follower_status || "pending"),
        xVerifiedAt: normalizeIsoDate(row.x_verified_at),
        followerCheckedAt: normalizeIsoDate(row.follower_checked_at),
      };
    },
  };
}

module.exports = {
  createAccountStore,
  normalizeIsoDate,
  normalizeUsername,
};
