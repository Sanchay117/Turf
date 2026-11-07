import { interpolate, useCurrentFrame } from "remotion";
import { cue, type Plan, type Shot } from "../plan.ts";
import { fonts, ink, PIGMENTS, rgba } from "../theme.ts";
import { Camera, clamp, easeInOut, Label, ramp, Rolling, Seal, Slam, StampIn, Vellum } from "../ui/kit.tsx";
import { Cues } from "../ui/Sfx.tsx";

const PROGRAM = "Bep1f2hsBMdST6xbkfQqMAUkuQiSGrNFE4Sg9VZ4pvMi";

/** The plat account, byte for byte (programs/turf/src/lib.rs): one pixel per byte. */
const SEGMENTS: { from: number; to: number; label: string; sub: string; tone: string }[] = [
  { from: 0, to: 8, label: "", sub: "", tone: ink.ink },
  { from: 8, to: 96, label: "Header", sub: "round · slots · moves", tone: ink.ink2 },
  { from: 96, to: 608, label: "8 seats", sub: "key · energy · last slot · hexes · name", tone: PIGMENTS[1] },
  { from: 608, to: 1056, label: "Champions", sub: "8 winners, newest first", tone: ink.brass },
  { from: 1056, to: 1596, label: "540 hexes", sub: "one byte each: who owns it", tone: PIGMENTS[2] },
  { from: 1596, to: 1600, label: "", sub: "", tone: ink.ink3 },
];

