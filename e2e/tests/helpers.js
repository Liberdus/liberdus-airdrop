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

module.exports = {
  connectViaWalletPicker,
  openWalletMenu,
  setFutureDeadline,
};
