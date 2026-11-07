import "./polyfill.ts";
import "@fontsource/im-fell-english/400.css";
import "@fontsource/im-fell-english/400-italic.css";
import "@fontsource/spectral/400.css";
import "@fontsource/spectral/400-italic.css";
import "@fontsource/ibm-plex-mono/400.css";
import "@fontsource/ibm-plex-mono/500.css";
import "./style.css";

import { Keypair, LAMPORTS_PER_SOL, PublicKey } from "@solana/web3.js";
import { Chain, DEFAULT_RPC, FEE_LAMPORTS, type Receipt } from "./chain/client.ts";
import { arenaAddress, claimIx, createArenaIx, cu, joinIx, nextRoundIx } from "./chain/ix.ts";
import {
  countOwned,
  ENERGY_CAP,
  IDLE_SLOTS,
  MAX_PLAYERS,
  MAX_TARGETS,
  N,
  PROGRAM_ID,
  liveEnergy,
  type Arena,
  type Player,
} from "./chain/layout.ts";
import { SURVEYORS, chooseClaims, type Temperament } from "./game/brain.ts";
import { affordable, route } from "./game/route.ts";
import { PIGMENTS } from "./game/pigments.ts";
import { Plat, placeLabels } from "./game/render.ts";
import { keyring, rename } from "./keys.ts";

// ---------------------------------------------------------------- config

const RPC: string = import.meta.env.VITE_RPC_URL || DEFAULT_RPC;
const WS: string | undefined = import.meta.env.VITE_WS_URL || undefined;
// New plats run 600-slot rounds (two and a half minutes at devnet's slot time); ?slots=150 makes a quick one.
const ROUND_SLOTS = (() => {
  const s = Number(new URLSearchParams(location.search).get("slots"));
  return Number.isInteger(s) && s >= 150 && s <= 9000 ? s : 600;
})();
const PUBLIC_PLATS = 12;
const PARTY = 4; // fill a plat with rivals up to this many surveyors
const SEND_BUDGET = 24; // sends per 10 s from this tab (public devnet allows about 40 per IP)
const LOCAL = RPC.includes("127.0.0.1") || RPC.includes("localhost");

const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;

function explorer(kind: "tx" | "address", id: string): string {
  const cluster = LOCAL ? `cluster=custom&customUrl=${encodeURIComponent(RPC)}` : "cluster=devnet";
  return `https://explorer.solana.com/${kind}/${id}?${cluster}`;
}

const fmt = (n: number) => n.toLocaleString("en-US");
const short = (s: string) => `${s.slice(0, 4)}…${s.slice(-4)}`;

// ---------------------------------------------------------------- state

const chain = new Chain(RPC, WS);
const keys = keyring();
const plat = new Plat($<HTMLCanvasElement>("plat"));

let arenaId = 1;
let arenaAddr = arenaAddress(arenaId);
let arena: Arena | null = null;
let slot = 0;
let joined = false;
let unwatch: (() => void) | null = null;
let crankedRound = 0;
let shownRound = 0;

interface PendingClaim {
  seat: number;
  at: number;
  cost: number;
  sig?: string;
}
const pending = new Map<number, PendingClaim>();
const queue: number[] = [];
let hover: number | null = null;
let hoverOk = false;
let painting = false;

const sendTimes: number[] = [];
const receipts: Receipt[] = [];
const names = new Map<string, { name: string; seat: number }>(); // signer -> label for the register
let confirmedCount = 0;
let confirmMsTotal = 0;

interface Rival {
  kp: Keypair;
  t: Temperament;
  inFlight: boolean;
  timer: ReturnType<typeof setTimeout> | null;
}
const rivals: Rival[] = [];

// ---------------------------------------------------------------- helpers

function seatOf(key: PublicKey, a: Arena | null = arena): number {
  if (!a) return -1;
  return a.players.findIndex((p) => p.active && p.authority.equals(key));
}

function mySeat(): number | null {
  const s = seatOf(keys.me.publicKey);
  return s >= 0 ? s : null;
}

function isIdle(p: Player): boolean {
  return slot > 0 && slot - p.lastSlot > IDLE_SLOTS;
}

