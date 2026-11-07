import { AbsoluteFill, interpolate, useCurrentFrame } from "remotion";
import { cue, type Shot } from "../plan.ts";
import { fonts, ink, PIGMENTS, rgba } from "../theme.ts";
import { center, fit, grow, hexPath, N, SITES } from "../ui/hex.ts";
import { Camera, clamp, easeInOut, easeOut, Label, ramp, Seal, Slam, StampIn, Typed, Vellum } from "../ui/kit.tsx";
import { Cues } from "../ui/Sfx.tsx";

const LINKS = 100;
const CHAIN = { x0: 170, x1: 1750, y: 690 };

/** One wire link of Gunter's chain, with the small rings that join it to the next. */
function Link({ x, w, y, k }: { x: number; w: number; y: number; k: number }) {
  const tally = k > 0 && k % 10 === 0;
  const teeth = tally ? (k <= 50 ? k / 10 : (100 - k) / 10) : 0;
  return (
    <g>
      <rect x={x + 2.2} y={y - 3.6} width={w - 4.4} height={7.2} rx={3.6} fill="none" stroke={ink.ink} strokeWidth={1.9} />
      <circle cx={x + w} cy={y} r={2.4} fill="none" stroke={ink.ink2} strokeWidth={1.4} />
      {tally && (
        <g transform={`translate(${x + w}, ${y + 5})`}>
          <line x1={0} y1={0} x2={0} y2={8} stroke={ink.brass} strokeWidth={1.6} />
          {teeth === 5 ? (
            <circle cx={0} cy={16} r={7.5} fill={ink.brass} stroke={ink.ink} strokeWidth={1} />
          ) : (
            <g>
              <rect x={-8} y={8} width={16} height={8} fill={ink.brass} stroke={ink.ink} strokeWidth={0.8} />
              {Array.from({ length: teeth }, (_, t) => {
                const tw = 16 / teeth;
                const x0 = -8 + t * tw;
                return <path key={t} d={`M${x0} 16 L${x0 + tw / 2} 23 L${x0 + tw} 16 Z`} fill={ink.brass} stroke={ink.ink} strokeWidth={0.8} />;
              })}
            </g>
          )}
        </g>
      )}
    </g>
  );
}

/** "In 1620, Edmund Gunter made a chain 66 feet long, with 100 links." */
export function ChainScene({ shot }: { shot: Shot }) {
  const frame = useCurrentFrame();
  const year = cue(shot, "1620");
  const name = cue(shot, "edmund");
  const chainAt = cue(shot, "chain") - 8;
  const feet = cue(shot, "66");
  const links = cue(shot, "100");
  const lay = 64; // frames to lay out all 100 links
  const shown = Math.floor(interpolate(frame, [chainAt, chainAt + lay], [0, LINKS], { ...clamp, easing: easeOut }));
  const w = (CHAIN.x1 - CHAIN.x0) / LINKS;
  const dim = ramp(frame, feet - 4, 18, easeInOut);
  const below = ramp(frame, links - 2, 16);
  const rule = ramp(frame, 0, 30, easeInOut);
  return (
    <Vellum>
      <Camera hits={[year]} push={0.00035} power={7}>
        <svg width="1920" height="1080" style={{ position: "absolute", inset: 0 }}>
          {/* the engraver's double rule */}
          <rect x={60} y={60} width={1800} height={960} fill="none" stroke={ink.ink} strokeWidth={2} pathLength={1} strokeDasharray={1} strokeDashoffset={1 - rule} />
          <rect x={72} y={72} width={1776} height={936} fill="none" stroke={ink.ink} strokeWidth={0.8} pathLength={1} strokeDasharray={1} strokeDashoffset={1 - rule} opacity={0.7} />
          {/* brass handles */}
          {shown > 0 && <path d={`M${CHAIN.x0 - 34} ${CHAIN.y - 16} h26 v32 h-26 z M${CHAIN.x0 - 8} ${CHAIN.y} h10`} fill="none" stroke={ink.brass} strokeWidth={4} strokeLinejoin="round" />}
          {shown >= LINKS && <path d={`M${CHAIN.x1 + 34} ${CHAIN.y - 16} h-26 v32 h26 z M${CHAIN.x1 + 8} ${CHAIN.y} h-10`} fill="none" stroke={ink.brass} strokeWidth={4} strokeLinejoin="round" />}
          {Array.from({ length: shown }, (_, k) => (
            <Link key={k} k={k + 1} x={CHAIN.x0 + k * w} w={w} y={CHAIN.y} />
          ))}
          {/* dimension line: 66 feet */}
          <g opacity={dim}>
            <line x1={CHAIN.x0} y1={CHAIN.y - 70} x2={CHAIN.x0 + (CHAIN.x1 - CHAIN.x0) * dim} y2={CHAIN.y - 70} stroke={ink.ink} strokeWidth={1.6} />
            <line x1={CHAIN.x0} y1={CHAIN.y - 86} x2={CHAIN.x0} y2={CHAIN.y - 54} stroke={ink.ink} strokeWidth={1.6} />
            <line x1={CHAIN.x1} y1={CHAIN.y - 86} x2={CHAIN.x1} y2={CHAIN.y - 54} stroke={ink.ink} strokeWidth={1.6} opacity={dim >= 1 ? 1 : 0} />
          </g>
        </svg>
        <div style={{ position: "absolute", left: 0, right: 0, top: CHAIN.y - 132, textAlign: "center", opacity: dim }}>
          <span style={{ background: ink.vellum, padding: "0 26px", fontFamily: fonts.display, fontStyle: "italic", fontSize: 54, color: ink.ink }}>66 feet</span>
        </div>
        <div style={{ position: "absolute", left: 0, right: 0, top: CHAIN.y + 62, display: "flex", justifyContent: "center", gap: 46, opacity: below, transform: `translateY(${(1 - below) * 10}px)` }}>
          <Label size={24} color={ink.ink}>100 links</Label>
          <Label size={24} color={ink.ink2}>7.92 inches each</Label>
          <Label size={24} color={ink.brass}>a brass tally every ten</Label>
        </div>
        {/* the year and the man */}
        <div style={{ position: "absolute", left: 0, right: 0, top: 150, textAlign: "center" }}>
          <Slam at={year} from={1.7}>
            <span style={{ fontFamily: fonts.display, fontSize: 250, lineHeight: 1, color: ink.ink, letterSpacing: 4 }}>1620</span>
          </Slam>
          <div style={{ marginTop: 10, opacity: ramp(frame, name, 16), transform: `translateY(${(1 - ramp(frame, name, 16)) * 12}px)`, fontFamily: fonts.display, fontStyle: "italic", fontSize: 64, color: ink.ink2 }}>
            Edmund Gunter's chain
          </div>
        </div>
        <div style={{ position: "absolute", left: 110, top: 104, opacity: rule }}>
          <Label size={18} color={ink.ink3}>Plate I · The surveyor's chain</Label>
        </div>
      </Camera>
      <Cues cues={[[year, "thud", 0.55], [chainAt, "ratchet", 0.4], [chainAt + 22, "ratchet", 0.3], [chainAt + 44, "ratchet", 0.25], [links, "tick", 0.3]]} />
    </Vellum>
  );
}

