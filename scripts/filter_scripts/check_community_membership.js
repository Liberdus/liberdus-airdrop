const fs = require("node:fs");
const path = require("node:path");

if (process.argv[2] === "--help" || process.argv.length > 4) {
  console.error("Usage: node scripts/filter_scripts/check_community_membership.js [input.csv] [output.csv]");
  process.exit(process.argv[2] === "--help" ? 0 : 1);
}
const repoRoot = path.resolve(__dirname, "../..");
const inputPath = path.resolve(process.argv[2] || path.join(repoRoot, "outputs/liberdus_social_rewards_compliant_unique.csv"));
const outputPath = path.resolve(process.argv[3] || path.join(repoRoot, "outputs/liberdus_social_rewards_community_checked.csv"));

function loadDiscordConfig() {
  const fileConfig = process.env.DISCORD_ENV_FILE
    ? require("dotenv").parse(fs.readFileSync(path.resolve(process.env.DISCORD_ENV_FILE), "utf8"))
    : {};
  return { ...fileConfig, ...process.env };
}

function parseCsv(text) {
  const rows = [];
  let row = [], field = "", quoted = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (quoted) {
      if (ch === '"' && text[i + 1] === '"') { field += '"'; i++; }
      else if (ch === '"') quoted = false;
      else field += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ',') { row.push(field); field = ""; }
    else if (ch === '\n') { row.push(field.replace(/\r$/, "")); rows.push(row); row = []; field = ""; }
    else field += ch;
  }
  if (field.length || row.length) { row.push(field.replace(/\r$/, "")); rows.push(row); }
  return rows;
}

const csvEscape = value => /[",\r\n]/.test(String(value ?? ""))
  ? `"${String(value ?? "").replaceAll('"', '""')}"`
  : String(value ?? "");
const normalize = value => String(value || "").trim().replace(/^@/, "").toLowerCase();
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

function exactDiscordMatch(member, submitted) {
  const user = member?.user || {};
  const discriminator = String(user.discriminator || "");
  const candidates = [user.username, user.global_name, member?.nick];
  if (user.username && discriminator && discriminator !== "0") candidates.push(`${user.username}#${discriminator}`);
  return candidates.some(value => normalize(value) === normalize(submitted));
}

async function discordSearch(token, guildId, query) {
  const url = `https://discord.com/api/v10/guilds/${encodeURIComponent(guildId)}/members/search?query=${encodeURIComponent(query)}&limit=1000`;
  for (let attempt = 0; attempt < 5; attempt++) {
    const response = await fetch(url, { headers: { Authorization: `Bot ${token}` } });
    const payload = await response.json().catch(() => ({}));
    if (response.status === 429) {
      await sleep(Math.ceil(Number(payload.retry_after || 1) * 1000) + 100);
      continue;
    }
    if (!response.ok) throw new Error(`Discord member search failed with HTTP ${response.status}`);
    return payload;
  }
  throw new Error("Discord rate-limit retries exhausted");
}

async function main() {
  const env = loadDiscordConfig();
  if (!env.DISCORD_BOT_TOKEN || !env.DISCORD_GUILD_ID) throw new Error("Discord bot token or guild ID is not configured");
  const matrix = parseCsv(fs.readFileSync(inputPath, "utf8").replace(/^\uFEFF/, ""));
  const headers = matrix[0];
  const rows = matrix.slice(1).filter(row => row.some(Boolean));
  const discordColumn = headers.indexOf("Join the Liberdus Discord, then please provide your Discord username.");
  if (discordColumn < 0) throw new Error("Discord username column was not found");
  const submitted = rows.map(row => row[discordColumn]);
  const prefixGroups = new Map();
  submitted.forEach(value => {
    const prefix = normalize(value).split("#")[0].slice(0, 1);
    if (!prefixGroups.has(prefix)) prefixGroups.set(prefix, []);
    prefixGroups.get(prefix).push(value);
  });
  const candidates = new Map();
  for (const [prefix, values] of prefixGroups) {
    let members = await discordSearch(env.DISCORD_BOT_TOKEN, env.DISCORD_GUILD_ID, prefix);
    // The endpoint caps a response at 1000; refine only saturated prefixes.
    if (members.length >= 1000) {
      members = [];
      for (const query of new Set(values.map(value => normalize(value).split("#")[0].slice(0, 2)))) {
        members.push(...await discordSearch(env.DISCORD_BOT_TOKEN, env.DISCORD_GUILD_ID, query));
      }
    }
    candidates.set(prefix, [...new Map(members.map(member => [member.user.id, member])).values()]);
  }
  const results = submitted.map(value => {
    const prefix = normalize(value).split("#")[0].slice(0, 1);
    const exact = (candidates.get(prefix) || []).filter(member => exactDiscordMatch(member, value));
    if (exact.length === 1) return { status: "CONFIRMED_MEMBER", userId: String(exact[0].user.id), note: "Exact guild-member identity match" };
    if (exact.length > 1) return { status: "AMBIGUOUS_MATCH", userId: "", note: `${exact.length} exact display/nickname matches` };
    return { status: "NOT_CONFIRMED", userId: "", note: "No exact guild-member identity match" };
  });
  const outputHeaders = [...headers, "Discord Community Status", "Discord Matched User ID", "Telegram Community Status", "Community Check Notes"];
  const outputRows = rows.map((row, i) => [...row, results[i].status, results[i].userId, "NEEDS_TELEGRAM_USER_ID", results[i].note]);
  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  fs.writeFileSync(outputPath, [outputHeaders, ...outputRows].map(row => row.map(csvEscape).join(",")).join("\r\n") + "\r\n");
  const counts = results.reduce((all, result) => ({ ...all, [result.status]: (all[result.status] || 0) + 1 }), {});
  console.log(JSON.stringify({ inputRows: rows.length, outputRows: outputRows.length, discord: counts, telegram: { NEEDS_TELEGRAM_USER_ID: rows.length }, outputPath }, null, 2));
}

main().catch(error => { console.error(error.message); process.exit(1); });
