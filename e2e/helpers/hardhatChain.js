const { execSync, spawn } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");
const Database = require("better-sqlite3");

const REPO_ROOT = path.resolve(__dirname, "..", "..");
const RPC_URL = "http://127.0.0.1:8545";
const E2E_BACKEND_HOST = "127.0.0.1";
const E2E_BACKEND_PORT = 8790;
const E2E_BACKEND_ORIGIN = `http://${E2E_BACKEND_HOST}:${E2E_BACKEND_PORT}`;
const E2E_FRONTEND_ORIGIN = "http://127.0.0.1:4173";
const E2E_FRONTEND_RETURN_URL = `${E2E_FRONTEND_ORIGIN}/frontend/`;
const E2E_DB_PATH = path.join(REPO_ROOT, "data", "e2e.sqlite");

function getNpmCommand() {
  return process.platform === "win32" ? "npm.cmd" : "npm";
}

function removeFileIfExists(filePath) {
  try {
    fs.rmSync(filePath, { force: true });
  } catch {
    // Best effort cleanup for local test artifacts.
  }
}

function resetE2eDatabaseFile() {
  removeFileIfExists(E2E_DB_PATH);
  removeFileIfExists(`${E2E_DB_PATH}-wal`);
  removeFileIfExists(`${E2E_DB_PATH}-shm`);
}

function clearE2EAirdropData() {
  if (!fs.existsSync(E2E_DB_PATH)) {
    return;
  }

  const db = new Database(E2E_DB_PATH);
  try {
    db.pragma("foreign_keys = ON");
    db.exec(`
      DELETE FROM airdrop_claims;
      DELETE FROM airdrop_rounds;
    `);
  } finally {
    db.close();
  }
}

async function rpcCall(method, params = [], rpcUrl = RPC_URL) {
  const response = await fetch(rpcUrl, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      id: Date.now(),
      jsonrpc: "2.0",
      method,
      params,
    }),
  });

  if (!response.ok) {
    throw new Error(`RPC ${method} failed with HTTP ${response.status}.`);
  }

  const payload = await response.json();
  if (payload.error) {
    const error = new Error(payload.error.message || `RPC ${method} failed.`);
    error.code = payload.error.code;
    error.data = payload.error.data;
    throw error;
  }

  return payload.result;
}

async function waitForRpc(rpcUrl = RPC_URL, timeoutMs = 30_000) {
  const startedAt = Date.now();

  while ((Date.now() - startedAt) < timeoutMs) {
    try {
      await rpcCall("eth_chainId", [], rpcUrl);
      return;
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 250));
    }
  }

  throw new Error(`Hardhat RPC did not become ready within ${timeoutMs}ms.`);
}

async function waitForBackend(backendUrl = E2E_BACKEND_ORIGIN, timeoutMs = 30_000) {
  const startedAt = Date.now();

  while ((Date.now() - startedAt) < timeoutMs) {
    try {
      const response = await fetch(`${backendUrl}/health`, { cache: "no-store" });
      if (response.ok) {
        return;
      }
    } catch {
      // Keep polling until timeout.
    }

    await new Promise((resolve) => setTimeout(resolve, 250));
  }

  throw new Error(`Backend did not become ready within ${timeoutMs}ms.`);
}

function runNpmScript(script, extraArgs = []) {
  const commandParts = [getNpmCommand(), "run", script, ...extraArgs];
  execSync(commandParts.join(" "), {
    cwd: REPO_ROOT,
    shell: true,
    stdio: "inherit",
  });
}

async function resetLocalChain() {
  await waitForRpc();
  await rpcCall("hardhat_reset");
  runNpmScript("deploy:local");
  runNpmScript("fund:owner:local", ["--", "1000000"]);
}

async function startBackendServer() {
  const env = {
    ...process.env,
    LIBERDUS_DB_PATH: E2E_DB_PATH,
    LIBERDUS_API_BASE_URL: E2E_BACKEND_ORIGIN,
    X_AUTH_ALLOWED_ORIGINS: E2E_FRONTEND_ORIGIN,
    X_FRONTEND_RETURN_URL: E2E_FRONTEND_RETURN_URL,
    X_FRONTEND_RETURN_URLS: E2E_FRONTEND_RETURN_URL,
    X_AUTH_COOKIE_SECURE: "false",
    X_AUTH_HOST: E2E_BACKEND_HOST,
    X_AUTH_PORT: String(E2E_BACKEND_PORT),
  };

  const backendProcess = spawn(process.execPath, ["backend/server.js"], {
    cwd: REPO_ROOT,
    env,
    stdio: ["ignore", "pipe", "pipe"],
  });

  let logs = "";
  const appendLog = (chunk) => {
    logs = `${logs}${chunk.toString()}`.slice(-16_384);
  };

  backendProcess.stdout?.on("data", appendLog);
  backendProcess.stderr?.on("data", appendLog);

  try {
    await waitForBackend(E2E_BACKEND_ORIGIN);
  } catch (error) {
    if (!backendProcess.killed) {
      try {
        if (process.platform === "win32") {
          execSync(`taskkill /pid ${backendProcess.pid} /T /F`, { stdio: "ignore" });
        } else {
          backendProcess.kill("SIGKILL");
        }
      } catch {
        // Ignore cleanup failures during startup.
      }
    }

    throw new Error(
      `Failed to start E2E backend.\n${error.message}\n\nBackend logs:\n${logs.trim() || "(none)"}`,
    );
  }

  return {
    url: E2E_BACKEND_ORIGIN,
    async stop() {
      if (backendProcess.exitCode != null || backendProcess.killed) {
        return;
      }

      try {
        if (process.platform === "win32") {
          execSync(`taskkill /pid ${backendProcess.pid} /T /F`, { stdio: "ignore" });
        } else {
          backendProcess.kill("SIGTERM");
        }
      } catch {
        // Ignore cleanup failures for test worker shutdown.
      }
    },
  };
}

async function createSnapshot(rpcUrl = RPC_URL) {
  return rpcCall("evm_snapshot", [], rpcUrl);
}

async function revertSnapshot(snapshotId, rpcUrl = RPC_URL) {
  return rpcCall("evm_revert", [snapshotId], rpcUrl);
}

module.exports = {
  createSnapshot,
  clearE2EAirdropData,
  E2E_BACKEND_ORIGIN,
  E2E_DB_PATH,
  REPO_ROOT,
  RPC_URL,
  resetLocalChain,
  resetE2eDatabaseFile,
  revertSnapshot,
  rpcCall,
  startBackendServer,
  waitForRpc,
};
