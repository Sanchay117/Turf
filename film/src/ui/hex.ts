// The plat's geometry (web/src/chain/layout.ts): a 30 by 18 odd-r hex grid, odd rows shifted right.

export const W = 30;
export const H = 18;
export const N = W * H;
const SQ3 = Math.sqrt(3);

export function neighbors(i: number): number[] {
  const r = Math.floor(i / W);
  const c = i % W;
  const d = r & 1 ? [[-1, 0], [1, 0], [0, -1], [1, -1], [0, 1], [1, 1]] : [[-1, 0], [1, 0], [-1, -1], [0, -1], [-1, 1], [0, 1]];
  return d
    .map(([dc, dr]) => {
      const nc = c + dc;
      const nr = r + dr;
      return nc >= 0 && nc < W && nr >= 0 && nr < H ? nr * W + nc : -1;
    })
    .filter((j) => j >= 0);
}

export interface Grid {
  R: number;
  ox: number;
  oy: number;
  w: number;
  h: number;
}

/** A grid of hexes of radius R fitted into a box. */
export function fit(x: number, y: number, w: number, h: number): Grid {
  const R = Math.min(w / (SQ3 * (W + 0.5)), h / (1.5 * (H - 1) + 2));
  const gw = SQ3 * R * (W + 0.5);
  const gh = R * (1.5 * (H - 1) + 2);
  return { R, ox: x + (w - gw) / 2, oy: y + (h - gh) / 2, w: gw, h: gh };
}

export function center(g: Grid, i: number) {
  const r = Math.floor(i / W);
  const c = i % W;
  return { x: g.ox + SQ3 * g.R * (c + 0.5 * (r & 1)) + (SQ3 * g.R) / 2, y: g.oy + g.R + 1.5 * g.R * r };
}

export function hexPath(cx: number, cy: number, R: number) {
  let d = "";
  for (let k = 0; k < 6; k++) {
    const a = (Math.PI / 180) * (60 * k - 30);
    d += `${k ? "L" : "M"}${(cx + R * Math.cos(a)).toFixed(2)} ${(cy + R * Math.sin(a)).toFixed(2)}`;
  }
  return d + "Z";
}

/** Deterministic territory growth from seed hexes, for drawn (not filmed) plats: owner per hex at each step. */
export function grow(seeds: number[], steps: number, seed = 7): Uint8Array[] {
  let s = seed;
  const rnd = () => {
    s = (s * 1103515245 + 12345) & 0x7fffffff;
    return s / 0x7fffffff;
  };
  const board = new Uint8Array(N);
  seeds.forEach((i, k) => {
    board[i] = k + 1;
    for (const j of neighbors(i)) board[j] = k + 1;
  });
  const out = [board.slice()];
  for (let t = 0; t < steps; t++) {
    for (let k = 0; k < seeds.length; k++) {
      const owner = k + 1;
      const frontier: number[] = [];
      for (let i = 0; i < N; i++) if (board[i] === 0 && neighbors(i).some((j) => board[j] === owner)) frontier.push(i);
      frontier.sort(() => rnd() - 0.5);
      for (const i of frontier.slice(0, 2 + Math.floor(rnd() * 3))) board[i] = owner;
    }
    out.push(board.slice());
  }
  return out;
}

export const SITES = [4 + 4 * W, 25 + 13 * W, 25 + 4 * W, 4 + 13 * W];
