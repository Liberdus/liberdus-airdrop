const { execFileSync } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");

if (process.argv[2] === "--help" || !process.argv[2] || process.argv.length > 4) {
  console.error("Usage: node scripts/filter_scripts/process_social_rewards_end_to_end.js <input.csv> [output.csv]");
  process.exit(process.argv[2] === "--help" ? 0 : 1);
}
const repoRoot = path.resolve(__dirname, "../..");
const inputPath = path.resolve(process.argv[2]);
const finalPath = path.resolve(process.argv[3] || path.join(repoRoot, "outputs/liberdus_social_rewards_discord_verified.csv"));
const compliantPath = path.join(path.dirname(finalPath), "liberdus_social_rewards_compliant_unique.csv");
const checkedPath = path.join(path.dirname(finalPath), "liberdus_social_rewards_community_checked.csv");

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

function run(script, args) {
  const output = execFileSync(process.execPath, [path.join(__dirname, script), ...args], {
    cwd: repoRoot,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "inherit"],
  });
  return JSON.parse(output);
}

const compliance = run("first_pass_email_dedupe.js", [inputPath, compliantPath]);
const community = run("check_community_membership.js", [compliantPath, checkedPath]);
const matrix = parseCsv(fs.readFileSync(checkedPath, "utf8").replace(/^\uFEFF/, ""));
const headers = matrix[0];
const statusColumn = headers.indexOf("Discord Community Status");
if (statusColumn < 0) throw new Error("Discord Community Status column was not found");
const verified = matrix.slice(1).filter(row => row.some(Boolean) && row[statusColumn] === "CONFIRMED_MEMBER");
fs.mkdirSync(path.dirname(finalPath), { recursive: true });
fs.writeFileSync(finalPath, [headers, ...verified].map(row => row.map(csvEscape).join(",")).join("\r\n") + "\r\n");

console.log(JSON.stringify({
  originalRows: compliance.inputRows,
  complianceRejectedRows: compliance.complianceRejectedRows,
  duplicateRemovedRows: compliance.duplicateRemovedRows,
  compliantUniqueRows: compliance.outputRows,
  discordConfirmedRows: verified.length,
  discordNotConfirmedRows: community.discord.NOT_CONFIRMED || 0,
  telegramStatus: "NEEDS_TELEGRAM_USER_ID",
  finalPath,
}, null, 2));
