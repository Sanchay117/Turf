// Renders single frames of the film for review, bundling once: out/check/<frame>.jpg
//
//   node scripts/stills.ts 120 400 900
//   node scripts/stills.ts --still Thumbnail

import { mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { bundle } from "@remotion/bundler";
import { renderStill, selectComposition } from "@remotion/renderer";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const out = join(root, "out", "check");
mkdirSync(out, { recursive: true });
const args = process.argv.slice(2);
const still = args[0] === "--still" ? args[1] : null;
const frames = still ? [0] : args.map(Number);

const browserExecutable = process.env.REMOTION_CHROME ?? "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const serveUrl = await bundle({ entryPoint: join(root, "src", "index.ts"), publicDir: join(root, "public") });
const composition = await selectComposition({ serveUrl, id: still ?? "Turf", browserExecutable, chromeMode: "chrome-for-testing" });
for (const frame of frames) {
  const output = join(out, still ? `${still}.png` : `${frame}.jpg`);
  const format = still ? { imageFormat: "png" as const } : { imageFormat: "jpeg" as const, jpegQuality: 80 };
  await renderStill({ serveUrl, composition, frame, output, ...format, scale: still ? 1 : 0.5, browserExecutable, chromeMode: "chrome-for-testing" });
  console.log(output);
}
