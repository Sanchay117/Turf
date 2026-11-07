// Voices the narration with Deepgram Aura-2, then transcribes each take with Deepgram Nova-3 to
// time every caption word. Writes public/vo/<id>.wav and public/vo/manifest.json.
//
//   node --env-file=<file holding TTS or DEEPGRAM_KEY> scripts/voice.ts
//   node --env-file=<file> scripts/voice.ts --only hero,close   re-voice some lines, keep the rest
//
// The key stays in that file. Nothing here writes it down.

import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { allLines, makeScript, type Line } from "../src/script.ts";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
// The narration quotes the filmed round, so the capture comes first.
const runPath = join(root, "public", "capture", "run.json");
if (!existsSync(runPath)) {
  console.error("Run npm run capture first: the narration quotes the filmed round.");
  process.exit(1);
}
const SCRIPT = allLines(makeScript(JSON.parse(readFileSync(runPath, "utf8")).closing));
const out = join(root, "public", "vo");
const manifestPath = join(out, "manifest.json");

const key = process.env.DEEPGRAM_KEY ?? process.env.TTS;
if (!key) {
  console.error("Run with --env-file pointing at a file that holds DEEPGRAM_KEY or TTS.");
  process.exit(1);
}

const args = process.argv.slice(2);
const flag = (name: string) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
};
const voice = flag("--voice") ?? "aura-2-draco-en";
const only = flag("--only")?.split(",");

export interface Word {
  text: string;
  start: number;
  end: number;
}
export interface Take {
  file: string;
  seconds: number;
  words: Word[];
}
export interface Manifest {
  voice: string;
  lines: Record<string, Take>;
}

async function speak(text: string, model: string): Promise<Buffer> {
  const url = `https://api.deepgram.com/v1/speak?model=${model}&encoding=linear16&container=wav&sample_rate=48000`;
  for (let attempt = 1; ; attempt++) {
    let res: Response;
    try {
      res = await fetch(url, {
        method: "POST",
        headers: { Authorization: `Token ${key}`, "Content-Type": "application/json" },
        body: JSON.stringify({ text }),
      });
    } catch (e) {
      // A dropped connection, not a refusal: try again.
      if (attempt >= 4) throw e;
      console.log(`  speak retry ${attempt}: ${(e as Error).message}`);
      await new Promise((r) => setTimeout(r, 1500 * attempt));
      continue;
    }
    if (res.ok) return Buffer.from(await res.arrayBuffer());
    if (res.status === 429 && attempt < 4) {
      await new Promise((r) => setTimeout(r, 2000 * attempt));
      continue;
    }
    throw new Error(`speak ${model}: ${res.status} ${await res.text()}`);
  }
}

interface SttWord {
  word: string;
  punctuated_word?: string;
  start: number;
  end: number;
}

/** The take as 16 kHz FLAC: a sixth of the upload, and the word times are the same. */
function small(wav: Buffer): Buffer {
  const run = spawnSync("ffmpeg", ["-loglevel", "error", "-i", "pipe:0", "-ar", "16000", "-ac", "1", "-c:a", "flac", "-f", "flac", "pipe:1"], { input: wav, maxBuffer: 64 * 1024 * 1024 });
  if (run.status !== 0) throw new Error(`ffmpeg: ${run.stderr}`);
  return run.stdout;
}

async function listen(wav: Buffer): Promise<SttWord[]> {
  const flac = small(wav);
  // A dropped connection or a slow upload is retried; anything else the API refuses is not.
  for (let attempt = 1; ; attempt++) {
    try {
      const res = await fetch("https://api.deepgram.com/v1/listen?model=nova-3&smart_format=true", {
        method: "POST",
        headers: { Authorization: `Token ${key}`, "Content-Type": "audio/flac" },
        body: new Uint8Array(flac),
      });
      if (!res.ok) throw new Error(`listen: ${res.status} ${await res.text()}`);
      const json = (await res.json()) as { results: { channels: { alternatives: { words: SttWord[] }[] }[] } };
      return json.results.channels[0]?.alternatives[0]?.words ?? [];
    } catch (e) {
      const refused = String(e).startsWith("Error: listen:") && !String(e).includes("listen: 408");
      if (attempt >= 4 || refused) throw e;
      console.log(`  listen retry ${attempt}: ${(e as Error).message}`);
      await new Promise((r) => setTimeout(r, 1500 * attempt));
    }
  }
}