function budgetLeft(): number {
  const now = performance.now();
  while (sendTimes.length && now - sendTimes[0] > 10_000) sendTimes.shift();
  return SEND_BUDGET - sendTimes.length;
}

function noteSend() {
  sendTimes.push(performance.now());
}

/** The board as this tab believes it will be once its in-flight claims land. */
function optimistic(): Uint8Array {
  const t = arena ? arena.tiles.slice() : new Uint8Array(N);
  for (const [i, p] of pending) t[i] = p.seat + 1;
  return t;
}

function pendingCost(seat: number): number {
  let c = 0;
  for (const [i, p] of pending) if (p.seat === seat && arena && arena.tiles[i] !== seat + 1) c += p.cost;
  return c;
}

function leaderSeat(): number | null {
  if (!arena) return null;
  let best: Player | null = null;
  for (const p of arena.players) if (p.active && (!best || p.tiles > best.tiles)) best = p;
  return best && best.tiles > 0 ? best.seat : null;
}

let tipTimer: ReturnType<typeof setTimeout> | null = null;
function tip(text: string, x: number, y: number, warn = false, ms = 1400) {
  const el = $("tip");
  el.textContent = text;
  el.style.left = `${x}px`;
  el.style.top = `${y}px`;
  el.classList.toggle("warn", warn);
  el.classList.add("on");
  if (tipTimer) clearTimeout(tipTimer);
  tipTimer = setTimeout(() => el.classList.remove("on"), ms);
}

function hint(text: string) {
  $("hint").textContent = text;
}

// ---------------------------------------------------------------- plat selection

async function choosePlat(): Promise<number> {
  const fromUrl = Number(new URLSearchParams(location.search).get("plat"));
  if (Number.isInteger(fromUrl) && fromUrl > 0) return fromUrl;
  const ids = Array.from({ length: PUBLIC_PLATS }, (_, k) => k + 1);
  let found: (Arena | null)[] = [];
  try {
    found = await chain.fetchArenas(ids.map(arenaAddress));
  } catch {
    return 1;
  }
  const s = await chain.conn.getSlot("processed").catch(() => 0);
  let best = -1;
  let bestScore = -Infinity;
  found.forEach((a, k) => {
    if (!a) return;
    if (seatOf(keys.me.publicKey, a) >= 0) {
      best = ids[k];
      bestScore = Infinity;
      return;
    }
    const live = a.players.filter((p) => p.active && s - p.lastSlot <= IDLE_SLOTS).length;
    if (live >= MAX_PLAYERS) return;
    const score = live * 10 - k;
    if (score > bestScore) {
      bestScore = score;
      best = ids[k];
    }
  });
  if (best > 0) return best;
  const missing = found.findIndex((a) => !a);
  return missing >= 0 ? ids[missing] : Math.floor(1000 + Math.random() * 1e6);
}

async function openPlat(id: number) {
  arenaId = id;
  arenaAddr = arenaAddress(id);
  plat.plateTitle = `Plat No. ${id}`;
  $("plate").textContent = `Plat No. ${id}`;
  if (unwatch) unwatch();
  unwatch = chain.watchArena(arenaAddr, onArena);
  try {
    const a = await chain.fetchArena(arenaAddr, "processed");
    if (a) {
      plat.set(a.tiles);
      onArena(a);
    } else {
      renderPanels();
    }
  } catch {
    $("net").classList.add("down");
  }
  updateProof();
}

// ---------------------------------------------------------------- arena updates

function onArena(a: Arena) {
  if (arena && a.round < arena.round) return; // stale processed update
  const newRound = arena !== null && a.round !== arena.round;
  arena = a;
  for (const p of a.players) if (p.active) names.set(p.authority.toBase58(), { name: p.name, seat: p.seat });

  if (newRound) {
    pending.clear();
    queue.length = 0;
    announceRound(a);
  }
  plat.update(a.tiles);
  for (const [i, p] of pending) if (a.tiles[i] === p.seat + 1) pending.delete(i);
  shownRound = a.round;
  renderPanels();
}

