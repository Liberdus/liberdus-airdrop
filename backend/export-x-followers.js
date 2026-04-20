const fs = require("node:fs");
const path = require("node:path");

const dotenv = require("dotenv");

const API_BASE_URL = "https://api.x.com/2";
const DEFAULT_USERNAME = "liberdus";
const DEFAULT_OUTPUT_PATH = path.join("cache", "x", `${DEFAULT_USERNAME}-followers.json`);
const DEFAULT_MAX_RESULTS = 1000;
const MAX_ATTEMPTS = 6;
const REQUEST_TIMEOUT_MS = 30_000;
const RETRYABLE_STATUS_CODES = new Set([429, 500, 502, 503, 504]);
const USER_CONTEXT_ONLY_USER_FIELDS = [
  {
    field: "confirmed_email",
    reason: "Requires the users.email scope and only applies to the authenticated user.",
  },
  {
    field: "connection_status",
    reason: "Depends on the relationship between the authenticating user and the looked-up user.",
  },
  {
    field: "receives_your_dm",
    reason: "Depends on the relationship between the authenticating user and the looked-up user.",
  },
  {
    field: "subscription",
    reason: "Describes whether the looked-up user is subscribed to the authenticated user.",
  },
  {
    field: "subscription_type",
    reason: "Describes the authenticated user's own Premium subscription tier.",
  },
];
const USER_FIELDS = [
  "affiliation",
  "created_at",
  "description",
  "entities",
  "id",
  "is_identity_verified",
  "location",
  "most_recent_tweet_id",
  "name",
  "parody",
  "pinned_tweet_id",
  "profile_banner_url",
  "profile_image_url",
  "protected",
  "public_metrics",
  "url",
  "username",
  "verified",
  "verified_followers_count",
  "verified_type",
  "withheld",
];

function usage() {
  console.error(
    [
      "Usage:",
      "  node backend/export-x-followers.js [--username <handle>] [--out <output.json>] [--max-results <1-1000>] [--force]",
      "",
      "Defaults:",
      `  username: ${DEFAULT_USERNAME}`,
      `  out: ${DEFAULT_OUTPUT_PATH}`,
      `  max-results: ${DEFAULT_MAX_RESULTS}`,
      "",
      "Behavior:",
      "  - reads X-BEARER-TOKEN from .env",
      `  - requests all app-only user fields X exposes for public lookups (${USER_FIELDS.length} fields)`,
      "  - checkpoints progress after every page to a .partial.json file",
      "  - writes completed exports to a timestamped filename so older snapshots are preserved",
      "  - uses --force only to discard an existing partial checkpoint and start over",
    ].join("\n"),
  );
}

function parseArgs(argv) {
  const options = {
    username: DEFAULT_USERNAME,
    outputPath: DEFAULT_OUTPUT_PATH,
    maxResults: DEFAULT_MAX_RESULTS,
    force: false,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];

    if (arg === "--username") {
      options.username = (argv[++index] || "").trim();
      continue;
    }

    if (arg === "--out") {
      options.outputPath = (argv[++index] || "").trim();
      continue;
    }

    if (arg === "--max-results") {
      options.maxResults = Number(argv[++index]);
      continue;
    }

    if (arg === "--force") {
      options.force = true;
      continue;
    }

    throw new Error(`Unknown option: ${arg}`);
  }

  if (!options.username) {
    throw new Error("`--username` is required.");
  }

  if (!options.outputPath) {
    throw new Error("`--out` is required.");
  }

  if (!Number.isInteger(options.maxResults) || options.maxResults < 1 || options.maxResults > 1000) {
    throw new Error("`--max-results` must be an integer between 1 and 1000.");
  }

  return options;
}

function resolvePaths(outputPath) {
  const repoRoot = path.resolve(__dirname, "..");
  const resolvedOutputPath = path.resolve(repoRoot, outputPath);
  const partialPath = resolvedOutputPath.endsWith(".json")
    ? resolvedOutputPath.replace(/\.json$/i, ".partial.json")
    : `${resolvedOutputPath}.partial.json`;

  return {
    repoRoot,
    outputPath: resolvedOutputPath,
    partialPath,
  };
}

function formatTimestampForFilename(isoTimestamp) {
  return isoTimestamp.replace(/:/g, ".");
}

function buildCompletedOutputPath(outputTemplatePath, completedAt) {
  const parsed = path.parse(outputTemplatePath);
  const extension = parsed.ext || ".json";
  const formattedTimestamp = formatTimestampForFilename(completedAt);
  const baseName = parsed.name || "followers";

  return path.join(parsed.dir, `${baseName}-${formattedTimestamp}${extension}`);
}

function ensureUniqueFilePath(filePath) {
  if (!fs.existsSync(filePath)) {
    return filePath;
  }

  const parsed = path.parse(filePath);
  let attempt = 2;

  while (true) {
    const candidate = path.join(parsed.dir, `${parsed.name}-${attempt}${parsed.ext}`);
    if (!fs.existsSync(candidate)) {
      return candidate;
    }
    attempt += 1;
  }
}

