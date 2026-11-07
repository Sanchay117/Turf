import type { CSSProperties, ReactNode } from "react";
import { AbsoluteFill, Easing, interpolate, random, useCurrentFrame } from "remotion";
import { fonts, ink } from "../theme.ts";

export const clamp = { extrapolateLeft: "clamp", extrapolateRight: "clamp" } as const;
export const easeOut = Easing.bezier(0.16, 1, 0.3, 1);
export const easeInOut = Easing.bezier(0.65, 0, 0.35, 1);
export const easeIn = Easing.bezier(0.5, 0, 0.75, 0);

/** 0 to 1 over `dur` frames starting at `at`, eased. */
export function ramp(frame: number, at: number, dur = 18, easing = easeOut) {
  return interpolate(frame, [at, at + dur], [0, 1], { ...clamp, easing });
}

const NOISE = (tone: string) =>
  `url("data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='260' height='260'><filter id='n'><feTurbulence type='fractalNoise' baseFrequency='.85' numOctaves='3' stitchTiles='stitch'/><feColorMatrix values='0 0 0 0 ${tone}  0 0 0 0 ${tone}  0 0 0 0 ${tone}  0 0 0 .6 0'/></filter><rect width='100%' height='100%' filter='url(%23n)'/></svg>")`;

/** Paper grain that moves every other frame, and a soft brown vignette. */
export function Grain({ amount = 0.14, edge = 0.22, dark = false }: { amount?: number; edge?: number; dark?: boolean }) {
  const frame = useCurrentFrame();
  const j = Math.floor(frame / 2) % 7;
  return (
    <>
      <AbsoluteFill style={{ pointerEvents: "none", backgroundImage: NOISE(dark ? ".9" : ".16"), backgroundPosition: `${j * 37}px ${j * 53}px`, opacity: amount, mixBlendMode: dark ? "overlay" : "multiply" }} />
      <AbsoluteFill style={{ pointerEvents: "none", background: `radial-gradient(ellipse at 50% 46%, transparent 52%, rgba(70,52,28,${edge}) 100%)` }} />
    </>
  );
}

/** Vellum: the warm sheet every drawn scene sits on, with a faint foxing. */
export function Vellum({ children, tone = ink.vellum }: { children?: ReactNode; tone?: string }) {
  return (
    <AbsoluteFill style={{ background: tone }}>
      <AbsoluteFill style={{ background: "radial-gradient(ellipse at 22% 18%, rgba(255,250,236,.55), transparent 55%), radial-gradient(ellipse at 84% 88%, rgba(150,118,70,.16), transparent 60%)" }} />
      {children}
      <Grain />
    </AbsoluteFill>
  );
}

/** How hard the last of `hits` is still ringing at `frame`: 1 on the hit, falling fast. */
export function ringing(frame: number, hits: number[], decay = 3.4) {
  const last = hits.filter((h) => h <= frame).at(-1);
  if (last === undefined) return { last: -1, k: 0 };
  return { last, k: Math.exp(-(frame - last) / decay) };
}

/** The camera: a slow push from `from`, and a jolt on every hit, so stamps feel heavy. */
export function Camera({ children, hits = [], power = 9, push = 0.0005, from = 0, origin = "50% 50%", style }: { children: ReactNode; hits?: number[]; power?: number; push?: number; from?: number; origin?: string; style?: CSSProperties }) {
  const frame = useCurrentFrame();
  const { last, k } = ringing(frame, hits);
  const a = random(`hit ${last}`) * Math.PI * 2;
  const scale = 1 + Math.max(0, frame - from) * push + 0.014 * k;
  return (
    <AbsoluteFill style={{ transform: `translate(${power * k * Math.cos(a)}px, ${power * k * Math.sin(a)}px) rotate(${(random(`rot ${last}`) - 0.5) * 0.5 * k}deg) scale(${scale})`, transformOrigin: origin, ...style }}>
      {children}
    </AbsoluteFill>
  );
}

/** Comes down hard: large and fast, a small bounce, and an echo thrown off the hit. */
export function Slam({ at, from = 1.6, children, style }: { at: number; from?: number; children: ReactNode; style?: CSSProperties }) {
  const frame = useCurrentFrame();
  const t = frame - at;
  if (t < 0) return <span style={{ display: "inline-block", opacity: 0, ...style }}>{children}</span>;
  const drop = interpolate(t, [0, 3], [from, 1], { ...clamp, easing: Easing.in(Easing.quad) });
  const bounce = interpolate(t, [3, 5, 10], [1, 0.975, 1], clamp);
  const thrown = interpolate(t, [3, 12], [1, 1.14], { ...clamp, easing: Easing.out(Easing.quad) });
  const echo = interpolate(t, [3, 12], [0.35, 0], clamp);
  return (
    <span style={{ position: "relative", display: "inline-block", transform: `scale(${t < 3 ? drop : bounce})`, filter: t < 3 ? `blur(${(3 - t) * 2.5}px)` : undefined, ...style }}>
      {t >= 3 && t < 12 && <span style={{ position: "absolute", inset: 0, opacity: echo, transform: `scale(${thrown})` }}>{children}</span>}
      {children}
    </span>
  );
}

/** Text written on at `cps` characters a second, like a pen. */
export function Typed({ at, text, cps = 40, style, caret = false }: { at: number; text: string; cps?: number; style?: CSSProperties; caret?: boolean }) {
  const frame = useCurrentFrame();
  const n = Math.max(0, Math.floor(((frame - at) / 30) * cps));
  if (frame < at) return null;
  const done = n >= text.length;
  return (
    <span style={{ whiteSpace: "pre", ...style }}>
      {text.slice(0, n)}
      {caret && (!done || Math.floor(frame / 8) % 2 === 0) && <span style={{ display: "inline-block", width: "0.5em", height: "1em", marginLeft: 3, verticalAlign: "-0.12em", background: "currentColor", opacity: 0.8 }} />}
    </span>
  );
}

