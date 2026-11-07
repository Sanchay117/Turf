// Prints the film's timeline: each scene's first frame, length, footage window and playback rate.
//
//   node scripts/timeline.ts

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { FPS, layout, type Capture, type Take } from "../src/plan.ts";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const manifest = JSON.parse(readFileSync(join(root, "public", "vo", "manifest.json"), "utf8")) as { lines: Record<string, Take> };
const capture = JSON.parse(readFileSync(join(root, "public", "capture", "run.json"), "utf8")) as Capture;
const plan = layout(manifest, capture);
for (const s of plan.shots) {
  const t = (f: number) => (f / FPS).toFixed(1).padStart(6);
  const foot = s.footage ? `  footage ${s.footage.start.toFixed(1)}s x${s.footage.rate}` : "";
  console.log(`${s.id.padEnd(11)} from ${String(s.from).padStart(5)} (${t(s.from)}s)  ${String(s.frames).padStart(4)} frames${foot}`);
}
console.log(`\ntotal ${plan.total} frames = ${(plan.total / FPS).toFixed(1)} s`);
