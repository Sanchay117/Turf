import { useCurrentFrame } from "remotion";
import { cue, type Shot } from "../plan.ts";
import { fonts, ink } from "../theme.ts";
import { Camera, Label, ramp, Seal, StampIn, Vellum } from "../ui/kit.tsx";
import { Cues } from "../ui/Sfx.tsx";

const PROGRAM = "Bep1f2hsBMdST6xbkfQqMAUkuQiSGrNFE4Sg9VZ4pvMi";

export function Wordmark({ size = 120 }: { size?: number }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: size * 0.2 }}>
      <svg viewBox="0 0 40 40" width={size * 0.66} height={size * 0.66}>
        <path d="M20 3 L34.7 11.5 L34.7 28.5 L20 37 L5.3 28.5 L5.3 11.5 Z" fill="none" stroke={ink.ink} strokeWidth="2.6" strokeDasharray="5.2 2.2" strokeLinecap="round" />
        <circle cx="20" cy="20" r="3.2" fill={ink.vermilion} />
        <path d="M20 20 V8.5 L27 11 L20 13.5" fill="none" stroke={ink.ink} strokeWidth="1.6" strokeLinejoin="round" />
      </svg>
      <span style={{ fontFamily: fonts.display, fontSize: size, lineHeight: 1, color: ink.ink }}>Turf</span>
    </div>
  );
}

/** "Land has been measured in chains since 1620. Now it's measured in slots. Stake your claim." */
export function EndScene({ shot, site, repo }: { shot: Shot; site: string; repo: string }) {
  const frame = useCurrentFrame();
  const now = cue(shot, "now");
  const stake = cue(shot, "stake");
  const line = (at: number) => ({ opacity: ramp(frame, at, 14), transform: `translateY(${(1 - ramp(frame, at, 14)) * 12}px)` });
  const links = [site && `Play: ${site}`, repo && `Code: ${repo}`].filter(Boolean) as string[];
  return (
    <Vellum>
      <Camera push={0.00022}>
        <div style={{ position: "absolute", left: 0, right: 0, top: 170, textAlign: "center" }}>
          <div style={{ fontFamily: fonts.display, fontSize: 78, color: ink.ink2, ...line(2) }}>Land has been measured in chains since 1620.</div>
          <div style={{ fontFamily: fonts.display, fontSize: 92, color: ink.ink, marginTop: 14, ...line(now) }}>
            Now it's measured in <span style={{ fontStyle: "italic", color: ink.vermilion }}>slots</span>.
          </div>
        </div>
        <div style={{ position: "absolute", left: 0, right: 0, top: 520, display: "flex", justifyContent: "center", alignItems: "center", gap: 70 }}>
          <div style={line(stake - 10)}>
            <Wordmark size={150} />
          </div>
          <StampIn at={stake} angle={-8}>
            <Seal text="Stake your claim" size={40} />
          </StampIn>
        </div>
        <div style={{ position: "absolute", left: 0, right: 0, top: 800, display: "flex", flexDirection: "column", alignItems: "center", gap: 14, ...line(stake + 18) }}>
          {links.map((l) => (
            <Label key={l} size={26} color={ink.ink}>{l}</Label>
          ))}
          <Label size={19} color={ink.ink2}>Program {PROGRAM} · Solana devnet</Label>
          <Label size={19} color={ink.ink3}>MLH Solana Hackathon · November 2026</Label>
        </div>
      </Camera>
      <Cues cues={[[stake, "stamp", 0.8]]} />
    </Vellum>
  );
}
