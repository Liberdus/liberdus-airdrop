# Adding a New Airdrop

This repo now uses a single raw claims JSON per round.

That same raw file is used for:

1. calculating the Merkle root
2. funding the contract
3. publishing claim data for the frontend

The claimant page does not use stored proof artifacts. It loads the raw claims JSON, rebuilds the Merkle tree in the browser, and generates proofs client-side.

## 1. Create The Raw Claims JSON

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
- each wallet should appear only once per round
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

## 2. Calculate The Merkle Root

You can calculate the root either in the admin UI or with the CLI.

CLI:

```bash
npm run merkle -- .\examples\my-round.claims.json
```

That prints:

- the Merkle root
- claim count
- total rewards

If you want a JSON summary instead:

```bash
npm run merkle -- .\examples\my-round.claims.json --stdout
```

## 3. Fund And Start The Airdrop

Open the admin page:

- [admin.html](C:/Users/Chris/Documents/Code/liberdus/follower-campaign/liberdus-airdrop/frontend/admin.html)

Then:

1. connect the owner wallet
2. upload the raw claims JSON file
3. verify the preview table, total rewards, and calculated root
4. optionally click `Fund Contract With Uploaded Total`
5. enter the deadline
6. submit `Start New Airdrop`

The contract will reject:

- zero roots
- past deadlines

## 4. Publish The Raw Claims File

To make the claimant page aware of the new round:

1. copy the raw claims JSON file into [frontend/claims](C:/Users/Chris/Documents/Code/liberdus/follower-campaign/liberdus-airdrop/frontend/claims)
2. add a row to [index.json](C:/Users/Chris/Documents/Code/liberdus/follower-campaign/liberdus-airdrop/frontend/claims/index.json)

Example:

```json
{
  "epoch": 11,
  "file": "./my-round.claims.json"
}
```

Notes:

- `epoch` must match the on-chain epoch you started
- `file` must point to the raw claims JSON, not a generated proof artifact

## 5. Verify

After publishing:

1. reload the claimant page
2. connect a wallet that has an allocation
3. confirm the claim appears
4. confirm the displayed amount matches the raw claims JSON
5. test a claim

## Optional Deadline Updates

If you need to close or reschedule an epoch after launch:

1. open the admin page
2. use `Epoch Management`
3. set a new future deadline, or disable the epoch by setting its deadline to `0`

The claimant page treats a deadline of `0` as closed.

## Summary

The normal workflow is:

1. create raw claims JSON in `examples/`
2. calculate the root in the admin page or with `npm run merkle`
3. fund the contract
4. start the new airdrop
5. copy the same raw claims JSON into `frontend/claims/`
6. add the epoch/file mapping to `frontend/claims/index.json`