function announceRound(a: Arena) {
  const champ = a.hall[0];
  const el = $("banner");
  const mine = champ && champ.authority.equals(keys.me.publicKey);
  el.innerHTML = !champ || champ.round !== a.round - 1
    ? `Round ${a.round} begins. A fresh plat is dealt.`
    : mine
      ? `Round ${champ.round} is yours, with ${champ.tiles} hexes. Your name is in the register.<span class="seal banner-seal">Champion</span>`
      : `Round ${champ.round} goes to <b>${escapeHtml(champ.name)}</b> with ${champ.tiles} hexes. A fresh plat is dealt.`;
  el.classList.toggle("won", Boolean(mine));
  el.hidden = false;
  setTimeout(() => (el.hidden = true), mine ? 7000 : 5200);
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
}

// ---------------------------------------------------------------- slot clock

// Slot time is measured, not assumed: devnet runs near 240 ms a slot, mainnet near 400.
const slotSamples: { s: number; t: number }[] = [];
let msPerSlot = 400;

function onSlot(s: number) {
  const t = performance.now();
  slotSamples.push({ s, t });
  while (slotSamples.length > 2 && t - slotSamples[0].t > 20_000) slotSamples.shift();
  const first = slotSamples[0];
  if (s - first.s >= 8) {
    msPerSlot = (t - first.t) / (s - first.s);
    $("slot-ms").textContent = String(Math.round(msPerSlot));
    $("round-min").textContent = (((arena?.roundSlots ?? ROUND_SLOTS) * msPerSlot) / 60_000).toFixed(1);
  }
  slot = s;
  $("slot").textContent = fmt(s);
  $("d-slot").textContent = fmt(s);
  $("net").classList.remove("down");
  if (arena) {
    const left = Math.max(0, arena.roundEnd - s);
    const secs = Math.round((left * msPerSlot) / 1000);
    $("left").textContent = `${fmt(left)} slots · ${Math.floor(secs / 60)}:${String(secs % 60).padStart(2, "0")}`;
    if (left === 0) maybeCrank();
  }
  renderEnergy();
}

function maybeCrank() {
  if (!arena || !joined || crankedRound === arena.round) return;
  crankedRound = arena.round;
  const round = arena.round;
  const el = $("banner");
  el.innerHTML = `Round ${round} is closed. Recording the champion…`;
  el.hidden = false;
  // A little jitter so a room full of tabs does not all turn the crank at once.
  setTimeout(async () => {
    if (!arena || arena.round !== round) return;
    try {
      noteSend();
      await chain.send("closes the round", [cu.next(), nextRoundIx(arenaAddr)], [keys.me]);
    } catch {
      crankedRound = 0;
    }
  }, 400 + Math.random() * 1600);
}

// ---------------------------------------------------------------- panels

function renderPanels() {
  const a = arena;
  $("round").textContent = a ? `Round ${a.round}` : "Round ·";
  $("d-moves").textContent = a ? fmt(a.totalMoves) : "0";
  const active = a ? a.players.filter((p) => p.active && !isIdle(p)) : [];
  $("d-players").textContent = String(active.length);

  const hold = $("holdings");
  if (!a || active.length === 0) {
    hold.innerHTML = `<li class="empty">No surveyors on this plat yet.</li>`;
  } else {
    const me = mySeat();
    const rivalKeys = new Set(rivals.map((r) => r.kp.publicKey.toBase58()));
    hold.innerHTML = a.players
      .filter((p) => p.active)
      .sort((x, y) => y.tiles - x.tiles)
      .map((p) => {
        const key = p.authority.toBase58();
        const tag = p.seat === me ? "you" : rivalKeys.has(key) ? "your rival" : isIdle(p) ? "idle" : "";
        return `<li class="${p.seat === me ? "me" : ""}">
          <i class="sw" style="--c:${PIGMENTS[p.seat].hex}"></i>
          <span class="who">${escapeHtml(p.name || short(key))}<small>${tag}</small></span>
          <span class="n">${p.tiles}</span>
          <span class="pct">${((p.tiles / N) * 100).toFixed(0)}%</span>
        </li>`;
      })
      .join("");
  }

  const hall = $("hall");
  hall.innerHTML = a && a.hall.length
    ? a.hall
        .map((c) => `<li><span class="r">Round ${c.round}</span><span class="who">${escapeHtml(c.name)}</span><span class="n">${c.tiles} hexes</span></li>`)
        .join("")
    : `<li class="empty">No round has closed on this plat yet.</li>`;

  const labels = new Map<number, string>();
  if (a) for (const p of a.players) if (p.active) labels.set(p.seat, p.name || "surveyor");
  labelsCache = placeLabels(optimistic(), labels);
  renderEnergy();
}