/** A figure whose digits roll into place, last digit first. */
export function Rolling({ at, value, dur = 24, style }: { at: number; value: string; dur?: number; style?: CSSProperties }) {
  const frame = useCurrentFrame();
  const chars = [...value];
  const digits = chars.filter((c) => /\d/.test(c)).length;
  let d = 0;
  return (
    <span style={{ display: "inline-flex", fontVariantNumeric: "tabular-nums", ...style }}>
      {chars.map((c, i) => {
        if (!/\d/.test(c)) return <span key={i}>{c}</span>;
        const k = d++;
        const settle = at + dur * ((k + 1) / digits);
        const target = Number(c);
        const spins = Math.max(0, settle - frame);
        const shown = frame < at ? 0 : spins > 0 ? (target + Math.floor(spins * 1.7)) % 10 : target;
        return (
          <span key={i} style={{ display: "inline-block", filter: spins > 0 ? "blur(1.2px)" : undefined }}>
            {shown}
          </span>
        );
      })}
    </span>
  );
}

/** The game's small uppercase mono label. */
export function Label({ children, color = ink.ink2, size = 20, style }: { children: ReactNode; color?: string; size?: number; style?: CSSProperties }) {
  return <div style={{ fontFamily: fonts.mono, fontWeight: 500, fontSize: size, letterSpacing: size * 0.14, textTransform: "uppercase", color, whiteSpace: "nowrap", ...style }}>{children}</div>;
}

/** A stamp hitting the frame at `at`: big and fast, a squash, a small shake. */
export function StampIn({ at, children, angle = -9, style }: { at: number; children: ReactNode; angle?: number; style?: CSSProperties }) {
  const frame = useCurrentFrame();
  const t = frame - at;
  if (t < 0) return null;
  const drop = interpolate(t, [0, 4], [2.2, 1], { ...clamp, easing: Easing.in(Easing.cubic) });
  const settle = interpolate(t, [4, 7, 11], [1, 0.96, 1], clamp);
  const shake = t >= 4 && t < 10 ? Math.sin(t * 2.4) * (10 - t) * 0.4 : 0;
  return (
    <div style={{ display: "inline-block", transform: `translate(${shake}px, 0) rotate(${angle}deg) scale(${t < 4 ? drop : settle})`, opacity: interpolate(t, [0, 2], [0, 1], clamp), ...style }}>
      {children}
    </div>
  );
}

/** The game's vermilion seal: a ruled box of spaced mono capitals, inked unevenly. */
export function Seal({ text, size = 34, color = ink.vermilion }: { text: string; size?: number; color?: string }) {
  return (
    <div
      style={{
        fontFamily: fonts.mono,
        fontWeight: 500,
        fontSize: size,
        letterSpacing: size * 0.18,
        textTransform: "uppercase",
        color,
        border: `${Math.max(2.5, size * 0.12)}px solid ${color}`,
        borderRadius: size * 0.14,
        padding: `${size * 0.32}px ${size * 0.6}px ${size * 0.26}px ${size * 0.78}px`,
        mixBlendMode: "multiply",
        WebkitMaskImage: `url("data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='300' height='300'><filter id='n'><feTurbulence type='fractalNoise' baseFrequency='.7' numOctaves='2' seed='3'/><feColorMatrix values='0 0 0 0 0  0 0 0 0 0  0 0 0 0 0  0 0 0 -1.6 1.75'/></filter><rect width='100%' height='100%' filter='url(%23n)'/></svg>")`,
        whiteSpace: "nowrap",
      }}
    >
      {text}
    </div>
  );
}

/** A pointed leader line and a mono label, the way a surveyor annotates a plat. */
export function Callout({ x, y, dx, dy, at, children, color = ink.ink, width = 460 }: { x: number; y: number; dx: number; dy: number; at: number; children: ReactNode; color?: string; width?: number }) {
  const frame = useCurrentFrame();
  const draw = ramp(frame, at, 14, easeInOut);
  const text = ramp(frame, at + 8, 14);
  const len = Math.hypot(dx, dy);
  const left = dx < 0;
  return (
    <div style={{ position: "absolute", left: 0, top: 0, width: "100%", height: "100%", pointerEvents: "none" }}>
      <svg width="1920" height="1080" style={{ position: "absolute", inset: 0, overflow: "visible" }}>
        <circle cx={x} cy={y} r={7 * draw} fill="none" stroke={color} strokeWidth="2.5" />
        <circle cx={x} cy={y} r={2.5} fill={color} opacity={draw} />
        <line x1={x} y1={y} x2={x + dx * draw} y2={y + dy * draw} stroke={color} strokeWidth="2" strokeDasharray={`${len}`} />
      </svg>
      <div
        style={{
          position: "absolute",
          top: y + dy - 30,
          left: left ? x + dx - width - 14 : x + dx + 14,
          width,
          textAlign: left ? "right" : "left",
          opacity: text,
          transform: `translateY(${(1 - text) * 8}px)`,
        }}
      >
        <div style={{ display: "inline-block", background: "rgba(239,230,208,.94)", border: `1.5px solid ${ink.ink}`, boxShadow: "0 8px 24px rgba(42,36,29,.22)", padding: "12px 18px 13px", textAlign: "left" }}>{children}</div>
      </div>
    </div>
  );
}
