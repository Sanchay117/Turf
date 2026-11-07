import { AbsoluteFill, Img, staticFile } from "remotion";
import { Wordmark } from "./scenes/End.tsx";
import { fonts, ink } from "./theme.ts";
import { Label, Seal, Vellum } from "./ui/kit.tsx";

/** The video's thumbnail: the wordmark and the promise, beside a real frame of the round it shows. */
export function Thumbnail() {
  // The board in the capture frame (2560 x 1440): the sheet is page x 0..1110, y 61..753.
  const k = 2560 / 1440;
  const crop = { x: 0, y: 61 * k, w: 1110 * k, h: 692 * k };
  const showW = 1090;
  const s = showW / crop.w;
  return (
    <Vellum>
      <div style={{ position: "absolute", right: -150, top: 190, width: showW, height: crop.h * s, overflow: "hidden", transform: "rotate(2.2deg)", boxShadow: "0 40px 90px rgba(42,36,29,.38)", border: `3px solid ${ink.ink}` }}>
        <Img src={staticFile("thumb-frame.jpg")} style={{ position: "absolute", left: -crop.x * s, top: -crop.y * s, width: 2560 * s, height: 1440 * s }} />
      </div>
      <AbsoluteFill style={{ padding: "120px 0 0 110px" }}>
        <Wordmark size={250} />
        <div style={{ marginTop: 40, width: 760, fontFamily: fonts.display, fontSize: 82, lineHeight: 1.04, color: ink.ink }}>
          A land war where every claim is a <span style={{ fontStyle: "italic", color: ink.vermilion }}>Solana</span> transaction
        </div>
        <div style={{ marginTop: 60, display: "flex", alignItems: "center", gap: 30 }}>
          <div style={{ transform: "rotate(-7deg)" }}>
            <Seal text="Live on devnet" size={34} />
          </div>
        </div>
        <Label size={22} color={ink.ink2} style={{ position: "absolute", left: 114, bottom: 84 }}>MLH Solana Hackathon · 2026</Label>
      </AbsoluteFill>
    </Vellum>
  );
}
