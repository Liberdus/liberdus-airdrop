# liberdus-airdrop

Epoch-based Merkle airdrop contract, static frontend, and Hardhat test harness for Liberdus.

This repo contains the Solidity contract, local Hardhat tests, and static wallet-connected UIs for claimants and admins against a Hardhat node.

## Contract Behavior

`EpochMerkleAirdrop` is designed around discrete airdrop epochs:

- each new epoch stores one Merkle root and one claim deadline
- multiple epochs may overlap and remain claimable at the same time
- each epoch stores running totals of successfully claimed tokens
- claims are tracked independently per epoch with a bitmap
- claims are allowed only before the epoch deadline
- the owner can update an epoch deadline to any future timestamp, or set it to `0` to disable that epoch immediately
- the contract is funded by transferring the ERC20 token into it directly
- funding is pooled across epochs; the contract does not reserve balances per epoch or enforce solvency
- withdrawals are owner-controlled and are not blocked by deadlines
- ownership transfers use OpenZeppelin `Ownable2Step`
- non-airdrop ERC20 tokens can be recovered by the owner through a separate recovery function

## Local Usage

```bash
npm install
npm run compile
npm test
```

## BSC Deployment

Create a `.env` file from `.env.example` and fill in:

```dotenv
DEPLOYER_PRIVATE_KEY=
BSC_TESTNET_RPC_URL=
BSC_MAINNET_RPC_URL=
BSC_TESTNET_TOKEN_ADDRESS=
BSC_MAINNET_TOKEN_ADDRESS=
BSCSCAN_API_KEY=
DEPLOY_CONFIRMATIONS=5
```

Then deploy:

```bash
npm run deploy:airdrop:bsc:testnet
```

or for mainnet later:

```bash
npm run deploy:airdrop:bsc:mainnet
```

Each deployment writes a reusable record to `deployments/<network>/EpochMerkleAirdrop.json`.
If `BSCSCAN_API_KEY` is set, the deploy script also verifies automatically on BscScan.

If verification needs to be retried separately:

```bash
npm run verify:airdrop:bsc:testnet
npm run verify:airdrop:bsc:mainnet
```

## Static Frontend

The frontend lives in `frontend/` and is served without any frontend framework or build step.

For server deployment, PM2, and SQLite account import instructions, see [SERVER_DEPLOYMENT.md](</C:/Users/Chris/Documents/Code/liberdus/follower-campaign/liberdus-airdrop/SERVER_DEPLOYMENT.md>).

```bash
npm run node
npm run deploy:local
npm run fund:owner:local
```

`npm run deploy:local` writes `frontend/config.local.json` with the current local deployment addresses used by the frontend.
It also writes a fresh `deploymentKey` each time so local Hardhat resets and redeploys do not collide with older airdrop rounds stored in SQLite.

For hosted deployments, the frontend reads `frontend/config.json`. Publish the right config file before deploying:

```bash
npm run publish:config:test
npm run publish:config:prod
```

Those commands copy `frontend/config.test.json` or `frontend/config.prod.json` to `frontend/config.json`.

Serve the repo with any static file server, then open:

- `/frontend/index.html` for the claimant page
- `/frontend/admin.html` for the owner-only admin page

Claim rounds now live in the backend SQLite database. The claim page reads wallet-specific proofs from the backend, and the admin page saves newly started rounds into that database after the `startNewAirdrop` transaction confirms on chain.

The claimant page also supports X sign-in through the `xAuth` block in each frontend config file:

```json
{
  "apiBaseUrl": "https://your-backend.example",
  "xAuth": {
    "enabled": true,
    "redirectUri": "https://your-site.example/frontend/index.html",
    "backendUrl": "https://your-auth-server.example"
  }
}
```

This repo now uses X OAuth 1.0a for the recovery flow. The frontend `redirectUri` is the page users should return to after the backend finishes the X callback. The actual callback registered in the X app settings must point at your backend callback endpoint, not the frontend page.

On the claim page, the X recovery flow is shown only when:

- a wallet is connected
- that wallet has no claim entries across the loaded rounds

After the user signs in with X, the page requests a wallet signature and submits the signed wallet/X pairing to the backend for storage.

For local development:

```bash
npm run serve
```

The local backend now lives under `backend/`.

The local auth server reads these environment variables from `.env`:

```dotenv
X_API_KEY=
X_API_SECRET=
X_OAUTH1_CALLBACK_URL=http://127.0.0.1:8787/api/x/callback
X_FRONTEND_RETURN_URL=http://127.0.0.1:5502/frontend/
X_FRONTEND_RETURN_URLS=http://127.0.0.1:5502/frontend/
X_AUTH_ALLOWED_ORIGINS=http://127.0.0.1:5502
X_AUTH_COOKIE_SECURE=auto
X_AUTH_TRUST_PROXY=false
LIBERDUS_DB_PATH=data/liberdus.sqlite
LIBERDUS_CHAIN_ID=1337
LIBERDUS_RPC_URL=http://127.0.0.1:8545
LIBERDUS_AIRDROP_ADDRESS=
LIBERDUS_DEPLOYMENT_KEY=
LIBERDUS_TOKEN_DECIMALS=18
X_FOLLOWER_SNAPSHOT_FILE=cache/x/liberdus-followers.json
X_RECOVERY_CANDIDATES_FILE=cache/x/missing-address-usernames.json
# Legacy import source for pre-SQLite recovery submissions.
X_RECOVERY_STORE_FILE=cache/x/recovery-links.json
```