let labelsCache: ReturnType<typeof placeLabels> = [];

function renderEnergy() {
  const s = mySeat();
  const links = $("links");
  if (links.childElementCount !== ENERGY_CAP) {
    links.innerHTML = Array.from({ length: ENERGY_CAP }, () => "<i></i>").join("");
  }
  const e = s !== null && arena ? Math.max(0, liveEnergy(arena.players[s], slot) - pendingCost(s)) : 0;
  [...links.children].forEach((el, k) => el.classList.toggle("on", k < e));
  $("energy-num").textContent = s !== null ? `${e} / ${ENERGY_CAP}` : "·";
}

function renderRegister() {
  const reg = $("register");
  const rows = receipts.slice(-16).reverse();
  reg.innerHTML = rows
    .map((r) => {
      const who = names.get(r.signer);
      const pig = who ? PIGMENTS[who.seat].hex : "#5c5145";
      const state = r.confirmedMs === undefined ? "sending" : r.err ? "refused" : "recorded";
      const cls = r.confirmedMs === undefined ? "pending" : r.err ? "err" : "ok";
      const when = r.slot ? `slot ${fmt(r.slot)}` : "";
      const ms = r.confirmedMs !== undefined && !r.err ? `${(r.confirmedMs / 1000).toFixed(2)} s` : "";
      return `<li class="${cls}">
        <span class="line1"><i class="sw" style="--c:${pig}"></i>${escapeHtml(who?.name ?? short(r.signer))} <span class="what">${escapeHtml(r.label)}</span></span>
        <span class="state">${state}</span>
        <span class="line2"><span>${when}</span><span>${ms}</span><a href="${explorer("tx", r.sig)}" target="_blank" rel="noopener">${short(r.sig)}</a></span>
      </li>`;
    })
    .join("");
  const fees = (chain.sentCount * FEE_LAMPORTS) / LAMPORTS_PER_SOL;
  $("sum").textContent = confirmedCount
    ? `${fmt(confirmedCount)} recorded · average ${(confirmMsTotal / confirmedCount / 1000).toFixed(2)} s to confirm · fees ${fees.toFixed(6)} SOL`
    : "Nothing recorded yet.";
}

chain.onReceipt((r) => {
  if (!receipts.includes(r)) receipts.push(r);
  if (receipts.length > 200) receipts.splice(0, receipts.length - 200);
  if (r.confirmedMs !== undefined) {
    if (!r.err) {
      confirmedCount++;
      confirmMsTotal += r.confirmedMs;
    }
    // Claims that confirmed but did not land (skipped by the program) stop hatching shortly after.
    setTimeout(() => {
      for (const [i, p] of pending) if (p.sig === r.sig) pending.delete(i);
      plat.touch();
      renderEnergy();
    }, r.err ? 0 : 1500);
  }
  renderRegister();
});

// ---------------------------------------------------------------- playing

function tryQueue(i: number, x: number, y: number) {
  if (i < 0 || !arena) return;
  const seat = mySeat();
  if (!joined || seat === null) {
    if (!joined) {
      $("deed").classList.remove("leaving");
      $("deed").hidden = false;
      $("name").focus();
    } else {
      tip("Rejoining the plat…", x, y);
      void rejoin();
    }
    return;
  }
  if (slot >= arena.roundEnd) return tip("The round is closed", x, y, true);
  if (pending.has(i)) return;
  const board = optimistic();
  if (board[i] === seat + 1) return;
  const r = route(board, seat, i);
  if (!r || !r.path.length) return tip("No open line to that hex", x, y, true);
  const have = liveEnergy(arena.players[seat], slot) - pendingCost(seat);
  const room = MAX_TARGETS - (queue.length % MAX_TARGETS);
  const n = affordable(r, have, room);
  if (n === 0) {
    $("links").classList.remove("shake");
    void $("links").offsetWidth;
    $("links").classList.add("shake");
    return tip(`Needs ${r.costs[0]} energy, you have ${Math.max(0, have)}`, x, y, true);
  }
  const now = performance.now();
  for (let k = 0; k < n; k++) {
    pending.set(r.path[k], { seat, at: now, cost: r.costs[k] });
    queue.push(r.path[k]);
  }
  if (n < r.path.length) tip(`Ran ${n} of ${r.path.length} hexes; energy refills each slot`, x, y, false, 1600);
  preview = null;
  plat.touch();
  renderEnergy();
}

