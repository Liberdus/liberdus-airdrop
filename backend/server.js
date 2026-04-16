const crypto = require("node:crypto");
const fs = require("node:fs");
const http = require("node:http");
const path = require("node:path");

const dotenv = require("dotenv");
const { ethers } = require("ethers");
const { openDatabase, getDatabasePath } = require("./lib/db");
const { loadAppConfig, requireChainConfig } = require("./lib/app-config");
const { buildClaimRound } = require("./lib/claim-round");
const { createAirdropRoundStore } = require("./lib/airdrop-round-store");
const { verifyAirdropStartTransaction } = require("./lib/airdrop-chain");
const { createAccountStore } = require("./lib/x-account-store");
const { createRecoverySubmissionStore } = require("./lib/recovery-submission-store");

dotenv.config({ path: path.join(__dirname, "..", ".env"), quiet: true });

const HOST = process.env.X_AUTH_HOST || "127.0.0.1";
const PORT = Number.parseInt(process.env.X_AUTH_PORT || "8787", 10);
const DEFAULT_ALLOWED_ORIGIN = "http://127.0.0.1:5502";
const DEFAULT_FRONTEND_RETURN_URL = "http://127.0.0.1:5502/frontend/";
const DEFAULT_FOLLOWER_SNAPSHOT_FILE = path.join("cache", "x", "liberdus-followers.json");
const DEFAULT_RECOVERY_CANDIDATES_FILE = path.join("cache", "x", "missing-address-usernames.json");
const DEFAULT_RECOVERY_STORE_FILE = path.join("cache", "x", "recovery-links.json");
const REQUEST_TOKEN_URL = "https://api.x.com/oauth/request_token";
const AUTHORIZE_URL = "https://api.x.com/oauth/authorize";
const ACCESS_TOKEN_URL = "https://api.x.com/oauth/access_token";
const VERIFY_CREDENTIALS_URL = "https://api.x.com/1.1/account/verify_credentials.json";
const AUTH_COMPLETE_QUERY_PARAM = "x_auth";
const AUTH_COMPLETE_QUERY_VALUE = "complete";
const AUTH_ERROR_QUERY_PARAM = "x_error";
const AUTH_SESSION_COOKIE_NAME = "liberdus_x_session";
const AUTH_INIT_COOKIE_NAME = "liberdus_x_oauth_init";
const AUTH_SESSION_TTL_MS = 15 * 60 * 1000;
const REQUEST_TOKEN_TTL_MS = 10 * 60 * 1000;
const CHALLENGE_TTL_MS = 10 * 60 * 1000;
const MAX_JSON_BODY_BYTES = 32 * 1024;
const RATE_LIMITS = {
  start: { limit: 12, windowMs: 10 * 60 * 1000 },
  callback: { limit: 24, windowMs: 10 * 60 * 1000 },
  session: { limit: 120, windowMs: 60 * 1000 },
  challenge: { limit: 20, windowMs: 10 * 60 * 1000 },
  complete: { limit: 20, windowMs: 10 * 60 * 1000 },
  logout: { limit: 40, windowMs: 10 * 60 * 1000 },
  walletClaims: { limit: 120, windowMs: 60 * 1000 },
  rounds: { limit: 120, windowMs: 60 * 1000 },
  claimLookup: { limit: 120, windowMs: 60 * 1000 },
  finalizeRound: { limit: 20, windowMs: 10 * 60 * 1000 },
  health: { limit: 30, windowMs: 60 * 1000 },
};

const authSessions = new Map();
const requestTokens = new Map();
const linkChallenges = new Map();
const rateLimits = new Map();

class HttpError extends Error {
  constructor(statusCode, message, options = {}) {
    super(message);
    this.name = "HttpError";
    this.statusCode = statusCode;
    this.expose = options.expose !== false;
    this.headers = options.headers || {};
  }
}

function getRepoRoot() {
  return path.resolve(__dirname, "..");
}

function resolveRepoPath(filePath) {
  return path.resolve(getRepoRoot(), filePath);
}

function getApiKey() {
  return String(
    process.env.X_API_KEY
    || process.env.X_CONSUMER_KEY
    || process.env.X_APP_KEY
    || "",
  ).trim();
}

function getApiSecret() {
  return String(
    process.env.X_API_SECRET
    || process.env.X_API_SECRET_KEY
    || process.env.X_CONSUMER_SECRET
    || process.env.X_APP_SECRET
    || "",
  ).trim();
}

function getCallbackUrl() {
  return String(process.env.X_OAUTH1_CALLBACK_URL || "").trim();
}

function getAllowedOrigins() {
  const rawValue = String(process.env.X_AUTH_ALLOWED_ORIGINS || DEFAULT_ALLOWED_ORIGIN);
  return rawValue
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);
}

function normalizeUrlString(rawValue) {
  const value = String(rawValue || "").trim();
  if (!value) return "";

  const normalized = new URL(value);
  normalized.hash = "";
  return normalized.toString();
}

function getDefaultFrontendReturnUrl() {
  return normalizeUrlString(process.env.X_FRONTEND_RETURN_URL || DEFAULT_FRONTEND_RETURN_URL);
}

function getAllowedReturnUrls() {
  const rawValue = String(process.env.X_FRONTEND_RETURN_URLS || getDefaultFrontendReturnUrl());
  return rawValue
    .split(",")
    .map((value) => normalizeUrlString(value))
    .filter(Boolean);
}

function validateReturnUri(returnUri) {
  const normalized = normalizeUrlString(returnUri || getDefaultFrontendReturnUrl());
  if (!normalized) {
    throw new HttpError(400, "Frontend return URI is required.");
  }

  if (!getAllowedReturnUrls().includes(normalized)) {
    throw new HttpError(400, "Frontend return URI is not allowed.");
  }

  return normalized;
}

function getLegacyFollowerSnapshotPath() {
  return resolveRepoPath(process.env.X_FOLLOWER_SNAPSHOT_FILE || DEFAULT_FOLLOWER_SNAPSHOT_FILE);
}

function getLegacyRecoveryCandidatesPath() {
  return resolveRepoPath(process.env.X_RECOVERY_CANDIDATES_FILE || DEFAULT_RECOVERY_CANDIDATES_FILE);
}

function getLegacyRecoveryStorePath() {
  return resolveRepoPath(process.env.X_RECOVERY_STORE_FILE || DEFAULT_RECOVERY_STORE_FILE);
}