/** The lots of a drawn plat, in chains: [x, y, w, h] on a 40 x 20 chain sheet. */
const LOTS: [number, number, number, number][] = [
  [0, 0, 10, 10], [10, 0, 10, 10], [20, 0, 20, 10], [0, 10, 20, 10], [20, 10, 10, 5], [30, 10, 10, 5], [20, 15, 20, 5],
];

/** "For three hundred years, land was measured with it." */
export function AcreScene({ shot }: { shot: Shot }) {
  const frame = useCurrentFrame();
  const sheet = { x: 300, y: 170, w: 1320, h: 660 };
  const u = Math.min(sheet.w / 40, sheet.h / 20);
  const years = cue(shot, "three");
  const yr = Math.round(interpolate(frame, [years, years + 60], [1620, 1920], { ...clamp, easing: easeInOut }));
  return (
    <Vellum>
      <Camera push={0.0004} from={0}>
        <svg width="1920" height="1080" style={{ position: "absolute", inset: 0 }}>
          <rect x={60} y={60} width={1800} height={960} fill="none" stroke={ink.ink} strokeWidth={2} />
          <rect x={72} y={72} width={1776} height={936} fill="none" stroke={ink.ink} strokeWidth={0.8} opacity={0.7} />
          {LOTS.map(([x, y, w, h], k) => {
            const p = ramp(frame, 4 + k * 9, 26, easeInOut);
            const area = (w * h) / 10;
            return (
              <g key={k}>
                <rect x={sheet.x + x * u} y={sheet.y + y * u} width={w * u} height={h * u} fill={k === 2 ? rgba(PIGMENTS[3], 0.12 * p) : "none"} stroke={ink.ink} strokeWidth={2.2} pathLength={1} strokeDasharray={1} strokeDashoffset={1 - p} />
                <text x={sheet.x + (x + w / 2) * u} y={sheet.y + (y + h / 2) * u - 6} textAnchor="middle" fontFamily={fonts.display} fontStyle="italic" fontSize={34} fill={ink.ink} opacity={ramp(frame, 18 + k * 9, 14)}>
                  {area} acres
                </text>
                <text x={sheet.x + (x + w / 2) * u} y={sheet.y + (y + h / 2) * u + 28} textAnchor="middle" fontFamily={fonts.mono} fontSize={18} letterSpacing={2} fill={ink.ink2} opacity={ramp(frame, 22 + k * 9, 14)}>
                  {w} × {h} CHAINS
                </text>
              </g>
            );
          })}
          {/* the chain, now a scale bar under the plat */}
          <g opacity={ramp(frame, 0, 12)}>
            {Array.from({ length: 10 }, (_, k) => (
              <rect key={k} x={sheet.x + k * u} y={sheet.y + sheet.h + 40} width={u} height={10} fill={k % 2 ? "none" : ink.ink} stroke={ink.ink} strokeWidth={1.4} />
            ))}
            <text x={sheet.x} y={sheet.y + sheet.h + 84} fontFamily={fonts.mono} fontSize={17} letterSpacing={2} fill={ink.ink2}>0</text>
            <text x={sheet.x + 10 * u} y={sheet.y + sheet.h + 84} fontFamily={fonts.mono} fontSize={17} letterSpacing={2} fill={ink.ink2} textAnchor="middle">10 CHAINS</text>
          </g>
        </svg>
        <div style={{ position: "absolute", right: 300, top: sheet.y + sheet.h + 34, fontFamily: fonts.display, fontSize: 64, color: ink.ink, fontVariantNumeric: "tabular-nums", opacity: ramp(frame, years - 6, 10) }}>
          1620 <span style={{ color: ink.ink3 }}>to</span> {yr}
        </div>
        <div style={{ position: "absolute", left: 110, top: 104 }}>
          <Label size={18} color={ink.ink3}>Plate II · Ten square chains make an acre</Label>
        </div>
      </Camera>
      <Cues cues={[[2, "paper", 0.4], [years, "whoosh", 0.25]]} />
    </Vellum>
  );
}

