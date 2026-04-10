export function createLogger(element) {
  function log(message, type = "info") {
    if (!element) return;
    const stamp = new Date().toLocaleTimeString();
    const prefix = type === "error" ? "[error]" : type === "success" ? "[ok]" : "[info]";
    const line = `${stamp} ${prefix} ${message}`;
    element.textContent = element.textContent ? `${line}\n${element.textContent}` : line;
  }

  function clear() {
    if (element) element.textContent = "";
  }

  return { log, clear };
}
