// End-to-end check of the Turf program: create an arena, seat three surveyors,
// play a short round with the bot brain, then crank next_round and read the hall.
// Usage: RPC=http://127.0.0.1:8899 npm run smoke   (defaults to a local validator)
import { Keypair, LAMPORTS_PER_SOL } from "@solana/web3.js";
import { Chain } from "../src/chain/client.ts";
import { arenaAddress, claimIx, createArenaIx, cu, joinIx, nextRoundIx } from "../src/chain/ix.ts";
import { liveEnergy, type Arena } from "../src/chain/layout.ts";
import { SURVEYORS, chooseClaims } from "../src/game/brain.ts";

const RPC = process.env.RPC ?? "http://127.0.0.1:8899";
const WS = RPC.includes("8899") ? RPC.replace("http", "ws").replace("8899", "8900") : undefined;
const chain = new Chain(RPC, WS);
const conn = chain.conn;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function check(cond: unknown, msg: string) {
  if (!cond) {
    console.error("FAIL:", msg);
    process.exit(1);
  }
  console.log("ok:", msg);
}

async function cuOf(sig: string): Promise<number | undefined> {
  for (let k = 0; k < 10; k++) {
    const tx = await conn.getTransaction(sig, { commitment: "confirmed", maxSupportedTransactionVersion: 0 });
    if (tx) return tx.meta?.computeUnitsConsumed ?? undefined;
    await sleep(400);
  }
}

const keys = [Keypair.generate(), Keypair.generate(), Keypair.generate()];
if (process.env.FUNDER) {
  // On devnet, fund from a local keypair file instead of the (rate-limited) faucet.
  const { readFileSync } = await import("node:fs");
  const { SystemProgram, Transaction } = await import("@solana/web3.js");
  const funder = Keypair.fromSecretKey(Uint8Array.from(JSON.parse(readFileSync(process.env.FUNDER, "utf8"))));
  const tx = new Transaction().add(
    ...keys.map((k) => SystemProgram.transfer({ fromPubkey: funder.publicKey, toPubkey: k.publicKey, lamports: 0.03 * LAMPORTS_PER_SOL })),
  );
  const sig = await conn.sendTransaction(tx, [funder]);
  await conn.confirmTransaction(sig, "confirmed");
} else {
  for (const k of keys) {
    const sig = await conn.requestAirdrop(k.publicKey, 2 * LAMPORTS_PER_SOL);
    await conn.confirmTransaction(sig, "confirmed");
  }
}
console.log("funded", keys.length, "surveyors");

const id = Number(process.env.ARENA ?? Math.floor(Math.random() * 1e9));
const arena = arenaAddress(id);
const created = await chain.sendAndWait("create", [cu.create(), createArenaIx(keys[0].publicKey, id, 150)], [keys[0]]);
console.log("create_arena CU:", await cuOf(created.sig));

let a = (await chain.fetchArena(arena))!;
check(a && a.round === 1 && a.roundSlots === 150, "arena created with round 1 of 150 slots");

for (let s = 0; s < keys.length; s++) {
  const r = await chain.sendAndWait("join", [cu.join(), joinIx(arena, keys[s].publicKey, SURVEYORS[s].name)], [keys[s]]);
  if (s === 0) console.log("join CU:", await cuOf(r.sig));
}
a = (await chain.fetchArena(arena))!;
const seated = a.players.filter((p) => p.active);
check(seated.length === 3, "three seats taken");
check(seated.every((p) => p.tiles >= 4), `everyone spawned with land: ${seated.map((p) => p.tiles).join(", ")}`);
check(seated.map((p) => p.name).join() === "Mason,Dixon,Everest", "names stored");
const owned = [...a.tiles].filter((t) => t !== 0).length;
check(owned === seated.reduce((n, p) => n + p.tiles, 0), "tile counts match the board");

// Rejoining with land is a no-op apart from the name.
await chain.sendAndWait("rejoin", [cu.join(), joinIx(arena, keys[0].publicKey, "Mason II")], [keys[0]]);
a = (await chain.fetchArena(arena))!;
check(a.players.filter((p) => p.active).length === 3 && a.players[0].name === "Mason II", "rejoin keeps the seat");

// Play: every surveyor moves when it has energy, until the round ends.
let claims = 0;
let failed = 0;
let firstClaimCu: number | undefined;
const seatOf = (k: Keypair, ar: Arena) => ar.players.findIndex((p) => p.active && p.authority.equals(k.publicKey));
while (true) {
  const slot = await conn.getSlot("confirmed");
  a = (await chain.fetchArena(arena))!;
  if (slot >= a.roundEnd - 4) break;
  const leader = a.players.reduce((b, p) => (p.active && p.tiles > (b?.tiles ?? -1) ? p : b), null as null | Arena["players"][number]);
  const sends = keys.map(async (k, kk) => {
    const s = seatOf(k, a);
    const p = a.players[s];
    const picks = chooseClaims(a.tiles, s, p.tiles, liveEnergy(p, slot), SURVEYORS[kk], leader?.seat ?? null);
    if (!picks.length) return;
    try {
      const r = await chain.sendAndWait("claim", [cu.claim(), claimIx(arena, k.publicKey, picks)], [k]);
      claims++;
      if (firstClaimCu === undefined) firstClaimCu = await cuOf(r.sig);
    } catch (e) {
      failed++;
      console.log("claim error", (e as Error).message);
    }
  });
  await Promise.all(sends);
  await sleep(300);
}
a = (await chain.fetchArena(arena))!;
console.log("claim CU (first):", firstClaimCu);
console.log(`claims sent ${claims}, failed ${failed}, round moves ${a.roundMoves}, hexes taken ${a.roundHexes}`);
console.log("holdings:", a.players.filter((p) => p.active).map((p) => `${p.name} ${p.tiles}`).join(" | "));
check(failed === 0, "no claim failed");
check(a.roundMoves >= claims, "round_moves counted every claim");
const total = a.players.reduce((n, p) => n + (p.active ? p.tiles : 0), 0);
check(total === [...a.tiles].filter((t) => t !== 0).length, "holdings match the board after play");

// Claiming after the round ends must fail; next_round crowns the leader.
while ((await conn.getSlot("confirmed")) < a.roundEnd) await sleep(400);
const winner = a.players.filter((p) => p.active).sort((x, y) => y.tiles - x.tiles)[0];
const nr = await chain.sendAndWait("next", [cu.next(), nextRoundIx(arena)], [keys[1]]);
console.log("next_round CU:", await cuOf(nr.sig));
a = (await chain.fetchArena(arena))!;
check(a.round === 2, "round advanced to 2");
check(a.hallCount === 1 && a.hall[0].tiles === winner.tiles && a.hall[0].name.startsWith(winner.name.slice(0, 8)), `hall records ${winner.name} with ${winner.tiles}`);
check(a.players.filter((p) => p.active).every((p) => p.tiles >= 4), "everyone respawned on the fresh map");
check(a.roundMoves === 0, "round counters reset");

let tooEarly = false;
try {
  await chain.sendAndWait("next-early", [cu.next(), nextRoundIx(arena)], [keys[2]]);
} catch {
  tooEarly = true;
}
check(tooEarly, "next_round refuses while a round is running");
console.log("\nSMOKE PASSED. arena", arena.toBase58());
process.exit(0);
