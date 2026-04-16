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

```bash
npm run node
npm run deploy:local
npm run fund:owner:local
```

`npm run deploy:local` writes `frontend/config.local.json` with the current local deployment addresses used by the frontend.

For hosted deployments, the frontend reads `frontend/config.json`. Publish the right config file before deploying:

```bash
npm run publish:config:test
npm run publish:config:prod
```

Those commands copy `frontend/config.test.json` or `frontend/config.prod.json` to `frontend/config.json`.

Serve the repo with any static file server, then open:

- `/frontend/index.html` for the claimant page
- `/frontend/admin.html` for the owner-only admin page

Hosted claim rounds are listed in `frontend/claims/index.json`. Each entry points at the raw claims JSON for one epoch. The claimant page loads those raw files, computes the Merkle tree in the browser, and generates proofs client-side.

The claimant page also supports X sign-in through the `xAuth` block in each frontend config file:

```json
{
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
npm run xauth:local
```

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
X_FOLLOWER_SNAPSHOT_FILE=cache/x/liberdus-followers.json
X_RECOVERY_CANDIDATES_FILE=cache/x/missing-address-usernames.json
X_RECOVERY_STORE_FILE=cache/x/recovery-links.json
```

Then set local frontend config like:

```json
{
  "xAuth": {
    "enabled": true,
    "redirectUri": "http://127.0.0.1:5502/frontend/",
    "backendUrl": "http://127.0.0.1:8787"
  }
}
```

For production, set `X_AUTH_COOKIE_SECURE=true` behind HTTPS and configure `X_AUTH_TRUST_PROXY=true` only if the server is behind a trusted reverse proxy that sets `X-Forwarded-For`.

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
- stores the resulting wallet/X pair in `X_RECOVERY_STORE_FILE`
- flags whether the username matched:
  - the follower snapshot in `X_FOLLOWER_SNAPSHOT_FILE`
  - the optional recovery candidate list in `X_RECOVERY_CANDIDATES_FILE`

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
