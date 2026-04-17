export async function sendTransaction(label, action, {
  log,
  afterSubmit,
  afterSuccess,
  formatError,
}) {
  try {
    const tx = await action();
    log(`${label}: submitted ${tx.hash}`);
    if (afterSubmit) await afterSubmit(tx);
    const receipt = await tx.wait();
    log(`${label}: confirmed in block ${receipt.blockNumber}`, "success");
    if (afterSuccess) await afterSuccess(receipt);
    return receipt;
  } catch (error) {
    throw new Error(formatError ? formatError(error, label) : `${label}: ${String(error)}`);
  }
}
