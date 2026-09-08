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

function importCampaignCandidate(store) {
  store.importCombinedAccountsCsv([
    `"${X_HEADER}",${WALLET_HEADER}`,
    "x.com/example_user,0x0000000000000000000000000000000000000001",
  ].join("\n"));
}

const campaignProfile = { id: "123456789", username: "example_user" };

test("campaign lookup skips unknown and non-campaign profiles", () => {
  withStore((store) => {
    assert.equal(store.isCampaignCandidate(campaignProfile), false);
    store.upsertAuthenticatedProfile(campaignProfile);
    assert.equal(store.isCampaignCandidate(campaignProfile), false);
    assert.equal(store.verifyCampaignProfile(campaignProfile, { status: "confirmed" }), null);
    importCampaignCandidate(store);
    assert.equal(store.isCampaignCandidate(campaignProfile), true);
  });
});

test("pending checks preserve confirmed campaign eligibility and snapshot evidence", () => {
  withStore((store) => {
    importCampaignCandidate(store);
    const checkedAt = "2026-09-03T12:00:00.000Z";
    store.verifyCampaignProfile(campaignProfile, { status: "confirmed", checkedAt }, checkedAt);
    const before = store.getAccountByProfile(campaignProfile);
    assert.equal(before.snapshotsSeenCount, 1);
    assert.equal(before.latestSnapshotCapturedAt, checkedAt);
    store.verifyCampaignProfile(campaignProfile, { status: "pending", checkedAt: null });
    const after = store.getAccountByProfile(campaignProfile);
    assert.equal(after.isFollower, true);
    assert.deepEqual(after.snapshotHistory, before.snapshotHistory);
    assert.equal(after.snapshotsSeenCount, before.snapshotsSeenCount);
    const eligible = store.listAccounts({ walletOnly: true });
    assert.equal(eligible.pagination.total, 1);
    assert.equal(eligible.accounts[0].campaignCandidate.followerCheckedAt, checkedAt);
    assert.equal(eligible.accounts[0].campaignCandidate.followerStatus, "confirmed");
  });
});

test("explicit not-following removes eligibility and pending checks do not restore it", () => {
  withStore((store) => {
    importCampaignCandidate(store);
    store.verifyCampaignProfile(campaignProfile, { status: "confirmed" });
    store.verifyCampaignProfile(campaignProfile, { status: "not_following" });
    store.verifyCampaignProfile(campaignProfile, { status: "pending" });
    assert.equal(store.getAccountByProfile(campaignProfile).isFollower, false);
    assert.equal(store.listAccounts({ walletOnly: true }).pagination.total, 0);
    assert.equal(store.listAccounts().accounts[0].campaignCandidate.followerStatus, "not_following");
  });
});

test("campaign import and pending login preserve existing flags without granting campaign eligibility", () => {
  withStore((store) => {
    store.saveAccount({
      xUserId: campaignProfile.id,
      usernameDisplay: campaignProfile.username,
      isFollower: true,
      needsRecovery: true,
      snapshotCapturedAt: "2026-09-01T12:00:00.000Z",
    });
    importCampaignCandidate(store);
    store.verifyCampaignProfile(campaignProfile, { status: "pending" });
    const account = store.getAccountByProfile(campaignProfile);
    assert.equal(account.isFollower, true);
    assert.equal(account.needsRecovery, true);
    assert.equal(account.snapshotsSeenCount, 1);
    assert.equal(store.listAccounts({ walletOnly: true }).pagination.total, 0);
    assert.equal(store.listAccounts().accounts[0].campaignCandidate.followerStatus, "pending");
  });
});
