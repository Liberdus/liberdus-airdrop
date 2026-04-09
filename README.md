# liberdus-airdrop

Epoch-based Merkle airdrop contract and Hardhat test harness for Liberdus.

This repo currently contains the Solidity contract and local Hardhat tests for the airdrop system. The static claim site is not included yet.

## Contract Behavior

`EpochMerkleAirdrop` is designed around discrete airdrop epochs:

- each new epoch stores one Merkle root and one claim deadline
- claims are tracked independently per epoch with a bitmap
- claims are allowed only before the epoch deadline
- the owner can withdraw the airdrop token only after the latest epoch deadline has passed
- the contract is funded by transferring the ERC20 token into it directly
- non-airdrop ERC20 tokens can be recovered by the owner through a separate recovery function

## Local Usage

```bash
npm install
npm run compile
npm test
```

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
