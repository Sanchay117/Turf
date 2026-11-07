// Films one real round of Turf on Solana devnet with Chrome's screencast, resampled to a constant
// 30 fps and encoded by ffmpeg. Nothing is staged: the page is the dev server pointed at devnet, the
// rivals are the page's own bots, and the human player is this script moving a real mouse.
// The game is live, so the script plays it and writes down when things happened; the edit then
// cuts to those moments. Writes:
//
//   public/capture/run.mp4     the footage, 2560 x 1440 (a 1440 x 810 page at 16/9 scale)
//   public/capture/run.json    marks (seconds into the footage), panel boxes, and the round's numbers
//
//   node scripts/capture.ts [--url http://localhost:5274/] [--slots 360]

import { spawn } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright-core";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const outDir = join(root, "public", "capture");
mkdirSync(outDir, { recursive: true });

const args = process.argv.slice(2);
const flag = (name: string, fallback: string) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : fallback;
};
const base = flag("--url", "http://localhost:5274/");
const slots = Number(flag("--slots", "360"));
const platId = Number(flag("--plat", String(Math.floor(2_000_000 + Math.random() * 1e9))));

const FPS = 30;
const VIEW = { width: 1440, height: 810 };
const SCALE = 16 / 9;
const FRAME = { w: Math.round(VIEW.width * SCALE), h: Math.round(VIEW.height * SCALE) };

const ffmpeg = spawn(
  "nice",
  ["-n", "10", "ffmpeg", "-y", "-loglevel", "error", "-f", "image2pipe", "-c:v", "mjpeg", "-framerate", String(FPS), "-i", "-",
   "-c:v", "libx264", "-preset", "medium", "-crf", "17", "-pix_fmt", "yuv420p", "-threads", "4", "-movflags", "+faststart",
   join(outDir, "run.mp4")],
  { stdio: ["pipe", "inherit", "inherit"] },
);
ffmpeg.stdin.on("error", (e) => console.log(`ffmpeg stdin: ${e.message}`));

// The screencast only sends a frame when the page changes, so each frame repeats until the next.
let t0 = 0;
let clockOffset = 0;
let written = 0;
let last: Buffer | null = null;
const fill = (until: number) => {
  const target = Math.floor((until - t0) * FPS);
  while (last && written < target) {
    ffmpeg.stdin.write(last);
    written++;
  }
};

type Box = { x: number; y: number; w: number; h: number };
const marks: Record<string, number> = {};
const events: { at: number; kind: string; [k: string]: unknown }[] = [];
const boxes: Record<string, Box> = {};
const now = () => Math.round((Date.now() / 1000 - clockOffset - t0) * 100) / 100;
const mark = (name: string) => {
  if (marks[name] !== undefined) return;
  marks[name] = now();
  console.log(`${marks[name].toFixed(2).padStart(7)}s  ${name}`);
};
const hold = (ms: number) => new Promise((r) => setTimeout(r, ms));

const browser = await chromium.launch({ channel: "chrome", headless: true, args: [`--force-device-scale-factor=${SCALE}`, "--enable-gpu-rasterization", "--ignore-gpu-blocklist"] });
const context = await browser.newContext({ viewport: VIEW, deviceScaleFactor: SCALE, colorScheme: "light", reducedMotion: "no-preference" });
const page = await context.newPage();
page.on("pageerror", (error) => console.log("pageerror", error.message));
page.on("console", (m) => {
  if (m.type() === "error" && !m.text().includes("429")) console.log("console", m.text().slice(0, 200));
});
const cdp = await context.newCDPSession(page);

function jpegSize(buf: Buffer): { w: number; h: number } | null {
  for (let p = 2; p + 9 < buf.length; ) {
    if (buf[p] !== 0xff) return null;
    const marker = buf[p + 1];
    const len = buf.readUInt16BE(p + 2);
    if (marker >= 0xc0 && marker <= 0xc3) return { h: buf.readUInt16BE(p + 5), w: buf.readUInt16BE(p + 7) };
    p += 2 + len;
  }
  return null;
}

let odd = 0;
cdp.on("Page.screencastFrame", async ({ data, metadata, sessionId }) => {
  await cdp.send("Page.screencastFrameAck", { sessionId }).catch(() => {});
  const jpeg = Buffer.from(data, "base64");
  const size = jpegSize(jpeg);
  if (!size || size.w !== FRAME.w || size.h !== FRAME.h) {
    if (odd++ < 3) console.log(`skipped a ${size?.w}x${size?.h} frame`);
    return;
  }
  const ts = metadata.timestamp ?? Date.now() / 1000;
  if (!t0) {
    t0 = ts;
    clockOffset = Date.now() / 1000 - ts;
  }
  fill(ts);
  last = jpeg;
});

