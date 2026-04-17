const { expect } = require("@playwright/test");

async function connectViaWalletPicker(page) {
  await page.getByRole("button", { name: "Connect Wallet" }).click();
  await page.getByRole("button", { name: /MetaMask/i }).click();
}

async function openWalletMenu(page, addressPattern) {
  await page.getByRole("button", { name: addressPattern }).click();
}

async function setFutureDeadline(page, selector, minutesAhead = 90) {
  const value = await page.evaluate((targetMinutesAhead) => {
    const target = new Date(Date.now() + (targetMinutesAhead * 60 * 1000));
    const offsetMs = target.getTimezoneOffset() * 60 * 1000;
    return new Date(target.getTime() - offsetMs).toISOString().slice(0, 16);
  }, minutesAhead);

  await page.locator(selector).fill(value);
}

async function getLocalDateTimeInputValue(page, unixTimestamp) {
  return page.evaluate((timestamp) => {
    const target = new Date(Number(timestamp) * 1000);
    const offsetMs = target.getTimezoneOffset() * 60 * 1000;
    return new Date(target.getTime() - offsetMs).toISOString().slice(0, 16);
  }, unixTimestamp);
}

async function getUtcDateTimeInputValue(page, unixTimestamp) {
  return page.evaluate((timestamp) => {
    return new Date(Number(timestamp) * 1000).toISOString().slice(0, 16);
  }, unixTimestamp);
}

async function startAirdropFromUpload(page, claimsFile, { deadlineSelector = "#startDeadlineInput" } = {}) {
  const currentEpochText = (await page.locator("#currentEpoch").textContent())?.trim() || "0";
  const currentEpoch = Number.parseInt(currentEpochText, 10) || 0;

  await page.locator("#uploadClaimsFileInput").setInputFiles(claimsFile);
  await setFutureDeadline(page, deadlineSelector);
  await page.getByRole("button", { name: "Fund Contract" }).click();
  await page.getByText("Fund airdrop complete.").waitFor();
  await page.getByRole("button", { name: "Start New Airdrop" }).click();
  await expect(page.locator("#currentEpoch")).toHaveText(String(currentEpoch + 1));
}

module.exports = {
  connectViaWalletPicker,
  getLocalDateTimeInputValue,
  getUtcDateTimeInputValue,
  openWalletMenu,
  setFutureDeadline,
  startAirdropFromUpload,
};
