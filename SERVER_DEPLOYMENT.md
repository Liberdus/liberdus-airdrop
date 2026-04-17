# Server Deployment

This document covers:

- running the backend with PM2
- hosting both test and prod on the same server
- loading the X account / wallet data into SQLite

This repo is designed to work well with one backend process per environment. If you run both test and prod on the same server, keep them in separate directories with separate `.env` files, separate PM2 app names, separate backend ports, and separate SQLite files.

## Recommended Layout

Example:

```text
/srv/liberdus-airdrop-prod
/srv/liberdus-airdrop-test
```

Each directory should contain its own checkout of this repo.

Recommended per-environment separation:

- prod backend port: `8787`
- test backend port: `8788`
- prod PM2 app name: `liberdus-airdrop-prod`
- test PM2 app name: `liberdus-airdrop-test`
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
X_OAUTH1_CALLBACK_URL=https://airdrop.example.com/api/x/callback
X_FRONTEND_RETURN_URL=https://airdrop.example.com/
X_FRONTEND_RETURN_URLS=https://airdrop.example.com/

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
- `X_AUTH_ALLOWED_ORIGINS` must match the frontend origin exactly.

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
  "apiBaseUrl": "https://airdrop.example.com",
  "deploymentKey": "56:0x...",
  "xAuth": {
    "enabled": true,
    "redirectUri": "https://airdrop.example.com/",
    "backendUrl": "https://airdrop.example.com"
  }
}
```

Notes:

- `apiBaseUrl` is the backend base URL, not `/api`.
- `xAuth.backendUrl` should normally match `apiBaseUrl`.
- `deploymentKey` must match `LIBERDUS_DEPLOYMENT_KEY` in `.env`.

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

## 5. Optional: Seed Old Claim Rounds

If you need to load existing file-backed claims into SQLite once:

```bash
npm run claim-rounds:import
```

That reads `LIBERDUS_CLAIMS_MANIFEST` and stores rounds in:

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

A practical setup is:

- serve the static frontend from `frontend/`
- proxy `/api/` to the local backend port

Example prod server block:

```nginx
server {
    server_name airdrop.example.com;

    root /srv/liberdus-airdrop-prod/frontend;
    index index.html;

    location / {
        try_files $uri $uri/ /index.html;
    }

    location /api/ {
        proxy_pass http://127.0.0.1:8787/api/;
        proxy_set_header Host $host;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
```

Example test server block:

```nginx
server {
    server_name test-airdrop.example.com;

    root /srv/liberdus-airdrop-test/frontend;
    index index.html;

    location / {
        try_files $uri $uri/ /index.html;
    }

    location /api/ {
        proxy_pass http://127.0.0.1:8788/api/;
        proxy_set_header Host $host;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
```

If you serve the frontend from site root like this, use:

- `https://airdrop.example.com/` as the X return URL
- `https://airdrop.example.com/api/x/callback` as the X callback URL

If you instead serve it at `/frontend/`, then use `/frontend/` everywhere consistently. Exact match matters.

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