/** Length of a PCM WAV in seconds, from its fmt and data chunks. */
function wavSeconds(wav: Buffer): number {
  let byteRate = 0;
  for (let p = 12; p + 8 <= wav.length; ) {
    const id = wav.toString("ascii", p, p + 4);
    const size = wav.readUInt32LE(p + 4);
    if (id === "fmt ") byteRate = wav.readUInt32LE(p + 16);
    if (id === "data") {
      // Streamed WAVs may leave the data size unset; fall back to the bytes present.
      const bytes = size === 0 || size === 0xffffffff ? wav.length - p - 8 : Math.min(size, wav.length - p - 8);
      return bytes / byteRate;
    }
    p += 8 + size + (size % 2);
  }
  throw new Error("not a PCM WAV");
}

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "");
const round = (n: number) => Math.round(n * 1000) / 1000;

/**
 * Times each caption word. The caption and the spoken text can differ ("1956" is read as
 * "nineteen fifty six"), so words are matched to the transcription where they agree and
 * interpolated between matches where they do not.
 */
function align(caption: string, heard: SttWord[], seconds: number): Word[] {
  const tokens = caption.split(/\s+/).filter(Boolean);
  const times: ({ start: number; end: number } | null)[] = tokens.map(() => null);
  let j = 0;
  tokens.forEach((t, i) => {
    const n = norm(t);
    if (!n) return;
    for (let k = j; k < Math.min(heard.length, j + 5); k++) {
      if (norm(heard[k].word) === n || norm(heard[k].punctuated_word ?? "") === n) {
        times[i] = { start: heard[k].start, end: heard[k].end };
        j = k + 1;
        return;
      }
    }
  });
  const first = heard[0]?.start ?? 0;
  const last = heard.at(-1)?.end ?? seconds;
  // Spread unmatched words across the time between their matched neighbours, by length.
  let i = 0;
  while (i < tokens.length) {
    if (times[i]) {
      i++;
      continue;
    }
    let k = i;
    while (k < tokens.length && !times[k]) k++;
    const from = i > 0 ? times[i - 1]!.end : first;
    const to = k < tokens.length ? times[k]!.start : last;
    const span = tokens.slice(i, k);
    const total = span.reduce((a, t) => a + t.length + 1, 0);
    let at = from;
    span.forEach((t, m) => {
      const d = ((to - from) * (t.length + 1)) / total;
      times[i + m] = { start: at, end: at + d };
      at += d;
    });
    i = k;
  }
  return tokens.map((text, m) => ({ text, start: round(times[m]!.start), end: round(times[m]!.end) }));
}

/** Speeds a take up with ffmpeg, keeping its pitch. */
function quicken(wav: Buffer, tempo: number): Buffer {
  const ffmpeg = ["-loglevel", "error", "-i", "pipe:0", "-filter:a", `atempo=${tempo}`, "-ar", "48000", "-c:a", "pcm_s16le", "-f", "wav", "pipe:1"];
  const run = spawnSync("ffmpeg", ffmpeg, { input: wav, maxBuffer: 64 * 1024 * 1024 });
  if (run.status !== 0) throw new Error(`ffmpeg: ${run.stderr}`);
  return run.stdout;
}

async function voiceLine(line: Line): Promise<Take> {
  const spoken = await speak(line.say ?? line.text, voice);
  const wav = line.tempo ? quicken(spoken, line.tempo) : spoken;
  const file = `vo/${line.id}.wav`;
  writeFileSync(join(root, "public", file), wav);
  const seconds = round(wavSeconds(wav));
  const words = align(line.text, await listen(wav), seconds);
  return { file, seconds, words };
}

mkdirSync(out, { recursive: true });
const prior: Manifest = existsSync(manifestPath) ? JSON.parse(readFileSync(manifestPath, "utf8")) : { voice, lines: {} };
const manifest: Manifest = { voice, lines: only ? prior.lines : {} };
for (const line of SCRIPT) {
  if (only && !only.includes(line.id)) continue;
  const take = await voiceLine(line);
  manifest.lines[line.id] = take;
  console.log(`${line.id.padEnd(11)} ${take.seconds.toFixed(2)}s  ${take.words.length} words`);
  // Saved after every line, so a dropped connection only costs the line it dropped on.
  writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + "\n");
}
const total = Object.values(manifest.lines).reduce((a, t) => a + t.seconds, 0);
console.log(`\n${voice}: ${total.toFixed(1)}s of narration`);
