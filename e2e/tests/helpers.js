const { expect } = require("@playwright/test");

const UI_CONFIG_STORAGE_KEY = "liberdus-airdrop-ui-config";
const X_AUTH_SESSION_KEY = "liberdus-airdrop-x-auth-session";

async function connectViaWalletPicker(page) {
  await page.getByRole("button", { name: "Connect Wallet" }).click();
  await page.getByRole("button", { name: /MetaMask/i }).click();
}

async function enableXRecovery(page, backendUrl) {
  await page.addInitScript(({ storageKey, nextBackendUrl }) => {
    const current = JSON.parse(window.localStorage.getItem(storageKey) || "{}");
    const currentXAuth = current.xAuth && typeof current.xAuth === "object" ? current.xAuth : {};
    window.localStorage.setItem(storageKey, JSON.stringify({
      ...current,
      xAuth: {
        ...currentXAuth,
        enabled: true,
        backendUrl: nextBackendUrl,
      },
    }));
  }, { storageKey: UI_CONFIG_STORAGE_KEY, nextBackendUrl: backendUrl });
}

async function mockXAuthSession(page, sessionPayload) {
  await page.route("**/api/x/session", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(sessionPayload),
    });
  });

  await page.addInitScript(({ storageKey, session }) => {
    window.sessionStorage.setItem(storageKey, JSON.stringify(session));
  }, { storageKey: X_AUTH_SESSION_KEY, session: sessionPayload });
}

async function openWalletMenu(page, addressPattern) {
  await page.getByRole("button", { name: addressPattern }).click();
}

async function setFutureDeadline(page, selector, minutesAhead = 90) {
  const value = await page.evaluate((targetMinutesAhead) => {
    const target = new Date(Date.now() + (targetMinutesAhead * 60 * 1000));
    const offsetMs = target.getTimezoneOffset() * 60 * 1000;
    return new Date(target.getTime() - offsetMs).toISOString().slice(0, 16);
  }, minutesAhead);

  await page.locator(selector).fill(value);
}

async function getLocalDateTimeInputValue(page, unixTimestamp) {
  return page.evaluate((timestamp) => {
    const target = new Date(Number(timestamp) * 1000);
    const offsetMs = target.getTimezoneOffset() * 60 * 1000;
    return new Date(target.getTime() - offsetMs).toISOString().slice(0, 16);
  }, unixTimestamp);
}

async function getUtcDateTimeInputValue(page, unixTimestamp) {
  return page.evaluate((timestamp) => {
    return new Date(Number(timestamp) * 1000).toISOString().slice(0, 16);
  }, unixTimestamp);
}

async function startAirdropFromUpload(page, claimsFile, { deadlineSelector = "#startDeadlineInput" } = {}) {
  await expect(page.locator("#accountRole")).toHaveText("Owner connected");
  await page.getByRole("button", { name: "Prepare", exact: true }).click();
  const currentEpochText = (await page.locator("#currentEpoch").textContent())?.trim() || "0";
  const currentEpoch = Number.parseInt(currentEpochText, 10) || 0;

  await page.locator("#uploadClaimsFileInput").setInputFiles(claimsFile);
  await setFutureDeadline(page, deadlineSelector);
  await page.getByRole("button", { name: "Save Round to DB" }).click();
  await page.getByRole("button", { name: "Fund Total" }).first().click();
  await page.getByText("Fund airdrop complete.").waitFor();
  await page.getByRole("button", { name: "Deploy" }).first().click();
  await page.getByText(`Draft deployed as epoch ${currentEpoch + 1}.`).waitFor();
  try {
    await expect(page.locator("#currentEpoch")).toHaveText(String(currentEpoch + 1), { timeout: 10000 });
  } catch {
    await page.getByRole("button", { name: "Refresh" }).click();
    await expect(page.locator("#currentEpoch")).toHaveText(String(currentEpoch + 1));
  }
  await expect(page.locator("#epochListBody")).toContainText("DB + Chain");
  await page.getByRole("button", { name: "Prepare" }).click();
}

async function fetchStoredRounds(page) {
  return page.evaluate(async (storageKey) => {
    const configResponse = await fetch("config.local.json", { cache: "no-store" });
    if (!configResponse.ok) {
      throw new Error("Unable to load local frontend config.");
    }

    const config = await configResponse.json();
    let overrides = {};
    try {
      overrides = JSON.parse(window.localStorage.getItem(storageKey) || "{}");
    } catch {
      overrides = {};
    }

    const overrideXAuth = overrides.xAuth && typeof overrides.xAuth === "object" ? overrides.xAuth : {};
    const configXAuth = config.xAuth && typeof config.xAuth === "object" ? config.xAuth : {};
    const apiBaseUrl = String(
      overrides.apiBaseUrl
      || overrideXAuth.backendUrl
      || config.apiBaseUrl
      || configXAuth.backendUrl
      || "",
    ).replace(/\/+$/u, "");
    if (!apiBaseUrl) {
      throw new Error("Local frontend config does not include an API base URL.");
    }

    const response = await fetch(`${apiBaseUrl}/api/airdrop/rounds`, {
      cache: "no-store",
      credentials: "include",
    });
    if (!response.ok) {
      throw new Error(`Stored rounds request failed with ${response.status}.`);
    }

    return response.json();
  }, UI_CONFIG_STORAGE_KEY);
}

module.exports = {
  connectViaWalletPicker,
  enableXRecovery,
  fetchStoredRounds,
  getLocalDateTimeInputValue,
  getUtcDateTimeInputValue,
  mockXAuthSession,
  openWalletMenu,
  setFutureDeadline,
  startAirdropFromUpload,
};