function getCookieSecureMode() {
  return String(process.env.X_AUTH_COOKIE_SECURE || "auto").trim().toLowerCase();
}

function shouldUseSecureCookies() {
  const mode = getCookieSecureMode();
  if (mode === "true") return true;
  if (mode === "false") return false;

  try {
    return new URL(getDefaultFrontendReturnUrl()).protocol === "https:";
  } catch {
    return false;
  }
}

function shouldTrustProxy() {
  return /^true$/iu.test(String(process.env.X_AUTH_TRUST_PROXY || "").trim());
}

const appConfig = loadAppConfig();
const db = openDatabase();
const accountStore = createAccountStore(db);
const recoverySubmissionStore = createRecoverySubmissionStore(db);
const airdropRoundStore = createAirdropRoundStore(db);

function createRandomToken(bytes = 32) {
  return crypto.randomBytes(bytes).toString("hex");
}

function hashValue(value) {
  return crypto.createHash("sha256").update(String(value || ""), "utf8").digest("hex");
}

function secureEquals(left, right) {
  const leftBuffer = Buffer.from(String(left || ""), "utf8");
  const rightBuffer = Buffer.from(String(right || ""), "utf8");
  if (leftBuffer.length !== rightBuffer.length) return false;
  return crypto.timingSafeEqual(leftBuffer, rightBuffer);
}

function parseCookies(request) {
  const rawCookie = String(request.headers.cookie || "");
  if (!rawCookie) return {};

  return rawCookie.split(";").reduce((cookies, chunk) => {
    const separatorIndex = chunk.indexOf("=");
    if (separatorIndex < 0) return cookies;
    const name = chunk.slice(0, separatorIndex).trim();
    const value = chunk.slice(separatorIndex + 1).trim();
    if (!name) return cookies;
    cookies[name] = decodeURIComponent(value);
    return cookies;
  }, {});
}

function appendSetCookie(response, cookieValue) {
  const existing = response.getHeader("Set-Cookie");
  if (!existing) {
    response.setHeader("Set-Cookie", [cookieValue]);
    return;
  }

  response.setHeader("Set-Cookie", Array.isArray(existing) ? [...existing, cookieValue] : [existing, cookieValue]);
}

function serializeCookie(name, value, options = {}) {
  const segments = [`${name}=${encodeURIComponent(value)}`];
  segments.push(`Path=${options.path || "/"}`);
  if (typeof options.maxAge === "number") {
    segments.push(`Max-Age=${Math.max(0, Math.floor(options.maxAge))}`);
  }
  if (options.httpOnly !== false) {
    segments.push("HttpOnly");
  }
  if (options.sameSite) {
    segments.push(`SameSite=${options.sameSite}`);
  }
  if (options.secure) {
    segments.push("Secure");
  }
  return segments.join("; ");
}

function setCookie(response, name, value, options = {}) {
  appendSetCookie(response, serializeCookie(name, value, options));
}

function clearCookie(response, name, options = {}) {
  appendSetCookie(response, serializeCookie(name, "", {
    ...options,
    maxAge: 0,
  }));
}

function getClientIp(request) {
  if (shouldTrustProxy()) {
    const forwarded = String(request.headers["x-forwarded-for"] || "").split(",")[0].trim();
    if (forwarded) return forwarded;
  }

  return String(request.socket?.remoteAddress || "");
}

function normalizeIpAddress(ipAddress) {
  const value = String(ipAddress || "").trim();
  if (value.startsWith("::ffff:")) {
    return value.slice(7);
  }
  return value;
}

function isLoopbackAddress(ipAddress) {
  const normalized = normalizeIpAddress(ipAddress);
  return normalized === "127.0.0.1" || normalized === "::1" || normalized === "localhost";
}

function getUserAgent(request) {
  return String(request.headers["user-agent"] || "").trim();
}

function setStandardHeaders(response) {
  response.setHeader("Referrer-Policy", "no-referrer");
  response.setHeader("X-Content-Type-Options", "nosniff");
  response.setHeader("Permissions-Policy", "interest-cohort=()");
  response.setHeader("Cross-Origin-Opener-Policy", "same-origin");
  response.setHeader("Cross-Origin-Resource-Policy", "same-site");
}

function getCorsOrigin(origin) {
  if (!origin) return "";
  return getAllowedOrigins().includes(origin) ? origin : "";
}

function setCorsHeaders(request, response) {
  const origin = getCorsOrigin(String(request.headers.origin || ""));
  if (!origin) return false;

  response.setHeader("Access-Control-Allow-Origin", origin);
  response.setHeader("Access-Control-Allow-Credentials", "true");
  response.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  response.setHeader("Access-Control-Allow-Headers", "Content-Type, X-CSRF-Token");
  response.setHeader("Access-Control-Max-Age", "600");
  response.setHeader("Vary", "Origin, Access-Control-Request-Headers");
  return true;
}

function requireAllowedOrigin(request, response) {
  const origin = String(request.headers.origin || "").trim();
  if (!origin) {
    throw new HttpError(403, "Origin is required.");
  }

  if (!setCorsHeaders(request, response)) {
    throw new HttpError(403, "Origin is not allowed.");
  }
}

function writeJson(response, statusCode, value, headers = {}) {
  response.writeHead(statusCode, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store, private, max-age=0",
    Pragma: "no-cache",
    "Content-Security-Policy": "default-src 'none'; base-uri 'none'; frame-ancestors 'none'",
    ...headers,
  });
  response.end(`${JSON.stringify(value)}\n`);
}

function redirect(response, location) {
  response.writeHead(302, {
    Location: location,
    "Cache-Control": "no-store, private, max-age=0",
    Pragma: "no-cache",
  });
  response.end();
}

function readJsonRequest(request) {
  return new Promise((resolve, reject) => {
    let rawBody = "";

    request.on("data", (chunk) => {
      rawBody += chunk;
      if (Buffer.byteLength(rawBody, "utf8") > MAX_JSON_BODY_BYTES) {
        reject(new HttpError(413, "Request body is too large."));
        request.destroy();
      }
    });

    request.on("end", () => {
      if (!rawBody) {
        resolve({});
        return;
      }

      try {
        resolve(JSON.parse(rawBody));
      } catch {
        reject(new HttpError(400, "Request body must be valid JSON."));
      }
    });

    request.on("error", reject);
  });
}