let preview: { path: number[]; ok: number } | null = null;

function updatePreview(x: number, y: number) {
  preview = null;
  hoverOk = false;
  const seat = mySeat();
  if (hover === null || seat === null || !arena || !joined) return;
  const board = optimistic();
  if (board[hover] === seat + 1) return;
  const r = route(board, seat, hover);
  if (!r || !r.path.length) return;
  const have = Math.max(0, liveEnergy(arena.players[seat], slot) - pendingCost(seat));
  const ok = affordable(r, have, MAX_TARGETS);
  const total = r.costs.reduce((s, c) => s + c, 0);
  preview = { path: r.path, ok };
  hoverOk = ok > 0;
  if (!painting) {
    const hexes = r.path.length === 1 ? "1 hex" : `${r.path.length} hexes`;
    tip(ok === r.path.length ? `${hexes} · ${total} energy` : `${hexes} · ${total} energy · you have ${have}`, x, y, ok === 0, 1100);
  }
}

async function flush() {
  if (!queue.length || !joined) return;
  if (budgetLeft() < 2 || flushing) return;
  // Hexes whose optimistic mark already expired are dropped from the queue.
  const batch = queue.splice(0, MAX_TARGETS).filter((i) => pending.has(i));
  if (!batch.length) return;
  flushing = true;
  try {
    noteSend();
    const r = await chain.send(`claims ${batch.length} ${batch.length === 1 ? "hex" : "hexes"}`, [cu.claim(), claimIx(arenaAddr, keys.me.publicKey, batch)], [keys.me]);
    for (const i of batch) {
      const p = pending.get(i);
      if (p) p.sig = r.sig;
    }
  } catch (e) {
    if (String(e).includes("429")) {
      queue.unshift(...batch); // throttled: send again on the next tick
    } else {
      for (const i of batch) pending.delete(i);
      hint("The network refused that claim. Try again in a moment.");
    }
  } finally {
    flushing = false;
  }
}
let flushing = false;
setInterval(() => void flush(), 330);

// Drop stale optimistic marks.
setInterval(() => {
  const now = performance.now();
  for (const [i, p] of pending) if (now - p.at > 9000) pending.delete(i);
}, 1000);

const canvas = $<HTMLCanvasElement>("plat");
function local(e: PointerEvent) {
  const r = canvas.getBoundingClientRect();
  return { x: e.clientX - r.left, y: e.clientY - r.top };
}
canvas.addEventListener("pointerdown", (e) => {
  const { x, y } = local(e);
  painting = true;
  canvas.setPointerCapture(e.pointerId);
  tryQueue(plat.hexAt(x, y), x, y);
});
canvas.addEventListener("pointermove", (e) => {
  const { x, y } = local(e);
  const i = plat.hexAt(x, y);
  if (i !== hover) {
    hover = i >= 0 ? i : null;
    if (painting && hover !== null) tryQueue(hover, x, y);
    else updatePreview(x, y);
    plat.touch();
  }
});
const stop = () => (painting = false);
canvas.addEventListener("pointerup", stop);
canvas.addEventListener("pointercancel", stop);
canvas.addEventListener("pointerleave", () => {
  hover = null;
  preview = null;
  plat.touch();
});

// ---------------------------------------------------------------- rivals

