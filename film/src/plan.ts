import { staticFile } from "remotion";
import { makeScript, type Closing, type Line, type Script } from "./script.ts";

export const FPS = 30;
/** Frames by which each scene fades up over the one before it. */
export const XFADE = 8;

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
export type Box = { x: number; y: number; w: number; h: number };
export interface CaptureEvent {
  at: number;
  kind: "claim" | "capture";
  move: number;
  x: number;
  y: number;
  hexes?: number;
  enemy: number;
  cost?: number;
  energy?: number;
}
export interface Capture {
  fps: number;
  width: number;
  height: number;
  view: { width: number; height: number };
  seconds: number;
  plat: number;
  slots: number;
  marks: Record<string, number>;
  events: CaptureEvent[];
  boxes: Record<string, Box>;
  closing: (Closing & { arena: string; roundHexes: number; slot: number; roundEnd: number; players: { name: string; tiles: number; seat: number; me: boolean }[]; stats: { sent: number; confirmed: number; avgMs: number; fees: number } }) | null;
}

export type Kind = "open" | "demo" | "build" | "end";

export interface Shot {
  id: string;
  kind: Kind;
  /** First frame of the scene in the film. */
  from: number;
  frames: number;
  /** Frame, relative to the scene, where the narrator starts. */
  voiceAt: number;
  take?: Take;
  text: string;
  /** Capture second the footage starts at, and how fast it plays. */
  footage?: { start: number; rate: number };
}

export interface Plan {
  shots: Shot[];
  capture: Capture;
  script: Script;
  total: number;
}

async function load<T>(path: string): Promise<T | undefined> {
  try {
    const res = await fetch(staticFile(path));
    return res.ok ? ((await res.json()) as T) : undefined;
  } catch {
    return undefined;
  }
}

/** Frames of air before and after each line. */
const LEAD: Record<string, number> = { "m-chain": 34, "m-title": 8, "d-stake": 10, "b-account": 12, "e-close": 16 };
const TAIL: Record<string, number> = { "m-chain": 6, "m-acre": 16, "m-title": 46, "d-chain": 8, "d-close": 34, "b-numbers": 22, "b-open": 18, "e-close": 96 };

/** The footage window each demo scene plays, in capture seconds: [start, end]. */
export function windows(c: Capture): Record<string, [number, number]> {
  const m = c.marks;
  const claims = c.events.filter((e) => e.kind === "claim");
  const captures = c.events.filter((e) => e.kind === "capture");
  const c1 = claims[0].at;
  const c2 = claims[1].at;
  const mid = captures.find((e) => e.at > c2 + 24) ?? captures.at(-1)!;
  return {
    "d-stake": [m.load + 0.3, m.recorded + 0.4],
    "d-rivals": [m.recorded + 0.4, c1 - 2.3],
    "d-chain": [c1 - 2.3, c2 + 1.6],
    "d-register": [c2 + 1.6, c2 + 9.6],
    "d-energy": [c2 + 9.6, c2 + 20],
    "d-rule": [mid.at - 1.4, mid.at + 6.0],
    "d-close": [m.closing - 1.6, m["next-round"] + 5.5],
  };
}

/** The capture event the d-rule scene is built around. */
export const ruleEvent = (c: Capture) => {
  const claims = c.events.filter((e) => e.kind === "claim");
  const captures = c.events.filter((e) => e.kind === "capture");
  return captures.find((e) => e.at > claims[1].at + 24) ?? captures.at(-1)!;
};

export async function makePlan(): Promise<Plan> {
  const manifest = await load<{ voice: string; lines: Record<string, Take> }>("vo/manifest.json");
  const capture = await load<Capture>("capture/run.json");
  if (!manifest || !capture) throw new Error("Run npm run capture and npm run voice first.");
  return layout(manifest, capture);
}

/** The film's timeline from the voice takes and the capture. */
export function layout(manifest: { lines: Record<string, Take> }, capture: Capture): Plan {
  const script = makeScript(capture.closing);
  const win = windows(capture);
  const shots: Shot[] = [];
  let at = 0;
  const add = (line: Line, kind: Kind) => {
    const take = manifest.lines[line.id];
    if (!take) throw new Error(`no take for ${line.id}: run npm run voice`);
    const voiceAt = LEAD[line.id] ?? 8;
    const frames = voiceAt + Math.ceil(take.seconds * FPS) + (TAIL[line.id] ?? 12);
    let footage: Shot["footage"];
    if (kind === "demo") {
      const [a, b] = win[line.id];
      const rate = Math.min(1.7, Math.max(0.7, (b - a) / (frames / FPS)));
      footage = { start: a, rate: Math.round(rate * 100) / 100 };
    }
    shots.push({ id: line.id, kind, from: at, frames, voiceAt, take, text: line.text, footage });
    at += frames - XFADE;
  };
  script.open.forEach((l) => add(l, "open"));
  script.demo.forEach((l) => add(l, "demo"));
  script.build.forEach((l) => add(l, "build"));
  script.end.forEach((l) => add(l, "end"));
  return { shots, capture, script, total: at + XFADE };
}

/** Seconds into a take at which the narrator starts the `nth` word beginning with `word`. */
export function wordAt(take: Take, word: string, nth = 0) {
  const bare = (t: string) => t.toLowerCase().replace(/[^a-z0-9]/g, "");
  const hit = take.words.filter((w) => bare(w.text).startsWith(word))[nth];
  return hit ? hit.start : 0;
}

/** Frame, relative to the scene, at which the narrator starts the `nth` word beginning with `word`. */
export function cue(shot: Shot, word: string, nth = 0): number {
  return shot.voiceAt + Math.round(wordAt(shot.take!, word, nth) * FPS);
}

/** Capture second shown at a scene frame. */
export function footageAt(shot: Shot, frame: number): number {
  return shot.footage!.start + (frame / FPS) * shot.footage!.rate;
}

/** Scene frame at which the footage reaches a capture second. */
export function frameOf(shot: Shot, second: number): number {
  return Math.round(((second - shot.footage!.start) / shot.footage!.rate) * FPS);
}
