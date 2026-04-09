# liberdus-airdrop

Epoch-based Merkle airdrop contract and Hardhat test harness for Liberdus.

This repo currently contains the Solidity contract and local Hardhat tests for the airdrop system. The static claim site is not included yet.

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
