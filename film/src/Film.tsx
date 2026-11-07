import type { ReactNode } from "react";
import { AbsoluteFill, Audio, interpolate, Sequence, staticFile, useCurrentFrame } from "remotion";
import { FPS, XFADE, type Plan, type Shot } from "./plan.ts";
import { BUILD_SCENES } from "./scenes/Build.tsx";
import { Demo } from "./scenes/Demo.tsx";
import { EndScene } from "./scenes/End.tsx";
import { OPEN_SCENES } from "./scenes/Open.tsx";
import { ink } from "./theme.ts";
import { Captions } from "./ui/Captions.tsx";

export interface FilmProps extends Record<string, unknown> {
  captions: boolean;
  music: boolean;
  /** Public game URL for the closing card; hidden when empty. */
  site: string;
  /** Public repository URL for the closing card; hidden when empty. */
  repo: string;
  plan?: Plan;
}

const fade = { extrapolateLeft: "clamp", extrapolateRight: "clamp" } as const;

/** Fades a scene up over the end of the one before it. */
function CrossFade({ children, first }: { children: ReactNode; first: boolean }) {
  const frame = useCurrentFrame();
  const o = first ? 1 : interpolate(frame, [0, XFADE], [0, 1], fade);
  return <AbsoluteFill style={{ opacity: o }}>{children}</AbsoluteFill>;
}

function SceneFor({ shot, plan, site, repo }: { shot: Shot; plan: Plan; site: string; repo: string }) {
  if (shot.kind === "demo") return <Demo shot={shot} plan={plan} />;
  if (shot.kind === "end") return <EndScene shot={shot} site={site} repo={repo} />;
  if (shot.kind === "open") {
    const S = OPEN_SCENES[shot.id as keyof typeof OPEN_SCENES];
    return <S shot={shot} />;
  }
  const S = BUILD_SCENES[shot.id as keyof typeof BUILD_SCENES];
  return <S shot={shot} plan={plan} />;
}

/** One pass of sfx/bed.wav (64 s); passes are laid by hand so the volume curve stays continuous. */
const BED = 64 * FPS;

function Bed({ plan }: { plan: Plan }) {
  const title = plan.shots.find((s) => s.id === "m-title")!;
  const end = plan.shots.at(-1)!;
  const level = (f: number) => {
    const up = interpolate(f, [0, 45], [0, 1], fade);
    const out = interpolate(plan.total - f, [0, 75], [0, 1], fade);
    const swell = Math.max(interpolate(f, [title.from, title.from + 20, title.from + title.frames - 10, title.from + title.frames + 20], [0, 1, 1, 0], fade), interpolate(f, [end.from, end.from + 30], [0, 1], fade));
    return (0.1 + 0.08 * swell) * up * out;
  };
  const passes = Math.ceil(plan.total / BED);
  return (
    <>
      {Array.from({ length: passes }, (_, pass) => {
        const from = pass * BED;
        return (
          <Sequence key={pass} from={from} durationInFrames={BED} name={`bed ${pass + 1}`}>
            <Audio src={staticFile("sfx/bed.wav")} volume={(f) => level(from + f)} />
          </Sequence>
        );
      })}
    </>
  );
}

export function Film({ captions, music, site, repo, plan }: FilmProps) {
  if (!plan) return null;
  return (
    <AbsoluteFill style={{ background: ink.vellum }}>
      {plan.shots.map((shot, i) => (
        <Sequence key={shot.id} from={shot.from} durationInFrames={shot.frames} name={shot.id}>
          <CrossFade first={i === 0}>
            <SceneFor shot={shot} plan={plan} site={site} repo={repo} />
            {/* The slot-clock scene looks at the energy tray along the bottom edge, so its captions sit up top. */}
            {captions && shot.kind !== "end" && <Captions shot={shot} top={shot.id === "d-energy"} />}
          </CrossFade>
        </Sequence>
      ))}
      {plan.shots.map((shot) => (
        <Sequence key={`vo ${shot.id}`} from={shot.from + shot.voiceAt} durationInFrames={Math.ceil(shot.take!.seconds * FPS) + 2} name={`vo ${shot.id}`}>
          <Audio src={staticFile(shot.take!.file)} />
        </Sequence>
      ))}
      {music && <Bed plan={plan} />}
    </AbsoluteFill>
  );
}
