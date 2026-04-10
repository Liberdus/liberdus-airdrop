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

## Static Frontend

The frontend lives in `frontend/` and is served without any frontend framework or build step.

```bash
npm run node
npm run deploy:local
```

`npm run deploy:local` writes `frontend/config.local.json` with the current local deployment addresses used by the frontend.

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