async function parseTextResponse(response) {
  return response.text();
}

function parseFormEncoded(text) {
  const params = new URLSearchParams(text);
  return Object.fromEntries(params.entries());
}

function percentEncode(value) {
  return encodeURIComponent(String(value))
    .replace(/[!'()*]/gu, (char) => `%${char.charCodeAt(0).toString(16).toUpperCase()}`);
}

function buildNormalizedParameterString(params) {
  return [...params]
    .map(([key, value]) => [percentEncode(key), percentEncode(value)])
    .sort((left, right) => {
      if (left[0] === right[0]) return left[1].localeCompare(right[1]);
      return left[0].localeCompare(right[0]);
    })
    .map(([key, value]) => `${key}=${value}`)
    .join("&");
}

function createSigningKey(consumerSecret, tokenSecret = "") {
  return `${percentEncode(consumerSecret)}&${percentEncode(tokenSecret)}`;
}

function buildSignature({ method, url, params, consumerSecret, tokenSecret = "" }) {
  const normalizedUrl = new URL(url);
  normalizedUrl.search = "";
  normalizedUrl.hash = "";

  const baseString = [
    method.toUpperCase(),
    percentEncode(normalizedUrl.toString()),
    percentEncode(buildNormalizedParameterString(params)),
  ].join("&");

  return crypto
    .createHmac("sha1", createSigningKey(consumerSecret, tokenSecret))
    .update(baseString)
    .digest("base64");
}

function createOAuthHeader(params) {
  const headerValue = [...params.entries()]
    .filter(([key]) => key.startsWith("oauth_"))
    .sort((left, right) => left[0].localeCompare(right[0]))
    .map(([key, value]) => `${percentEncode(key)}="${percentEncode(value)}"`)
    .join(", ");

  return `OAuth ${headerValue}`;
}

function buildOAuthParams(overrides = {}) {
  return new Map(Object.entries({
    oauth_consumer_key: getApiKey(),
    oauth_nonce: createRandomToken(16),
    oauth_signature_method: "HMAC-SHA1",
    oauth_timestamp: Math.floor(Date.now() / 1000).toString(),
    oauth_version: "1.0",
    ...overrides,
  }));
}

async function oauthRequest({ method, url, oauthOverrides = {}, requestParams = new Map(), tokenSecret = "" }) {
  const apiKey = getApiKey();
  const apiSecret = getApiSecret();
  if (!apiKey || !apiSecret) {
    throw new HttpError(500, "Missing X API key or API secret in .env.", { expose: false });
  }

  const oauthParams = buildOAuthParams(oauthOverrides);
  const signatureParams = new Map([...oauthParams.entries(), ...requestParams.entries()]);
  oauthParams.set("oauth_signature", buildSignature({
    method,
    url,
    params: signatureParams,
    consumerSecret: apiSecret,
    tokenSecret,
  }));

  const response = await fetch(url, {
    method,
    headers: {
      Authorization: createOAuthHeader(oauthParams),
      "Content-Length": "0",
    },
  });

  const text = await parseTextResponse(response);
  if (!response.ok) {
    console.error(`[OAuth 1.0a ${method} ${url}] HTTP ${response.status}: ${text}`);
    throw new HttpError(502, "X rejected the authentication request.", { expose: false });
  }

  return parseFormEncoded(text);
}

async function verifyCredentials(accessToken, accessTokenSecret) {
  const apiKey = getApiKey();
  const apiSecret = getApiSecret();
  const oauthParams = buildOAuthParams({
    oauth_consumer_key: apiKey,
    oauth_token: accessToken,
  });
  oauthParams.set("oauth_signature", buildSignature({
    method: "GET",
    url: VERIFY_CREDENTIALS_URL,
    params: oauthParams,
    consumerSecret: apiSecret,
    tokenSecret: accessTokenSecret,
  }));

  const response = await fetch(VERIFY_CREDENTIALS_URL, {
    method: "GET",
    headers: {
      Authorization: createOAuthHeader(oauthParams),
    },
  });

  const text = await parseTextResponse(response);
  if (!response.ok) {
    console.error(`[OAuth 1.0a GET ${VERIFY_CREDENTIALS_URL}] HTTP ${response.status}: ${text}`);
    throw new HttpError(502, "X user identity lookup failed.", { expose: false });
  }

  try {
    return JSON.parse(text);
  } catch {
    throw new HttpError(502, "X identity lookup returned invalid JSON.", { expose: false });
  }
}

function pruneExpiredState() {
  const now = Date.now();

  for (const [sessionId, session] of authSessions.entries()) {
    if (session.expiresAtMs <= now) {
      authSessions.delete(sessionId);
    }
  }

  for (const [requestToken, pending] of requestTokens.entries()) {
    if (pending.expiresAtMs <= now) {
      requestTokens.delete(requestToken);
    }
  }

  for (const [challengeId, challenge] of linkChallenges.entries()) {
    if (challenge.expiresAtMs <= now) {
      linkChallenges.delete(challengeId);
    }
  }

  for (const [key, bucket] of rateLimits.entries()) {
    if (bucket.resetAtMs <= now) {
      rateLimits.delete(key);
    }
  }
}

function consumeRateLimit(request, name) {
  const policy = RATE_LIMITS[name];
  if (!policy) return;

  pruneExpiredState();

  const key = `${name}:${normalizeIpAddress(getClientIp(request)) || "unknown"}`;
  const now = Date.now();
  const bucket = rateLimits.get(key);

  if (!bucket || bucket.resetAtMs <= now) {
    rateLimits.set(key, {
      count: 1,
      resetAtMs: now + policy.windowMs,
    });
    return;
  }

  if (bucket.count >= policy.limit) {
    throw new HttpError(429, "Too many requests. Try again shortly.", {
      headers: {
        "Retry-After": String(Math.max(1, Math.ceil((bucket.resetAtMs - now) / 1000))),
      },
    });
  }

  bucket.count += 1;
}

function requireWalletAddress(walletAddress) {
  const normalized = String(walletAddress || "").trim();
  if (!normalized) {
    throw new HttpError(400, "Wallet address is required.");
  }

  try {
    return ethers.getAddress(normalized);
  } catch {
    throw new HttpError(400, "Wallet address is invalid.");
  }
}

function deleteAuthSession(sessionId) {
  authSessions.delete(sessionId);
  for (const [challengeId, challenge] of linkChallenges.entries()) {
    if (challenge.sessionId === sessionId) {
      linkChallenges.delete(challengeId);
    }
  }
}

function getRequiredSessionFromCookie(request, response) {
  pruneExpiredState();

  const cookies = parseCookies(request);
  const sessionId = String(cookies[AUTH_SESSION_COOKIE_NAME] || "").trim();
  if (!sessionId) {
    throw new HttpError(401, "X session expired. Sign in again.");
  }

  const session = authSessions.get(sessionId);
  if (!session) {
    clearCookie(response, AUTH_SESSION_COOKIE_NAME, {
      path: "/api/x/",
      sameSite: "Lax",
      secure: shouldUseSecureCookies(),
    });
    throw new HttpError(401, "X session expired. Sign in again.");
  }

  if (session.expiresAtMs <= Date.now()) {
    deleteAuthSession(sessionId);
    clearCookie(response, AUTH_SESSION_COOKIE_NAME, {
      path: "/api/x/",
      sameSite: "Lax",
      secure: shouldUseSecureCookies(),
    });
    throw new HttpError(401, "X session expired. Sign in again.");
  }

  const userAgentHash = hashValue(getUserAgent(request));
  if (!secureEquals(session.userAgentHash, userAgentHash)) {
    deleteAuthSession(sessionId);
    clearCookie(response, AUTH_SESSION_COOKIE_NAME, {
      path: "/api/x/",
      sameSite: "Lax",
      secure: shouldUseSecureCookies(),
    });
    throw new HttpError(401, "X session could not be verified. Sign in again.");
  }

  return session;
}

function requireCsrf(request, session) {
  const csrfToken = String(request.headers["x-csrf-token"] || "").trim();
  if (!csrfToken || !secureEquals(session.csrfToken, csrfToken)) {
    throw new HttpError(403, "Request could not be verified.");
  }
}

function buildWalletLinkMessage({ profile, walletAddress, challengeId, issuedAt }) {
  return [
    "Liberdus follower recovery",
    "",
    `x.com username: @${profile.username}`,
    `X user ID: ${profile.id}`,
    `Wallet: ${walletAddress}`,
    `Challenge: ${challengeId}`,
    `Issued at: ${issuedAt}`,
    "",
    "Sign this message to prove wallet ownership for follower reward recovery.",
  ].join("\n");
}

function appendAuthQuery(returnUri, key, value) {
  const redirectUrl = new URL(returnUri);
  redirectUrl.searchParams.set(key, value);
  return redirectUrl.toString();
}

function appendErrorRedirect(returnUri, errorMessage) {
  return appendAuthQuery(returnUri, AUTH_ERROR_QUERY_PARAM, errorMessage);
}

function appendCompleteRedirect(returnUri) {
  return appendAuthQuery(returnUri, AUTH_COMPLETE_QUERY_PARAM, AUTH_COMPLETE_QUERY_VALUE);
}

function normalizeIdentityFromOAuth1(accessTokenResponse, verifiedCredentials = null) {
  const screenName = String(
    accessTokenResponse.screen_name
    || accessTokenResponse.screenName
    || verifiedCredentials?.screen_name
    || verifiedCredentials?.screenName
    || "",
  ).trim();
  const userId = String(
    accessTokenResponse.user_id
    || accessTokenResponse.userId
    || verifiedCredentials?.id_str
    || verifiedCredentials?.id
    || "",
  ).trim();
  const name = String(
    verifiedCredentials?.name
    || screenName,
  ).trim();

  if (!screenName || !userId) {
    throw new HttpError(502, "Could not determine the authenticated X user.", { expose: false });
  }

  return {
    id: userId,
    username: screenName,
    name: name || screenName,
    profile_image_url: String(
      verifiedCredentials?.profile_image_url_https
      || verifiedCredentials?.profile_image_url
      || "",
    ).trim(),
    verified: Boolean(verifiedCredentials?.verified),
    verified_type: String(verifiedCredentials?.verified_type || ""),
  };
}

function serializeAccountForClient(account) {
  if (!account) return null;

  return {
    id: account.id,
    xUserId: account.xUserId,
    username: account.usernameDisplay,
    walletAddress: account.walletAddress || "",
    walletSource: account.walletSource || "",
    isFollower: Boolean(account.isFollower),
    needsRecovery: Boolean(account.needsRecovery),
    firstSeenFollowingAt: account.firstSeenFollowingAt || null,
    lastSeenFollowingAt: account.lastSeenFollowingAt || null,
    snapshotsSeenCount: Number(account.snapshotsSeenCount || 0),
  };
}

function serializeSubmissionForClient(submission) {
  if (!submission) return null;

  return {
    id: submission.id,
    xUserId: submission.xUserId,
    usernameAtSubmission: submission.usernameAtSubmission,
    walletAddress: submission.walletAddress,
    wasKnownFollower: Boolean(submission.wasKnownFollower),
    wasRecoveryCandidate: Boolean(submission.wasRecoveryCandidate),
    status: submission.status || "",
    submittedAt: submission.submittedAt || null,
  };
}

function serializeAirdropRoundSummary(round) {
  if (!round) return null;

  return {
    deploymentKey: String(round.deploymentKey || "").trim(),
    epoch: Number(round.epoch || 0),
    merkleRoot: String(round.merkleRoot || "").trim(),
    deadline: Number(round.deadline || 0),
    claimCount: Number(round.claimCount || 0),
    totalAmountRaw: String(round.totalAmountRaw || "0"),
    decimals: Number(round.decimals || 18),
    chainId: Number(round.chainId || 0),
    contractAddress: String(round.contractAddress || "").trim(),
    sourceKind: String(round.sourceKind || "").trim(),
    startTxHash: String(round.startTxHash || "").trim(),
    startBlockNumber: round.startBlockNumber == null ? null : Number(round.startBlockNumber),
    startBlockHash: String(round.startBlockHash || "").trim(),
    createdAt: String(round.createdAt || "").trim(),
    updatedAt: String(round.updatedAt || "").trim(),
  };
}

function serializeAirdropWalletRound(round) {
  if (!round) return null;

  return {
    ...serializeAirdropRoundSummary(round),
    entry: round.entry
      ? {
        index: String(round.entry.index || ""),
        account: String(round.entry.account || "").trim(),
        amountRaw: String(round.entry.amountRaw || "0"),
        proof: Array.isArray(round.entry.proof) ? [...round.entry.proof] : [],
      }
      : null,
  };
}

function getExistingWalletMessage(account) {
  if (!account?.walletAddress) {
    return "";
  }

  if (account.walletSource === "form") {
    return `We already have a wallet on file for this X account: ${account.walletAddress}.`;
  }

  return "We already received a response for this X account.";
}

function getExistingRecoverySubmissionMessage() {
  return "We already received a response for this X account.";
}

function getRequiredDeploymentKey() {
  const deploymentKey = String(appConfig.deploymentKey || "").trim();
  if (!deploymentKey) {
    throw new HttpError(500, "Airdrop deployment key is not configured.", { expose: false });
  }

  return deploymentKey;
}

function getHealthPayload(request) {
  const basePayload = { ok: true };
  if (!isLoopbackAddress(getClientIp(request))) {
    return basePayload;
  }

  const accountStats = accountStore.getStats();
  const submissionStats = recoverySubmissionStore.getStats();
  const roundStats = airdropRoundStore.getStats();
  const deploymentKey = String(appConfig.deploymentKey || "").trim();
  const deploymentRoundStats = deploymentKey
    ? airdropRoundStore.getStats(deploymentKey)
    : { roundCount: 0, claimCount: 0 };

  return {
    ...basePayload,
    apiKeyConfigured: Boolean(getApiKey()),
    apiSecretConfigured: Boolean(getApiSecret()),
    callbackUrl: getCallbackUrl(),
    databasePath: getDatabasePath(),
    defaultFrontendReturnUrl: getDefaultFrontendReturnUrl(),
    allowedOrigins: getAllowedOrigins(),
    allowedReturnUrls: getAllowedReturnUrls(),
    legacyFollowerSnapshotPath: getLegacyFollowerSnapshotPath(),
    legacyRecoveryCandidatesPath: getLegacyRecoveryCandidatesPath(),
    legacyRecoveryStorePath: getLegacyRecoveryStorePath(),
    accountCount: accountStats.accountCount,
    followerCount: accountStats.followerCount,
    recoveryCandidateCount: accountStats.recoveryCandidateCount,
    latestSnapshotCapturedAt: accountStats.latestSnapshotCapturedAt,
    recoverySubmissionCount: submissionStats.submissionCount,
    airdropRoundCount: deploymentRoundStats.roundCount,
    airdropClaimCount: deploymentRoundStats.claimCount,
    airdropRoundCountTotal: roundStats.roundCount,
    airdropClaimCountTotal: roundStats.claimCount,
    chainId: appConfig.chainId,
    rpcUrlConfigured: Boolean(appConfig.rpcUrl),
    airdropAddress: appConfig.airdropAddress,
    deploymentKey: appConfig.deploymentKey,
    apiBaseUrl: appConfig.apiBaseUrl,
    claimsManifestPath: appConfig.claimsManifestPath,
    activeAuthSessions: authSessions.size,
    activeRequestTokens: requestTokens.size,
    activeChallenges: linkChallenges.size,
  };
}

function getPublicErrorMessage(error, fallback = "Request failed.") {
  if (error instanceof HttpError && error.expose) {
    return error.message;
  }
  return fallback;
}

async function handleStart(request, response) {
  const callbackUrl = getCallbackUrl();
  if (!callbackUrl) {
    throw new HttpError(500, "Missing X_OAUTH1_CALLBACK_URL in .env.", { expose: false });
  }

  const requestUrl = new URL(request.url, `http://${request.headers.host}`);
  const returnUri = validateReturnUri(requestUrl.searchParams.get("return_uri") || getDefaultFrontendReturnUrl());
  const initNonce = createRandomToken(24);
  const userAgentHash = hashValue(getUserAgent(request));

  const requestTokenResponse = await oauthRequest({
    method: "POST",
    url: REQUEST_TOKEN_URL,
    oauthOverrides: {
      oauth_callback: callbackUrl,
    },
  });

  if (!requestTokenResponse.oauth_token || !requestTokenResponse.oauth_token_secret) {
    throw new HttpError(502, "X did not return request-token credentials.", { expose: false });
  }

  requestTokens.set(requestTokenResponse.oauth_token, {
    tokenSecret: requestTokenResponse.oauth_token_secret,
    returnUri,
    initNonce,
    userAgentHash,
    createdAt: new Date().toISOString(),
    expiresAtMs: Date.now() + REQUEST_TOKEN_TTL_MS,
  });

  setCookie(response, AUTH_INIT_COOKIE_NAME, initNonce, {
    httpOnly: true,
    sameSite: "Lax",
    secure: shouldUseSecureCookies(),
    maxAge: Math.ceil(REQUEST_TOKEN_TTL_MS / 1000),
    path: "/api/x/callback",
  });

  const authorizeUrl = new URL(AUTHORIZE_URL);
  authorizeUrl.searchParams.set("oauth_token", requestTokenResponse.oauth_token);
  redirect(response, authorizeUrl.toString());
}

async function handleCallback(request, response) {
  const requestUrl = new URL(request.url, `http://${request.headers.host}`);
  const oauthToken = String(requestUrl.searchParams.get("oauth_token") || "").trim();
  const oauthVerifier = String(requestUrl.searchParams.get("oauth_verifier") || "").trim();
  const deniedToken = String(requestUrl.searchParams.get("denied") || "").trim();
  const cookies = parseCookies(request);

  if (deniedToken) {
    const deniedRequest = requestTokens.get(deniedToken);
    const returnUri = deniedRequest?.returnUri || getDefaultFrontendReturnUrl();
    requestTokens.delete(deniedToken);
    clearCookie(response, AUTH_INIT_COOKIE_NAME, {
      path: "/api/x/callback",
      sameSite: "Lax",
      secure: shouldUseSecureCookies(),
    });
    redirect(response, appendErrorRedirect(returnUri, "X authorization was denied."));
    return;
  }

  if (!oauthToken || !oauthVerifier) {
    throw new HttpError(400, "Callback did not include oauth_token and oauth_verifier.");
  }

  pruneExpiredState();
  const pending = requestTokens.get(oauthToken);
  if (!pending) {
    clearCookie(response, AUTH_INIT_COOKIE_NAME, {
      path: "/api/x/callback",
      sameSite: "Lax",
      secure: shouldUseSecureCookies(),
    });
    redirect(response, appendErrorRedirect(getDefaultFrontendReturnUrl(), "X sign-in session expired. Start again."));
    return;
  }

  requestTokens.delete(oauthToken);

  const initNonce = String(cookies[AUTH_INIT_COOKIE_NAME] || "").trim();
  if (!initNonce || !secureEquals(initNonce, pending.initNonce)) {
    clearCookie(response, AUTH_INIT_COOKIE_NAME, {
      path: "/api/x/callback",
      sameSite: "Lax",
      secure: shouldUseSecureCookies(),
    });
    redirect(response, appendErrorRedirect(pending.returnUri, "X sign-in session could not be verified. Start again."));
    return;
  }

  const callbackUserAgentHash = hashValue(getUserAgent(request));
  if (!secureEquals(callbackUserAgentHash, pending.userAgentHash)) {
    clearCookie(response, AUTH_INIT_COOKIE_NAME, {
      path: "/api/x/callback",
      sameSite: "Lax",
      secure: shouldUseSecureCookies(),
    });
    redirect(response, appendErrorRedirect(pending.returnUri, "X sign-in session could not be verified. Start again."));
    return;
  }

  try {
    const accessTokenResponse = await oauthRequest({
      method: "POST",
      url: ACCESS_TOKEN_URL,
      oauthOverrides: {
        oauth_token: oauthToken,
        oauth_verifier: oauthVerifier,
      },
      tokenSecret: pending.tokenSecret,
    });

    let verifiedCredentials = null;
    if (!accessTokenResponse.screen_name || !accessTokenResponse.user_id) {
      verifiedCredentials = await verifyCredentials(
        accessTokenResponse.oauth_token,
        accessTokenResponse.oauth_token_secret,
      );
    }

    const profile = normalizeIdentityFromOAuth1(accessTokenResponse, verifiedCredentials);
    const sessionId = createRandomToken(32);
    const csrfToken = createRandomToken(24);
    const authenticatedAt = new Date().toISOString();
    const expiresAtMs = Date.now() + AUTH_SESSION_TTL_MS;

    authSessions.set(sessionId, {
      sessionId,
      csrfToken,
      profile,
      authenticatedAt,
      expiresAtMs,
      userAgentHash: callbackUserAgentHash,
    });

    clearCookie(response, AUTH_INIT_COOKIE_NAME, {
      path: "/api/x/callback",
      sameSite: "Lax",
      secure: shouldUseSecureCookies(),
    });
    setCookie(response, AUTH_SESSION_COOKIE_NAME, sessionId, {
      httpOnly: true,
      sameSite: "Lax",
      secure: shouldUseSecureCookies(),
      maxAge: Math.ceil(AUTH_SESSION_TTL_MS / 1000),
      path: "/api/x/",
    });
    redirect(response, appendCompleteRedirect(pending.returnUri));
  } catch (error) {
    clearCookie(response, AUTH_INIT_COOKIE_NAME, {
      path: "/api/x/callback",
      sameSite: "Lax",
      secure: shouldUseSecureCookies(),
    });
    console.error("[OAuth 1.0a callback]", error);
    redirect(response, appendErrorRedirect(pending.returnUri, "Could not complete X sign-in. Start again."));
  }
}

async function handleSessionLookup(request, response) {
  const session = getRequiredSessionFromCookie(request, response);
  const account = accountStore.getAccountByProfile(session.profile);
  const existingSubmission = recoverySubmissionStore.getLatestSubmissionForProfile(session.profile);

  writeJson(response, 200, {
    profile: session.profile,
    authenticatedAt: session.authenticatedAt,
    expiresAt: session.expiresAtMs,
    csrfToken: session.csrfToken,
    account: serializeAccountForClient(account),
    existingSubmission: serializeSubmissionForClient(existingSubmission),
  });
}

async function handleWalletClaimsLookup(request, response, walletAddress) {
  const normalizedWalletAddress = requireWalletAddress(walletAddress);
  const rounds = airdropRoundStore.getWalletRounds(normalizedWalletAddress, getRequiredDeploymentKey());

  writeJson(response, 200, {
    walletAddress: normalizedWalletAddress,
    rounds: rounds.map((round) => serializeAirdropWalletRound(round)),
  });
}

async function handleRoundsLookup(response) {
  const rounds = airdropRoundStore.listRounds(getRequiredDeploymentKey());
  writeJson(response, 200, {
    rounds: rounds.map((round) => serializeAirdropRoundSummary(round)),
  });
}

async function handleClaimByEpochAndIndexLookup(response, epoch, claimIndex) {
  const normalizedEpoch = Number.parseInt(String(epoch || "").trim(), 10);
  const normalizedClaimIndex = Number.parseInt(String(claimIndex || "").trim(), 10);

  if (!Number.isInteger(normalizedEpoch) || normalizedEpoch <= 0) {
    throw new HttpError(400, "Epoch must be a positive integer.");
  }

  if (!Number.isInteger(normalizedClaimIndex) || normalizedClaimIndex < 0) {
    throw new HttpError(400, "Claim index must be zero or greater.");
  }

  const claim = airdropRoundStore.getClaimByEpochAndIndex(
    normalizedEpoch,
    normalizedClaimIndex,
    getRequiredDeploymentKey(),
  );
  if (!claim) {
    throw new HttpError(404, "Claim was not found.");
  }

  writeJson(response, 200, {
    round: serializeAirdropRoundSummary(claim),
    entry: serializeAirdropWalletRound(claim).entry,
  });
}

async function handleFinalizeAirdropRound(request, response) {
  const body = await readJsonRequest(request);
  const rawClaims = Array.isArray(body.claims)
    ? body.claims
    : Array.isArray(body.round?.claims)
      ? body.round.claims
      : null;
  const txHash = String(body.txHash || body.transactionHash || "").trim();
  const decimals = Number.parseInt(String(body.decimals || body.round?.decimals || appConfig.tokenDecimals || "18").trim(), 10);

  if (!rawClaims?.length) {
    throw new HttpError(400, "Claims payload is required.");
  }

  if (!Number.isInteger(decimals) || decimals < 0) {
    throw new HttpError(400, "Token decimals must be a non-negative integer.");
  }

  const builtRound = buildClaimRound(rawClaims, decimals);
  const chainConfig = requireChainConfig(appConfig);
  const verifiedRound = await verifyAirdropStartTransaction(chainConfig, txHash, builtRound.root);
  const savedRound = airdropRoundStore.upsertRound({
    deploymentKey: getRequiredDeploymentKey(),
    epoch: verifiedRound.epoch,
    merkleRoot: verifiedRound.merkleRoot,
    deadline: verifiedRound.deadline,
    claimCount: builtRound.claimCount,
    totalAmountRaw: builtRound.totalAmountRaw,
    decimals: builtRound.decimals,
    chainId: chainConfig.chainId,
    contractAddress: chainConfig.airdropAddress,
    sourceKind: "admin-finalized",
    startTxHash: verifiedRound.txHash,
    startBlockNumber: verifiedRound.blockNumber,
    startBlockHash: verifiedRound.blockHash,
    claims: builtRound.claims,
    updatedAt: new Date().toISOString(),
  });

  writeJson(response, 200, {
    round: serializeAirdropRoundSummary(savedRound),
  });
}

async function handleLinkChallenge(request, response) {
  const session = getRequiredSessionFromCookie(request, response);
  requireCsrf(request, session);
  const flags = accountStore.getFlagsForProfile(session.profile);
  const existingSubmission = recoverySubmissionStore.getLatestSubmissionForProfile(session.profile);

  if (flags.account?.walletAddress) {
    throw new HttpError(409, getExistingWalletMessage(flags.account));
  }

  if (existingSubmission) {
    throw new HttpError(409, getExistingRecoverySubmissionMessage());
  }

  const body = await readJsonRequest(request);
  const walletAddress = requireWalletAddress(body.walletAddress);
  const challengeId = createRandomToken(18);
  const issuedAt = new Date().toISOString();
  const message = buildWalletLinkMessage({
    profile: session.profile,
    walletAddress,
    challengeId,
    issuedAt,
  });

  for (const [existingId, challenge] of linkChallenges.entries()) {
    if (challenge.sessionId === session.sessionId && challenge.walletAddress === walletAddress) {
      linkChallenges.delete(existingId);
    }
  }

  linkChallenges.set(challengeId, {
    challengeId,
    sessionId: session.sessionId,
    walletAddress,
    message,
    issuedAt,
    expiresAtMs: Date.now() + CHALLENGE_TTL_MS,
  });

  writeJson(response, 200, {
    challengeId,
    message,
    expiresAt: Date.now() + CHALLENGE_TTL_MS,
  });
}

async function handleLinkComplete(request, response) {
  const session = getRequiredSessionFromCookie(request, response);
  requireCsrf(request, session);
  const flags = accountStore.getFlagsForProfile(session.profile);
  const existingSubmission = recoverySubmissionStore.getLatestSubmissionForProfile(session.profile);

  if (flags.account?.walletAddress) {
    throw new HttpError(409, getExistingWalletMessage(flags.account));
  }

  if (existingSubmission) {
    throw new HttpError(409, getExistingRecoverySubmissionMessage());
  }

  const body = await readJsonRequest(request);
  const challengeId = String(body.challengeId || "").trim();
  const walletAddress = requireWalletAddress(body.walletAddress);
  const signature = String(body.signature || "").trim();

  if (!challengeId || !signature) {
    throw new HttpError(400, "Request must include challengeId and signature.");
  }

  pruneExpiredState();
  const challenge = linkChallenges.get(challengeId);
  if (!challenge) {
    throw new HttpError(400, "Wallet challenge expired. Start again.");
  }

  if (challenge.sessionId !== session.sessionId) {
    throw new HttpError(403, "Wallet challenge does not match the signed-in X account.");
  }

  if (challenge.walletAddress !== walletAddress) {
    throw new HttpError(400, "Wallet challenge does not match the requested wallet.");
  }

  let recoveredAddress;
  try {
    recoveredAddress = ethers.verifyMessage(challenge.message, signature);
  } catch {
    throw new HttpError(400, "Wallet signature is invalid.");
  }

  if (ethers.getAddress(recoveredAddress) !== walletAddress) {
    throw new HttpError(400, "Wallet signature did not match the connected wallet.");
  }

  linkChallenges.delete(challengeId);
  const savedAt = new Date().toISOString();
  const knownAccount = accountStore.upsertAuthenticatedProfile(session.profile, savedAt);
  const walletAccount = flags.isRecoveryCandidate
    ? (accountStore.saveRecoveryWallet(session.profile, walletAddress, savedAt) || knownAccount)
    : knownAccount;
  const submissionId = crypto.randomUUID();

  recoverySubmissionStore.createSubmission({
    id: submissionId,
    accountId: walletAccount?.id || knownAccount?.id || flags.account?.id || null,
    xUserId: String(session.profile.id || "").trim(),
    usernameAtSubmission: String(session.profile.username || "").trim(),
    walletAddress,
    signedMessage: challenge.message,
    signature,
    wasKnownFollower: flags.isKnownFollower,
    wasRecoveryCandidate: flags.isRecoveryCandidate,
    status: "received",
    submittedAt: savedAt,
    createdAt: savedAt,
  });

  writeJson(response, 200, {
    recordId: submissionId,
    walletAddress,
    xUsername: String(session.profile.username || "").trim(),
    xUserId: String(session.profile.id || "").trim(),
    isKnownFollower: flags.isKnownFollower,
    isRecoveryCandidate: flags.isRecoveryCandidate,
    savedAt,
    account: serializeAccountForClient(walletAccount || knownAccount || flags.account),
    existingSubmission: serializeSubmissionForClient(
      recoverySubmissionStore.getLatestSubmissionForProfile(session.profile),
    ),
  });
}

async function handleLogout(request, response) {
  let session = null;
  try {
    session = getRequiredSessionFromCookie(request, response);
    requireCsrf(request, session);
  } catch (error) {
    if (!(error instanceof HttpError) || error.statusCode !== 401) {
      throw error;
    }
  }

  if (session) {
    deleteAuthSession(session.sessionId);
  }

  clearCookie(response, AUTH_SESSION_COOKIE_NAME, {
    path: "/api/x/",
    sameSite: "Lax",
    secure: shouldUseSecureCookies(),
  });

  writeJson(response, 200, { ok: true });
}

function handleOptions(request, response) {
  if (!setCorsHeaders(request, response)) {
    throw new HttpError(403, "Origin is not allowed.");
  }

  response.writeHead(204, {
    "Cache-Control": "no-store, private, max-age=0",
    Pragma: "no-cache",
  });
  response.end();
}

function handleError(response, error) {
  const statusCode = error instanceof HttpError ? error.statusCode : 500;
  const headers = error instanceof HttpError ? error.headers : {};
  if (!(error instanceof HttpError) || statusCode >= 500) {
    console.error("[Liberdus server]", error);
  }
  writeJson(response, statusCode, {
    error: getPublicErrorMessage(error, "Request failed."),
  }, headers);
}

const server = http.createServer(async (request, response) => {
  setStandardHeaders(response);

  try {
    const requestUrl = new URL(request.url, `http://${request.headers.host}`);
    const pathname = requestUrl.pathname;

    if (request.method === "OPTIONS") {
      handleOptions(request, response);
      return;
    }

    if (request.method === "GET" && pathname === "/health") {
      consumeRateLimit(request, "health");
      pruneExpiredState();
      writeJson(response, 200, getHealthPayload(request));
      return;
    }

    if (request.method === "GET" && pathname === "/api/x/start") {
      consumeRateLimit(request, "start");
      await handleStart(request, response);
      return;
    }

    if (request.method === "GET" && pathname === "/api/x/callback") {
      consumeRateLimit(request, "callback");
      await handleCallback(request, response);
      return;
    }

    if (request.method === "GET" && pathname === "/api/x/session") {
      requireAllowedOrigin(request, response);
      consumeRateLimit(request, "session");
      await handleSessionLookup(request, response);
      return;
    }

    if (request.method === "GET" && pathname.startsWith("/api/claims/wallet/")) {
      requireAllowedOrigin(request, response);
      consumeRateLimit(request, "walletClaims");
      await handleWalletClaimsLookup(request, response, decodeURIComponent(pathname.slice("/api/claims/wallet/".length)));
      return;
    }

    if (request.method === "GET" && pathname === "/api/airdrop/rounds") {
      requireAllowedOrigin(request, response);
      consumeRateLimit(request, "rounds");
      await handleRoundsLookup(response);
      return;
    }

    const claimLookupMatch = pathname.match(/^\/api\/airdrop\/epochs\/(\d+)\/claims\/(\d+)$/u);
    if (request.method === "GET" && claimLookupMatch) {
      requireAllowedOrigin(request, response);
      consumeRateLimit(request, "claimLookup");
      await handleClaimByEpochAndIndexLookup(response, claimLookupMatch[1], claimLookupMatch[2]);
      return;
    }

    if (request.method === "POST" && pathname === "/api/admin/airdrop-rounds/finalize") {
      requireAllowedOrigin(request, response);
      consumeRateLimit(request, "finalizeRound");
      await handleFinalizeAirdropRound(request, response);
      return;
    }

    if (request.method === "POST" && pathname === "/api/x/link/challenge") {
      requireAllowedOrigin(request, response);
      consumeRateLimit(request, "challenge");
      await handleLinkChallenge(request, response);
      return;
    }

    if (request.method === "POST" && pathname === "/api/x/link/complete") {
      requireAllowedOrigin(request, response);
      consumeRateLimit(request, "complete");
      await handleLinkComplete(request, response);
      return;
    }

    if (request.method === "POST" && pathname === "/api/x/logout") {
      requireAllowedOrigin(request, response);
      consumeRateLimit(request, "logout");
      await handleLogout(request, response);
      return;
    }

    writeJson(response, 404, { error: "Not found." });
  } catch (error) {
    handleError(response, error);
  }
});

server.listen(PORT, HOST, () => {
  const accountStats = accountStore.getStats();
  const submissionStats = recoverySubmissionStore.getStats();
  const deploymentKey = String(appConfig.deploymentKey || "").trim();
  const deploymentRoundStats = deploymentKey
    ? airdropRoundStore.getStats(deploymentKey)
    : { roundCount: 0, claimCount: 0 };
  console.log(`Liberdus server listening at http://${HOST}:${PORT}`);
  console.log(`SQLite path: ${getDatabasePath()}`);
  console.log(`Allowed origins: ${getAllowedOrigins().join(", ")}`);
  console.log(`Allowed return URLs: ${getAllowedReturnUrls().join(", ")}`);
  console.log(`API key configured: ${getApiKey() ? "yes" : "no"}`);
  console.log(`API secret configured: ${getApiSecret() ? "yes" : "no"}`);
  console.log(`OAuth 1 callback URL: ${getCallbackUrl() || "(missing)"}`);
  console.log(`Default frontend return URL: ${getDefaultFrontendReturnUrl()}`);
  console.log(`Secure cookies: ${shouldUseSecureCookies() ? "yes" : "no"}`);
  console.log(`X accounts in DB: ${accountStats.accountCount}`);
  console.log(`Current followers in DB: ${accountStats.followerCount}`);
  console.log(`Recovery candidates in DB: ${accountStats.recoveryCandidateCount}`);
  console.log(`Latest follower snapshot captured at: ${accountStats.latestSnapshotCapturedAt || "(none)"}`);
  console.log(`Recovery submissions in DB: ${submissionStats.submissionCount}`);
  console.log(`Backend deployment key: ${deploymentKey || "(missing)"}`);
  console.log(`Airdrop rounds in current deployment: ${deploymentRoundStats.roundCount}`);
  console.log(`Airdrop claims in current deployment: ${deploymentRoundStats.claimCount}`);
  console.log(`Backend chain config source: ${appConfig.sourcePath || "(env only)"}`);
  console.log(`Backend chain ID: ${appConfig.chainId ?? "(missing)"}`);
  console.log(`Backend RPC URL: ${appConfig.rpcUrl || "(missing)"}`);
  console.log(`Backend airdrop address: ${appConfig.airdropAddress || "(missing)"}`);
  console.log(`Legacy recovery submission import path: ${getLegacyRecoveryStorePath()}`);
  if (accountStats.followerCount === 0 && fs.existsSync(getLegacyFollowerSnapshotPath())) {
    console.log(`Follower DB is empty. Import a snapshot with: npm run followers:import`);
  }
  if (accountStats.recoveryCandidateCount === 0 && fs.existsSync(getLegacyRecoveryCandidatesPath())) {
    console.log(`Recovery candidate DB is empty. Import candidates with: npm run recovery-candidates:import`);
  }
  if (submissionStats.submissionCount === 0 && fs.existsSync(getLegacyRecoveryStorePath())) {
    console.log(`Recovery submissions DB is empty. Import legacy submissions with: npm run recovery-submissions:import`);
  }
});
