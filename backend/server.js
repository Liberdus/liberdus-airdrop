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
const { fetchAirdropOwner, verifyAirdropStartTransaction } = require("./lib/airdrop-chain");
const { createClaimSyncService } = require("./lib/claim-sync");
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
const ADMIN_ACCESS_HEADER_NAME = "x-admin-token";
const AUTH_SESSION_TTL_MS = 15 * 60 * 1000;
const ADMIN_ACCESS_SESSION_TTL_MS = 30 * 60 * 1000;
const REQUEST_TOKEN_TTL_MS = 10 * 60 * 1000;
const CHALLENGE_TTL_MS = 10 * 60 * 1000;
const ADMIN_ROUND_SAVE_CHALLENGE_TTL_MS = 10 * 60 * 1000;
const ADMIN_ACCESS_CHALLENGE_TTL_MS = 10 * 60 * 1000;
const MAX_JSON_BODY_BYTES = 32 * 1024;
const MAX_IMPORT_BODY_BYTES = 5 * 1024 * 1024;
const MAX_AIRDROP_ROUND_SAVE_BODY_BYTES = 5 * 1024 * 1024;
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
  roundClaims: { limit: 120, windowMs: 60 * 1000 },
  adminAccessChallenge: { limit: 20, windowMs: 10 * 60 * 1000 },
  adminAccessComplete: { limit: 20, windowMs: 10 * 60 * 1000 },
  adminAccountsRead: { limit: 120, windowMs: 60 * 1000 },
  adminAccountsImport: { limit: 20, windowMs: 10 * 60 * 1000 },
  adminAccountsWrite: { limit: 40, windowMs: 10 * 60 * 1000 },
  adminClaimReconcile: { limit: 10, windowMs: 10 * 60 * 1000 },
  adminSubmissionsRead: { limit: 120, windowMs: 60 * 1000 },
  adminSubmissionsImport: { limit: 20, windowMs: 10 * 60 * 1000 },
  adminSubmissionsExport: { limit: 20, windowMs: 10 * 60 * 1000 },
  adminDraftChallenge: { limit: 20, windowMs: 10 * 60 * 1000 },
  saveRound: { limit: 20, windowMs: 10 * 60 * 1000 },
  deployRound: { limit: 20, windowMs: 10 * 60 * 1000 },
  health: { limit: 30, windowMs: 60 * 1000 },
};

const authSessions = new Map();
const requestTokens = new Map();
const linkChallenges = new Map();
const adminAccessChallenges = new Map();
const adminAccessSessions = new Map();
const adminRoundSaveChallenges = new Map();
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

function getPublicXCallbackPath() {
  const callbackUrl = getCallbackUrl();
  if (!callbackUrl) {
    return "/api/x/callback";
  }

  try {
    const pathname = new URL(callbackUrl).pathname || "/api/x/callback";
    return pathname.startsWith("/") ? pathname : `/${pathname}`;
  } catch {
    return "/api/x/callback";
  }
}

