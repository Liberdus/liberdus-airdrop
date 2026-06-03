const fs = require("node:fs");
const http = require("node:http");
const path = require("node:path");

const HOST = "127.0.0.1";
const PORT = Number(process.env.PORT || 4173);
const ROOT_DIR = path.resolve(__dirname, "..", "..");

const MIME_TYPES = {
  ".css": "text/css; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".ico": "image/x-icon",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".txt": "text/plain; charset=utf-8",
  ".woff2": "font/woff2",
};

function send(response, statusCode, body, contentType = "text/plain; charset=utf-8") {
  response.writeHead(statusCode, {
    "Cache-Control": "no-store",
    "Content-Type": contentType,
  });
  response.end(body);
}

function resolveFilePath(urlPathname) {
  const normalizedPath = path
    .normalize(decodeURIComponent(urlPathname))
    .replace(/^(\.\.[/\\])+/, "");
  const candidatePath = path.resolve(ROOT_DIR, `.${normalizedPath}`);

  if (!candidatePath.startsWith(ROOT_DIR)) {
    return null;
  }

  if (fs.existsSync(candidatePath) && fs.statSync(candidatePath).isDirectory()) {
    return path.join(candidatePath, "index.html");
  }

  return candidatePath;
}

const server = http.createServer((request, response) => {
  const requestUrl = new URL(request.url || "/", `http://${request.headers.host || `${HOST}:${PORT}`}`);
  const filePath = resolveFilePath(requestUrl.pathname === "/" ? "/frontend/index.html" : requestUrl.pathname);

  if (!filePath || !fs.existsSync(filePath) || !fs.statSync(filePath).isFile()) {
    send(response, 404, "Not Found");
    return;
  }

  const contentType = MIME_TYPES[path.extname(filePath).toLowerCase()] || "application/octet-stream";
  response.writeHead(200, {
    "Cache-Control": "no-store",
    "Content-Type": contentType,
  });
  fs.createReadStream(filePath).pipe(response);
});

server.listen(PORT, HOST, () => {
  console.log(`Static E2E server listening on http://${HOST}:${PORT}`);
});
