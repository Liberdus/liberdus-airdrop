const fs = require("node:fs");
const path = require("node:path");

if (process.argv[2] === "--help" || !process.argv[2] || process.argv.length > 4) {
  console.error("Usage: node scripts/filter_scripts/first_pass_email_dedupe.js <input.csv> [output.csv]");
  process.exit(process.argv[2] === "--help" ? 0 : 1);
}
const repoRoot = path.resolve(__dirname, "../..");
const inputPath = path.resolve(process.argv[2]);
const outputPath = path.resolve(process.argv[3] ?? path.join(repoRoot, "outputs/liberdus_social_rewards_compliant_unique.csv"));

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

function csvEscape(value) {
  const text = value ?? "";
  return /[",\r\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

const compact = value => (value ?? "").trim().toLowerCase().replace(/\s+/g, "");
const xUser = value => {
  let text = (value ?? "").trim().toLowerCase();
  text = text.replace(/^https?:\/\/(www\.)?(x|twitter)\.com\//, "")
             .replace(/^(www\.)?(x|twitter)\.com\//, "");
  return compact(text.split("?")[0].replace(/^\/+|\/+$/g, "").split("/")[0]).replace(/^@/, "");
};
const validWallet = value => /^0x[a-f0-9]{40}$/.test(compact(value)) ? compact(value) : "";
const validXUser = value => {
  const user = xUser(value);
  return /^[a-z0-9_]{1,15}$/.test(user) && user !== "liberdus" ? user : "";
};
const nullValues = new Set(["", "n/a", "na", "nil", "nill", "none", "no", "null", "not applicable", "-"]);
const badValues = new Set(["yes", "y", "done", "joined", "subscribed", "followed", "completed", "test", "testing", "."]);
const normalizedText = value => (value ?? "").trim().toLowerCase().replace(/\s+/g, " ");
const isBlankOptional = value => nullValues.has(normalizedText(value));
const validEmail = value => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test((value ?? "").trim());
const validRepost = value => /^https?:\/\/(?:www\.)?(?:x|twitter)\.com\/[A-Za-z0-9_]{1,15}\/status\/\d+(?:[/?#].*)?$/i.test((value ?? "").trim());
const telegramUser = value => {
  let text = (value ?? "").trim();
  text = text.replace(/^https?:\/\/(?:t\.me|telegram\.me)\//i, "").split("?")[0].replace(/^@/, "").replace(/^\/+|\/+$/g, "");
  return /^[A-Za-z][A-Za-z0-9_]{4,31}$/.test(text) ? text.toLowerCase() : "";
};
const discordUser = value => {
  const text = (value ?? "").trim().replace(/^@/, "");
  const normalized = normalizedText(text);
  if (nullValues.has(normalized) || badValues.has(normalized) || /https?:\/\/|discord\.(?:gg|com\/invite)/i.test(text)) return "";
  return text.length >= 2 && text.length <= 37 && /[A-Za-z0-9]/.test(text) ? text.toLowerCase() : "";
};
const cmcProfile = value => {
  const text = (value ?? "").trim();
  const match = text.match(/^https?:\/\/(?:www\.)?coinmarketcap\.com\/community\/profile\/([^/?#]+)\/?(?:\?[^\s]*)?$/i);
  return match ? match[1].toLowerCase() : "";
};
const youtubeProfile = value => {
  const text = (value ?? "").trim();
  const match = text.match(/^https?:\/\/(?:www\.|m\.)?youtube\.com\/(?:@[^/?#]+|channel\/[^/?#]+|user\/[^/?#]+|c\/[^/?#]+)\/?(?:\?[^\s]*)?$/i);
  return match ? match[0].toLowerCase().split("?")[0].replace(/\/$/, "") : "";
};
const linkedinProfile = value => {
  const text = (value ?? "").trim();
  const match = text.match(/^https?:\/\/(?:[a-z]{2,3}\.)?linkedin\.com\/(?:in|company)\/([^/?#]+)\/?(?:\?[^\s]*)?$/i);
  return match ? match[1].toLowerCase() : "";
};
const substantiveAnswer = value => {
  const text = normalizedText(value);
  const words = text.match(/[a-z]{2,}/g) ?? [];
  return text.length >= 20 && words.length >= 4 && !nullValues.has(text) && !badValues.has(text) && !/^(yes[\s,;.!]*)+$/i.test(text);
};

const raw = fs.readFileSync(inputPath, "utf8").replace(/^\uFEFF/, "");
const matrix = parseCsv(raw);
const headers = matrix[0];
const records = matrix.slice(1).filter(row => row.some(value => value !== ""));
const index = Object.fromEntries(headers.map((header, i) => [header, i]));
const names = {
  timestamp: "Timestamp",
  x: "Follow @Liberdus on X, then please provided the link to your X profile page.",
  telegram: "Join our @LiberdusOfficial Telegram Channel, then please provide your Telegram username.",
  discord: "Join the Liberdus Discord, then please provide your Discord username.",
  wallet: "What is your Binance Smart Chain address?",
  email: "Email Address",
};

const optionalValid = (value, validator) => isBlankOptional(value) || Boolean(validator(value));
const complianceReasons = records.map(row => {
  const reasons = [];
  if (!validEmail(row[index[names.email]])) reasons.push("INVALID_EMAIL");
  if (!validXUser(row[index[names.x]])) reasons.push("INVALID_X_PROFILE");
  if (!validRepost(row[index["Like and repost the Liberdus social rewards campaign post on X, then please provide the link to your repost."]])) reasons.push("INVALID_X_REPOST_LINK");
  if (!telegramUser(row[index[names.telegram]])) reasons.push("INVALID_TELEGRAM");
  if (!discordUser(row[index[names.discord]])) reasons.push("INVALID_DISCORD");
  if (!validWallet(row[index[names.wallet]])) reasons.push("INVALID_WALLET");
  if (!substantiveAnswer(row[index["In your own words, what are your favourite features of Liberdus and why? You can learn more about Liberdus features on our website."]])) reasons.push("INVALID_WRITTEN_ANSWER");
  if (!optionalValid(row[index["If you have a CoinMarketCap (CMC) account, you can follow @liberdus, then provide your link to your CoinMarketCap profile."]], cmcProfile)) reasons.push("INVALID_OPTIONAL_CMC");
  if (!youtubeProfile(row[index["Subscribe to the Liberdus YouTube channel, then please provide the link to your Youtube profile."]])) reasons.push("INVALID_YOUTUBE");
  if (!optionalValid(row[index["If you have LinkedIn you can follow Liberdus, then provide the link to your LinkedIn profile."]], linkedinProfile)) reasons.push("INVALID_OPTIONAL_LINKEDIN");
  return reasons;
});
const compliantIndexes = records.map((_, i) => i).filter(i => complianceReasons[i].length === 0);

// Build connected identity clusters across compliant rows. Repeated normalized
// identifiers link submissions; only the earliest row in each cluster survives.
const parent = records.map((_, i) => i);
const find = i => {
  while (parent[i] !== i) { parent[i] = parent[parent[i]]; i = parent[i]; }
  return i;
};
const union = (a, b) => {
  a = find(a); b = find(b);
  if (a !== b) parent[b] = a;
};
const keyDefinitions = [
  ["email", names.email, compact],
  ["wallet", names.wallet, validWallet],
  ["x", names.x, validXUser],
  ["telegram", names.telegram, telegramUser],
  ["discord", names.discord, discordUser],
  ["cmc", "If you have a CoinMarketCap (CMC) account, you can follow @liberdus, then provide your link to your CoinMarketCap profile.", cmcProfile],
  ["youtube", "Subscribe to the Liberdus YouTube channel, then please provide the link to your Youtube profile.", youtubeProfile],
  ["linkedin", "If you have LinkedIn you can follow Liberdus, then provide the link to your LinkedIn profile.", linkedinProfile],
];
const repeatedKeyCounts = {};
for (const [keyName, field, transform] of keyDefinitions) {
  const seen = new Map();
  let repeatedRows = 0;
  compliantIndexes.forEach(i => {
    const row = records[i];
    const value = transform(row[index[field]]);
    if (!value) return;
    if (seen.has(value)) {
      union(i, seen.get(value));
      repeatedRows++;
    } else {
      seen.set(value, i);
    }
  });
  repeatedKeyCounts[keyName] = repeatedRows;
}

const components = new Map();
compliantIndexes.forEach(originalIndex => {
  const row = records[originalIndex];
  const root = find(originalIndex);
  if (!components.has(root)) components.set(root, []);
  components.get(root).push({ row, originalIndex });
});

const duplicateRemoved = new Set();
let duplicateComponents = 0;
for (const component of components.values()) {
  if (component.length < 2) continue;
  duplicateComponents++;
  const ordered = [...component].sort((a, b) => {
    const ta = Date.parse(a.row[index[names.timestamp]]) || Number.MAX_SAFE_INTEGER;
    const tb = Date.parse(b.row[index[names.timestamp]]) || Number.MAX_SAFE_INTEGER;
    return ta - tb || a.originalIndex - b.originalIndex;
  });
  ordered.slice(1).forEach(item => duplicateRemoved.add(item.originalIndex));
}

const kept = records.filter((_, i) => complianceReasons[i].length === 0 && !duplicateRemoved.has(i));
fs.mkdirSync(path.dirname(outputPath), { recursive: true });
const output = [headers, ...kept].map(row => row.map(csvEscape).join(",")).join("\r\n") + "\r\n";
fs.writeFileSync(outputPath, output, "utf8");

console.log(JSON.stringify({
  inputRows: records.length,
  outputRows: kept.length,
  complianceRejectedRows: complianceReasons.filter(reasons => reasons.length).length,
  duplicateRemovedRows: duplicateRemoved.size,
  removedRows: records.length - kept.length,
  duplicateComponents,
  repeatedKeyCounts,
  complianceReasonCounts: Object.fromEntries([...new Set(complianceReasons.flat())].sort().map(reason => [reason, complianceReasons.filter(reasons => reasons.includes(reason)).length])),
  outputPath,
}, null, 2));
