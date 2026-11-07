import type { ReactNode } from "react";
import { AbsoluteFill, interpolate, OffthreadVideo, staticFile, useCurrentFrame } from "remotion";
import { FPS, cue, frameOf, ruleEvent, type Capture, type Plan, type Shot } from "../plan.ts";
import { fonts, ink } from "../theme.ts";
import { Callout, clamp, easeInOut, Grain, Label } from "../ui/kit.tsx";
import { Cues, type Cue } from "../ui/Sfx.tsx";

/** Comp pixels per page pixel: the page was 1440 wide, the film is 1920. */
const K = 1920 / 1440;
const PAGE = { w: 1440, h: 810 };

/** Where the camera looks, in page pixels, and how close. */
export interface Look {
  at: number;
  x: number;
  y: number;
  s: number;
}

function settle(l: Omit<Look, "at">) {
  const hw = PAGE.w / 2 / l.s;
  const hh = PAGE.h / 2 / l.s;
  return { x: Math.min(PAGE.w - hw, Math.max(hw, l.x)), y: Math.min(PAGE.h - hh, Math.max(hh, l.y)), s: l.s };
}

/** The camera at a frame: eased between the keyframes either side. */
export function lookAt(looks: Look[], frame: number) {
  if (frame <= looks[0].at) return settle(looks[0]);
  for (let i = 1; i < looks.length; i++) {
    const a = looks[i - 1];
    const b = looks[i];
    if (frame <= b.at) {
      const p = interpolate(frame, [a.at, b.at], [0, 1], { ...clamp, easing: easeInOut });
      const A = settle(a);
      const B = settle(b);
      // Ease the zoom in log space so pushes feel even.
      const s = Math.exp(Math.log(A.s) + (Math.log(B.s) - Math.log(A.s)) * p);
      return { x: A.x + (B.x - A.x) * p, y: A.y + (B.y - A.y) * p, s };
    }
  }
  return settle(looks.at(-1)!);
}

/** A page point to film pixels, through the camera. */
export const project = (cam: { x: number; y: number; s: number }, p: { x: number; y: number }) => ({
  x: 960 + (p.x - cam.x) * K * cam.s,
  y: 540 + (p.y - cam.y) * K * cam.s,
});

const WIDE = { x: 720, y: 405, s: 1 };

interface Note {
  /** Page point the leader line starts from. */
  p: { x: number; y: number };
  dx: number;
  dy: number;
  at: number;
  head: string;
  body?: string;
  width?: number;
  /** Frame the note fades by; 150 frames after it appears when unset. */
  until?: number;
}

interface Def {
  looks: Look[];
  notes: Note[];
  cues: Cue[];
}

function Head({ head, body }: { head: string; body?: string }) {
  return (
    <>
      <Label size={19} color={ink.ink}>{head}</Label>
      {body && <div style={{ fontFamily: fonts.text, fontStyle: "italic", fontSize: 25, color: ink.ink2, marginTop: 4, whiteSpace: "nowrap" }}>{body}</div>}
    </>
  );
}

