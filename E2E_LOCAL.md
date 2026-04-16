# Running E2E Tests Locally

This repo has a Playwright E2E suite that runs the static frontend against a local Hardhat node.

## What The E2E Harness Starts

`npm run test:e2e` starts everything it needs through Playwright:

- a local Hardhat node on `127.0.0.1:8545`
- the static frontend server on `127.0.0.1:4173`

The tests then:

- deploy fresh local contracts
- write `frontend/config.local.json`
- fund the owner wallet
- use a mocked MetaMask-style injected wallet backed by the Hardhat RPC

You do not need to start those services manually before running the suite.

## Requirements

- Node.js 20
- `npm install`

Install dependencies once:

```bash
npm install
```

## Commands

Run the full E2E suite:

```bash
npm run test:e2e
```

Run only the smoke subset:

```bash
npm run test:e2e:smoke
```

Run the non-smoke E2E tests:

```bash
npm run test:e2e:non-smoke
```

Run the contract tests:

```bash
npm test
```

## Important Port Rules

The E2E suite does **not** reuse existing processes on its ports.

That means these ports must be free before you start the suite:

- `8545` for Hardhat
- `4173` for the static frontend server

If something else is already listening on either port, Playwright will fail fast instead of silently attaching to the wrong process.

This is intentional. It prevents one worktree from accidentally running tests against another worktree's Hardhat node or frontend files.

## Common Failure

If you see an error like:

```text
http://localhost:8545 is already used
```

or:

```text
http://localhost:4173 is already used
```

stop the process that owns that port and run the suite again.

On bash, you can inspect the listener:

```bash
lsof -iTCP:8545 -sTCP:LISTEN
lsof -iTCP:4173 -sTCP:LISTEN
```

Then inspect the owning process:

```bash
ps -p <PID> -f
```

And stop it if needed:

```bash
kill <PID>
```

## Notes About Isolation

The suite currently runs with one Playwright worker.

Per test, it resets blockchain state by reverting to a worker-scoped Hardhat snapshot, then creating a fresh snapshot again. Browser context is still fresh per test.

This means:

- tests are isolated from each other
- contract addresses stay deterministic
- the suite should not depend on any manually started local services

## Files To Know

- [playwright.config.js](/C:/Users/Chris/.codex/worktrees/9939/liberdus-airdrop/playwright.config.js)
- [e2e/fixtures/testWithMockWallet.js](/C:/Users/Chris/.codex/worktrees/9939/liberdus-airdrop/e2e/fixtures/testWithMockWallet.js)
- [e2e/helpers/hardhatChain.js](/C:/Users/Chris/.codex/worktrees/9939/liberdus-airdrop/e2e/helpers/hardhatChain.js)
- [scripts/e2e/static-server.js](/C:/Users/Chris/.codex/worktrees/9939/liberdus-airdrop/scripts/e2e/static-server.js)