// The film cursor: an ink arrow that follows the real mouse, pressed in on a click.
const CURSOR_CSS = `
  #film-cursor { position: fixed; z-index: 10000; left: 0; top: 0; width: 26px; height: 26px; pointer-events: none;
    filter: drop-shadow(0 2px 3px rgba(42,36,29,.35)); }
  #film-cursor svg { transition: transform .12s; transform-origin: 4px 2px; } #film-cursor.press svg { transform: scale(.8); }
`;
let cursor = { x: VIEW.width * 0.5, y: VIEW.height * 0.7 };
async function dress() {
  await page.addStyleTag({ content: CURSOR_CSS });
  await page.evaluate(({ x, y }) => {
    const c = document.createElement("div");
    c.id = "film-cursor";
    c.innerHTML = `<svg width="26" height="26" viewBox="0 0 24 24"><path d="M4 2l15 9.5-6.6 1.4L16 20l-2.6 1.3-3.6-7.3L4 18.6z" fill="#2a241d" stroke="#efe6d0" stroke-width="1.4" stroke-linejoin="round"/></svg>`;
    c.style.transform = `translate(${x}px, ${y}px)`;
    document.body.appendChild(c);
    addEventListener("mousemove", (e) => (c.style.transform = `translate(${e.clientX}px, ${e.clientY}px)`), { passive: true });
  }, cursor);
  await page.mouse.move(cursor.x, cursor.y);
}

const ease = (p: number) => (p < 0.5 ? 4 * p * p * p : 1 - Math.pow(-2 * p + 2, 3) / 2);
/** Moves the real mouse along an eased path, so hover previews update on the way like a hand's. */
async function glide(x: number, y: number, ms = 560) {
  const from = { ...cursor };
  const steps = Math.max(6, Math.round(ms / 20));
  for (let s = 1; s <= steps; s++) {
    const e = ease(s / steps);
    await page.mouse.move(from.x + (x - from.x) * e, from.y + (y - from.y) * e);
    await hold(ms / steps - 4);
  }
  cursor = { x, y };
}
async function click() {
  await page.evaluate(() => document.getElementById("film-cursor")!.classList.add("press"));
  await page.mouse.down();
  await hold(70);
  await page.mouse.up();
  await hold(90);
  await page.evaluate(() => document.getElementById("film-cursor")?.classList.remove("press"));
}
async function boxOf(selector: string): Promise<Box | null> {
  const b = await page.locator(selector).first().boundingBox();
  return b ? { x: Math.round(b.x), y: Math.round(b.y), w: Math.round(b.width), h: Math.round(b.height) } : null;
}

interface Suggestion { x: number; y: number; hexes: number; enemy: number; cost: number; energy: number }
interface Snapshot {
  slot: number;
  round: number;
  roundEnd: number;
  roundMoves: number;
  roundHexes: number;
  totalMoves: number;
  seat: number | null;
  players: { name: string; tiles: number; seat: number; me: boolean }[];
  stats: { sent: number; confirmed: number; avgMs: number; fees: number };
  arena: string;
}
const snap = () =>
  page.evaluate(() => {
    const t = (window as unknown as { turf: any }).turf;
    const a = t.arena;
    if (!a) return null;
    return {
      slot: t.slot,
      round: a.round,
      roundEnd: a.roundEnd,
      roundMoves: a.roundMoves,
      roundHexes: a.roundHexes,
      totalMoves: a.totalMoves,
      seat: t.mySeat,
      players: a.players.filter((p: any) => p.active).map((p: any) => ({ name: p.name, tiles: p.tiles, seat: p.seat, me: p.seat === t.mySeat })),
      stats: t.stats,
      arena: a.address.toBase58(),
    };
  }) as Promise<Snapshot | null>;
const suggest = (prefer: "far" | "solid" | "enemy") =>
  page.evaluate((p) => (window as unknown as { turf: any }).turf.suggest(p), prefer) as Promise<Suggestion | null>;