Then set local frontend config like:

```json
{
  "apiBaseUrl": "http://127.0.0.1:8787",
  "deploymentKey": "local:your-current-deploy-id",
  "xAuth": {
    "enabled": true,
    "redirectUri": "http://127.0.0.1:5502/frontend/",
    "backendUrl": "http://127.0.0.1:8787"
  }
}
```

For production, set `X_AUTH_COOKIE_SECURE=true` behind HTTPS and configure `X_AUTH_TRUST_PROXY=true` only if the server is behind a trusted reverse proxy that sets `X-Forwarded-For`.

Follower matching now reads from SQLite, not directly from the raw follower export JSON. Import the latest snapshot into the DB before running the auth server:

```bash
npm run followers:import
```

That command reads `X_FOLLOWER_SNAPSHOT_FILE`, upserts the latest follower state into `x_accounts`, and updates per-account snapshot rollups in `LIBERDUS_DB_PATH` so you can track how many snapshots an account has appeared in and when it was first or last seen.

Recovery-candidate matching also reads from SQLite. Import the latest processed candidate list before running the auth server:

```bash
npm run recovery-candidates:import -- --file "C:\path\to\api_followers_not_seen_in_airdrop_rewards_....csv"
```

That command reads `X_RECOVERY_CANDIDATES_FILE` by default, supports both the processed CSV format and the legacy JSON username list, and marks the latest recovery-candidate set on `x_accounts` in `LIBERDUS_DB_PATH`.

If you want to pull old JSON submissions into SQLite once, run:

```bash
npm run recovery-submissions:import
```

That command reads `X_RECOVERY_STORE_FILE` as a legacy import source and writes those rows into `recovery_submissions`.

Claim rounds are now created and persisted through the admin UI. Upload a raw claims JSON file or build the round in the admin page, then fund and start the airdrop there. The backend stores finalized proofs in `airdrop_rounds` / `airdrop_claims` when the round is finalized.

Round identity is now namespaced by `deploymentKey`. The backend stores rounds under `(deploymentKey, epoch)`, so:

- production/test deployments can keep a stable key, such as `chainId:contractAddress`
- local deployments should use a fresh key every time `npm run deploy:local` runs
- old rounds and claims can stay in SQLite for history, but they will not leak into the current deployment once the key changes

The local auth server:

- starts the OAuth 1.0a request-token flow server-side
- receives the X callback at `X_OAUTH1_CALLBACK_URL`
- exchanges the request token for an access token and token secret
- uses the username returned by X when available, and falls back to `account/verify_credentials` only if needed
- keeps a short-lived X session in memory using an HttpOnly cookie
- allows only exact frontend return URLs listed in `X_FRONTEND_RETURN_URLS`
- binds the login handoff to the initiating browser before accepting the X callback
- requires allowed browser origins plus a CSRF token on state-changing requests
- rate limits the auth, challenge, and save endpoints
- issues a wallet-signature challenge tied to the signed-in X account
- verifies the wallet signature on the backend
- reads follower matches from the `x_accounts` table in `LIBERDUS_DB_PATH`
- reads recovery-candidate flags from the `x_accounts` table in `LIBERDUS_DB_PATH`
- stores recovery proof submissions in the `recovery_submissions` table in `LIBERDUS_DB_PATH`
- stores finalized airdrop rounds in `airdrop_rounds` / `airdrop_claims` in `LIBERDUS_DB_PATH`
- flags whether the username matched:
  - the imported follower snapshot data in `LIBERDUS_DB_PATH`
  - the latest imported recovery-candidate set in `LIBERDUS_DB_PATH`

`X_RECOVERY_CANDIDATES_FILE` is optional. If present, it can be either:

```json
["alice", "bob", "charlie"]
```

or:

```json
{
  "usernames": ["alice", "bob", "charlie"]
}
```

## Merkle CLI

Use the CLI to validate an offline claims file and print the Merkle root and total amount:

```bash
npm run merkle -- .\examples\my-round.claims.json
```

Optional flags:

- `--decimals 18`
- `--stdout`
- `--out .\examples\my-round.summary.json`

Input files can be either a raw array of claim objects or an object with a top-level `claims` array.

Each claim must contain:

```json
[
  {
    "index": 0,
    "account": "0x0000000000000000000000000000000000000001",
    "amount": "100"
  }
]
```

You may also provide `amountRaw` instead of `amount` if your source data is already in token base units.

## Key Reads

Useful read functions exposed by the contract:

- `merkleRoots(epoch)`
- `deadlines(epoch)`
- `epochClaimedAmounts(epoch)`
- `epochInfo(epoch)`
## Merkle Tree Format

The contract uses the OpenZeppelin standard Merkle tree leaf format:

```solidity
keccak256(bytes.concat(keccak256(abi.encode(index, account, amount))))
```

The frontend, test suite, and CLI in this repo all use that same leaf format with leaf values shaped as:

```text
[index, account, amount]
```

with types:

```text
["uint256", "address", "uint256"]
```

If the off-chain leaf format differs even slightly, proofs will fail on-chain.
