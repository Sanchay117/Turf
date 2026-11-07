// Masters the film's sound without touching the picture: out/turf-raw.mp4 to
// out/turf.mp4
//
// Two passes. The first measures the mix. The second limits the few loudest hits (the stamps), then
// applies one steady gain, so the mix keeps its shape. A single pass would ride the level.
//
//   node scripts/master.ts

import { spawnSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const OUT = join(dirname(fileURLToPath(import.meta.url)), "..", "out");
const RAW = join(OUT, "turf-raw.mp4");
const MASTER = join(OUT, "turf.mp4");

const LOUDNESS = -15;
const TRUE_PEAK = -1.5;
const RANGE = 20;
/** Linear ceiling for the limiter, about -6 dB: it shaves the drop, the last strike and the loudest syllables. */
const LIMIT = 0.5;

const limiter = `alimiter=limit=${LIMIT}:attack=5:release=80:level=false`;
const target = `I=${LOUDNESS}:TP=${TRUE_PEAK}:LRA=${RANGE}`;

function ffmpeg(args: string[]) {
  const run = spawnSync("ffmpeg", ["-hide_banner", "-nostats", ...args], { encoding: "utf8" });
  if (run.status !== 0) throw new Error(run.stderr);
  return run.stderr;
}

const report = ffmpeg(["-i", RAW, "-af", `${limiter},loudnorm=${target}:print_format=json`, "-f", "null", "-"]);
const m = JSON.parse(report.slice(report.lastIndexOf("{"), report.lastIndexOf("}") + 1));
console.log(`measured ${m.input_i} LUFS, range ${m.input_lra}, true peak ${m.input_tp}`);

const measured = `measured_I=${m.input_i}:measured_TP=${m.input_tp}:measured_LRA=${m.input_lra}:measured_thresh=${m.input_thresh}:offset=${m.target_offset}`;
const second = ffmpeg([
  "-y", "-i", RAW,
  "-c:v", "copy",
  "-af", `${limiter},loudnorm=${target}:${measured}:linear=true:print_format=json`,
  "-ar", "48000", "-c:a", "aac", "-b:a", "192k",
  "-movflags", "+faststart",
  MASTER,
]);
const r = JSON.parse(second.slice(second.lastIndexOf("{"), second.lastIndexOf("}") + 1));
console.log(`mastered ${r.output_i} LUFS, range ${r.output_lra}, true peak ${r.output_tp}, ${r.normalization_type}`);