await cdp.send("Page.startScreencast", { format: "jpeg", quality: 90, maxWidth: FRAME.w, maxHeight: FRAME.h, everyNthFrame: 1 });
let closing: Snapshot | null = null;
try {
  const url = `${base}?plat=${platId}&slots=${slots}`;
  console.log(`plat ${platId}, ${slots}-slot round: ${url}`);
  await page.goto(url, { waitUntil: "networkidle" });
  await page.evaluate(() => document.fonts.ready);
  await dress();
  await hold(400);
  mark("load");
  for (const [k, sel] of Object.entries({ sheet: "#sheet", deed: ".deed-card", ledger: ".ledger", holdings: "#holdings", register: ".register-block", hall: "#hall", tray: ".tray", links: "#links", header: "header", slot: "#slot", left: "#left" })) {
    const b = await boxOf(sel);
    if (b) boxes[k] = b;
  }
  await hold(1600);

  // Stake a claim: name the surveyor and press the button.
  const name = (await boxOf("#name"))!;
  await glide(name.x + name.w * 0.6, name.y + name.h * 0.55, 700);
  await click();
  await page.keyboard.press("ControlOrMeta+A");
  await page.keyboard.type("Gunter", { delay: 110 });
  mark("typed");
  await hold(500);
  const btn = (await boxOf("#stake-btn"))!;
  await glide(btn.x + btn.w * 0.5, btn.y + btn.h * 0.55, 600);
  await hold(250);
  await click();
  mark("stake");
  await page.waitForSelector(".deed-card .seal", { timeout: 90_000 });
  mark("recorded");
  await page.waitForSelector("#deed[hidden]", { timeout: 10_000, state: "attached" });
  mark("deed-gone");
  const me = await snap();
  console.log(`seat ${me?.seat}, arena ${me?.arena}, round ends at slot ${me?.roundEnd}`);

  // Look at your land while the rivals take their seats.
  const land = (await page.evaluate((s) => (window as unknown as { turf: any }).turf.landOf(s), me!.seat!)) as { x: number; y: number } | null;
  if (land) await glide(land.x + 18, land.y + 22, 800);
  for (let k = 0; k < 40; k++) {
    const s = await snap();
    if (s && s.players.length >= 4) break;
    await hold(500);
  }
  mark("rivals");
  await hold(1800);

  // Play the round: aim, let the chain line show, click. Every few moves, go for enemy land.
  let move = 0;
  let captures = 0;
  while (true) {
    const s = await snap();
    if (!s) break;
    if (s.slot >= s.roundEnd - 2) {
      closing = s;
      break;
    }
    // The first runs wait for a full purse, so the long chain line reads on camera.
    if (move < 2) {
      const e = await page.evaluate(() => {
        const t = (window as unknown as { turf: any }).turf;
        const p = t.arena.players[t.mySeat];
        return Math.min(30, p.energy + Math.max(0, t.slot - p.lastSlot));
      });
      if (e < 12) {
        await hold(400);
        continue;
      }
    }
    // Two long lines for the camera, then play to win: solid land, and the leader's thin edges.
    const late = (s.slot - (s.roundEnd - slots)) / slots > 0.6;
    const prefer = move < 2 ? "far" : move % (late ? 2 : 3) === 0 ? "enemy" : "solid";
    const pick = await suggest(prefer);
    if (!pick) {
      await hold(300);
      continue;
    }
    await glide(pick.x, pick.y, move < 2 ? 900 : 400);
    await hold(move < 2 ? 1300 : 300); // the preview: dashed chain, stakes, cost tip
    await click();
    move++;
    const at = now();
    events.push({ at, kind: "claim", move, ...pick });
    mark(`claim-${move}`);
    if (pick.enemy > 0) {
      captures++;
      events.push({ at, kind: "capture", move, enemy: pick.enemy, x: pick.x, y: pick.y });
      mark(`capture-${captures}`);
    }
    if (move === 1) mark("first-claim");
    await hold(move < 2 ? 1400 : 280);
  }
  mark("closing");
  console.log("closing:", JSON.stringify(closing));

  // The crank: this page (or another) sends next_round; wait for the new round on the board.
  if (land) await glide(VIEW.width * 0.36, VIEW.height * 0.5, 900);
  const round = closing?.round ?? 1;
  await page.waitForFunction((r) => (window as unknown as { turf: any }).turf.shownRound > r, round, { timeout: 120_000 });
  mark("next-round");
  const won = await page.evaluate(() => !!document.querySelector("#banner.won:not([hidden])"));
  console.log(won ? "the human won the round" : "a rival won the round");
  boxes.banner = (await boxOf("#banner"))!;
  boxes.hallAfter = (await boxOf("#hall"))!;
  await hold(8000);
  mark("end");
} finally {
  const final = await snap().catch(() => null);
  await cdp.send("Page.stopScreencast").catch(() => {});
  fill(Date.now() / 1000 - clockOffset);
  ffmpeg.stdin.end();
  await new Promise((r) => ffmpeg.on("close", r));
  await browser.close();
  writeFileSync(
    join(outDir, "run.json"),
    JSON.stringify({ fps: FPS, width: FRAME.w, height: FRAME.h, view: VIEW, scale: SCALE, seconds: written / FPS, plat: platId, slots, marks, events, boxes, closing, final }, null, 2) + "\n",
  );
  console.log(`\n${(written / FPS).toFixed(1)}s of footage`);
}
