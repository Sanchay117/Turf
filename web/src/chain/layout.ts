// Mirrors programs/turf/src/lib.rs byte for byte. If the Rust layout changes, change this.
import { PublicKey } from "@solana/web3.js";

export const W = 30;
export const H = 18;
export const N = W * H;
export const MAX_PLAYERS = 8;
export const HALL = 8;
export const ENERGY_CAP = 30;
export const MAX_TARGETS = 12;
export const IDLE_SLOTS = 300;
export const ARENA_SIZE = 8 + 1592;

export const PROGRAM_ID = new PublicKey("Bep1f2hsBMdST6xbkfQqMAUkuQiSGrNFE4Sg9VZ4pvMi");

export const DISC = {
  createArena: [174, 236, 45, 61, 197, 215, 149, 169],
  join: [206, 55, 2, 106, 113, 220, 17, 163],
  claim: [62, 198, 214, 193, 213, 159, 108, 210],
  nextRound: [71, 165, 58, 85, 228, 54, 16, 73],
  arena: [243, 215, 44, 44, 231, 211, 232, 168],
} as const;

const OFF = {
  creator: 8,
  roundStart: 40,
  roundEnd: 48,
  totalMoves: 56,
  round: 64,
  roundSlots: 68,
  roundMoves: 72,
  id: 76,
  hallCount: 80,
  roundHexes: 84,
  players: 96,
  hall: 96 + 64 * MAX_PLAYERS,
  tiles: 96 + 64 * MAX_PLAYERS + 56 * HALL,
};

export interface Player {
  seat: number;
  authority: PublicKey;
  lastSlot: number;
  moves: number;
  energy: number;
  tiles: number;
  name: string;
  active: boolean;
}

export interface Champion {
  authority: PublicKey;
  name: string;
  round: number;
  tiles: number;
}

export interface Arena {
  address: PublicKey;
  creator: PublicKey;
  roundStart: number;
  roundEnd: number;
  totalMoves: number;
  round: number;
  roundSlots: number;
  roundMoves: number;
  roundHexes: number;
  id: number;
  hallCount: number;
  players: Player[];
  hall: Champion[]; // newest first
  tiles: Uint8Array; // owner seat + 1, 0 = open land
}

const dec = new TextDecoder();

function readName(bytes: Uint8Array): string {
  let end = bytes.indexOf(0);
  if (end < 0) end = bytes.length;
  return dec.decode(bytes.subarray(0, end));
}

export function decodeArena(address: PublicKey, data: Uint8Array): Arena {
  if (data.length < ARENA_SIZE) throw new Error(`arena account too small: ${data.length}`);
  for (let i = 0; i < 8; i++) {
    if (data[i] !== DISC.arena[i]) throw new Error("not a Turf arena account");
  }
  const v = new DataView(data.buffer, data.byteOffset, data.byteLength);
  const u64 = (o: number) => Number(v.getBigUint64(o, true));
  const u32 = (o: number) => v.getUint32(o, true);
  const u16 = (o: number) => v.getUint16(o, true);

  const players: Player[] = [];
  for (let s = 0; s < MAX_PLAYERS; s++) {
    const o = OFF.players + s * 64;
    players.push({
      seat: s,
      authority: new PublicKey(data.subarray(o, o + 32)),
      lastSlot: u64(o + 32),
      moves: u32(o + 40),
      energy: u16(o + 44),
      tiles: u16(o + 46),
      name: readName(data.subarray(o + 48, o + 63)),
      active: data[o + 63] === 1,
    });
  }

  const hallCount = u32(OFF.hallCount);
  const hall: Champion[] = [];
  for (let k = 0; k < Math.min(hallCount, HALL); k++) {
    const idx = (hallCount - 1 - k) % HALL;
    const o = OFF.hall + idx * 56;
    hall.push({
      authority: new PublicKey(data.subarray(o, o + 32)),
      name: readName(data.subarray(o + 32, o + 48)),
      round: u32(o + 48),
      tiles: u32(o + 52),
    });
  }

  return {
    address,
    creator: new PublicKey(data.subarray(OFF.creator, OFF.creator + 32)),
    roundStart: u64(OFF.roundStart),
    roundEnd: u64(OFF.roundEnd),
    totalMoves: u64(OFF.totalMoves),
    round: u32(OFF.round),
    roundSlots: u32(OFF.roundSlots),
    roundMoves: u32(OFF.roundMoves),
    roundHexes: u32(OFF.roundHexes),
    id: u32(OFF.id),
    hallCount,
    players,
    hall,
    tiles: data.slice(OFF.tiles, OFF.tiles + N),
  };
}

/** Energy a player has right now, given the latest slot (refills one per slot). */
export function liveEnergy(p: Player, slot: number): number {
  return Math.min(ENERGY_CAP, p.energy + Math.max(0, slot - p.lastSlot));
}

// ---------------------------------------------------------------- hex geometry

/** Neighbours on an odd-r offset grid (odd rows shifted right). -1 = off the board. */
export function neighbors(i: number): number[] {
  const r = Math.floor(i / W);
  const c = i % W;
  const d =
    r & 1
      ? [[-1, 0], [1, 0], [0, -1], [1, -1], [0, 1], [1, 1]]
      : [[-1, 0], [1, 0], [-1, -1], [0, -1], [-1, 1], [0, 1]];
  return d.map(([dc, dr]) => {
    const nc = c + dc;
    const nr = r + dr;
    return nc >= 0 && nc < W && nr >= 0 && nr < H ? nr * W + nc : -1;
  });
}

const NB: number[][] = Array.from({ length: N }, (_, i) => neighbors(i));
export const nb = (i: number) => NB[i];

export function countOwned(tiles: Uint8Array, i: number, owner: number): number {
  let n = 0;
  for (const j of NB[i]) if (j >= 0 && tiles[j] === owner) n++;
  return n;
}

/** What the program would charge `seat` for hex `i`, or null if it cannot be claimed now. */
export function claimCost(tiles: Uint8Array, i: number, seat: number, myTiles: number): number | null {
  const mine = seat + 1;
  const owner = tiles[i];
  if (owner === mine) return null;
  if (myTiles === 0) return owner === 0 ? 1 : null;
  if (countOwned(tiles, i, mine) === 0) return null;
  return owner === 0 ? 1 : 2 + countOwned(tiles, i, owner);
}

export function encodeName(name: string): Uint8Array {
  const out = new Uint8Array(15);
  const bytes = new TextEncoder().encode(name.replace(/[^\x20-\x7e]/g, "").slice(0, 15));
  out.set(bytes.subarray(0, 15));
  return out;
}
