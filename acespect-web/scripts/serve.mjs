// Serves the built web app (dist/) in production. Replaces `vite preview`, which sent every file -- including the content-hashed
// scripts -- with "Cache-Control: no-cache" and no compression of its own.
//   * /assets/* is named by content, so it never changes: cached for a year ("immutable"). A missing one is a real 404, never index.html.
//   * index.html (and any route the app handles itself) is never cached, so a new release is picked up at once.
//   * Text files are compressed (brotli or gzip, whichever the browser accepts) once and kept in memory.
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "dist");
const port = Number(process.env.PORT ?? 4173);
const types = {
  ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".mjs": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8", ".svg": "image/svg+xml", ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".webp": "image/webp",
  ".ico": "image/x-icon", ".woff": "font/woff", ".woff2": "font/woff2", ".txt": "text/plain; charset=utf-8", ".map": "application/json",
};
const compressible = new Set([".html", ".js", ".mjs", ".css", ".json", ".svg", ".txt", ".map"]);
const cache = new Map(); // "encoding|file|mtime" -> Buffer

function pick(req) {
  const a = String(req.headers["accept-encoding"] ?? "");
  return /\bbr\b/.test(a) ? "br" : /\bgzip\b/.test(a) ? "gzip" : null;
}

function send(req, res, file, { immutable }) {
  let st;
  try { st = fs.statSync(file); } catch { return false; }
  if (!st.isFile()) return false;
  const ext = path.extname(file).toLowerCase();
  const etag = `W/"${st.size.toString(16)}-${Math.floor(st.mtimeMs).toString(16)}"`;
  const headers = {
    "Content-Type": types[ext] ?? "application/octet-stream",
    ETag: etag,
    "Cache-Control": immutable ? "public, max-age=31536000, immutable" : ext === ".html" ? "no-cache" : "public, max-age=86400",
    "X-Content-Type-Options": "nosniff",
    Vary: "Accept-Encoding",
  };
  if (req.headers["if-none-match"] === etag) { res.writeHead(304, headers); res.end(); return true; }
  let body = null;
  const enc = compressible.has(ext) ? pick(req) : null;
  if (enc) {
    const key = `${enc}|${file}|${etag}`;
    body = cache.get(key) ?? null;
    if (!body) {
      const raw = fs.readFileSync(file);
      body = enc === "br" ? zlib.brotliCompressSync(raw, { params: { [zlib.constants.BROTLI_PARAM_QUALITY]: 5 } }) : zlib.gzipSync(raw, { level: 8 });
      cache.set(key, body);
    }
    headers["Content-Encoding"] = enc;
    headers["Content-Length"] = body.length;
  } else {
    headers["Content-Length"] = st.size;
  }
  res.writeHead(200, headers);
  if (req.method === "HEAD") { res.end(); return true; }
  if (body) res.end(body);
  else fs.createReadStream(file).pipe(res);
  return true;
}

http.createServer((req, res) => {
  if (req.method !== "GET" && req.method !== "HEAD") { res.writeHead(405, { Allow: "GET, HEAD" }); return res.end(); }
  let pathname;
  try { pathname = decodeURIComponent(new URL(req.url ?? "/", "http://x").pathname); } catch { res.writeHead(400); return res.end(); }
  const file = path.join(root, path.normalize(pathname));
  if (!file.startsWith(root)) { res.writeHead(403); return res.end(); }
  const hashed = pathname.startsWith("/assets/");
  if (pathname !== "/" && send(req, res, file, { immutable: hashed })) return;
  if (hashed || path.extname(pathname)) { res.writeHead(404, { "Cache-Control": "no-cache" }); return res.end("Not found"); }
  // A route of the app itself (/reviewer/review/123 ...): the single page takes it from here.
  if (!send(req, res, path.join(root, "index.html"), { immutable: false })) { res.writeHead(500); res.end("The app has not been built (dist/index.html is missing)."); }
}).listen(port, "0.0.0.0", () => console.log(`serving ${root} on ${port}`));
