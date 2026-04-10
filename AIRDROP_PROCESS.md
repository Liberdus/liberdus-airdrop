# Adding a New Airdrop

This repo uses a two-file flow for each airdrop round:

1. a simple source claims JSON you create manually
2. a generated Merkle artifact JSON the frontend uses for claiming

The source claims JSON is the human-edited input. The generated Merkle artifact contains the Merkle root plus each wallet's proof data.

## 1. Create The Source Claims JSON

Create a file under [examples](C:/Users/Chris/Documents/Code/liberdus/follower-campaign/liberdus-airdrop/examples) with one entry per wallet.

Example:

```json
[
  {
    "index": 0,
    "account": "0x1111111111111111111111111111111111111111",
    "amount": "100"
  },
  {
    "index": 1,
    "account": "0x2222222222222222222222222222222222222222",
    "amount": "250.5"
  }
]
```

Rules:

- `index` must be unique per row
- `index` should usually start at `0` and increase by `1`
- `account` must be a valid EVM address
- use `amount` for human token units like `"100"` or `"250.5"`
- if you already have base units, you can use `amountRaw` instead of `amount`

Example using `amountRaw`:

```json
[
  {
    "index": 0,
    "account": "0x1111111111111111111111111111111111111111",
    "amountRaw": "100000000000000000000"
  }
]
```

## 2. Generate The Merkle Artifact

From [liberdus-airdrop](C:/Users/Chris/Documents/Code/liberdus/follower-campaign/liberdus-airdrop), run:

```bash
npm run merkle -- .\examples\my-round.claims.json --out .\frontend\claims\my-round.merkle.json
```

This does two things:

- prints the Merkle root in the terminal
- writes the generated proof artifact to `frontend/claims/`

The output artifact includes:

- `root`
- `leafEncoding`
- `decimals`
- `generatedAt`
- `sourceFile`
- `claims[]` with `index`, `account`, `amount`, `amountRaw`, and `proof`

## 3. Start The Airdrop On-Chain

Open the admin page:

- [admin.html](C:/Users/Chris/Documents/Code/liberdus/follower-campaign/liberdus-airdrop/frontend/admin.html)

Then:

1. connect the owner wallet
2. fund the airdrop contract with enough LIB
3. copy the printed Merkle root from the CLI output
4. paste that root into the `Merkle Root` field
5. enter the deadline
6. submit `Start New Airdrop`

The contract will reject:

- zero roots
- past deadlines
- deadlines more than 365 days out

## 4. Publish The Claim Artifact To The Frontend

To make the claimant page aware of the new round:

1. keep the generated `*.merkle.json` file in [frontend/claims](C:/Users/Chris/Documents/Code/liberdus/follower-campaign/liberdus-airdrop/frontend/claims)
2. add a row to [index.json](C:/Users/Chris/Documents/Code/liberdus/follower-campaign/liberdus-airdrop/frontend/claims/index.json)

Example:

```json
{
  "epoch": 11,
  "file": "./my-round.merkle.json"
}
```

Notes:

- `epoch` must match the on-chain epoch you started
- `file` must point to the generated Merkle artifact, not the source claims JSON

## 5. Verify

After publishing:

1. reload the claimant page
2. connect a wallet that has an allocation
3. confirm the round appears
4. confirm the claim amount matches the source JSON
5. test a claim

## Summary

The normal workflow is:

1. create source claims JSON in `examples/`
2. generate a Merkle artifact with `npm run merkle`
3. fund the contract
4. start the new airdrop with the generated root
5. add the generated artifact to `frontend/claims/`
6. add the epoch/file mapping to `frontend/claims/index.json`
