import { Composition, Still } from "remotion";
import links from "../links.json";
import { Film, type FilmProps } from "./Film.tsx";
import { FPS, makePlan } from "./plan.ts";
import { Thumbnail } from "./Stills.tsx";

export function Root() {
  return (
    <>
      <Composition
        id="Turf"
        component={Film}
        width={1920}
        height={1080}
        fps={FPS}
        durationInFrames={FPS * 150}
        defaultProps={{ captions: true, music: true, site: links.site, repo: links.repo } satisfies FilmProps}
        calculateMetadata={async ({ props }) => {
          const plan = await makePlan();
          return { durationInFrames: plan.total, props: { ...props, plan } };
        }}
      />
      <Still id="Thumbnail" component={Thumbnail} width={1920} height={1080} />
    </>
  );
}