function define(shot: Shot, plan: Plan): Def {
  const c: Capture = plan.capture;
  const m = c.marks;
  const b = c.boxes;
  const f = (sec: number) => frameOf(shot, sec);
  const end = shot.frames;
  const claims = c.events.filter((e) => e.kind === "claim");
  const mine = (from: number, to: number): Cue[] =>
    claims.filter((e) => f(e.at) >= from && f(e.at) < to).map((e) => [f(e.at), "tick", 0.32] as Cue);
  switch (shot.id) {
    case "d-stake": {
      const card = b.deed;
      return {
        looks: [
          { at: 0, ...WIDE },
          { at: Math.min(f(m.typed) - 6, 40), x: card.x + card.w / 2, y: card.y + card.h / 2 + 10, s: 1.28 },
          { at: end, x: card.x + card.w / 2, y: card.y + card.h / 2 + 20, s: 1.34 },
        ],
        notes: [{ p: { x: card.x + card.w - 40, y: card.y + card.h - 62 }, dx: 120, dy: -70, at: cue(shot, "throwaway"), head: "A key made in this tab", body: "no wallet, no popup" }],
        cues: [[f(m.typed) - 18, "typing", 0.24], [f(m.stake), "press", 0.5], [f(m.recorded), "stamp", 0.75]],
      };
    }
    case "d-rivals": {
      const h = b.holdings;
      return {
        looks: [
          { at: 0, x: 600, y: 420, s: 1.06 },
          { at: Math.round(end * 0.55), x: 1150, y: h.y + 120, s: 1.55 },
          { at: end, x: 1150, y: h.y + 120, s: 1.6 },
        ],
        notes: [{ p: { x: h.x + 6, y: h.y + 70 }, dx: -60, dy: 250, at: cue(shot, "bots"), head: "Three bots, one program", body: "the same instructions you send" }],
        cues: [[f(m.rivals), "paper", 0.4]],
      };
    }
    case "d-chain": {
      const [e1, e2] = claims;
      const a = f(e1.at);
      const z = f(e2.at);
      return {
        looks: [
          { at: 0, x: e1.x, y: e1.y - 60, s: 1.15 },
          { at: Math.max(10, a - 30), x: e1.x + 60, y: e1.y - 90, s: 1.7 },
          { at: a + 24, x: e1.x + 60, y: e1.y - 90, s: 1.72 },
          { at: z - 20, x: e2.x - 40, y: e2.y + 120, s: 1.6 },
          { at: end, x: e2.x - 40, y: e2.y + 120, s: 1.65 },
        ],
        notes: [
          { p: { x: e1.x, y: e1.y }, dx: 150, dy: -110, at: a - 30, head: "Hover: the cheapest line", body: "priced the way the program will charge it" },
          { p: { x: e2.x, y: e2.y }, dx: 120, dy: 80, at: z - 8, head: `${e2.hexes} hexes · one transaction` },
        ],
        cues: [[a, "ratchet", 0.4], [z, "ratchet", 0.4], ...mine(z + 1, end)],
      };
    }
    case "d-register": {
      const r = b.register;
      return {
        looks: [
          { at: 0, ...WIDE },
          { at: 34, x: r.x + r.w / 2 - 150, y: r.y + 190, s: 1.9 },
          { at: end, x: r.x + r.w / 2 - 150, y: r.y + 205, s: 1.95 },
        ],
        notes: [{ p: { x: r.x + 2, y: r.y + 250 }, dx: -110, dy: 70, at: cue(shot, "slot"), head: "Slot · seconds · explorer link", body: "every row is a real transaction" }],
        cues: mine(0, end).map(([at]) => [at, "stamp", 0.16] as Cue),
      };
    }
    case "d-energy": {
      const l = b.links;
      const s = b.slot;
      const pivot = cue(shot, "pace");
      return {
        looks: [
          { at: 0, x: l.x + 260, y: l.y - 90, s: 1.9 },
          { at: pivot - 24, x: l.x + 260, y: l.y - 110, s: 1.95 },
          { at: pivot + 6, x: s.x + 160, y: s.y + 110, s: 1.9 },
          { at: end, x: s.x + 160, y: s.y + 110, s: 1.95 },
        ],
        notes: [
          { p: { x: l.x + l.w, y: l.y + 4 }, dx: 90, dy: -80, at: 18, head: "+1 energy a slot", body: "30 links, refilled by the chain" },
          { p: { x: s.x + s.w / 2, y: s.y + s.h }, dx: 90, dy: 90, at: pivot + 14, head: "The Solana slot, live" },
        ],
        cues: mine(0, end),
      };
    }
    case "d-rule": {
      const e = ruleEvent(c);
      const hit = f(e.at);
      return {
        looks: [
          { at: 0, x: e.x, y: e.y, s: 1.4 },
          { at: Math.max(8, hit - 4), x: e.x, y: e.y, s: 2.1 },
          { at: end, x: e.x, y: e.y, s: 2.2 },
        ],
        notes: [{ p: { x: e.x, y: e.y }, dx: 130, dy: -100, at: hit + 8, head: "Enemy hex: 2 + its owner's neighbours", body: "a thin line costs 3 or 4; a solid block, up to 8" }],
        cues: [[hit, "thud", 0.45], ...mine(hit + 1, end)],
      };
    }
    case "d-close": {
      const ban = b.banner;
      const hall = b.hallAfter ?? b.hall;
      const turn = f(m["next-round"]);
      return {
        looks: [
          { at: 0, ...WIDE },
          { at: Math.max(20, turn - 30), x: 640, y: 300, s: 1.18 },
          { at: turn + 10, x: ban.x + ban.w / 2 + 60, y: ban.y + 190, s: 1.5 },
          { at: turn + 80, x: ban.x + ban.w / 2 + 60, y: ban.y + 190, s: 1.56 },
          { at: Math.min(end - 8, turn + 120), x: 1050, y: hall.y - 60, s: 1.55 },
          { at: end, x: 1060, y: hall.y - 60, s: 1.6 },
        ],
        notes: [
          { p: { x: ban.x + ban.w * 0.4, y: ban.y + ban.h }, dx: 60, dy: 120, at: turn + 16, until: turn + 84, head: "next_round · anyone can call it" },
          { p: { x: hall.x + 10, y: hall.y + hall.h / 2 }, dx: -130, dy: -90, at: Math.min(end - 40, turn + 124), head: "Champions register", body: "written by the program" },
        ],
        cues: [[turn, "chime", 0.5], [turn + 2, "stamp", 0.5]],
      };
    }
  }
  return { looks: [{ at: 0, ...WIDE }], notes: [], cues: [] };
}

