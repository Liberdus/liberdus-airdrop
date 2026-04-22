function getBackendBaseUrl(configOrUrl) {
  if (typeof configOrUrl === "string") {
    return String(configOrUrl || "").trim().replace(/\/+$/u, "");
  }

  return String(
    configOrUrl?.apiBaseUrl
    || configOrUrl?.xAuth?.backendUrl
    || "",
  ).trim().replace(/\/+$/u, "");
}

function getRequiredAccessToken(accessToken) {
  const normalized = String(accessToken || "").trim();
  if (!normalized) {
    throw new Error("Admin access token is required.");
  }

  return normalized;
}

async function fetchJson(url, options = {}) {
  const response = await fetch(url, {
    cache: "no-store",
    ...options,
  });

  const text = await response.text();
  let parsed = {};
  if (text) {
    try {
      parsed = JSON.parse(text);
    } catch {
      parsed = { error: text };
    }
  }

  if (!response.ok) {
    throw new Error(parsed?.error || `Request failed (${response.status}).`);
  }

  return parsed;
}

function buildAdminHeaders(accessToken, headers = {}) {
  return {
    ...headers,
    "X-Admin-Token": getRequiredAccessToken(accessToken),
  };
}

export async function requestAdminAccessChallenge(config, payload) {
  const backendBaseUrl = getBackendBaseUrl(config);
  if (!backendBaseUrl) {
    throw new Error("Backend API URL is not configured.");
  }

  return fetchJson(`${backendBaseUrl}/api/admin/access/challenge`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
  });
}

export async function completeAdminAccess(config, payload) {
  const backendBaseUrl = getBackendBaseUrl(config);
  if (!backendBaseUrl) {
    throw new Error("Backend API URL is not configured.");
  }

  return fetchJson(`${backendBaseUrl}/api/admin/access/complete`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
  });
}

export async function fetchAdminAccounts(config, accessToken, options = {}) {
  const backendBaseUrl = getBackendBaseUrl(config);
  if (!backendBaseUrl) {
    throw new Error("Backend API URL is not configured.");
  }

  const url = new URL(`${backendBaseUrl}/api/admin/accounts`);
  if (options.page != null) {
    url.searchParams.set("page", String(options.page));
  }
  if (options.pageSize != null) {
    url.searchParams.set("pageSize", String(options.pageSize));
  }
  if (String(options.search || "").trim()) {
    url.searchParams.set("query", String(options.search || "").trim());
  }
  if (options.walletOnly) {
    url.searchParams.set("walletOnly", "true");
  }

  return fetchJson(url, {
    headers: buildAdminHeaders(accessToken),
  });
}

export async function importAdminAccounts(config, accessToken, payload) {
  const backendBaseUrl = getBackendBaseUrl(config);
  if (!backendBaseUrl) {
    throw new Error("Backend API URL is not configured.");
  }

  return fetchJson(`${backendBaseUrl}/api/admin/accounts/import`, {
    method: "POST",
    headers: buildAdminHeaders(accessToken, {
      "Content-Type": "application/json",
    }),
    body: JSON.stringify(payload),
  });
}

export async function saveAdminAccount(config, accessToken, payload) {
  const backendBaseUrl = getBackendBaseUrl(config);
  if (!backendBaseUrl) {
    throw new Error("Backend API URL is not configured.");
  }

  return fetchJson(`${backendBaseUrl}/api/admin/accounts`, {
    method: "POST",
    headers: buildAdminHeaders(accessToken, {
      "Content-Type": "application/json",
    }),
    body: JSON.stringify(payload),
  });
}

export async function fetchAdminRecoverySubmissions(config, accessToken, options = {}) {
  const backendBaseUrl = getBackendBaseUrl(config);
  if (!backendBaseUrl) {
    throw new Error("Backend API URL is not configured.");
  }

  const url = new URL(`${backendBaseUrl}/api/admin/recovery-submissions`);
  if (options.page != null) {
    url.searchParams.set("page", String(options.page));
  }
  if (options.pageSize != null) {
    url.searchParams.set("pageSize", String(options.pageSize));
  }
  if (String(options.search || "").trim()) {
    url.searchParams.set("query", String(options.search || "").trim());
  }

  return fetchJson(url, {
    headers: buildAdminHeaders(accessToken),
  });
}

export async function importAdminRecoverySubmissions(config, accessToken, payload) {
  const backendBaseUrl = getBackendBaseUrl(config);
  if (!backendBaseUrl) {
    throw new Error("Backend API URL is not configured.");
  }

  return fetchJson(`${backendBaseUrl}/api/admin/recovery-submissions/import`, {
    method: "POST",
    headers: buildAdminHeaders(accessToken, {
      "Content-Type": "application/json",
    }),
    body: JSON.stringify(payload),
  });
}

export async function exportAdminRecoverySubmissions(config, accessToken, format = "json") {
  const backendBaseUrl = getBackendBaseUrl(config);
  if (!backendBaseUrl) {
    throw new Error("Backend API URL is not configured.");
  }

  const url = new URL(`${backendBaseUrl}/api/admin/recovery-submissions/export`);
  url.searchParams.set("format", String(format || "json").trim().toLowerCase());

  return fetchJson(url, {
    headers: buildAdminHeaders(accessToken),
  });
}
