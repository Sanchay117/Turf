import { Audio, Sequence, staticFile } from "remotion";

export type SfxName = "stamp" | "press" | "thud" | "whoosh" | "tick" | "ratchet" | "paper" | "chime" | "typing";
export type Cue = [at: number, name: SfxName, volume?: number];

/** A one-shot sound effect from public/sfx (made by scripts/sfx.ts) at a scene frame. */
export function Sfx({ name, at, volume = 0.6 }: { name: SfxName; at: number; volume?: number }) {
  return (
    <Sequence from={Math.max(0, Math.round(at))} durationInFrames={name === "typing" ? 120 : 90} name={`sfx ${name}`} layout="none">
      <Audio src={staticFile(`sfx/${name}.wav`)} volume={volume} />
    </Sequence>
  );
}

export function Cues({ cues }: { cues: Cue[] }) {
  return (
    <>
      {cues.map(([at, name, volume], i) => (
        <Sfx key={i} name={name} at={at} volume={volume} />
      ))}
    </>
  );
}
