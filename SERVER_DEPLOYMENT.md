# Server Deployment

This document covers:

- running the backend with PM2
- hosting both test and prod on the same server
- loading the X account / wallet data into SQLite
- using a GitHub Pages frontend that talks to the backend over HTTPS

This repo is designed to work well with one backend process per environment. If you run both test and prod on the same server, keep them in separate directories with separate `.env` files, separate PM2 app names, separate backend ports, and separate SQLite files.

Important deployment model for Liberdus:

- the frontend is hosted separately on GitHub Pages / `liberdus.com`
- the server only hosts the backend
- nginx on the backend server exposes separate public backend base paths for test and prod
- each backend process still binds only to `127.0.0.1` locally

That means there are always two different URLs to think about:

- bind URL:
  - example: `http://127.0.0.1:8788`
- public backend URL:
  - example: `https://att.liberdus.com/rewards-test`

`X_AUTH_HOST=127.0.0.1` is correct in this setup. It means the Node process listens only on loopback, and nginx proxies the public HTTPS URL to that local port.

## Recommended Layout

Example:

```text
/home/liberdus/liberdus-airdrop-prod
/home/liberdus/liberdus-airdrop-test
```

Each directory should contain its own checkout of this repo.

If you have a root-managed deployment layout such as `/srv/...`, that is also fine. On a shared server without `sudo`, user-owned directories under the deploy user home are safer and more practical.

Recommended per-environment separation:

- prod backend port: `8787`
- test backend port: `8788`
- prod PM2 app name: `liberdus-airdrop-prod`
- test PM2 app name: `liberdus-airdrop-test`
- prod public backend base URL: `https://att.liberdus.com/rewards`
- test public backend base URL: `https://att.liberdus.com/rewards-test`
- prod DB path: `data/liberdus.sqlite` inside the prod checkout
- test DB path: `data/liberdus.sqlite` inside the test checkout

Because the checkouts are separate, the default `data/liberdus.sqlite` path is already isolated. You only need to override `LIBERDUS_DB_PATH` if you want the DB somewhere else.

## 1. Install

Run this once in each directory:

```bash
npm ci
```

## 2. Configure `.env`

Create `.env` in each directory from `.env.example`.

Minimum backend fields:

```dotenv
X_AUTH_HOST=127.0.0.1
X_AUTH_PORT=8787
X_AUTH_ALLOWED_ORIGINS=https://airdrop.example.com
X_AUTH_COOKIE_SECURE=true
X_AUTH_TRUST_PROXY=true

X_API_KEY=
X_API_SECRET=
X_OAUTH1_CALLBACK_URL=https://backend.example.com/api/x/callback
X_FRONTEND_RETURN_URL=https://frontend.example.com/
X_FRONTEND_RETURN_URLS=https://frontend.example.com/

LIBERDUS_DB_PATH=data/liberdus.sqlite
LIBERDUS_CHAIN_ID=56
LIBERDUS_RPC_URL=https://your-rpc.example
LIBERDUS_AIRDROP_ADDRESS=0x...
LIBERDUS_DEPLOYMENT_KEY=56:0x...
LIBERDUS_TOKEN_DECIMALS=18
```

For test, use the test domain, test port, test chain ID, test contract address, and a different `LIBERDUS_DEPLOYMENT_KEY`.

Notes:

- `LIBERDUS_DEPLOYMENT_KEY` is the namespace for stored airdrop rounds. Keep it stable for a real deployment.
- `X_OAUTH1_CALLBACK_URL` must be the backend callback URL.
- `X_FRONTEND_RETURN_URL` and `X_FRONTEND_RETURN_URLS` must exactly match the claim page URL users return to after X sign-in.
- `X_AUTH_ALLOWED_ORIGINS` must match the frontend origin exactly. This is origin-only, not path-based.
- if your frontend is at `https://liberdus.com/rewards-test/`, then `X_AUTH_ALLOWED_ORIGINS` should be `https://liberdus.com`
- if test and prod share the same frontend origin but different paths, the exact path separation is enforced by `X_FRONTEND_RETURN_URLS`

### Current Liberdus Test Example

For the current test deployment target:

```dotenv
X_AUTH_HOST=127.0.0.1
X_AUTH_PORT=8788
X_AUTH_ALLOWED_ORIGINS=https://liberdus.com
X_AUTH_COOKIE_SECURE=true
X_AUTH_TRUST_PROXY=true

X_OAUTH1_CALLBACK_URL=https://att.liberdus.com/rewards-test/api/x/callback
X_FRONTEND_RETURN_URL=https://liberdus.com/rewards-test/
X_FRONTEND_RETURN_URLS=https://liberdus.com/rewards-test/

LIBERDUS_CHAIN_ID=97
LIBERDUS_AIRDROP_ADDRESS=0x822C39eFe9055593418071a80552760282fB1B71
LIBERDUS_DEPLOYMENT_KEY=97:0x822c39efe9055593418071a80552760282fb1b71
```

## 3. Configure the Frontend

This repo expects the frontend to load `frontend/config.json`.

For prod:

```bash
cp frontend/config.prod.json frontend/config.json
```

For test:

```bash
cp frontend/config.test.json frontend/config.json
```

Then edit `frontend/config.json` for that environment.

Important fields:

```json
{
  "chainId": 56,
  "rpcUrl": "https://your-rpc.example",
  "tokenAddress": "0x...",
  "airdropAddress": "0x...",
  "apiBaseUrl": "https://backend.example.com/path-prefix",
  "deploymentKey": "56:0x...",
  "xAuth": {
    "enabled": true,
    "redirectUri": "https://frontend.example.com/",
    "backendUrl": "https://backend.example.com/path-prefix"
  }
}
```

Notes:

- `apiBaseUrl` is the backend base URL, not `/api`.
- `xAuth.backendUrl` should normally match `apiBaseUrl`.
- `deploymentKey` must match `LIBERDUS_DEPLOYMENT_KEY` in `.env`.
- `xAuth.redirectUri` is the frontend page the user returns to after X login, not the backend callback.

### Current Liberdus Test Frontend Example

The current test frontend is hosted at:

- `https://liberdus.com/rewards-test/`

So the test frontend config should use:

```json
{
  "apiBaseUrl": "https://att.liberdus.com/rewards-test",
  "deploymentKey": "97:0x822c39efe9055593418071a80552760282fb1b71",
  "xAuth": {
    "enabled": true,
    "redirectUri": "https://liberdus.com/rewards-test/",
    "backendUrl": "https://att.liberdus.com/rewards-test"
  }
}
```

With that config, the frontend will call:

- `https://att.liberdus.com/rewards-test/api/claims/wallet/...`
- `https://att.liberdus.com/rewards-test/api/airdrop/rounds`
- `https://att.liberdus.com/rewards-test/api/x/...`

## 4. Load Account Data Into SQLite

The backend creates the SQLite file automatically the first time you run an importer or the server.

The simplest path is the combined accounts importer:

```bash
npm run accounts:import -- --file /absolute/path/to/combined_followers_and_responses_latest_api_only.csv
```

### Supported Combined CSV Headers

The importer in [backend/import-accounts.js](</C:/Users/Chris/Documents/Code/liberdus/follower-campaign/liberdus-airdrop/backend/import-accounts.js>) understands these columns:

```csv
x_username,wallet_address,x_user_id,x_account_created_at,is_follower,needs_recovery,first_seen_following_at,last_seen_following_at,snapshots_seen_count,latest_snapshot_captured_at
```

What they mean:

- `x_username`: X username, with or without `@`
- `wallet_address`: wallet from the form, if known
- `x_user_id`: stable X user ID, if known
- `x_account_created_at`: X account creation timestamp, if known
- `is_follower`: `true` / `false`
- `needs_recovery`: `true` / `false`
- `first_seen_following_at`: earliest snapshot timestamp where the account was seen
- `last_seen_following_at`: most recent snapshot timestamp where the account was seen
- `snapshots_seen_count`: number of snapshots the account appeared in
- `latest_snapshot_captured_at`: timestamp of the latest snapshot used for that row

Practical minimum:

```csv
x_username,wallet_address,x_user_id,is_follower,needs_recovery
```

Behavior:

