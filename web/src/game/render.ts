// The plat sheet: watercolour washes under an engraved hex grid, with pigment pooling at borders.
import { H, N, W, nb } from "../chain/layout.ts";
import { INK, PIGMENTS, VERMILION, hexPath, paintWashes, rgba, variantOf } from "./pigments.ts";

const SQ3 = Math.sqrt(3);
const BLOOM_MS = 460;
const FLASH_MS = 900;
// neighbors() order is [left, right, up-left, up-right, down-left, down-right];
// edge k runs from corner k to corner k+1 (corner 0 at the top, clockwise).
const EDGE_NEIGHBOR = [3, 1, 5, 4, 0, 2];

export interface Label {
  seat: number;
  text: string;
  tile: number;
}

export interface Frame {
  tiles: Uint8Array;
  pending: Map<number, number>; // tile -> seat, optimistic claims in flight
  mySeat: number | null;
  hover: number | null;
  hoverOk: boolean;
  labels: Label[];
  route: number[]; // previewed chain line, outward from your land
  routeOk: number; // how many of those hexes you can afford now
}

export class Plat {
  readonly canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private dpr = 1;
  R = 10;
  private ox = 0;
  private oy = 0;
  sheet = { x: 0, y: 0, w: 0, h: 0 };
  private washes: HTMLCanvasElement[][] = [];
  private grid: HTMLCanvasElement | null = null;
  private shown = new Uint8Array(N);
  private changedAt = new Float64Array(N);
  private prevOwner = new Uint8Array(N);
  private capturedAt = new Float64Array(N).fill(-1e9);
  private dirty = true;
  plateTitle = "Plat No. 1";

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas;
    this.ctx = canvas.getContext("2d")!;
  }

  resize(cssW: number, cssH: number) {
    this.dpr = Math.min(2, window.devicePixelRatio || 1);
    this.canvas.width = Math.round(cssW * this.dpr);
    this.canvas.height = Math.round(cssH * this.dpr);
    this.canvas.style.width = `${cssW}px`;
    this.canvas.style.height = `${cssH}px`;
    const pad = Math.max(14, Math.min(30, cssW * 0.025));
    const strip = cssW < 640 ? 30 : 44;
    const gw = (cssW - 2 * pad) / (SQ3 * (W + 0.5));
    const gh = (cssH - 2 * pad - strip) / (1.5 * (H - 1) + 2);
    this.R = Math.max(4, Math.min(gw, gh));
    const boardW = SQ3 * this.R * (W + 0.5);
    const boardH = this.R * (1.5 * (H - 1) + 2);
    this.ox = (cssW - boardW) / 2;
    this.oy = pad + (cssH - 2 * pad - strip - boardH) / 2;
    this.sheet = { x: this.ox - pad * 0.6, y: this.oy - pad * 0.6, w: boardW + pad * 1.2, h: boardH + pad * 0.6 + strip };
    this.washes = paintWashes(this.R * this.dpr);
    this.grid = this.paintGrid(cssW, cssH, strip);
    this.dirty = true;
  }

  center(i: number): { x: number; y: number } {
    const r = Math.floor(i / W);
    const c = i % W;
    return {
      x: this.ox + SQ3 * this.R * (c + 0.5 * (r & 1)) + (SQ3 * this.R) / 2,
      y: this.oy + this.R + 1.5 * this.R * r,
    };
  }

  hexAt(x: number, y: number): number {
    let best = -1;
    let bestD = Infinity;
    for (let i = 0; i < N; i++) {
      const p = this.center(i);
      const d = (p.x - x) ** 2 + (p.y - y) ** 2;
      if (d < bestD) {
        bestD = d;
        best = i;
      }
    }
    return bestD <= this.R * this.R ? best : -1;
  }

  /** Feed a new confirmed board; changed hexes bloom, captured ones flash. */
  update(tiles: Uint8Array, now = performance.now()) {
    for (let i = 0; i < N; i++) {
      if (tiles[i] === this.shown[i]) continue;
      this.prevOwner[i] = this.shown[i];
      this.changedAt[i] = now;
      if (this.shown[i] !== 0 && tiles[i] !== 0) this.capturedAt[i] = now;
      this.shown[i] = tiles[i];
    }
    this.dirty = true;
  }

  /** Reset without animation (new round dealt, or first load). */
  set(tiles: Uint8Array) {
    this.shown.set(tiles);
    this.changedAt.fill(-1e9);
    this.dirty = true;
  }

  touch() {
    this.dirty = true;
  }

  private paintGrid(cssW: number, cssH: number, strip: number): HTMLCanvasElement {
    const c = document.createElement("canvas");
    c.width = Math.round(cssW * this.dpr);
    c.height = Math.round(cssH * this.dpr);
    const ctx = c.getContext("2d")!;
    ctx.scale(this.dpr, this.dpr);
    const R = this.R;

    // Engraved hex grid.
    ctx.strokeStyle = "rgba(42,36,29,0.30)";
    ctx.lineWidth = 0.7;
    for (let i = 0; i < N; i++) {
      const p = this.center(i);
      hexPath(ctx, p.x, p.y, R);
      ctx.stroke();
    }

    // Double rule around the sheet.
    const s = this.sheet;
    ctx.strokeStyle = INK;
    ctx.lineWidth = 1.4;
    ctx.strokeRect(s.x, s.y, s.w, s.h);
    ctx.lineWidth = 0.6;
    ctx.strokeRect(s.x + 4, s.y + 4, s.w - 8, s.h - 8);

    // Column references along the top edge, as on a survey sheet.
    if (R > 9) {
      ctx.fillStyle = "rgba(42,36,29,0.55)";
      ctx.font = `italic ${Math.round(R * 0.42)}px "IM Fell English", serif`;
      ctx.textAlign = "center";
      for (let col = 0; col < W; col += 5) {
        const p = this.center(col);
        ctx.fillText(String(col + 1), p.x, s.y + 4 + R * 0.42);
      }
    }

    // Bottom strip: scale of chains (left) and a compass mark (right).
    const by = s.y + s.h - strip / 2 - 2;
    const hexW = SQ3 * R;
    const x0 = s.x + 16;
    ctx.strokeStyle = INK;
    ctx.fillStyle = INK;
    ctx.lineWidth = 0.8;
    const segs = 10;
    for (let k = 0; k < segs; k++) {
      const x = x0 + k * hexW;
      if (k % 2 === 0) ctx.fillRect(x, by - 2, hexW, 4);
      else ctx.strokeRect(x, by - 2, hexW, 4);
    }
    ctx.font = `${Math.max(9, Math.round(R * 0.42))}px "IBM Plex Mono", monospace`;
    ctx.textAlign = "center";
    for (const k of [0, 5, 10]) ctx.fillText(String(k), x0 + k * hexW, by - 6);
    ctx.textAlign = "left";
    ctx.font = `italic ${Math.max(10, Math.round(R * 0.5))}px "IM Fell English", serif`;
    ctx.fillText("Scale of Chains: one hex, one chain of 66 feet", x0 + segs * hexW + 12, by + 4);

    // Compass: a simple north arrow.
    const cx = s.x + s.w - 26;
    ctx.beginPath();
    ctx.moveTo(cx, by - 12);
    ctx.lineTo(cx + 5, by + 8);
    ctx.lineTo(cx, by + 4);
    ctx.lineTo(cx - 5, by + 8);
    ctx.closePath();
    ctx.fillStyle = INK;
    ctx.fill();
    ctx.font = `${Math.max(9, Math.round(R * 0.45))}px "IM Fell English", serif`;
    ctx.textAlign = "center";
    ctx.fillText("N", cx, by - 15);
    return c;
  }

  /** Draw if anything changed or is animating. Returns true when it drew. */
  draw(f: Frame, now = performance.now()): boolean {
    const animating = this.isAnimating(now);
    if (!this.dirty && !animating) return false;
    this.dirty = false;
    const ctx = this.ctx;
    const d = this.dpr;
    const R = this.R;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);

    // 1. Washes.
    for (let i = 0; i < N; i++) {
      const owner = f.tiles[i];
      const age = now - this.changedAt[i];
      const p = this.center(i);
      if (age < BLOOM_MS) {
        const t = easeOut(age / BLOOM_MS);
        const prev = this.prevOwner[i];
        if (prev) this.stamp(prev - 1, i, p.x, p.y, 1, 1 - t);
        if (owner) this.stamp(owner - 1, i, p.x, p.y, 0.35 + 0.65 * t, Math.min(1, t * 1.4));
      } else if (owner) {
        this.stamp(owner - 1, i, p.x, p.y, 1, 1);
      }
    }

    // 2. Engraving on top of the washes.
    if (this.grid) ctx.drawImage(this.grid, 0, 0);
    ctx.setTransform(d, 0, 0, d, 0, 0);

    // 3. Pigment pools along every border between owners.
    for (let seat = 0; seat < PIGMENTS.length; seat++) {
      const tag = seat + 1;
      ctx.beginPath();
      let any = false;
      for (let i = 0; i < N; i++) {
        if (f.tiles[i] !== tag) continue;
        const n = nb(i);
        const p = this.center(i);
        for (let k = 0; k < 6; k++) {
          const j = n[EDGE_NEIGHBOR[k]];
          if (j >= 0 && f.tiles[j] === tag) continue;
          const a0 = (Math.PI / 180) * (60 * k - 90);
          const a1 = (Math.PI / 180) * (60 * (k + 1) - 90);
          const inset = R - 1.1;
          ctx.moveTo(p.x + inset * Math.cos(a0), p.y + inset * Math.sin(a0));
          ctx.lineTo(p.x + inset * Math.cos(a1), p.y + inset * Math.sin(a1));
          any = true;
        }
      }
      if (!any) continue;
      ctx.strokeStyle = rgba(PIGMENTS[seat], 0.9, 0.38);
      ctx.lineWidth = Math.max(1.2, R * 0.09);
      ctx.lineCap = "round";
      ctx.stroke();
    }

    // 4. Claims in flight: hatched in the claimant's pigment.
    for (const [i, seat] of f.pending) {
      if (f.tiles[i] === seat + 1) continue;
      const p = this.center(i);
      ctx.save();
      hexPath(ctx, p.x, p.y, R - 1);
      ctx.clip();
      ctx.strokeStyle = rgba(PIGMENTS[seat], 0.7, 0.2);
      ctx.lineWidth = 1.1;
      ctx.beginPath();
      for (let k = -R * 2; k < R * 2; k += 3.5) {
        ctx.moveTo(p.x + k - R, p.y + R);
        ctx.lineTo(p.x + k + R, p.y - R);
      }
      ctx.stroke();
      ctx.restore();
    }

    // 5. Captures flash a vermilion hex, like a clerk's correction.
    for (let i = 0; i < N; i++) {
      const age = now - this.capturedAt[i];
      if (age >= FLASH_MS) continue;
      const p = this.center(i);
      ctx.strokeStyle = `rgba(194,65,45,${(1 - age / FLASH_MS) * 0.95})`;
      ctx.lineWidth = 2;
      hexPath(ctx, p.x, p.y, R - 1.5);
      ctx.stroke();
    }

    // 6. The chain line you are about to run: stakes joined by links.
    if (f.route.length && f.mySeat !== null) {
      const pig = PIGMENTS[f.mySeat];
      for (let k = 0; k < f.route.length; k++) {
        const p = this.center(f.route[k]);
        const ok = k < f.routeOk;
        ctx.fillStyle = ok ? rgba(pig, 0.28) : "rgba(42,36,29,0.05)";
        hexPath(ctx, p.x, p.y, R - 1.5);
        ctx.fill();
      }
      ctx.lineCap = "round";
      ctx.lineWidth = Math.max(1.6, R * 0.13);
      ctx.setLineDash([R * 0.32, R * 0.22]);
      for (const part of [0, 1]) {
        const from = part === 0 ? 0 : Math.max(0, f.routeOk - 1);
        const to = part === 0 ? f.routeOk : f.route.length;
        if (to - from < 1) continue;
        ctx.strokeStyle = part === 0 ? INK : "rgba(42,36,29,0.3)";
        ctx.beginPath();
        for (let k = from; k < to; k++) {
          const p = this.center(f.route[k]);
          if (k === from) ctx.moveTo(p.x, p.y);
          else ctx.lineTo(p.x, p.y);
        }
        ctx.stroke();
      }
      ctx.setLineDash([]);
      for (let k = 0; k < f.route.length; k++) {
        const p = this.center(f.route[k]);
        ctx.fillStyle = k < f.routeOk ? INK : "rgba(42,36,29,0.3)";
        ctx.beginPath();
        ctx.arc(p.x, p.y, Math.max(1.8, R * 0.14), 0, Math.PI * 2);
        ctx.fill();
      }
    }

    // 7. Hover.
    if (f.hover !== null && f.hover >= 0) {
      const p = this.center(f.hover);
      ctx.strokeStyle = f.hoverOk ? INK : "rgba(42,36,29,0.45)";
      ctx.lineWidth = f.hoverOk ? 2 : 1.2;
      ctx.setLineDash(f.hoverOk ? [] : [3, 3]);
      hexPath(ctx, p.x, p.y, R - 0.5);
      ctx.stroke();
      ctx.setLineDash([]);
    }

    // 8. Map labels in the surveyors' pigments.
    if (R > 7) {
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      for (const l of f.labels) {
        const p = this.center(l.tile);
        const size = Math.max(11, R * 0.78);
        ctx.font = `italic ${size}px "IM Fell English", serif`;
        const text = l.text.toUpperCase().split("").join(" ");
        ctx.lineWidth = 3;
        ctx.strokeStyle = "rgba(240,232,212,0.75)";
        ctx.strokeText(text, p.x, p.y);
        ctx.fillStyle = l.seat === f.mySeat ? INK : rgba(PIGMENTS[l.seat], 1, 0.5);
        ctx.fillText(text, p.x, p.y);
        if (l.seat === f.mySeat) {
          // A small vermilion pennant on a survey stake marks your land.
          const sx = p.x;
          const sy = p.y - size * 0.95;
          ctx.strokeStyle = INK;
          ctx.lineWidth = 1.4;
          ctx.beginPath();
          ctx.moveTo(sx, sy + size * 0.45);
          ctx.lineTo(sx, sy - size * 0.55);
          ctx.stroke();
          ctx.fillStyle = VERMILION;
          ctx.beginPath();
          ctx.moveTo(sx, sy - size * 0.55);
          ctx.lineTo(sx + size * 0.7, sy - size * 0.35);
          ctx.lineTo(sx, sy - size * 0.15);
          ctx.closePath();
          ctx.fill();
          ctx.font = `500 ${Math.max(10, R * 0.55)}px "IBM Plex Mono", monospace`;
          ctx.lineWidth = 3;
          ctx.strokeStyle = "rgba(240,232,212,0.85)";
          ctx.strokeText("YOU", p.x, p.y + size * 0.95);
          ctx.fillStyle = INK;
          ctx.fillText("YOU", p.x, p.y + size * 0.95);
        }
      }
      ctx.textBaseline = "alphabetic";
    }
    return true;
  }

  private stamp(seat: number, i: number, x: number, y: number, scale: number, alpha: number) {
    const sprite = this.washes[seat]?.[variantOf(i)];
    if (!sprite || alpha <= 0) return;
    const d = this.dpr;
    const s = sprite.width * scale;
    this.ctx.globalAlpha = alpha;
    this.ctx.drawImage(sprite, x * d - s / 2, y * d - s / 2, s, s);
    this.ctx.globalAlpha = 1;
  }

  private isAnimating(now: number): boolean {
    for (let i = 0; i < N; i++) {
      if (now - this.changedAt[i] < BLOOM_MS || now - this.capturedAt[i] < FLASH_MS) return true;
    }
    return false;
  }
}

function easeOut(t: number): number {
  return 1 - Math.pow(1 - Math.min(1, Math.max(0, t)), 3);
}

/** Pick an interior hex for each seat's name: the one with the most own land within two steps. */
export function placeLabels(tiles: Uint8Array, names: Map<number, string>): Label[] {
  const out: Label[] = [];
  for (const [seat, text] of names) {
    const tag = seat + 1;
    let best = -1;
    let bestScore = -1;
    for (let i = 0; i < N; i++) {
      if (tiles[i] !== tag) continue;
      let s = 0;
      for (const j of nb(i)) {
        if (j < 0) continue;
        if (tiles[j] === tag) s += 2;
        for (const k of nb(j)) if (k >= 0 && tiles[k] === tag) s += 1;
      }
      // Keep labels off the left and right edges so they do not clip.
      const c = i % W;
      if (c < 2 || c > W - 3) s -= 6;
      if (s > bestScore) {
        bestScore = s;
        best = i;
      }
    }
    if (best >= 0 && bestScore >= 10) out.push({ seat, text, tile: best });
  }
  return out;
}

export { VERMILION };