const GROWTH = grow(SITES, 40, 11);

/** "This is Turf. A real-time land war on Solana, where every claim is a transaction." */
export function TitleScene({ shot }: { shot: Shot }) {
  const frame = useCurrentFrame();
  const g = fit(120, 110, 1680, 860);
  const turf = cue(shot, "turf");
  const sub = cue(shot, "real");
  const tx = cue(shot, "transaction");
  const step = Math.min(GROWTH.length - 1, Math.max(0, Math.floor((frame - 6) / 4)));
  const board = GROWTH[step];
  const grid = ramp(frame, 0, 20);
  const card = ramp(frame, turf - 3, 10);
  return (
    <Vellum>
      <Camera hits={[turf, tx]} push={0.0003} power={8}>
        <svg width="1920" height="1080" style={{ position: "absolute", inset: 0 }}>
          <defs>
            <filter id="wash" x="-5%" y="-5%" width="110%" height="110%">
              <feTurbulence type="fractalNoise" baseFrequency="0.035" numOctaves="2" seed="5" result="t" />
              <feDisplacementMap in="SourceGraphic" in2="t" scale="7" />
            </filter>
          </defs>
          <g filter="url(#wash)">
            {Array.from({ length: N }, (_, i) => {
              const o = board[i];
              if (!o) return null;
              const p = center(g, i);
              return <path key={i} d={hexPath(p.x, p.y, g.R * 1.02)} fill={rgba(PIGMENTS[o - 1], 0.5)} />;
            })}
          </g>
          <g opacity={0.55 * grid}>
            {Array.from({ length: N }, (_, i) => {
              const p = center(g, i);
              return <path key={i} d={hexPath(p.x, p.y, g.R)} fill="none" stroke={ink.ink} strokeWidth={0.8} />;
            })}
          </g>
        </svg>
        <AbsoluteFill style={{ alignItems: "center", justifyContent: "center" }}>
          <div style={{ background: rgba(ink.vellum, 0.95 * card), border: `2px solid ${rgba(ink.ink, card)}`, boxShadow: `0 30px 80px rgba(42,36,29,${0.25 * card})`, padding: "54px 110px 58px", textAlign: "center", position: "relative", minWidth: 1160 }}>
            <Slam at={turf} from={1.8}>
              <div style={{ display: "flex", alignItems: "center", gap: 34, justifyContent: "center" }}>
                <svg viewBox="0 0 40 40" width={150} height={150}>
                  <path d="M20 3 L34.7 11.5 L34.7 28.5 L20 37 L5.3 28.5 L5.3 11.5 Z" fill="none" stroke={ink.ink} strokeWidth="2.6" strokeDasharray="5.2 2.2" strokeLinecap="round" />
                  <circle cx="20" cy="20" r="3.2" fill={ink.vermilion} />
                  <path d="M20 20 V8.5 L27 11 L20 13.5" fill="none" stroke={ink.ink} strokeWidth="1.6" strokeLinejoin="round" />
                </svg>
                <span style={{ fontFamily: fonts.display, fontSize: 240, lineHeight: 0.9, color: ink.ink }}>Turf</span>
              </div>
            </Slam>
            <div style={{ marginTop: 26, minHeight: 60, fontFamily: fonts.text, fontStyle: "italic", fontSize: 48, color: ink.ink2 }}>
              <Typed at={sub} text="A real-time land war on Solana" cps={34} />
            </div>
            <div style={{ position: "absolute", right: -70, bottom: -46 }}>
              <StampIn at={tx} angle={-8}>
                <Seal text="Every claim a transaction" size={30} />
              </StampIn>
            </div>
          </div>
        </AbsoluteFill>
      </Camera>
      <Cues cues={[[turf, "thud", 0.6], [sub, "typing", 0.18], [tx, "stamp", 0.75]]} />
    </Vellum>
  );
}

export const OPEN_SCENES = { "m-chain": ChainScene, "m-acre": AcreScene, "m-title": TitleScene } as const;
