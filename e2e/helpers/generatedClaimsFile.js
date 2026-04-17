const fs = require("node:fs");
const path = require("node:path");

function writeClaimsFixtureFile(testInfo, fileName, claims) {
  const filePath = testInfo.outputPath(fileName);
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify({ claims }, null, 2), "utf8");
  return filePath;
}

module.exports = {
  writeClaimsFixtureFile,
};
