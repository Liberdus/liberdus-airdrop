const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const { openDatabase } = require("../lib/db");
const { createAccountStore } = require("../lib/x-account-store");

const X_HEADER = "Follow @Liberdus on X, then please provided the link to your X profile page.";
const WALLET_HEADER = "What is your Binance Smart Chain address?";

function withStore(callback) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "liberdus-account-test-"));
  const previousPath = process.env.LIBERDUS_DB_PATH;
  process.env.LIBERDUS_DB_PATH = path.join(directory, "test.sqlite");
  const db = openDatabase();
  try {
    return callback(createAccountStore(db), db);
  } finally {
    db.close();
    if (previousPath == null) delete process.env.LIBERDUS_DB_PATH;
    else process.env.LIBERDUS_DB_PATH = previousPath;
  }
}

test("imports a prevalidated social rewards CSV and defers X verification", () => {
  withStore((store, db) => {
    const csv = [
      `"${X_HEADER}",${WALLET_HEADER},Email Address,Discord Community Status`,
      "x.com/example_user,0x0000000000000000000000000000000000000001,user@example.com,CONFIRMED_MEMBER",
    ].join("\n");
    const result = store.importCombinedAccountsCsv(csv);
    assert.equal(result.sourceFormat, "social-rewards-campaign");
    assert.equal(result.importedCount, 1);
    assert.equal(result.rejectedCount, 0);
    assert.equal(db.prepare("SELECT x_verification_status FROM social_reward_candidates").get().x_verification_status, "pending");
    const listed = store.listAccounts({ page: 1, pageSize: 10 }).accounts[0];
    assert.equal(listed.campaignCandidate.xVerificationStatus, "pending");
    assert.equal(store.listAccounts({ walletOnly: true }).pagination.total, 0);
  });
});

test("rejects an incompatible CSV instead of silently clearing account flags", () => {
  withStore((store) => {
    assert.throws(
      () => store.importCombinedAccountsCsv("Email Address,Wallet\nuser@example.com,0x123"),
      /X username or X user ID column/u,
    );
  });
});

test("fills the immutable X id and follower result after matching X authentication", () => {
  withStore((store, db) => {
    const csv = [
      `"${X_HEADER}",${WALLET_HEADER},Discord Community Status`,
      "https://x.com/example_user,0x0000000000000000000000000000000000000001,CONFIRMED_MEMBER",
    ].join("\n");
    store.importCombinedAccountsCsv(csv);
    store.verifyCampaignProfile(
      { id: "123456789", username: "example_user" },
      { status: "confirmed", checkedAt: "2026-09-03T12:00:00.000Z" },
      "2026-09-03T12:00:00.000Z",
    );
    const candidate = db.prepare("SELECT * FROM social_reward_candidates").get();
    assert.equal(candidate.authenticated_x_user_id, "123456789");
    assert.equal(candidate.x_verification_status, "verified");
    assert.equal(candidate.follower_status, "confirmed");
    assert.equal(store.getFlagsForProfile({ id: "123456789", username: "example_user" }).isKnownFollower, true);
    assert.equal(store.listAccounts({ walletOnly: true }).pagination.total, 1);
  });
});
