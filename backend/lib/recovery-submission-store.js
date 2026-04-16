const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");

function readJsonFile(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function createRecoverySubmissionStore(db) {
  const statements = {
    insertSubmission: db.prepare(`
      INSERT INTO recovery_submissions (
        id,
        account_id,
        x_user_id,
        username_at_submission,
        wallet_address,
        signed_message,
        signature,
        was_known_follower,
        was_recovery_candidate,
        status,
        submitted_at,
        created_at
      ) VALUES (
        @id,
        @accountId,
        @xUserId,
        @usernameAtSubmission,
        @walletAddress,
        @signedMessage,
        @signature,
        @wasKnownFollower,
        @wasRecoveryCandidate,
        @status,
        @submittedAt,
        @createdAt
      )
    `),
    hasSubmissionId: db.prepare(`
      SELECT 1
      FROM recovery_submissions
      WHERE id = ?
      LIMIT 1
    `),
    getStats: db.prepare(`
      SELECT COUNT(*) AS submissionCount
      FROM recovery_submissions
    `),
    getLatestByUserId: db.prepare(`
      SELECT *
      FROM recovery_submissions
      WHERE x_user_id = ?
      ORDER BY datetime(submitted_at) DESC, rowid DESC
      LIMIT 1
    `),
    getLatestByUsername: db.prepare(`
      SELECT *
      FROM recovery_submissions
      WHERE LOWER(username_at_submission) = ?
      ORDER BY datetime(submitted_at) DESC, rowid DESC
      LIMIT 1
    `),
  };

  const createSubmission = db.transaction((submission) => {
    statements.insertSubmission.run({
      id: submission.id || crypto.randomUUID(),
      accountId: submission.accountId || null,
      xUserId: submission.xUserId,
      usernameAtSubmission: submission.usernameAtSubmission,
      walletAddress: submission.walletAddress,
      signedMessage: submission.signedMessage,
      signature: submission.signature,
      wasKnownFollower: submission.wasKnownFollower ? 1 : 0,
      wasRecoveryCandidate: submission.wasRecoveryCandidate ? 1 : 0,
      status: submission.status || "received",
      submittedAt: submission.submittedAt,
      createdAt: submission.createdAt || submission.submittedAt,
    });
  });

  return {
    createSubmission(submission) {
      createSubmission(submission);
    },

    importLegacyStore(filePath, accountStore) {
      const resolvedPath = path.resolve(filePath);
      const rawStore = readJsonFile(resolvedPath);
      const records = Array.isArray(rawStore?.records) ? rawStore.records : [];
      let importedCount = 0;

      const transaction = db.transaction(() => {
        for (const record of records) {
          if (!record?.id || statements.hasSubmissionId.get(record.id)) {
            continue;
          }

          const profile = {
            id: String(record.xUserId || "").trim(),
            username: String(record.xUsername || "").trim(),
            name: String(record.xName || record.xUsername || "").trim(),
          };
          const account = accountStore.upsertAuthenticatedProfile(profile, record.updatedAt || new Date().toISOString());

          if (record.isRecoveryCandidate && record.walletAddress) {
            accountStore.saveRecoveryWallet(profile, String(record.walletAddress).trim(), record.updatedAt || new Date().toISOString());
          }

          statements.insertSubmission.run({
            id: record.id,
            accountId: account?.id || null,
            xUserId: String(record.xUserId || "").trim(),
            usernameAtSubmission: String(record.xUsername || "").trim(),
            walletAddress: String(record.walletAddress || "").trim(),
            signedMessage: String(record.signedMessage || "").trim(),
            signature: String(record.signature || "").trim(),
            wasKnownFollower: record.isKnownFollower ? 1 : 0,
            wasRecoveryCandidate: record.isRecoveryCandidate ? 1 : 0,
            status: "legacy-import",
            submittedAt: String(record.updatedAt || record.createdAt || new Date().toISOString()),
            createdAt: String(record.createdAt || record.updatedAt || new Date().toISOString()),
          });
          importedCount += 1;
        }
      });

      transaction();
      return {
        importedCount,
        sourceFilePath: resolvedPath,
      };
    },

    getStats() {
      const row = statements.getStats.get() || {};
      return {
        submissionCount: Number(row.submissionCount || 0),
      };
    },

    getLatestSubmissionForProfile(profile = {}) {
      const xUserId = String(profile.id || "").trim();
      const username = String(profile.username || "").trim().replace(/^@+/u, "").toLowerCase();

      const row = (xUserId ? statements.getLatestByUserId.get(xUserId) : null)
        || (username ? statements.getLatestByUsername.get(username) : null);

      if (!row) {
        return null;
      }

      return {
        id: String(row.id || "").trim(),
        accountId: row.account_id == null ? null : Number(row.account_id),
        xUserId: String(row.x_user_id || "").trim(),
        usernameAtSubmission: String(row.username_at_submission || "").trim(),
        walletAddress: String(row.wallet_address || "").trim(),
        wasKnownFollower: Boolean(row.was_known_follower),
        wasRecoveryCandidate: Boolean(row.was_recovery_candidate),
        status: String(row.status || "").trim(),
        submittedAt: String(row.submitted_at || "").trim(),
      };
    },
  };
}

module.exports = {
  createRecoverySubmissionStore,
};
