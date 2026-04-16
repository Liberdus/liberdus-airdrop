const { execSync } = require("node:child_process");
const path = require("node:path");

const REPO_ROOT = path.resolve(__dirname, "..", "..");
const RPC_URL = "http://127.0.0.1:8545";

function getNpmCommand() {
  return process.platform === "win32" ? "npm.cmd" : "npm";
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

async function createSnapshot(rpcUrl = RPC_URL) {
  return rpcCall("evm_snapshot", [], rpcUrl);
}

async function revertSnapshot(snapshotId, rpcUrl = RPC_URL) {
  return rpcCall("evm_revert", [snapshotId], rpcUrl);
}

module.exports = {
  createSnapshot,
  REPO_ROOT,
  RPC_URL,
  resetLocalChain,
  revertSnapshot,
  rpcCall,
  waitForRpc,
};
