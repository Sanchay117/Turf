// Watercolour pigments for the eight seats, and hex-shaped wash sprites painted once per size.

export interface Pigment {
  name: string;
  hex: string;
  rgb: [number, number, number];
}

function rgb(hex: string): [number, number, number] {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

const list: [string, string][] = [
  ["madder", "#B4513E"],
  ["indigo", "#34507C"],
  ["verdigris", "#3B8470"],
  ["gamboge", "#CF9628"],
  ["mulberry", "#7A4A80"],
  ["sap green", "#6C8A3A"],
  ["burnt sienna", "#A65F2C"],
  ["prussian", "#2C6C8E"],
];

export const PIGMENTS: Pigment[] = list.map(([name, hex]) => ({ name, hex, rgb: rgb(hex) }));

export const INK = "#2A241D";
export const VERMILION = "#C2412D";
export const BRASS = "#A88445";

export function rgba(p: Pigment, a: number, darken = 0): string {
  const [r, g, b] = p.rgb.map((v) => Math.max(0, Math.round(v * (1 - darken))));
  return `rgba(${r},${g},${b},${a})`;
}

// Deterministic noise so the same hex always gets the same wash.
export function hash(i: number): number {
  let x = (i + 1) * 0x9e3779b1;
  x ^= x >>> 15;
  x = Math.imul(x, 0x85ebca6b);
  x ^= x >>> 13;
  return (x >>> 0) / 4294967296;
}

export function hexPath(ctx: CanvasRenderingContext2D, cx: number, cy: number, r: number) {
  ctx.beginPath();
  for (let k = 0; k < 6; k++) {
    const ang = (Math.PI / 180) * (60 * k - 90);
    const x = cx + r * Math.cos(ang);
    const y = cy + r * Math.sin(ang);
    if (k === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  }
  ctx.closePath();
}

const VARIANTS = 4;

/** Paint wash sprites: [seat][variant] canvases, each a hex of radius r (in device pixels). */
export function paintWashes(r: number): HTMLCanvasElement[][] {
  const size = Math.ceil(r * 2 + 4);
  return PIGMENTS.map((p, seat) =>
    Array.from({ length: VARIANTS }, (_, v) => {
      const c = document.createElement("canvas");
      c.width = c.height = size;
      const ctx = c.getContext("2d")!;
      const cx = size / 2;
      const cy = size / 2;
      const rr = r + 0.6; // overlap a hair so washes meet without paper gaps
      let seed = seat * 97 + v * 13 + 1;
      const rnd = () => {
        seed = (seed * 16807) % 2147483647;
        return seed / 2147483647;
      };

      ctx.save();
      hexPath(ctx, cx, cy, rr);
      ctx.clip();
      ctx.fillStyle = rgba(p, 0.5 + rnd() * 0.08);
      ctx.fillRect(0, 0, size, size);
      // Blooms: soft darker and lighter blotches where the water pooled.
      for (let k = 0; k < 4; k++) {
        const bx = cx + (rnd() - 0.5) * r * 1.2;
        const by = cy + (rnd() - 0.5) * r * 1.2;
        const br = r * (0.5 + rnd() * 0.8);
        const g = ctx.createRadialGradient(bx, by, 0, bx, by, br);
        const dark = rnd() > 0.45;
        g.addColorStop(0, dark ? rgba(p, 0.22, 0.25) : "rgba(246,239,222,0.22)");
        g.addColorStop(1, dark ? rgba(p, 0, 0.25) : "rgba(246,239,222,0)");
        ctx.fillStyle = g;
        ctx.fillRect(0, 0, size, size);
      }
      // Granulation: pigment settling into the paper's tooth.
      const grains = Math.round(r * r * 0.9);
      for (let k = 0; k < grains; k++) {
        ctx.fillStyle = rgba(p, 0.08 + rnd() * 0.14, 0.35);
        ctx.fillRect(rnd() * size, rnd() * size, 1, 1);
      }
      ctx.restore();
      return c;
    }),
  );
}

export const variantOf = (i: number) => Math.floor(hash(i) * VARIANTS);
