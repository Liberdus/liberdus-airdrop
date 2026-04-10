export async function sendTransaction(label, action, { log, afterSuccess, formatError }) {
  try {
    const tx = await action();
    log(`${label}: submitted ${tx.hash}`);
    const receipt = await tx.wait();
    log(`${label}: confirmed in block ${receipt.blockNumber}`, "success");
    if (afterSuccess) await afterSuccess(receipt);
    return receipt;
  } catch (error) {
    throw new Error(formatError ? formatError(error, label) : `${label}: ${String(error)}`);
  }
}