/** "There's no game server. Each plat is one 1,600-byte account, and the program is the referee." */
export function AccountScene({ shot }: { shot: Shot }) {
  const frame = useCurrentFrame();
  const strike = cue(shot, "server");
  const bytes = cue(shot, "1600");
  const referee = cue(shot, "referee");
  const x0 = 160;
  const y = 470;
  const bar = ramp(frame, bytes - 18, 40, easeInOut);
  return (
    <Vellum>
      <Camera push={0.0003} hits={[referee]} power={6}>
        <div style={{ position: "absolute", left: 160, top: 120, fontFamily: fonts.display, fontSize: 96, color: ink.ink, lineHeight: 1 }}>
          <span style={{ opacity: ramp(frame, 0, 12) }}>No </span>
          <span style={{ position: "relative", opacity: ramp(frame, 2, 12) }}>
            game server.
            <span style={{ position: "absolute", left: -6, right: -6, top: "54%", height: 7, background: ink.vermilion, transformOrigin: "left", transform: `scaleX(${ramp(frame, strike, 12, easeInOut)}) rotate(-1.5deg)` }} />
          </span>
        </div>
        <div style={{ position: "absolute", left: 160, top: y - 120, opacity: ramp(frame, bytes - 10, 14) }}>
          <Label size={22} color={ink.ink}>One plat = one account = 1,600 bytes</Label>
        </div>
        <svg width="1920" height="1080" style={{ position: "absolute", inset: 0 }}>
          {SEGMENTS.map((s, k) => {
            const shown = Math.max(0, Math.min(s.to, bar * 1600) - s.from);
            return <rect key={k} x={x0 + s.from} y={y} width={shown} height={64} fill={rgba(s.tone, k % 2 ? 0.75 : 0.9)} stroke={ink.ink} strokeWidth={shown > 0 ? 1.2 : 0} />;
          })}
          {Array.from({ length: 17 }, (_, k) => (
            <g key={k} opacity={bar * 1600 >= k * 100 ? 1 : 0}>
              <line x1={x0 + k * 100} y1={y + 64} x2={x0 + k * 100} y2={y + (k % 2 ? 76 : 84)} stroke={ink.ink} strokeWidth={1.4} />
              {k % 2 === 0 && (
                <text x={x0 + k * 100} y={y + 110} textAnchor="middle" fontFamily={fonts.mono} fontSize={17} fill={ink.ink2}>
                  {k * 100}
                </text>
              )}
            </g>
          ))}
          {/* the hex bytes as stripes: one byte, one hex */}
          {bar >= 1 &&
            Array.from({ length: 540 }, (_, i) => (i % 9 === 0 ? <line key={i} x1={x0 + 1056 + i} y1={y + 4} x2={x0 + 1056 + i} y2={y + 60} stroke={rgba(ink.vellum, 0.45)} strokeWidth={1} /> : null))}
        </svg>
        {SEGMENTS.filter((s) => s.label).map((s, k) => {
          const at = bytes + 6 + k * 7;
          // The header is too narrow to carry its label above the bar, so it hangs below.
          const below = s.label === "Header";
          return (
            <div key={s.label} style={{ position: "absolute", left: x0 + s.from + 4, top: below ? y + 128 : y - 66, width: below ? 400 : s.to - s.from, opacity: ramp(frame, at, 12), transform: `translateY(${(1 - ramp(frame, at, 12)) * 10}px)` }}>
              <div style={{ fontFamily: fonts.display, fontSize: 34, color: ink.ink, whiteSpace: "nowrap" }}>{s.label}</div>
              <div style={{ fontFamily: fonts.text, fontStyle: "italic", fontSize: 20, color: ink.ink2, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{s.sub}</div>
            </div>
          );
        })}
        {/* the referee: four instructions, one program */}
        <div style={{ position: "absolute", left: 160, top: 690, display: "flex", gap: 22, alignItems: "center" }}>
          {["create_arena", "join", "claim", "next_round"].map((ixn, k) => {
            const p = ramp(frame, referee - 30 + k * 5, 12);
            return (
              <div key={ixn} style={{ opacity: p, transform: `translateY(${(1 - p) * 14}px)`, border: `1.8px solid ${ink.ink}`, background: rgba(ink.vellum, 0.9), padding: "14px 24px 12px", fontFamily: fonts.mono, fontSize: 28, color: ink.ink }}>
                {ixn}
              </div>
            );
          })}
        </div>
        <div style={{ position: "absolute", left: 160, top: 790, opacity: ramp(frame, referee - 6, 14) }}>
          <div style={{ fontFamily: fonts.text, fontStyle: "italic", fontSize: 32, color: ink.ink2 }}>Every rule is checked by the program: adjacency, energy, cost, the clock.</div>
          <Label size={18} color={ink.ink3} style={{ marginTop: 14 }}>Program {PROGRAM} · devnet</Label>
        </div>
        <div style={{ position: "absolute", right: 170, top: 700 }}>
          <StampIn at={referee} angle={-7}>
            <Seal text="Referee: the program" size={30} />
          </StampIn>
        </div>
      </Camera>
      <Cues cues={[[strike, "press", 0.4], [bytes - 18, "ratchet", 0.3], [referee, "stamp", 0.7]]} />
    </Vellum>
  );
}

/** "That round took N claims from 4 players. On devnet, they confirmed in X seconds on average." */
export function NumbersScene({ shot, plan }: { shot: Shot; plan: Plan }) {
  const frame = useCurrentFrame();
  const c = plan.capture.closing!;
  const claims = String(c.roundMoves);
  const at1 = cue(shot, claims);
  const at2 = cue(shot, String(c.players.length));
  const at3 = cue(shot, "devnet");
  const players = [...c.players].sort((a, b) => b.tiles - a.tiles);
  const max = players[0].tiles;
  const figures: { at: number; value: string; label: string }[] = [
    { at: at1, value: claims, label: "claims, each a transaction" },
    { at: at2, value: String(c.players.length), label: "surveyors on one plat" },
    { at: at3, value: (c.stats.avgMs / 1000).toFixed(2), label: "seconds, average to confirm" },
    { at: at3 + 26, value: String(c.roundHexes), label: "hexes claimed in the round" },
  ];
  return (
    <Vellum>
      <Camera push={0.00025}>
        <div style={{ position: "absolute", left: 160, top: 112, opacity: ramp(frame, 0, 12) }}>
          <Label size={20} color={ink.ink3}>The round you just watched · Plat No. {plan.capture.plat} · Solana devnet</Label>
        </div>
        <div style={{ position: "absolute", left: 160, right: 160, top: 190, display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 40 }}>
          {figures.map((f) => {
            const p = ramp(frame, f.at - 4, 12);
            return (
              <div key={f.label} style={{ borderTop: `2px solid ${ink.ink}`, paddingTop: 18, opacity: p }}>
                <Slam at={f.at - 4} from={1.3}>
                  <Rolling at={f.at - 4} value={f.value} dur={18} style={{ fontFamily: fonts.display, fontSize: 150, lineHeight: 1, color: ink.ink }} />
                </Slam>
                <div style={{ fontFamily: fonts.text, fontStyle: "italic", fontSize: 30, color: ink.ink2, marginTop: 8 }}>{f.label}</div>
              </div>
            );
          })}
        </div>
        {/* final holdings, in each surveyor's pigment */}
        <div style={{ position: "absolute", left: 160, right: 160, top: 560 }}>
          <Label size={18} color={ink.ink3} style={{ marginBottom: 18, opacity: ramp(frame, at1 + 10, 12) }}>Holdings when the round closed</Label>
          {players.map((p, k) => {
            const grow = interpolate(frame, [at1 + 14 + k * 6, at1 + 44 + k * 6], [0, 1], { ...clamp, easing: easeInOut });
            return (
              <div key={p.name} style={{ display: "flex", alignItems: "center", gap: 22, height: 64, opacity: ramp(frame, at1 + 12 + k * 6, 10) }}>
                <div style={{ width: 200, fontFamily: fonts.display, fontSize: 38, color: ink.ink }}>{p.name}</div>
                <div style={{ height: 30, width: 1140 * (p.tiles / max) * grow, background: rgba(PIGMENTS[p.seat], 0.78), border: `1.5px solid ${PIGMENTS[p.seat]}` }} />
                <div style={{ fontFamily: fonts.mono, fontSize: 24, color: ink.ink2 }}>{Math.round(p.tiles * grow)}</div>
                {p.me && grow >= 1 && <Label size={16} color={ink.vermilion}>you · champion</Label>}
              </div>
            );
          })}
        </div>
        <div style={{ position: "absolute", left: 160, bottom: 150, opacity: ramp(frame, at3 + 30, 14) }}>
          <Label size={17} color={ink.ink3}>
            Fees for all four players: {(c.stats.fees / 1e9).toFixed(5)} SOL · plat account {c.arena}
          </Label>
        </div>
      </Camera>
      <Cues cues={[[at1 - 4, "thud", 0.45], [at2 - 4, "tick", 0.4], [at3 - 4, "thud", 0.4], [at3 + 22, "tick", 0.35]]} />
    </Vellum>
  );
}

const SNIPPET = `const me = arena.players[seat];
const options = [...arena.tiles.keys()]
  .map((i) => [i, claimCost(arena.tiles, i, seat, me.tiles)])
  .filter(([, cost]) => cost !== null && cost <= liveEnergy(me, slot))
  .sort((a, b) => a[1] - b[1]);

await chain.send("claim", [claimIx(arenaAddress, key.publicKey,
  options.slice(0, 12).map(([i]) => i))], [key]);`;

/** "And because the rules live on chain, anyone can write a surveyor of their own." */
export function OpenScene({ shot }: { shot: Shot }) {
  const frame = useCurrentFrame();
  const anyone = cue(shot, "anyone");
  const chars = Math.floor(interpolate(frame, [4, 4 + 70], [0, SNIPPET.length], clamp));
  return (
    <Vellum>
      <Camera push={0.0004}>
        <div style={{ position: "absolute", left: 160, top: 120, fontFamily: fonts.display, fontSize: 84, color: ink.ink, opacity: ramp(frame, 0, 12) }}>
          Send your own surveyor
        </div>
        <div style={{ position: "absolute", left: 160, top: 236, fontFamily: fonts.text, fontStyle: "italic", fontSize: 34, color: ink.ink2, opacity: ramp(frame, 6, 12) }}>
          This bot takes the cheapest open hexes next to its land. It is in the game's field notes.
        </div>
        <div style={{ position: "absolute", left: 160, top: 330, width: 1600, background: "#2a241d", padding: "36px 44px", boxShadow: "0 24px 60px rgba(42,36,29,.3)", opacity: ramp(frame, 2, 10) }}>
          <pre style={{ margin: 0, fontFamily: fonts.mono, fontSize: 27, lineHeight: 1.55, color: ink.vellum, whiteSpace: "pre" }}>
            {SNIPPET.slice(0, chars)}
            <span style={{ color: ink.brassLight }}>{chars < SNIPPET.length ? "▍" : ""}</span>
          </pre>
        </div>
        <div style={{ position: "absolute", right: 170, top: 860 }}>
          <StampIn at={anyone} angle={-6}>
            <Seal text="Open program · open rules" size={28} />
          </StampIn>
        </div>
      </Camera>
      <Cues cues={[[4, "typing", 0.2], [anyone, "stamp", 0.6]]} />
    </Vellum>
  );
}

export const BUILD_SCENES = { "b-account": AccountScene, "b-numbers": NumbersScene, "b-open": OpenScene } as const;