function loadBearerToken(repoRoot) {
  dotenv.config({ path: path.join(repoRoot, ".env"), quiet: true });

  const token = process.env["X-BEARER-TOKEN"];
  if (!token || !token.trim()) {
    throw new Error("Missing `X-BEARER-TOKEN` in .env.");
  }

  return token.trim();
}

function sleep(ms) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

function describeRetryDelayMs(response, attempt) {
  const retryAfterHeader = response.headers.get("retry-after");
  if (retryAfterHeader) {
    const retryAfterSeconds = Number(retryAfterHeader);
    if (Number.isFinite(retryAfterSeconds) && retryAfterSeconds > 0) {
      return retryAfterSeconds * 1000;
    }
  }

  const resetHeader = response.headers.get("x-rate-limit-reset");
  if (resetHeader) {
    const resetAtMs = Number(resetHeader) * 1000;
    if (Number.isFinite(resetAtMs)) {
      return Math.max(resetAtMs - Date.now() + 1_000, 1_000);
    }
  }

  return Math.min(60_000, 2_000 * (2 ** (attempt - 1)));
}

function isRetryableError(error) {
  return (
    error &&
    typeof error === "object" &&
    (
      error.name === "AbortError" ||
      error.code === "ECONNRESET" ||
      error.code === "ETIMEDOUT" ||
      error.code === "UND_ERR_CONNECT_TIMEOUT" ||
      error.code === "UND_ERR_HEADERS_TIMEOUT"
    )
  );
}

async function parseJsonResponse(response) {
  const text = await response.text();
  if (!text) return {};

  try {
    return JSON.parse(text);
  } catch {
    return { raw: text };
  }
}

async function fetchJson(url, bearerToken, label, attempt = 1) {
  try {
    const response = await fetch(url, {
      headers: {
        Authorization: `Bearer ${bearerToken}`,
      },
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });

    const payload = await parseJsonResponse(response);

    if (response.ok) {
      return payload;
    }

    if (RETRYABLE_STATUS_CODES.has(response.status) && attempt < MAX_ATTEMPTS) {
      const delayMs = describeRetryDelayMs(response, attempt);
      console.error(
        `${label} returned HTTP ${response.status}; retrying in ${Math.ceil(delayMs / 1000)}s (attempt ${attempt}/${MAX_ATTEMPTS})`,
      );
      await sleep(delayMs);
      return fetchJson(url, bearerToken, label, attempt + 1);
    }

    const detail = typeof payload === "object" ? JSON.stringify(payload) : String(payload);
    throw new Error(`${label} failed with HTTP ${response.status}: ${detail}`);
  } catch (error) {
    if (attempt < MAX_ATTEMPTS && isRetryableError(error)) {
      const delayMs = Math.min(60_000, 2_000 * (2 ** (attempt - 1)));
      console.error(
        `${label} failed with ${error.name || "network error"}; retrying in ${Math.ceil(delayMs / 1000)}s (attempt ${attempt}/${MAX_ATTEMPTS})`,
      );
      await sleep(delayMs);
      return fetchJson(url, bearerToken, label, attempt + 1);
    }

    throw error;
  }
}

function ensureDirectory(filePath) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
}

