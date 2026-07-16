/* Production static server for the Vite build output (dist/).
   Zero dependencies — used by Railway (and any Node host) to serve the game.
   Binds to $PORT / 0.0.0.0 as Railway requires. Does not affect the build
   or the game itself; it only serves the already-built files. */
import http from "node:http";
import { createReadStream, existsSync, statSync } from "node:fs";
import { join, normalize, extname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(fileURLToPath(new URL(".", import.meta.url)), "dist");
const ASSETS = join(ROOT, "assets");
const PORT = Number(process.env.PORT) || 8080;
const HOST = "0.0.0.0";

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".ico": "image/x-icon",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
  ".ttf": "font/ttf",
  ".wasm": "application/wasm",
  ".map": "application/json; charset=utf-8",
  ".txt": "text/plain; charset=utf-8",
};

function resolvePath(urlPath) {
  let p = decodeURIComponent(urlPath.split("?")[0].split("#")[0]);
  if (p === "/" || p === "") p = "/index.html";
  const full = normalize(join(ROOT, p));
  // Path-traversal guard: resolved path must stay inside ROOT.
  if (full !== ROOT && !full.startsWith(ROOT + "/")) return null;
  return full;
}

const server = http.createServer((req, res) => {
  if (req.method !== "GET" && req.method !== "HEAD") {
    res.writeHead(405, { Allow: "GET, HEAD" });
    return res.end("Method Not Allowed");
  }
  let filePath = resolvePath(req.url || "/");
  if (!filePath) {
    res.writeHead(403);
    return res.end("Forbidden");
  }
  // Missing file or a directory → SPA fallback to index.html.
  if (!existsSync(filePath) || statSync(filePath).isDirectory()) {
    filePath = join(ROOT, "index.html");
    if (!existsSync(filePath)) {
      res.writeHead(404);
      return res.end("Not found — did the build run? (dist/index.html missing)");
    }
  }
  const type = MIME[extname(filePath).toLowerCase()] || "application/octet-stream";
  // Hashed assets are immutable; the HTML shell must never be cached.
  const cache = filePath.startsWith(ASSETS + "/")
    ? "public, max-age=31536000, immutable"
    : "no-cache";
  res.writeHead(200, { "Content-Type": type, "Cache-Control": cache });
  if (req.method === "HEAD") return res.end();
  createReadStream(filePath).on("error", () => {
    res.writeHead(500);
    res.end("Read error");
  }).pipe(res);
});

server.listen(PORT, HOST, () => {
  console.log(`SUPER NOVUS static server listening on http://${HOST}:${PORT}`);
});