function startRival(r: Rival) {
  const tick = async () => {
    r.timer = setTimeout(tick, r.t.cadence[0] + Math.random() * (r.t.cadence[1] - r.t.cadence[0]));
    if (!arena || r.inFlight || document.hidden) return;
    if (slot >= arena.roundEnd) return;
    if (budgetLeft() < 8) return; // leave room for the human
    const seat = seatOf(r.kp.publicKey);
    if (seat < 0) {
      const free = arena.players.some((p) => !p.active || isIdle(p));
      if (!free) return;
      r.inFlight = true;
      noteSend();
      chain
        .sendAndWait("rejoins", [cu.join(), joinIx(arenaAddr, r.kp.publicKey, r.t.name)], [r.kp])
        .catch(() => undefined)
        .finally(() => (r.inFlight = false));
      return;
    }
    const p = arena.players[seat];
    const board = optimistic();
    const picks = chooseClaims(board, seat, p.tiles, liveEnergy(p, slot), r.t, leaderSeat());
    if (!picks.length) return;
    r.inFlight = true;
    try {
      noteSend();
      const rec = await chain.send(`claims ${picks.length} ${picks.length === 1 ? "hex" : "hexes"}`, [cu.claim(), claimIx(arenaAddr, r.kp.publicKey, picks)], [r.kp]);
      const now = performance.now();
      for (const i of picks) pending.set(i, { seat, at: now, cost: 0, sig: rec.sig });
      plat.touch();
      const off = chain.onReceipt((u) => {
        if (u.sig !== rec.sig || u.confirmedMs === undefined) return;
        off();
        r.inFlight = false;
      });
      setTimeout(() => (r.inFlight = false), 8000);
    } catch {
      r.inFlight = false;
    }
  };
  r.timer = setTimeout(tick, 600 + Math.random() * 1200);
}

async function seatRivals() {
  if (!arena) return;
  const others = arena.players.filter((p) => p.active && !isIdle(p) && !p.authority.equals(keys.me.publicKey));
  const mine = new Set(rivals.map((r) => r.kp.publicKey.toBase58()));
  const strangers = others.filter((p) => !mine.has(p.authority.toBase58())).length;
  const want = Math.max(0, Math.min(3, PARTY - 1 - strangers));
  const offset = keys.me.publicKey.toBytes()[0] % SURVEYORS.length;
  for (let k = rivals.length; k < want; k++) {
    const kp = keys.rivals[k];
    const t = SURVEYORS[(offset + k) % SURVEYORS.length];
    const r: Rival = { kp, t, inFlight: false, timer: null };
    rivals.push(r);
    names.set(kp.publicKey.toBase58(), { name: t.name, seat: 0 });
    if (seatOf(kp.publicKey) < 0) {
      try {
        noteSend();
        await chain.sendAndWait(`takes a seat`, [cu.join(), joinIx(arenaAddr, kp.publicKey, t.name)], [kp]);
      } catch {
        /* the rival will retry from its loop */
      }
    }
    startRival(r);
  }
}

// ---------------------------------------------------------------- staking a claim

async function fund(): Promise<void> {
  const want = [keys.me, ...keys.rivals].map((k) => k.publicKey);
  const balances = await chain.conn.getMultipleAccountsInfo(want).catch(() => []);
  const low = want.filter((_, k) => (balances[k]?.lamports ?? 0) < 0.004 * LAMPORTS_PER_SOL);
  if (!low.length) return;
  if (LOCAL) {
    await Promise.all(low.map(async (k) => {
      const sig = await chain.conn.requestAirdrop(k, LAMPORTS_PER_SOL);
      await chain.conn.confirmTransaction(sig, "confirmed");
    }));
    return;
  }
  const res = await fetch("/api/fund", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ keys: [keys.me.publicKey.toBase58(), ...keys.rivals.map((k) => k.publicKey.toBase58())] }),
  });
  const body = (await res.json().catch(() => ({}))) as { ok?: boolean; error?: string };
  if (!res.ok || !body.ok) throw new Error(body.error || `land office returned ${res.status}`);
}

