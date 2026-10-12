#!/usr/bin/env node
// Writes the placeholder photographs the sample reports use (scripts/lib/placeholder-photos.mjs) as real JPEG files, one folder per mix of
// shapes, so the same photos can be used by hand -- e.g. uploaded from the app -- to try a layout.
//
//   node scripts/export-placeholder-photos.mjs <out folder>
import { mkdirSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { join, resolve } from "node:path";
import { SHAPES, svgFor } from "./lib/placeholder-photos.mjs";

const out = resolve(process.argv[2] ?? "placeholder-photos");
const puppeteer = createRequire(new URL("../../acespect-backend/package.json", import.meta.url))("puppeteer");
const MIXES = ["P P L", "L L P", "P P P", "L L L", "P L P L P", "P", "P P P P", "L P", "S W T", "L P P L L P", "L L", "L", "P L L"];
const NAMES = { P: "portrait", L: "landscape", S: "square", W: "panorama", T: "tall" };

const browser = await puppeteer.launch({ headless: true, args: ["--no-sandbox"] });
const page = await browser.newPage();
let count = 0;
for (const mix of MIXES) {
  const shapes = mix.replace(/\s+/g, "");
  const dir = join(out, `${String(MIXES.indexOf(mix) + 1).padStart(2, "0")}-${mix.replace(/ /g, "-")}`); // e.g. "01-P-P-L"
  mkdirSync(dir, { recursive: true });
  for (let i = 0; i < shapes.length; i++) {
    const k = shapes[i];
    const s = SHAPES[k];
    await page.setViewport({ width: s.w, height: s.h });
    await page.setContent(`<html><body style="margin:0">${svgFor(k, i + 1, `Photo set (${mix})`)}</body></html>`);
    const file = join(dir, `${i + 1}-${NAMES[k]}-${s.w}x${s.h}.jpg`);
    writeFileSync(file, await page.screenshot({ type: "jpeg", quality: 90, clip: { x: 0, y: 0, width: s.w, height: s.h } }));
    count++;
  }
}
await browser.close();
console.log(`wrote ${count} photographs in ${out}`);
