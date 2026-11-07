import { continueRender, delayRender, staticFile } from "remotion";

// The game's own type and colours (web/src/style.css and web/src/game/pigments.ts), so the film
// and the plat are one thing: surveyor's vellum, iron-gall ink, a brass chain, vermilion seals.

const FACES: [string, string, string, string][] = [
  ["IM Fell English", "im-fell-english-latin-400-normal.woff2", "400", "normal"],
  ["IM Fell English", "im-fell-english-latin-400-italic.woff2", "400", "italic"],
  ["Spectral", "spectral-latin-400-normal.woff2", "400", "normal"],
  ["Spectral", "spectral-latin-400-italic.woff2", "400", "italic"],
  ["Spectral", "spectral-latin-600-normal.woff2", "600", "normal"],
  ["IBM Plex Mono", "ibm-plex-mono-latin-400-normal.woff2", "400", "normal"],
  ["IBM Plex Mono", "ibm-plex-mono-latin-500-normal.woff2", "500", "normal"],
];

if (typeof document !== "undefined") {
  const handle = delayRender("fonts");
  Promise.all(
    FACES.map(([family, file, weight, style]) => {
      const face = new FontFace(family, `url(${staticFile(`fonts/${file}`)})`, { weight, style });
      return face.load().then(() => document.fonts.add(face));
    }),
  ).then(() => continueRender(handle));
}

export const fonts = {
  display: "'IM Fell English', Georgia, serif",
  text: "'Spectral', Georgia, serif",
  mono: "'IBM Plex Mono', ui-monospace, monospace",
};

export const ink = {
  vellum: "#efe6d0",
  vellumDeep: "#e3d5b5",
  vellumDark: "#d6c49c",
  rule: "#c4b28a",
  ink: "#2a241d",
  ink2: "#5c5145",
  ink3: "#8a7c68",
  brass: "#a88445",
  brassLight: "#c9a865",
  vermilion: "#c2412d",
  night: "#1f1b16",
};

/** The eight pigments, in seat order (web/src/game/pigments.ts). */
export const PIGMENTS = ["#B4513E", "#34507C", "#3B8470", "#CF9628", "#7A4A80", "#6C8A3A", "#A65F2C", "#2C6C8E"];
export const PIGMENT_NAMES = ["madder", "indigo", "verdigris", "gamboge", "mulberry", "sap green", "burnt sienna", "prussian"];

export const rgba = (hex: string, a: number) => {
  const n = parseInt(hex.slice(1), 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`;
};