export function Demo({ shot, plan }: { shot: Shot; plan: Plan }) {
  const frame = useCurrentFrame();
  const d = define(shot, plan);
  const cam = lookAt(d.looks, frame);
  const fps = plan.capture.fps;
  return (
    <AbsoluteFill style={{ background: ink.night, overflow: "hidden" }}>
      <AbsoluteFill style={{ transformOrigin: "0 0", transform: `translate(${960 - cam.x * K * cam.s}px, ${540 - cam.y * K * cam.s}px) scale(${cam.s})` }}>
        <OffthreadVideo
          src={staticFile("capture/run.mp4")}
          trimBefore={Math.round(shot.footage!.start * fps)}
          playbackRate={shot.footage!.rate}
          muted
          style={{ width: 1920, height: 1080, display: "block" }}
        />
      </AbsoluteFill>
      <AbsoluteFill style={{ boxShadow: "inset 0 0 160px rgba(42,30,16,.28)", pointerEvents: "none" }} />
      {d.notes.map((n, i) => (
        <NoteView key={i} n={n} p={project(cam, n.p)} />
      ))}
      <Grain amount={0.06} edge={0.1} />
      <Cues cues={d.cues} />
      <Stamp label={tagFor(shot.id)} />
    </AbsoluteFill>
  );
}

function NoteView({ n, p }: { n: Note; p: { x: number; y: number } }) {
  const frame = useCurrentFrame();
  const gone = n.until ?? n.at + 150;
  const out = interpolate(frame, [gone, gone + 12], [1, 0], clamp);
  return (
    <div style={{ opacity: out }}>
      <Callout x={p.x} y={p.y} dx={n.dx} dy={n.dy} at={n.at} width={n.width ?? 520}>
        <Head head={n.head} body={n.body} />
      </Callout>
    </div>
  );
}

const tagFor = (id: string) =>
  ({ "d-stake": "Staking a claim", "d-rivals": "Rival surveyors", "d-chain": "Running a chain", "d-register": "The register", "d-energy": "The slot clock", "d-rule": "Solid land holds", "d-close": "Turning the crank" })[id] ?? "";

/** The corner slug: live footage from devnet, never a mock. */
function Stamp({ label }: { label: string }): ReactNode {
  const frame = useCurrentFrame();
  const o = interpolate(frame, [4, 16], [0, 1], clamp);
  const blink = Math.floor(frame / 18) % 2 === 0 ? 1 : 0.35;
  return (
    <div style={{ position: "absolute", left: 40, top: 34, display: "flex", alignItems: "center", gap: 14, opacity: o, zIndex: 50 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 10, background: "rgba(36,30,23,.86)", padding: "9px 16px 9px 14px", borderRadius: 2 }}>
        <span style={{ width: 11, height: 11, borderRadius: 6, background: ink.vermilion, opacity: blink }} />
        <Label size={16} color={ink.vellum}>Live on Solana devnet</Label>
      </div>
      <Label size={16} color={ink.vellum} style={{ background: "rgba(36,30,23,.6)", padding: "9px 14px", borderRadius: 2 }}>{label}</Label>
    </div>
  );
}

export const DEMO_FPS = FPS;
