# liberdus-airdrop

Epoch-based Merkle airdrop contract, static frontend, and Hardhat test harness for Liberdus.

This repo contains the Solidity contract, local Hardhat tests, and static wallet-connected UIs for claimants and admins against a Hardhat node.

## Contract Behavior

`EpochMerkleAirdrop` is designed around discrete airdrop epochs:

- each new epoch stores one Merkle root and one claim deadline
- multiple epochs may overlap and remain claimable at the same time
- each epoch also stores running totals of successfully claimed tokens
- claims are tracked independently per epoch with a bitmap
- claims are allowed only before the epoch deadline
- epoch deadlines are capped at 365 days from creation
- the owner can withdraw the airdrop token only after the furthest deadline across all epochs has passed
- the contract is funded by transferring the ERC20 token into it directly
- funding is pooled across epochs; the contract does not reserve balances per epoch or enforce solvency
- ownership transfers use OpenZeppelin `Ownable2Step`
- non-airdrop ERC20 tokens can be recovered by the owner through a separate recovery function

## Local Usage

```bash
npm install
npm run compile
npm test
```

## Static Frontend Pages

The frontend lives in `frontend/` and is served without any frontend framework or build step.

```bash
npm run node
npm run deploy:local
```

Then open one of:

- `http://127.0.0.1:8080/` for the claimant page
- `http://127.0.0.1:8080/admin.html` for the owner-only admin page

`npm run deploy:local` writes `frontend/config.local.json` with the current local deployment addresses used by the frontend.

Hosted claim rounds are loaded from `frontend/claims/index.json`. Each entry points at a generated `*.merkle.json` artifact. The claimant page scans those rounds for the connected wallet.

## Merkle CLI

Use the CLI generator to turn an offline claims file into a Merkle root plus per-claim proofs:

```bash
npm run merkle -- ./claims.json
```

This writes `./claims.merkle.json` by default.

You can also choose a specific output path:

```bash
npm run merkle -- ./claims.json --out ./epoch-1.merkle.json
```

To publish multiple claim rounds for the frontend, generate one `*.merkle.json` file per epoch and add each file to `frontend/claims/index.json`.

Optional flags:

- `--decimals 18`
- `--stdout`

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
- `latestDeadline()`
- `latestDeadlineEpoch()`

## Merkle Tree Format

The contract uses the OpenZeppelin standard Merkle tree leaf format:

```solidity
keccak256(bytes.concat(keccak256(abi.encode(index, account, amount))))
```

For the frontend and off-chain generation, use OpenZeppelin's `StandardMerkleTree` with leaf values shaped as:

```text
[index, account, amount]
```

with types:

```text
["uint256", "address", "uint256"]
```

Use the same leaf encoding in any future frontend, proof-generation script, or backend job. If the off-chain leaf format differs even slightly, proofs will fail on-chain.