function writeJson(filePath, value) {
  ensureDirectory(filePath);
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`);
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function removeFileIfExists(filePath) {
  if (fs.existsSync(filePath)) {
    fs.rmSync(filePath);
  }
}

async function lookupUser(username, bearerToken) {
  const url = new URL(`${API_BASE_URL}/users/by/username/${encodeURIComponent(username)}`);
  url.searchParams.set("user.fields", USER_FIELDS.join(","));

  const response = await fetchJson(url, bearerToken, `lookup @${username}`);
  if (!response || !response.data || !response.data.id) {
    throw new Error(`Could not resolve @${username} to a user ID.`);
  }

  return response.data;
}

function createInitialState(options, sourceUser) {
  const startedAt = new Date().toISOString();

  return {
    version: 1,
    complete: false,
    startedAt,
    updatedAt: startedAt,
    completedAt: null,
    username: options.username,
    sourceUser,
    request: {
      apiBaseUrl: API_BASE_URL,
      maxResults: options.maxResults,
      outputTemplatePath: options.outputPath,
      userFields: USER_FIELDS,
      omittedUserFields: USER_CONTEXT_ONLY_USER_FIELDS,
    },
    resume: {
      page: 0,
      nextToken: null,
    },
    stats: {
      fetchedUsers: 0,
      pagesFetched: 0,
      duplicatesSkipped: 0,
      apiErrors: 0,
      sourceFollowersCount: sourceUser.public_metrics?.followers_count ?? null,
    },
    pageSummaries: [],
    apiErrors: [],
    followers: [],
  };
}

function loadState(options, paths) {
  if (options.force) {
    removeFileIfExists(paths.partialPath);
  }

  if (!fs.existsSync(paths.partialPath)) {
    return {
      state: null,
      skipReason: null,
    };
  }

  const state = readJson(paths.partialPath);
  if (state.username !== options.username) {
    throw new Error(
      `Checkpoint username mismatch: expected @${options.username}, found @${state.username}. Use --force to start fresh.`,
    );
  }

  if (state.request?.maxResults !== options.maxResults) {
    throw new Error(
      `Checkpoint max-results mismatch: expected ${options.maxResults}, found ${state.request?.maxResults}. Use --force to start fresh.`,
    );
  }

  if (state.request?.outputTemplatePath !== options.outputPath) {
    throw new Error(
      `Checkpoint output path mismatch: expected ${options.outputPath}, found ${state.request?.outputTemplatePath}. Use --force to start fresh.`,
    );
  }

  return {
    state,
    skipReason: null,
  };
}

function createFollowerRequest(userId, maxResults, nextToken) {
  const url = new URL(`${API_BASE_URL}/users/${userId}/followers`);
  url.searchParams.set("max_results", String(maxResults));
  url.searchParams.set("user.fields", USER_FIELDS.join(","));

  if (nextToken) {
    url.searchParams.set("pagination_token", nextToken);
  }

  return url;
}

function summarizePage(response, pageNumber, requestedToken, usersReturned, usersAdded) {
  return {
    page: pageNumber,
    fetchedAt: new Date().toISOString(),
    requestedToken: requestedToken || null,
    nextToken: response.meta?.next_token ?? null,
    resultCount: response.meta?.result_count ?? usersReturned,
    usersReturned,
    usersAdded,
    errorCount: Array.isArray(response.errors) ? response.errors.length : 0,
  };
}

async function exportFollowers(options, paths, bearerToken) {
  const loaded = loadState(options, paths);
  if (loaded.skipReason) {
    console.log(loaded.skipReason);
    return;
  }

  const state = loaded.state || createInitialState(options, await lookupUser(options.username, bearerToken));
  const seenIds = new Set(state.followers.map((user) => user.id));

  if (loaded.state) {
    console.log(
      `Resuming @${state.username} export from page ${state.resume.page + 1} with ${state.followers.length} users already saved.`,
    );
  } else {
    writeJson(paths.partialPath, state);
    console.log(`Resolved @${state.username} to user ID ${state.sourceUser.id}.`);
    console.log(
      `Skipping auth-context-only user fields: ${USER_CONTEXT_ONLY_USER_FIELDS.map((entry) => entry.field).join(", ")}.`,
    );
  }

  while (true) {
    const requestedToken = state.resume.nextToken;
    const pageNumber = state.resume.page + 1;
    const url = createFollowerRequest(state.sourceUser.id, options.maxResults, requestedToken);
    const response = await fetchJson(url, bearerToken, `followers page ${pageNumber}`);
    const pageUsers = Array.isArray(response.data) ? response.data : [];
    const pageErrors = Array.isArray(response.errors) ? response.errors : [];

    let usersAdded = 0;

    for (const user of pageUsers) {
      if (!user || !user.id) {
        continue;
      }

      if (seenIds.has(user.id)) {
        state.stats.duplicatesSkipped += 1;
        continue;
      }

      seenIds.add(user.id);
      state.followers.push(user);
      usersAdded += 1;
    }

    state.pageSummaries.push(summarizePage(response, pageNumber, requestedToken, pageUsers.length, usersAdded));

    if (pageErrors.length > 0) {
      state.apiErrors.push(
        ...pageErrors.map((error) => ({
          page: pageNumber,
          receivedAt: new Date().toISOString(),
          ...error,
        })),
      );
    }

    state.resume.page = pageNumber;
    state.resume.nextToken = response.meta?.next_token ?? null;
    state.stats.fetchedUsers = state.followers.length;
    state.stats.pagesFetched = state.pageSummaries.length;
    state.stats.apiErrors = state.apiErrors.length;
    state.updatedAt = new Date().toISOString();

    writeJson(paths.partialPath, state);

    console.log(
      `Page ${pageNumber}: returned ${pageUsers.length}, added ${usersAdded}, total saved ${state.followers.length}.`,
    );

    if (!state.resume.nextToken) {
      break;
    }
  }

  state.complete = true;
  state.completedAt = new Date().toISOString();
  state.updatedAt = state.completedAt;
  state.resume.nextToken = null;
  state.outputFile = ensureUniqueFilePath(buildCompletedOutputPath(paths.outputPath, state.completedAt));

  writeJson(state.outputFile, state);
  removeFileIfExists(paths.partialPath);

  console.log(`Saved ${state.followers.length} followers for @${state.username} to ${state.outputFile}`);
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const paths = resolvePaths(options.outputPath);
  const bearerToken = loadBearerToken(paths.repoRoot);

  await exportFollowers(options, paths, bearerToken);
}

main().catch((error) => {
  console.error(error.message || String(error));
  usage();
  process.exitCode = 1;
});
