// Placeholder photographs of known shapes -- labelled SVGs served locally -- for checking how the report lays photos out.
import { createServer } from "node:http";

export const SHAPES = {
  P: { w: 900, h: 1200, name: "PORTRAIT 3:4", color: "#2f6f9f" },
  L: { w: 1200, h: 900, name: "LANDSCAPE 4:3", color: "#b86a2d" },
  S: { w: 1000, h: 1000, name: "SQUARE 1:1", color: "#4d8f5a" },
  W: { w: 1800, h: 600, name: "PANORAMA 3:1", color: "#8a4f9e" },
  T: { w: 600, h: 1200, name: "TALL 1:2", color: "#a33a4a" },
  X: { w: 2400, h: 600, name: "VERY WIDE 4:1", color: "#2f8f8f" },
  Y: { w: 600, h: 2400, name: "VERY TALL 1:4", color: "#8f6f2f" },
};

export const svgFor = (kind, n, rawSet) => {
  const s = SHAPES[kind];
  const set = String(rawSet).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;"); // a label such as "Notes & Defects" must not break the SVG
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${s.w}" height="${s.h}" viewBox="0 0 ${s.w} ${s.h}"><rect width="100%" height="100%" fill="${s.color}"/><rect x="12" y="12" width="${s.w - 24}" height="${s.h - 24}" fill="none" stroke="white" stroke-width="8"/><line x1="0" y1="0" x2="${s.w}" y2="${s.h}" stroke="white" stroke-opacity=".35" stroke-width="6"/><line x1="${s.w}" y1="0" x2="0" y2="${s.h}" stroke="white" stroke-opacity=".35" stroke-width="6"/><text x="50%" y="42%" font-family="Arial" font-size="${Math.min(s.w, s.h) / 3}" font-weight="700" fill="white" text-anchor="middle">${kind}${n}</text><text x="50%" y="58%" font-family="Arial" font-size="${Math.min(s.w, s.h) / 11}" fill="white" text-anchor="middle">${s.name}</text><text x="50%" y="68%" font-family="Arial" font-size="${Math.min(s.w, s.h) / 14}" fill="white" fill-opacity=".85" text-anchor="middle">${set}</text></svg>`;
};

/** Starts the little server the placeholders come from; resolves with the http server (close it when done). */
export function startPhotoServer(port) {
  const server = createServer((req, res) => {
    const m = /^\/photo\/([A-Z])(\d+)\/(.+)\.svg$/.exec((req.url ?? "").split("?")[0]);
    if (!m || !SHAPES[m[1]]) { res.writeHead(404).end(); return; }
    res.writeHead(200, { "Content-Type": "image/svg+xml", "Access-Control-Allow-Origin": "*", "Cache-Control": "no-store" }).end(svgFor(m[1], m[2], decodeURIComponent(m[3])));
  });
  return new Promise((ok) => server.listen(port, () => ok(server)));
}

/** "P P L" -> the URLs of a portrait, a portrait and a landscape placeholder, each labelled with `set`. */
export const photosOf = (shapes, set, port) => [...shapes.replace(/\s+/g, "")].map((k, i) => `http://localhost:${port}/photo/${k}${i + 1}/${encodeURIComponent(set)}.svg`);

/** Serves the picture files in `dir` at http://localhost:<port>/<file name> (for sample reports built from real photographs). */
export async function serveFolder(port, dir) {
  const { readFileSync, existsSync } = await import("node:fs");
  const { join, basename, extname } = await import("node:path");
  const types = { ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".png": "image/png" };
  const server = createServer((req, res) => {
    const file = join(dir, basename(decodeURIComponent((req.url ?? "").split("?")[0])));
    if (!existsSync(file) || !types[extname(file).toLowerCase()]) { res.writeHead(404).end(); return; }
    res.writeHead(200, { "Content-Type": types[extname(file).toLowerCase()], "Access-Control-Allow-Origin": "*", "Cache-Control": "no-store" }).end(readFileSync(file));
  });
  return new Promise((ok) => server.listen(port, () => ok(server)));
}