async function stake(e: Event) {
  e.preventDefault();
  const btn = $<HTMLButtonElement>("stake-btn");
  const status = $("status");
  status.classList.remove("err");
  btn.disabled = true;
  rename(keys, $<HTMLInputElement>("name").value);
  names.set(keys.me.publicKey.toBase58(), { name: keys.name, seat: mySeat() ?? 0 });
  try {
    status.textContent = "Asking the land office for survey fees…";
    try {
      await fund();
    } catch (err) {
      const bal = await chain.conn.getBalance(keys.me.publicKey).catch(() => 0);
      if (bal < 0.002 * LAMPORTS_PER_SOL) {
        status.classList.add("err");
        status.innerHTML = `The land office could not fund your key (${escapeHtml((err as Error).message)}). Send a little devnet SOL to <code>${keys.me.publicKey.toBase58()}</code> from <a href="https://faucet.solana.com" target="_blank" rel="noopener">faucet.solana.com</a> and press the button again.`;
        btn.disabled = false;
        return;
      }
    }
    if (!arena) {
      status.textContent = `Drawing Plat No. ${arenaId}…`;
      noteSend();
      await chain.sendAndWait("draws a new plat", [cu.create(), createArenaIx(keys.me.publicKey, arenaId, ROUND_SLOTS)], [keys.me]).catch(async (err) => {
        // Someone else may have drawn it a moment earlier; that is fine.
        if (!(await chain.fetchArena(arenaAddr))) throw err;
      });
      const a = await chain.fetchArena(arenaAddr, "processed");
      if (a) onArena(a);
    }
    if (arena && arena.roundEnd <= slot) {
      status.textContent = "Closing the last round first…";
      noteSend();
      await chain.sendAndWait("closes the round", [cu.next(), nextRoundIx(arenaAddr)], [keys.me]).catch(() => undefined);
    }
    status.textContent = "Recording your claim…";
    noteSend();
    await chain.sendAndWait("stakes a claim", [cu.join(), joinIx(arenaAddr, keys.me.publicKey, keys.name)], [keys.me]);
    const a = await chain.fetchArena(arenaAddr, "processed");
    if (a) onArena(a);
    joined = true;
    const card = document.querySelector(".deed-card")!;
    const seal = document.createElement("span");
    seal.className = "seal";
    seal.textContent = "Recorded";
    card.appendChild(seal);
    setTimeout(() => $("deed").classList.add("leaving"), 650);
    setTimeout(() => ($("deed").hidden = true), 1350);
    hint("Your land carries the red pennant. Click any hex to run a chain to it; each run is one transaction.");
    void seatRivals();
  } catch (err) {
    status.classList.add("err");
    status.textContent = `That did not go through: ${(err as Error).message}. Press the button to try again.`;
  } finally {
    btn.disabled = false;
  }
}

async function rejoin() {
  try {
    noteSend();
    await chain.sendAndWait("rejoins", [cu.join(), joinIx(arenaAddr, keys.me.publicKey, keys.name)], [keys.me]);
  } catch {
    hint("Could not rejoin just now. Click the plat again in a moment.");
  }
}

// ---------------------------------------------------------------- notes, invite

function updateProof() {
  const set = (id: string, text: string, href: string) => {
    const a = $<HTMLAnchorElement>(id);
    a.textContent = text;
    a.href = href;
  };
  set("p-program", PROGRAM_ID.toBase58(), explorer("address", PROGRAM_ID.toBase58()));
  set("p-arena", arenaAddr.toBase58(), explorer("address", arenaAddr.toBase58()));
  set("p-key", keys.me.publicKey.toBase58(), explorer("address", keys.me.publicKey.toBase58()));
  $("p-net").textContent = LOCAL ? `local validator (${RPC})` : `Solana devnet via ${new URL(RPC).host}`;
}

if (LOCAL) $("net").lastChild!.textContent = "Local validator";

$("notes-btn").addEventListener("click", () => $<HTMLDialogElement>("notes").showModal());
$("invite").addEventListener("click", async () => {
  const url = `${location.origin}${location.pathname}?plat=${arenaId}`;
  try {
    await navigator.clipboard.writeText(url);
    hint(`Link copied. Anyone who opens it lands on Plat No. ${arenaId} with you.`);
  } catch {
    hint(`Share this link: ${url}`);
  }
});
$("stake").addEventListener("submit", (e) => void stake(e));

// ---------------------------------------------------------------- boot

function fit() {
  const sheet = $("sheet");
  const r = sheet.getBoundingClientRect();
  plat.resize(Math.max(300, r.width), Math.max(220, r.height));
}