function getPublicXCookieBasePath() {
  const callbackPath = getPublicXCallbackPath();
  if (callbackPath.endsWith("/callback")) {
    return callbackPath.slice(0, -"/callback".length + 1);
  }

  return "/api/x/";
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
let claimSyncService = null;

try {
  claimSyncService = createClaimSyncService({
    appConfig,
    airdropRoundStore,
    logger: {
      info(message) {
        console.log(`[claim-sync][server] ${message}`);
      },
      warn(message) {
        console.warn(`[claim-sync][server] ${message}`);
      },
      error(message) {
        console.error(`[claim-sync][server] ${message}`);
      },
    },
  });
} catch (error) {
  console.warn(`[claim-sync][server] disabled: ${error?.message || error}`);
}

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
  response.setHeader("Access-Control-Allow-Headers", "Content-Type, X-CSRF-Token, X-Admin-Token");
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

function writeText(response, statusCode, value, contentType = "text/plain; charset=utf-8", headers = {}) {
  response.writeHead(statusCode, {
    "Content-Type": contentType,
    "Cache-Control": "no-store, private, max-age=0",
    Pragma: "no-cache",
    "Content-Security-Policy": "default-src 'none'; base-uri 'none'; frame-ancestors 'none'",
    ...headers,
  });
  response.end(String(value || ""));
}

function redirect(response, location) {
  response.writeHead(302, {
    Location: location,
    "Cache-Control": "no-store, private, max-age=0",
    Pragma: "no-cache",
  });
  response.end();
}

function readJsonRequest(request, maxBytes = MAX_JSON_BODY_BYTES) {
  return new Promise((resolve, reject) => {
    let rawBody = "";
    let settled = false;

    const cleanup = () => {
      request.off("data", handleData);
      request.off("end", handleEnd);
      request.off("error", handleError);
    };

    const rejectOnce = (error) => {
      if (settled) return;
      settled = true;
      cleanup();
      reject(error);
    };

    const resolveOnce = (value) => {
      if (settled) return;
      settled = true;
      cleanup();
      resolve(value);
    };

    const handleData = (chunk) => {
      if (settled) return;
      rawBody += chunk;
      if (Buffer.byteLength(rawBody, "utf8") > maxBytes) {
        rawBody = "";
        rejectOnce(new HttpError(413, "Request body is too large."));
      }
    };

    const handleEnd = () => {
      if (settled) return;
      if (!rawBody) {
        resolveOnce({});
        return;
      }

      try {
        resolveOnce(JSON.parse(rawBody));
      } catch {
        rejectOnce(new HttpError(400, "Request body must be valid JSON."));
      }
    };

    const handleError = (error) => {
      rejectOnce(error);
    };

    request.on("data", handleData);
    request.on("end", handleEnd);
    request.on("error", handleError);
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

  for (const [challengeId, challenge] of adminAccessChallenges.entries()) {
    if (challenge.expiresAtMs <= now) {
      adminAccessChallenges.delete(challengeId);
    }
  }

  for (const [accessToken, session] of adminAccessSessions.entries()) {
    if (session.expiresAtMs <= now) {
      adminAccessSessions.delete(accessToken);
    }
  }

  for (const [challengeId, challenge] of adminRoundSaveChallenges.entries()) {
    if (challenge.expiresAtMs <= now) {
      adminRoundSaveChallenges.delete(challengeId);
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

function requireBytes32Hex(value, label) {
  const normalized = String(value || "").trim();
  if (!ethers.isHexString(normalized, 32)) {
    throw new HttpError(400, `${label} must be a 32-byte hex string.`);
  }

  return normalized.toLowerCase();
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
      path: getPublicXCookieBasePath(),
      sameSite: "Lax",
      secure: shouldUseSecureCookies(),
    });
    throw new HttpError(401, "X session expired. Sign in again.");
  }

  if (session.expiresAtMs <= Date.now()) {
    deleteAuthSession(sessionId);
    clearCookie(response, AUTH_SESSION_COOKIE_NAME, {
      path: getPublicXCookieBasePath(),
      sameSite: "Lax",
      secure: shouldUseSecureCookies(),
    });
    throw new HttpError(401, "X session expired. Sign in again.");
  }

  const userAgentHash = hashValue(getUserAgent(request));
  if (!secureEquals(session.userAgentHash, userAgentHash)) {
    deleteAuthSession(sessionId);
    clearCookie(response, AUTH_SESSION_COOKIE_NAME, {
      path: getPublicXCookieBasePath(),
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

function parseBooleanInput(value) {
  if (typeof value === "boolean") {
    return value;
  }

  const normalized = String(value || "").trim().toLowerCase();
  return normalized === "true" || normalized === "1" || normalized === "yes" || normalized === "on";
}

function parsePositiveInteger(value, fallbackValue, { min = 1, max = Number.MAX_SAFE_INTEGER } = {}) {
  const parsed = Number.parseInt(String(value ?? "").trim(), 10);
  if (!Number.isInteger(parsed)) {
    return fallbackValue;
  }

  return Math.min(Math.max(parsed, min), max);
}

function formatDownloadTimestamp(value = new Date()) {
  return value.toISOString().replace(/[:.]/gu, "-");
}

function escapeCsvCell(value) {
  const normalized = value == null ? "" : String(value);
  if (!/[",\r\n]/u.test(normalized)) {
    return normalized;
  }

  return `"${normalized.replace(/"/gu, "\"\"")}"`;
}

function buildCsv(headers, rows) {
  const lines = [
    headers.map((header) => escapeCsvCell(header)).join(","),
    ...rows.map((row) => row.map((value) => escapeCsvCell(value)).join(",")),
  ];
  return `${lines.join("\n")}\n`;
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

function buildAdminAccessMessage({ walletAddress, challengeId, issuedAt, chainId, contractAddress }) {
  return [
    "Liberdus admin access",
    "",
    `Wallet: ${walletAddress}`,
    `Chain ID: ${chainId}`,
    `Contract: ${contractAddress}`,
    `Challenge: ${challengeId}`,
    `Issued at: ${issuedAt}`,
    "",
    "Sign this message to access follower and recovery submission management.",
  ].join("\n");
}

function buildAdminRoundSaveMessage({
  walletAddress,
  merkleRoot,
  deadline,
  challengeId,
  issuedAt,
  chainId,
  contractAddress,
  deploymentKey,
}) {
  return [
    "Liberdus admin airdrop draft save",
    "",
    `Wallet: ${walletAddress}`,
    `Chain ID: ${chainId}`,
    `Contract: ${contractAddress}`,
    `Deployment key: ${deploymentKey}`,
    `Merkle root: ${merkleRoot}`,
    `Deadline: ${deadline}`,
    `Challenge: ${challengeId}`,
    `Issued at: ${issuedAt}`,
    "",
    "Sign this message to authorize saving this airdrop draft to the backend.",
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

function serializeAdminAccount(account) {
  if (!account) return null;

  return {
    ...serializeAccountForClient(account),
    claimedRoundCount: Number(account.claimedRoundCount || 0),
    totalClaimedAmountRaw: String(account.totalClaimedAmountRaw || "0"),
    xAccountCreatedAt: account.xAccountCreatedAt || null,
    latestSnapshotCapturedAt: account.latestSnapshotCapturedAt || null,
    createdAt: account.createdAt || null,
    updatedAt: account.updatedAt || null,
  };
}

function serializeAdminSubmission(submission) {
  if (!submission) return null;

  return {
    ...serializeSubmissionForClient(submission),
    accountId: submission.accountId == null ? null : Number(submission.accountId),
    createdAt: submission.createdAt || null,
  };
}

function buildAdminSummary() {
  const accountStats = accountStore.getStats();
  const submissionStats = recoverySubmissionStore.getStats();

  return {
    accountCount: accountStats.accountCount,
    followerCount: accountStats.followerCount,
    recoveryCandidateCount: accountStats.recoveryCandidateCount,
    latestSnapshotCapturedAt: accountStats.latestSnapshotCapturedAt,
    recoverySubmissionCount: submissionStats.submissionCount,
  };
}

function serializeAirdropRoundSummary(round) {
  if (!round) return null;

  return {
    id: Number(round.id || 0),
    deploymentKey: String(round.deploymentKey || "").trim(),
    status: String(round.status || "").trim(),
    epoch: round.epoch == null ? null : Number(round.epoch),
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
    claimedCount: Number(round.claimedCount || 0),
    claimedAmountRaw: String(round.claimedAmountRaw || "0"),
    claimsSyncedThroughBlock: round.claimsSyncedThroughBlock == null
      ? null
      : Number(round.claimsSyncedThroughBlock),
    claimsLastReconciledAt: String(round.claimsLastReconciledAt || "").trim() || null,
    createdAt: String(round.createdAt || "").trim(),
    updatedAt: String(round.updatedAt || "").trim(),
  };
}

function serializeAirdropClaimEntry(entry) {
  if (!entry) return null;

  return {
    id: Number(entry.id || 0),
    index: String(entry.index || ""),
    account: String(entry.account || "").trim(),
    amountRaw: String(entry.amountRaw || "0"),
    proof: Array.isArray(entry.proof) ? [...entry.proof] : [],
    usernameDisplay: String(entry.usernameDisplay || "").trim() || null,
    claimedAt: entry.claimedAt || null,
    claimedTxHash: String(entry.claimedTxHash || "").trim() || null,
    claimedBlockNumber: entry.claimedBlockNumber == null ? null : Number(entry.claimedBlockNumber),
    claimedBlockHash: String(entry.claimedBlockHash || "").trim() || null,
    claimedLogIndex: entry.claimedLogIndex == null ? null : Number(entry.claimedLogIndex),
    createdAt: entry.createdAt || null,
    updatedAt: entry.updatedAt || null,
  };
}

function serializeAirdropWalletRound(round) {
  if (!round) return null;

  return {
    ...serializeAirdropRoundSummary(round),
    entry: serializeAirdropClaimEntry(round.entry),
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

function getRequiredAdminRoundSaveChallenge(body) {
  const challengeId = String(body?.challengeId || "").trim();
  if (!challengeId) {
    throw new HttpError(400, "Admin round save request must include challengeId.");
  }

  pruneExpiredState();
  const challenge = adminRoundSaveChallenges.get(challengeId);
  if (!challenge) {
    throw new HttpError(400, "Admin round save challenge expired. Start again.");
  }

  return challenge;
}

function getRequiredAdminAccessChallenge(body) {
  const challengeId = String(body?.challengeId || "").trim();
  if (!challengeId) {
    throw new HttpError(400, "Admin access request must include challengeId.");
  }

  pruneExpiredState();
  const challenge = adminAccessChallenges.get(challengeId);
  if (!challenge) {
    throw new HttpError(400, "Admin access challenge expired. Start again.");
  }

  return challenge;
}

function getRequiredAdminAccessSession(request) {
  pruneExpiredState();
  const accessToken = String(request.headers[ADMIN_ACCESS_HEADER_NAME] || "").trim();
  if (!accessToken) {
    throw new HttpError(401, "Admin access token is required.");
  }

  const session = adminAccessSessions.get(accessToken);
  if (!session) {
    throw new HttpError(401, "Admin access expired. Sign again.");
  }

  return session;
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
    path: getPublicXCallbackPath(),
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
      path: getPublicXCallbackPath(),
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
      path: getPublicXCallbackPath(),
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
      path: getPublicXCallbackPath(),
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
      path: getPublicXCallbackPath(),
      sameSite: "Lax",
      secure: shouldUseSecureCookies(),
    });
    setCookie(response, AUTH_SESSION_COOKIE_NAME, sessionId, {
      httpOnly: true,
      sameSite: "Lax",
      secure: shouldUseSecureCookies(),
      maxAge: Math.ceil(AUTH_SESSION_TTL_MS / 1000),
      path: getPublicXCookieBasePath(),
    });
    redirect(response, appendCompleteRedirect(pending.returnUri));
  } catch (error) {
    clearCookie(response, AUTH_INIT_COOKIE_NAME, {
      path: getPublicXCallbackPath(),
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
  const deploymentKey = getRequiredDeploymentKey();
  const rounds = airdropRoundStore.listRounds(deploymentKey);
  writeJson(response, 200, {
    rounds: rounds.map((round) => serializeAirdropRoundSummary(round)),
    summary: airdropRoundStore.getClaimSyncSummary(deploymentKey),
  });
}

async function handleAdminAccessChallenge(request, response) {
  const body = await readJsonRequest(request);
  const walletAddress = requireWalletAddress(body.walletAddress);
  const chainConfig = requireChainConfig(appConfig);
  const currentOwner = await fetchAirdropOwner(chainConfig);

  if (ethers.getAddress(currentOwner) !== walletAddress) {
    throw new HttpError(403, "Only the current contract owner can access follower management.");
  }

  const challengeId = createRandomToken(18);
  const issuedAt = new Date().toISOString();
  const message = buildAdminAccessMessage({
    walletAddress,
    challengeId,
    issuedAt,
    chainId: chainConfig.chainId,
    contractAddress: chainConfig.airdropAddress,
  });

  adminAccessChallenges.set(challengeId, {
    challengeId,
    walletAddress,
    message,
    issuedAt,
    expiresAtMs: Date.now() + ADMIN_ACCESS_CHALLENGE_TTL_MS,
  });

  writeJson(response, 200, {
    challengeId,
    message,
    expiresAt: Date.now() + ADMIN_ACCESS_CHALLENGE_TTL_MS,
    walletAddress,
  });
}

async function handleAdminAccessComplete(request, response) {
  const body = await readJsonRequest(request);
  const challenge = getRequiredAdminAccessChallenge(body);
  const walletAddress = requireWalletAddress(body.walletAddress);
  const signature = String(body.signature || "").trim();

  if (!signature) {
    throw new HttpError(400, "Admin access request must include a wallet signature.");
  }

  if (challenge.walletAddress !== walletAddress) {
    throw new HttpError(400, "Admin access challenge does not match the signing wallet.");
  }

  let recoveredAddress;
  try {
    recoveredAddress = ethers.verifyMessage(challenge.message, signature);
  } catch {
    throw new HttpError(400, "Admin access signature is invalid.");
  }

  if (ethers.getAddress(recoveredAddress) !== walletAddress) {
    throw new HttpError(403, "Admin access signature did not match the supplied wallet.");
  }

  const chainConfig = requireChainConfig(appConfig);
  const currentOwner = await fetchAirdropOwner(chainConfig);
  if (ethers.getAddress(currentOwner) !== walletAddress) {
    throw new HttpError(403, "Only the current contract owner can access follower management.");
  }

  adminAccessChallenges.delete(challenge.challengeId);

  const accessToken = createRandomToken(24);
  const session = {
    accessToken,
    walletAddress,
    createdAt: new Date().toISOString(),
    expiresAtMs: Date.now() + ADMIN_ACCESS_SESSION_TTL_MS,
  };
  adminAccessSessions.set(accessToken, session);

  writeJson(response, 200, {
    accessToken,
    walletAddress,
    expiresAt: session.expiresAtMs,
  });
}

function getAdminListOptions(requestUrl) {
  return {
    page: parsePositiveInteger(requestUrl.searchParams.get("page"), 1, { min: 1, max: 10000 }),
    pageSize: parsePositiveInteger(requestUrl.searchParams.get("pageSize"), 50, { min: 1, max: 200 }),
    search: String(requestUrl.searchParams.get("query") || "").trim(),
    walletOnly: parseBooleanInput(requestUrl.searchParams.get("walletOnly")),
  };
}

async function handleAdminAccountsLookup(request, response, requestUrl) {
  getRequiredAdminAccessSession(request);
  const result = accountStore.listAccounts(getAdminListOptions(requestUrl));
  const deploymentKey = String(appConfig.deploymentKey || "").trim();
  const walletClaimSummaries = deploymentKey
    ? airdropRoundStore.getWalletClaimSummaries(
      result.accounts.map((account) => account.walletAddress).filter(Boolean),
      deploymentKey,
    )
    : new Map();

  writeJson(response, 200, {
    summary: buildAdminSummary(),
    pagination: result.pagination,
    accounts: result.accounts.map((account) => {
      const summary = account.walletAddress
        ? walletClaimSummaries.get(String(account.walletAddress || "").trim().toLowerCase()) || null
        : null;
      return serializeAdminAccount({
        ...account,
        claimedRoundCount: Number(summary?.claimedCount || 0),
        totalClaimedAmountRaw: String(summary?.totalClaimedAmountRaw || "0"),
      });
    }),
  });
}

async function handleAdminClaimReconcile(request, response) {
  getRequiredAdminAccessSession(request);
  if (!claimSyncService) {
    throw new HttpError(503, "Claim sync is not configured on this server.");
  }

  const summary = await claimSyncService.reconcileDeployment({
    reason: "admin",
  });
  const deploymentKey = getRequiredDeploymentKey();

  writeJson(response, 200, {
    summary,
    claimSummary: airdropRoundStore.getClaimSyncSummary(deploymentKey),
  });
}

async function handleAdminAccountsImport(request, response) {
  getRequiredAdminAccessSession(request);
  const body = await readJsonRequest(request, MAX_IMPORT_BODY_BYTES);
  const csvContent = String(body.csv || body.content || "");

  if (!csvContent.trim()) {
    throw new HttpError(400, "Accounts import must include CSV content.");
  }

  const result = accountStore.importCombinedAccountsCsv(csvContent, {
    importedAt: String(body.importedAt || "").trim() || undefined,
  });

  writeJson(response, 200, {
    fileName: String(body.fileName || "").trim() || null,
    importedAt: result.importedAt,
    importedCount: result.importedCount,
    summary: buildAdminSummary(),
  });
}

async function handleAdminAccountUpsert(request, response) {
  getRequiredAdminAccessSession(request);
  const body = await readJsonRequest(request);
  const username = String(body.username || body.usernameDisplay || "").trim().replace(/^@+/u, "");
  const xUserId = String(body.xUserId || "").trim();
  const walletAddressValue = String(body.walletAddress || "").trim();
  const updatedAt = new Date().toISOString();
  const isFollower = parseBooleanInput(body.isFollower);
  const needsRecovery = parseBooleanInput(body.needsRecovery);
  const shouldSeedSnapshot = isFollower
    && !String(body.snapshotCapturedAt || "").trim()
    && !String(body.firstSeenFollowingAt || "").trim()
    && !String(body.lastSeenFollowingAt || "").trim()
    && !String(body.latestSnapshotCapturedAt || "").trim();

  if (!username && !xUserId) {
    throw new HttpError(400, "Manual account save requires a username or X user ID.");
  }

  const savedAccount = accountStore.saveAccount({
    xUserId,
    usernameDisplay: username,
    xAccountCreatedAt: String(body.xAccountCreatedAt || "").trim() || undefined,
    isFollower,
    needsRecovery,
    walletAddress: walletAddressValue ? requireWalletAddress(walletAddressValue) : null,
    walletSource: walletAddressValue ? "form" : null,
    snapshotCapturedAt: shouldSeedSnapshot
      ? updatedAt
      : (String(body.snapshotCapturedAt || "").trim() || undefined),
    firstSeenFollowingAt: String(body.firstSeenFollowingAt || "").trim() || undefined,
    lastSeenFollowingAt: String(body.lastSeenFollowingAt || "").trim() || undefined,
    snapshotsSeenCount: body.snapshotsSeenCount == null
      ? undefined
      : parsePositiveInteger(body.snapshotsSeenCount, 0, { min: 0, max: 1000000 }),
    latestSnapshotCapturedAt: String(body.latestSnapshotCapturedAt || "").trim() || undefined,
    updatedAt,
  });

  writeJson(response, 200, {
    account: serializeAdminAccount(savedAccount),
    summary: buildAdminSummary(),
  });
}

async function handleAdminRecoverySubmissionsLookup(request, response, requestUrl) {
  getRequiredAdminAccessSession(request);
  const result = recoverySubmissionStore.listSubmissions(getAdminListOptions(requestUrl));

  writeJson(response, 200, {
    summary: buildAdminSummary(),
    pagination: result.pagination,
    submissions: result.submissions.map((submission) => serializeAdminSubmission(submission)),
  });
}

async function handleAdminRecoverySubmissionsImport(request, response) {
  getRequiredAdminAccessSession(request);
  const body = await readJsonRequest(request, MAX_IMPORT_BODY_BYTES);
  let payload = body.payload;

  if (!payload) {
    const rawContent = String(body.content || "").trim();
    if (!rawContent) {
      throw new HttpError(400, "Recovery submissions import must include JSON content.");
    }

    try {
      payload = JSON.parse(rawContent);
    } catch {
      throw new HttpError(400, "Recovery submissions upload must be valid JSON.");
    }
  }

  const result = recoverySubmissionStore.importLegacyPayload(payload, accountStore);

  writeJson(response, 200, {
    fileName: String(body.fileName || "").trim() || null,
    importedCount: result.importedCount,
    summary: buildAdminSummary(),
  });
}

function buildRecoverySubmissionExportPayload(records) {
  const exportedAt = new Date().toISOString();
  return {
    version: 1,
    exportedAt,
    recordCount: records.length,
    records: records.map((record) => ({
      id: record.id,
      accountId: record.accountId,
      xUserId: record.xUserId,
      xUsername: record.usernameAtSubmission,
      walletAddress: record.walletAddress,
      signedMessage: record.signedMessage || "",
      signature: record.signature || "",
      isKnownFollower: Boolean(record.wasKnownFollower),
      isRecoveryCandidate: Boolean(record.wasRecoveryCandidate),
      status: record.status || "received",
      updatedAt: record.submittedAt || exportedAt,
      createdAt: record.createdAt || record.submittedAt || exportedAt,
    })),
  };
}

function buildRecoverySubmissionExportCsv(records) {
  return buildCsv(
    [
      "id",
      "account_id",
      "x_user_id",
      "username_at_submission",
      "wallet_address",
      "was_known_follower",
      "was_recovery_candidate",
      "status",
      "submitted_at",
      "created_at",
      "signed_message",
      "signature",
    ],
    records.map((record) => ([
      record.id,
      record.accountId == null ? "" : String(record.accountId),
      record.xUserId,
      record.usernameAtSubmission,
      record.walletAddress,
      record.wasKnownFollower ? "true" : "false",
      record.wasRecoveryCandidate ? "true" : "false",
      record.status,
      record.submittedAt,
      record.createdAt,
      record.signedMessage || "",
      record.signature || "",
    ])),
  );
}

async function handleAdminRecoverySubmissionsExport(request, response, requestUrl) {
  getRequiredAdminAccessSession(request);
  const format = String(requestUrl.searchParams.get("format") || "json").trim().toLowerCase();
  const records = recoverySubmissionStore.listAllSubmissions({ includeSecrets: true });

  if (format === "csv") {
    const content = buildRecoverySubmissionExportCsv(records);
    writeJson(response, 200, {
      format,
      fileName: `recovery-submissions-${formatDownloadTimestamp()}.csv`,
      contentType: "text/csv",
      content,
    });
    return;
  }

  if (format === "json") {
    const exportPayload = buildRecoverySubmissionExportPayload(records);
    writeJson(response, 200, {
      format,
      fileName: `recovery-submissions-${formatDownloadTimestamp()}.json`,
      contentType: "application/json",
      content: `${JSON.stringify(exportPayload, null, 2)}\n`,
    });
    return;
  }

  throw new HttpError(400, "Recovery submissions export format must be json or csv.");
}

function serializeAirdropClaimRecord(record) {
  if (!record) return null;

  return {
    round: serializeAirdropRoundSummary(record.round),
    entry: serializeAirdropClaimEntry(record.entry),
  };
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
    entry: serializeAirdropClaimEntry(claim.entry),
  });
}

async function handleRoundClaimsLookup(response, roundId) {
  const normalizedRoundId = Number.parseInt(String(roundId || "").trim(), 10);
  if (!Number.isInteger(normalizedRoundId) || normalizedRoundId <= 0) {
    throw new HttpError(400, "Round ID must be a positive integer.");
  }

  const claims = airdropRoundStore.listClaimsByRound(normalizedRoundId, getRequiredDeploymentKey());
  writeJson(response, 200, {
    claims: claims.map((record) => serializeAirdropClaimRecord(record)),
  });
}

async function handleClaimByIdLookup(response, claimId) {
  const normalizedClaimId = Number.parseInt(String(claimId || "").trim(), 10);
  if (!Number.isInteger(normalizedClaimId) || normalizedClaimId <= 0) {
    throw new HttpError(400, "Claim ID must be a positive integer.");
  }

  const claim = airdropRoundStore.getClaimById(normalizedClaimId, getRequiredDeploymentKey());
  if (!claim) {
    throw new HttpError(404, "Claim was not found.");
  }

  writeJson(response, 200, serializeAirdropClaimRecord(claim));
}

async function handleClaimWalletLookup(response, walletAddress) {
  const normalizedWalletAddress = requireWalletAddress(walletAddress);
  const claims = airdropRoundStore.findClaimsByWallet(normalizedWalletAddress, getRequiredDeploymentKey());
  writeJson(response, 200, {
    walletAddress: normalizedWalletAddress,
    claims: claims.map((record) => serializeAirdropClaimRecord(record)),
  });
}

async function handleAdminDraftChallenge(request, response) {
  const body = await readJsonRequest(request);
  const walletAddress = requireWalletAddress(body.walletAddress);
  const merkleRoot = requireBytes32Hex(body.merkleRoot, "Merkle root");
  const deadline = Number.parseInt(String(body.deadline || "").trim(), 10);
  if (!Number.isInteger(deadline) || deadline <= 0) {
    throw new HttpError(400, "Deadline must be a positive integer.");
  }
  const chainConfig = requireChainConfig(appConfig);
  const currentOwner = await fetchAirdropOwner(chainConfig);

  if (ethers.getAddress(currentOwner) !== walletAddress) {
    throw new HttpError(403, "Only the current contract owner can save airdrop drafts.");
  }

  const challengeId = createRandomToken(18);
  const issuedAt = new Date().toISOString();
  const deploymentKey = getRequiredDeploymentKey();
  const message = buildAdminRoundSaveMessage({
    walletAddress,
    merkleRoot,
    deadline,
    challengeId,
    issuedAt,
    chainId: chainConfig.chainId,
    contractAddress: chainConfig.airdropAddress,
    deploymentKey,
  });

  adminRoundSaveChallenges.set(challengeId, {
    challengeId,
    walletAddress,
    merkleRoot,
    deadline,
    deploymentKey,
    message,
    issuedAt,
    expiresAtMs: Date.now() + ADMIN_ROUND_SAVE_CHALLENGE_TTL_MS,
  });

  writeJson(response, 200, {
    challengeId,
    message,
    expiresAt: Date.now() + ADMIN_ROUND_SAVE_CHALLENGE_TTL_MS,
    walletAddress,
  });
}

async function handleSaveAirdropRound(request, response) {
  const body = await readJsonRequest(request, MAX_AIRDROP_ROUND_SAVE_BODY_BYTES);
  const rawClaims = Array.isArray(body.claims)
    ? body.claims
    : Array.isArray(body.round?.claims)
      ? body.round.claims
      : null;
  const deadline = Number.parseInt(String(body.deadline || body.round?.deadline || "").trim(), 10);
  const decimals = Number.parseInt(String(body.decimals || body.round?.decimals || appConfig.tokenDecimals || "18").trim(), 10);

  if (!rawClaims?.length) {
    throw new HttpError(400, "Claims payload is required.");
  }

  if (!Number.isInteger(deadline) || deadline <= 0) {
    throw new HttpError(400, "Round deadline must be a positive integer.");
  }

  if (!Number.isInteger(decimals) || decimals < 0) {
    throw new HttpError(400, "Token decimals must be a non-negative integer.");
  }

  const challenge = getRequiredAdminRoundSaveChallenge(body);
  const signedWalletAddress = requireWalletAddress(body.walletAddress);
  const signature = String(body.signature || "").trim();
  if (!signature) {
    throw new HttpError(400, "Admin round save request must include a wallet signature.");
  }

  const builtRound = buildClaimRound(rawClaims, decimals);
  const expectedMerkleRoot = String(builtRound.root || "").trim().toLowerCase();

  if (challenge.walletAddress !== signedWalletAddress) {
    throw new HttpError(403, "Admin round save challenge does not match the signing wallet.");
  }

  if (challenge.merkleRoot !== expectedMerkleRoot) {
    throw new HttpError(400, "Admin round save challenge does not match the Merkle root.");
  }

  if (challenge.deadline !== deadline) {
    throw new HttpError(400, "Admin round save challenge does not match the deadline.");
  }

  if (challenge.deploymentKey !== getRequiredDeploymentKey()) {
    throw new HttpError(400, "Admin round save challenge does not match the active deployment.");
  }

  let recoveredAddress;
  try {
    recoveredAddress = ethers.verifyMessage(challenge.message, signature);
  } catch {
    throw new HttpError(400, "Admin round save signature is invalid.");
  }

  if (ethers.getAddress(recoveredAddress) !== signedWalletAddress) {
    throw new HttpError(403, "Admin round save signature did not match the supplied wallet.");
  }

  const chainConfig = requireChainConfig(appConfig);
  const currentOwner = await fetchAirdropOwner(chainConfig);
  if (ethers.getAddress(currentOwner) !== signedWalletAddress) {
    throw new HttpError(403, "Only the current contract owner can save airdrop drafts.");
  }

  adminRoundSaveChallenges.delete(challenge.challengeId);
  const savedRound = airdropRoundStore.saveDraftRound({
    deploymentKey: getRequiredDeploymentKey(),
    merkleRoot: expectedMerkleRoot,
    deadline,
    claimCount: builtRound.claimCount,
    totalAmountRaw: builtRound.totalAmountRaw,
    decimals: builtRound.decimals,
    chainId: chainConfig.chainId,
    contractAddress: chainConfig.airdropAddress,
    sourceKind: "admin-draft",
    claims: builtRound.claims,
    updatedAt: new Date().toISOString(),
  });

  writeJson(response, 200, {
    round: serializeAirdropRoundSummary(savedRound),
  });
}

async function handleDeployStoredAirdropRound(request, response, roundId) {
  const body = await readJsonRequest(request);
  const txHash = requireBytes32Hex(body.txHash || body.transactionHash, "Transaction hash");
  const deploymentKey = getRequiredDeploymentKey();
  const storedRound = airdropRoundStore.getRoundById(roundId, deploymentKey);

  if (!storedRound) {
    throw new HttpError(404, "Stored airdrop round was not found.");
  }

  if (storedRound.status === "deployed") {
    if (storedRound.startTxHash && storedRound.startTxHash !== txHash) {
      throw new HttpError(409, "This round was already deployed with a different transaction hash.");
    }

    writeJson(response, 200, {
      round: serializeAirdropRoundSummary(storedRound),
    });
    return;
  }

  const chainConfig = requireChainConfig(appConfig);
  const verifiedRound = await verifyAirdropStartTransaction(chainConfig, txHash, storedRound.merkleRoot);

  if (verifiedRound.deadline !== storedRound.deadline) {
    throw new HttpError(400, "The deployed round deadline did not match the saved draft.");
  }

  const deployedRound = airdropRoundStore.finalizeRoundDeployment(roundId, deploymentKey, {
    epoch: verifiedRound.epoch,
    merkleRoot: verifiedRound.merkleRoot,
    deadline: verifiedRound.deadline,
    chainId: chainConfig.chainId,
    contractAddress: chainConfig.airdropAddress,
    sourceKind: "admin-draft",
    startTxHash: verifiedRound.txHash,
    startBlockNumber: verifiedRound.blockNumber,
    startBlockHash: verifiedRound.blockHash,
    updatedAt: new Date().toISOString(),
  });

  writeJson(response, 200, {
    round: serializeAirdropRoundSummary(deployedRound),
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
    path: getPublicXCookieBasePath(),
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

    const roundClaimsMatch = pathname.match(/^\/api\/airdrop\/rounds\/(\d+)\/claims$/u);
    if (request.method === "GET" && roundClaimsMatch) {
      requireAllowedOrigin(request, response);
      consumeRateLimit(request, "roundClaims");
      await handleRoundClaimsLookup(response, roundClaimsMatch[1]);
      return;
    }

    const claimLookupMatch = pathname.match(/^\/api\/airdrop\/epochs\/(\d+)\/claims\/(\d+)$/u);
    if (request.method === "GET" && claimLookupMatch) {
      requireAllowedOrigin(request, response);
      consumeRateLimit(request, "claimLookup");
      await handleClaimByEpochAndIndexLookup(response, claimLookupMatch[1], claimLookupMatch[2]);
      return;
    }

    const claimByIdMatch = pathname.match(/^\/api\/airdrop\/claims\/(\d+)$/u);
    if (request.method === "GET" && claimByIdMatch) {
      requireAllowedOrigin(request, response);
      consumeRateLimit(request, "claimLookup");
      await handleClaimByIdLookup(response, claimByIdMatch[1]);
      return;
    }

    if (request.method === "GET" && pathname === "/api/airdrop/claims") {
      requireAllowedOrigin(request, response);
      consumeRateLimit(request, "claimLookup");
      await handleClaimWalletLookup(response, requestUrl.searchParams.get("walletAddress"));
      return;
    }

    if (request.method === "POST" && pathname === "/api/admin/access/challenge") {
      requireAllowedOrigin(request, response);
      consumeRateLimit(request, "adminAccessChallenge");
      await handleAdminAccessChallenge(request, response);
      return;
    }

    if (request.method === "POST" && pathname === "/api/admin/access/complete") {
      requireAllowedOrigin(request, response);
      consumeRateLimit(request, "adminAccessComplete");
      await handleAdminAccessComplete(request, response);
      return;
    }

    if (request.method === "GET" && pathname === "/api/admin/accounts") {
      requireAllowedOrigin(request, response);
      consumeRateLimit(request, "adminAccountsRead");
      await handleAdminAccountsLookup(request, response, requestUrl);
      return;
    }

    if (request.method === "POST" && pathname === "/api/admin/accounts/import") {
      requireAllowedOrigin(request, response);
      consumeRateLimit(request, "adminAccountsImport");
      await handleAdminAccountsImport(request, response);
      return;
    }

    if (request.method === "POST" && pathname === "/api/admin/accounts") {
      requireAllowedOrigin(request, response);
      consumeRateLimit(request, "adminAccountsWrite");
      await handleAdminAccountUpsert(request, response);
      return;
    }

    if (request.method === "POST" && pathname === "/api/admin/airdrop-claims/reconcile") {
      requireAllowedOrigin(request, response);
      consumeRateLimit(request, "adminClaimReconcile");
      await handleAdminClaimReconcile(request, response);
      return;
    }

    if (request.method === "GET" && pathname === "/api/admin/recovery-submissions") {
      requireAllowedOrigin(request, response);
      consumeRateLimit(request, "adminSubmissionsRead");
      await handleAdminRecoverySubmissionsLookup(request, response, requestUrl);
      return;
    }

    if (request.method === "POST" && pathname === "/api/admin/recovery-submissions/import") {
      requireAllowedOrigin(request, response);
      consumeRateLimit(request, "adminSubmissionsImport");
      await handleAdminRecoverySubmissionsImport(request, response);
      return;
    }

    if (request.method === "GET" && pathname === "/api/admin/recovery-submissions/export") {
      requireAllowedOrigin(request, response);
      consumeRateLimit(request, "adminSubmissionsExport");
      await handleAdminRecoverySubmissionsExport(request, response, requestUrl);
      return;
    }

    if (request.method === "POST" && pathname === "/api/admin/airdrop-rounds/save-challenge") {
      requireAllowedOrigin(request, response);
      consumeRateLimit(request, "adminDraftChallenge");
      await handleAdminDraftChallenge(request, response);
      return;
    }

    if (request.method === "POST" && pathname === "/api/admin/airdrop-rounds/save") {
      requireAllowedOrigin(request, response);
      consumeRateLimit(request, "saveRound");
      await handleSaveAirdropRound(request, response);
      return;
    }

    const deployRoundMatch = pathname.match(/^\/api\/admin\/airdrop-rounds\/(\d+)\/deploy$/u);
    if (request.method === "POST" && deployRoundMatch) {
      requireAllowedOrigin(request, response);
      consumeRateLimit(request, "deployRound");
      await handleDeployStoredAirdropRound(request, response, deployRoundMatch[1]);
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
