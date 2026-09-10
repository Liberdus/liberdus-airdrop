# Campaign filtering scripts

Run these scripts with Node.js 20 or later after `npm ci` in the repository root.
They process the original social-rewards form CSV using its existing column names.
Paths supplied on the command line are relative to your current directory; default
outputs are under this repository's `outputs/` directory. Each script supports
`--help` and prints its result summary as JSON.

## Validate submissions and remove duplicates

```sh
node scripts/filter_scripts/first_pass_email_dedupe.js /path/to/responses.csv
```

An optional second argument selects the output CSV. The default is
`outputs/liberdus_social_rewards_compliant_unique.csv`.

The existing filtering rules are preserved:

- Require a valid email, X username/profile, X post link, Telegram username,
  Discord username, BSC wallet address, and YouTube profile URL.
- Require the written answer to contain at least 20 characters and four words
  matched by the script's English-letter word check.
- CMC and LinkedIn may be blank, but nonblank entries must be profile URLs.
  Usernames, settings pages, and introductory text around URLs are rejected.
- Among submissions that pass validation, link duplicates by normalized email,
  wallet, X, Telegram, Discord, CMC, YouTube, or LinkedIn identity. Keep the
  earliest timestamp in each connected group, with input order as the tie-breaker.

This validates submitted formats; it does not establish X ownership, reposting,
following, or YouTube subscription. The summary reports rejection counts by rule,
not a separate per-person rejection report.

## Check Discord membership

Provide `DISCORD_BOT_TOKEN` and `DISCORD_GUILD_ID` in the environment, or set
`DISCORD_ENV_FILE` to an existing private dotenv file containing those values.
Environment variables take precedence over values in that file.

```sh
DISCORD_ENV_FILE=/path/to/private.env \
  node scripts/filter_scripts/check_community_membership.js
```

Optional arguments select the input and output CSVs. Defaults are
`outputs/liberdus_social_rewards_compliant_unique.csv` and
`outputs/liberdus_social_rewards_community_checked.csv`.

The bot needs access to the configured guild's member-search endpoint. The script
makes read-only Discord requests and adds membership status, matched Discord ID,
Telegram status, and check notes. It accepts a single exact normalized match to a
returned member's username, global display name, nickname, or legacy tag.
Multiple matches are marked `AMBIGUOUS_MATCH`; no exact match is `NOT_CONFIRMED`.
These results depend on the members returned by the prefix searches and are not
proof of ownership of the submitted Discord account. Telegram membership is not
checked and is labeled `NEEDS_TELEGRAM_USER_ID`.

## Run the complete pipeline

```sh
DISCORD_ENV_FILE=/path/to/private.env \
  node scripts/filter_scripts/process_social_rewards_end_to_end.js \
  /path/to/responses.csv /path/to/output/discord_verified.csv
```

The pipeline validates and deduplicates submissions, checks Discord membership,
then retains only `CONFIRMED_MEMBER` rows. If the output path is omitted, the final
file is `outputs/liberdus_social_rewards_discord_verified.csv`. Intermediate
`liberdus_social_rewards_compliant_unique.csv` and
`liberdus_social_rewards_community_checked.csv` files are written beside the final
file. Existing output files at these paths are overwritten.

Campaign CSVs, generated results, and bot credentials are private inputs and are
not part of these scripts. Do not commit them. The scripts do not import results
into the app database or create payouts; verified campaign CSVs can be imported
through the existing admin workflow, which handles X verification separately.
