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
