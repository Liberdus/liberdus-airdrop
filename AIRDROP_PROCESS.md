# Adding a New Airdrop

This repo now uses a single raw claims JSON per round.

That same raw file is used for:

1. calculating the Merkle root
2. funding the contract
3. publishing claim data for the frontend

The claimant page does not use stored proof artifacts. It loads the raw claims JSON, rebuilds the Merkle tree in the browser, and generates proofs client-side.

## 1. Create The Raw Claims JSON

You can create the raw claims JSON in either of these ways:

1. use the admin page builder to enter wallet addresses and amounts, then download the generated JSON file
2. create a file manually under [examples](C:/Users/Chris/Documents/Code/liberdus/follower-campaign/liberdus-airdrop/examples) with one entry per wallet

The generated file should contain one entry per wallet.

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
2. either build the raw claims JSON in `Build Claims JSON` and click `Use Built Claims`, or upload an existing raw claims JSON file
3. if you used the builder, click `Download JSON` to save the deployable raw claims file
4. verify the preview table, total rewards, and calculated root
5. optionally click `Fund Contract With Uploaded Total`
6. enter the deadline
7. submit `Start New Airdrop`

The contract will reject:

- zero roots
- past deadlines

## 4. Finalize In The Admin UI

The claimant page now reads round data from the backend database, not from checked-in claim manifests.

After you upload or build the raw claims JSON in the admin page and successfully start the airdrop, the admin flow finalizes the round into SQLite automatically.

Notes:

- the epoch in the raw claims JSON must still match the on-chain round you start
- the same raw claims JSON should be kept available for auditability or future review, but it does not need to live under `frontend/claims/`

## 5. Verify

After finalizing the round:

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

1. create raw claims JSON in the admin page builder or in `examples/`
2. download or save that raw claims JSON file
3. calculate the root in the admin page or with `npm run merkle`
4. fund the contract
5. start the new airdrop
6. confirm the admin flow finalizes the round into the backend DB

## Frontend Config Publishing

Hosted deployments should publish exactly one runtime config file as `frontend/config.json`.

Use:

```bash
npm run publish:config:test
```

or:

```bash
npm run publish:config:prod
```

Local development still uses the ignored `frontend/config.local.json` when running on `localhost`.