function frame() {
  plat.draw({
    tiles: arena ? arena.tiles : new Uint8Array(N),
    pending: new Map([...pending].map(([i, p]) => [i, p.seat])),
    mySeat: mySeat(),
    hover,
    hoverOk,
    labels: labelsCache,
    route: preview?.path ?? [],
    routeOk: preview?.ok ?? 0,
  });
  requestAnimationFrame(frame);
}

async function boot() {
  $<HTMLInputElement>("name").value = keys.name;
  new ResizeObserver(() => fit()).observe($("sheet"));
  await document.fonts.ready.catch(() => undefined);
  fit();
  requestAnimationFrame(frame);
  chain.watchSlot(onSlot);
  setInterval(renderPanels, 1000);
  const id = await choosePlat();
  await openPlat(id);
  if (arena && seatOf(keys.me.publicKey) >= 0) {
    $<HTMLButtonElement>("stake-btn").textContent = "Return to your land";
  }
}

void boot();

/**
 * A good next run for your surveyor, in page pixels: the longest affordable chain, with a bonus for
 * enemy hexes and for land that stays solid. Used by the film's capture script and the console.
 */
function suggest(prefer: "far" | "solid" | "enemy" = "solid") {
  const seat = mySeat();
  if (seat === null || !arena || !joined) return null;
  const board = optimistic();
  const have = liveEnergy(arena.players[seat], slot) - pendingCost(seat);
  if (have < 2) return null;
  const lead = leaderSeat();
  const leader = lead !== null && lead !== seat ? lead + 1 : -1;
  let best: { i: number; score: number; n: number; enemy: number; cost: number } | null = null;
  for (let i = 0; i < N; i++) {
    if (board[i] === seat + 1 || pending.has(i)) continue;
    const r = route(board, seat, i);
    if (!r || !r.path.length) continue;
    if (affordable(r, have, MAX_TARGETS) < r.path.length) continue;
    let enemy = 0;
    let fromLeader = 0;
    let solid = 0;
    for (const k of r.path) {
      if (board[k] !== 0) enemy++;
      if (board[k] === leader) fromLeader++;
      solid += countOwned(board, k, seat + 1);
    }
    const n = r.path.length;
    const cost = r.costs.reduce((s, c) => s + c, 0);
    // far: the longest line. solid: land that holds, bought cheaply. enemy: take it from the leader.
    const score =
      prefer === "far" ? n + enemy * 1.4 + solid * 0.12
      : prefer === "enemy" ? enemy * 2 + fromLeader * 2.5 + n * 0.4 + solid * 0.3 - cost * 0.15
      : n + solid * 0.45 + enemy * 1.2 + fromLeader * 1.2 - (cost - n) * 0.35;
    if (!best || score > best.score) best = { i, score, n, enemy, cost };
  }
  if (!best) return null;
  const box = canvas.getBoundingClientRect();
  const p = plat.center(best.i);
  return { x: box.left + p.x, y: box.top + p.y, hexes: best.n, enemy: best.enemy, cost: best.cost, energy: have };
}

/** Where a seat's land sits on the page (its middle hex), for pointing at it. */
function landOf(seat: number) {
  if (!arena) return null;
  const mine = [...arena.tiles.keys()].filter((i) => arena!.tiles[i] === seat + 1);
  if (!mine.length) return null;
  const cs = mine.map((i) => plat.center(i));
  const cx = cs.reduce((s, p) => s + p.x, 0) / cs.length;
  const cy = cs.reduce((s, p) => s + p.y, 0) / cs.length;
  const near = cs.reduce((b, p) => ((p.x - cx) ** 2 + (p.y - cy) ** 2 < (b.x - cx) ** 2 + (b.y - cy) ** 2 ? p : b));
  const box = canvas.getBoundingClientRect();
  return { x: box.left + near.x, y: box.top + near.y };
}

// Expose a little for debugging from the console.
(window as unknown as { turf: unknown }).turf = {
  chain,
  keys,
  suggest,
  landOf,
  get arena() { return arena; },
  get shownRound() { return shownRound; },
  get slot() { return slot; },
  get mySeat() { return mySeat(); },
  get stats() { return { sent: chain.sentCount, confirmed: confirmedCount, avgMs: confirmedCount ? Math.round(confirmMsTotal / confirmedCount) : 0, fees: confirmedCount * FEE_LAMPORTS }; },
};