- rows are keyed by `x_user_id` when present, otherwise lowercase username
- existing `wallet_address` values are not overwritten
- `wallet_source` is set to `form` when `wallet_address` is provided by this importer

### Raw Imports If You Need Them

If you want to import from the raw sources instead of a combined CSV:

```bash
npm run followers:import -- --file /absolute/path/to/followers.json
npm run recovery-candidates:import -- --file /absolute/path/to/recovery-candidates.csv
npm run recovery-submissions:import -- --file /absolute/path/to/recovery-links.json
```

## 5. Create Claim Rounds Through The Admin UI

Claim rounds are created through the admin UI now.

Upload a raw claims JSON file or build the round in the admin page, then fund and start the airdrop there. Finalized rounds are stored in:

- `airdrop_rounds`
- `airdrop_claims`

Those rows are namespaced by `deployment_key`.

## 6. Run the Backend With PM2

This repo includes [backend/pm2.config.cjs](</C:/Users/Chris/Documents/Code/liberdus/follower-campaign/liberdus-airdrop/backend/pm2.config.cjs>) and these package scripts:

```bash
npm run pm2:start
npm run pm2:restart
npm run pm2:stop
npm run pm2:delete
npm run pm2:status
```

For same-server test and prod, set a different PM2 app name in each directory when starting:

Prod:

```bash
PM2_APP_NAME=liberdus-airdrop-prod npm run pm2:start
```

Test:

```bash
PM2_APP_NAME=liberdus-airdrop-test npm run pm2:start
```

After the first successful start:

```bash
npx pm2 save
npx pm2 startup
```

Useful commands:

```bash
PM2_APP_NAME=liberdus-airdrop-prod npm run pm2:restart
PM2_APP_NAME=liberdus-airdrop-test npm run pm2:restart
pm2 logs liberdus-airdrop-prod
pm2 logs liberdus-airdrop-test
pm2 status
```

## 7. Recommended Nginx Layout

A practical setup for Liberdus is:

- the frontend stays on GitHub Pages / `liberdus.com`
- `att.liberdus.com` only proxies backend API traffic
- nginx uses different path prefixes for test and prod

Recommended backend routing:

- test public backend base URL: `https://att.liberdus.com/rewards-test`
- prod public backend base URL: `https://att.liberdus.com/rewards`

Example nginx config on `att.liberdus.com`:

```nginx
server {
    server_name att.liberdus.com;

    location /rewards-test/api/ {
        proxy_pass http://127.0.0.1:8788/api/;
        proxy_set_header Host $host;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }

    location /rewards/api/ {
        proxy_pass http://127.0.0.1:8787/api/;
        proxy_set_header Host $host;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
```

With that setup:

- test `apiBaseUrl` is `https://att.liberdus.com/rewards-test`
- prod `apiBaseUrl` is `https://att.liberdus.com/rewards`
- test callback URL is `https://att.liberdus.com/rewards-test/api/x/callback`
- prod callback URL is `https://att.liberdus.com/rewards/api/x/callback`

Remember:

- the Node server binds to `127.0.0.1`
- nginx is what exposes the public HTTPS URL
- `apiBaseUrl` must be the public backend base URL, not the loopback bind URL
- `apiBaseUrl` must not include `/api`

## 8. Deploy / Update Flow

For each environment:

```bash
git pull
npm ci
cp frontend/config.prod.json frontend/config.json   # or config.test.json
# update frontend/config.json if needed
# update .env if needed
npm run accounts:import -- --file /absolute/path/to/latest-combined.csv
PM2_APP_NAME=liberdus-airdrop-prod npm run pm2:restart
```

Use the matching PM2 app name for test.

If the server clone cannot use GitHub SSH keys, set the checkout remote to HTTPS first:

```bash
git remote set-url origin https://github.com/Liberdus/liberdus-airdrop.git
```

## 9. Sanity Checks

Check backend health locally on the server:

```bash
curl http://127.0.0.1:8787/health
```

Check PM2:

```bash
pm2 status
pm2 logs liberdus-airdrop-prod
```

Check that the frontend config and backend `.env` agree on:

- chain ID
- airdrop contract address
- deployment key
- backend base URL
- X callback / return URLs
- frontend origin vs `X_AUTH_ALLOWED_ORIGINS`
