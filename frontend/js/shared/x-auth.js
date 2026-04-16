import { X_AUTH_SESSION_KEY } from "./constants.js";

const SESSION_EXPIRY_WINDOW_MS = 60_000;
const AUTH_COMPLETE_QUERY_PARAM = "x_auth";
const AUTH_COMPLETE_QUERY_VALUE = "complete";
const AUTH_ERROR_QUERY_PARAM = "x_error";

function getSessionStorage() {
  if (!window.sessionStorage) {
    throw new Error("This browser does not support sessionStorage.");
  }

  return window.sessionStorage;
}

function readSessionJson(key) {
  try {
    const storage = getSessionStorage();
    const rawValue = storage.getItem(key);
    return rawValue ? JSON.parse(rawValue) : null;
  } catch {
    return null;
  }
}

function writeSessionJson(key, value) {
  const storage = getSessionStorage();
  storage.setItem(key, JSON.stringify(value));
}

function removeSessionValue(key) {
  try {
    getSessionStorage().removeItem(key);
  } catch {
    // Ignore storage cleanup failures.
  }
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

function describeErrorPayload(payload) {
  if (!payload || typeof payload !== "object") {
    return "Unexpected response from X recovery backend.";
  }

  if (typeof payload.error === "string" && payload.error.trim()) {
    return payload.error.trim();
  }

  if (typeof payload.detail === "string" && payload.detail.trim()) {
    return payload.detail.trim();
  }

  return "Unexpected response from X recovery backend.";
}

function cleanupAuthQueryParams() {
  const currentUrl = new URL(window.location.href);
  [AUTH_COMPLETE_QUERY_PARAM, AUTH_ERROR_QUERY_PARAM].forEach((key) => {
    currentUrl.searchParams.delete(key);
  });
  window.history.replaceState({}, document.title, currentUrl.toString());
}

function getNormalizedXAuthConfig(config = {}) {
  const xAuth = config?.xAuth && typeof config.xAuth === "object" ? config.xAuth : {};
  return {
    enabled: xAuth.enabled !== false,
    backendUrl: String(xAuth.backendUrl || "").trim().replace(/\/+$/u, ""),
    redirectUri: String(xAuth.redirectUri || "").trim() || `${window.location.origin}${window.location.pathname}`,
  };
}

function normalizeProfile(payload) {
  const user = payload?.data || payload;
  if (!user?.id || !user?.username) {
    throw new Error("X did not return a valid user profile.");
  }

  return {
    id: String(user.id),
    name: String(user.name || user.username),
    username: String(user.username),
    profileImageUrl: String(user.profile_image_url || user.profileImageUrl || ""),
    verified: Boolean(user.verified),
    verifiedType: String(user.verified_type || user.verifiedType || ""),
  };
}

function buildSession(result, profile, previousSession = null) {
  const previousLinkResult = previousSession?.profile?.id === profile.id ? previousSession.linkResult || null : null;
  return {
    expiresAt: result?.expiresAt || null,
    csrfToken: String(result?.csrfToken || ""),
    profile,
    authenticatedAt: result?.authenticatedAt || new Date().toISOString(),
    linkResult: previousLinkResult,
  };
}

async function fetchBackendSession(backendUrl, { required = false } = {}) {
  const response = await fetch(`${backendUrl}/api/x/session`, {
    credentials: "include",
    cache: "no-store",
  });

  const payload = await parseJsonResponse(response);
  if (response.status === 401) {
    if (required) {
      throw new Error(`X sign-in failed: ${describeErrorPayload(payload)}`);
    }
    return null;
  }

  if (!response.ok) {
    throw new Error(`X sign-in failed: ${describeErrorPayload(payload)}`);
  }

  if (!payload?.profile?.username || !payload?.csrfToken) {
    throw new Error("X sign-in failed: missing authenticated X profile.");
  }

  return payload;
}

export function getXSession() {
  const session = readSessionJson(X_AUTH_SESSION_KEY);
  if (!session?.profile?.username || !session?.csrfToken) {
    return null;
  }

  return session;
}

export function clearXSession() {
  removeSessionValue(X_AUTH_SESSION_KEY);
}

export function saveXSession(session) {
  if (!session) {
    clearXSession();
    return;
  }

  writeSessionJson(X_AUTH_SESSION_KEY, session);
}

export function isXSessionExpired(session = getXSession()) {
  if (!session?.expiresAt) {
    return false;
  }

  return Date.now() >= (Number(session.expiresAt) - SESSION_EXPIRY_WINDOW_MS);
}

export function isXAuthConfigured(config = {}) {
  const xAuth = getNormalizedXAuthConfig(config);
  return xAuth.enabled && Boolean(xAuth.backendUrl);
}

export async function startXLogin(config = {}) {
  const xAuth = getNormalizedXAuthConfig(config);
  if (!xAuth.enabled || !xAuth.backendUrl) {
    throw new Error("X sign-in is not configured.");
  }

  const startUrl = new URL(`${xAuth.backendUrl}/api/x/start`);
  startUrl.searchParams.set("return_uri", xAuth.redirectUri);
  window.location.assign(startUrl.toString());
}

export async function logoutXSession(config = {}, session = getXSession()) {
  const xAuth = getNormalizedXAuthConfig(config);
  const csrfToken = String(session?.csrfToken || "").trim();

  if (xAuth.enabled && xAuth.backendUrl && csrfToken) {
    await fetch(`${xAuth.backendUrl}/api/x/logout`, {
      method: "POST",
      credentials: "include",
      cache: "no-store",
      headers: {
        "Content-Type": "application/json",
        "X-CSRF-Token": csrfToken,
      },
      body: "{}",
    }).catch(() => null);
  }

  clearXSession();
}

export async function completeXLoginIfPresent(config = {}) {
  const params = new URLSearchParams(window.location.search);
  const hasCompletionSignal = params.get(AUTH_COMPLETE_QUERY_PARAM) === AUTH_COMPLETE_QUERY_VALUE;
  const authError = params.get(AUTH_ERROR_QUERY_PARAM);
  const handled = hasCompletionSignal || Boolean(authError);
  const previousSession = getXSession();

  try {
    if (authError) {
      throw new Error(authError);
    }

    const xAuth = getNormalizedXAuthConfig(config);
    if (!xAuth.enabled || !xAuth.backendUrl) {
      return {
        handled,
        session: previousSession,
      };
    }

    const authResult = await fetchBackendSession(xAuth.backendUrl, { required: hasCompletionSignal });
    if (!authResult) {
      clearXSession();
      return {
        handled,
        session: null,
      };
    }

    const profile = normalizeProfile(authResult.profile);
    const session = buildSession(authResult, profile, previousSession);
    saveXSession(session);

    return {
      handled,
      session,
    };
  } finally {
    if (handled) {
      cleanupAuthQueryParams();
    }
  }
}
