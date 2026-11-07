// Pure move selection for rival surveyors. Same rules as the program, simulated locally.
import { MAX_TARGETS, N, W, H, claimCost, countOwned, nb } from "../chain/layout.ts";

export interface Temperament {
  name: string;
  /** Weight for taking enemy land (0 = never attacks). */
  aggression: number;
  /** Weight for keeping territory compact. */
  compact: number;
  /** Energy to bank before moving; patient surveyors move in bigger bursts. */
  bank: number;
  /** Delay between moves, in ms. */
  cadence: [number, number];
  /** Most hexes per move. Rivals stay below a busy human's pace on purpose. */
  reach: number;
}

export const SURVEYORS: Temperament[] = [
  { name: "Mason", aggression: 0.8, compact: 1.0, bank: 4, cadence: [1900, 2800], reach: 4 },
  { name: "Dixon", aggression: 1.6, compact: 0.6, bank: 6, cadence: [2000, 2900], reach: 5 },
  { name: "Everest", aggression: 0.5, compact: 1.6, bank: 10, cadence: [2600, 3400], reach: 6 },
  { name: "Banneker", aggression: 1.1, compact: 1.2, bank: 5, cadence: [2000, 2900], reach: 4 },
  { name: "Lambton", aggression: 0.9, compact: 1.4, bank: 7, cadence: [2300, 3100], reach: 5 },
];

const CX = (W - 1) / 2;
const CY = (H - 1) / 2;

function centrality(i: number): number {
  const r = Math.floor(i / W);
  const c = i % W;
  const dx = (c - CX) / CX;
  const dy = (r - CY) / CY;
  return 1 - Math.min(1, Math.sqrt(dx * dx + dy * dy));
}

/**
 * Choose up to 12 hexes for `seat` to claim this turn, in an order that keeps
 * every pick adjacent to land it holds by the time the program processes it.
 */
export function chooseClaims(
  board: Uint8Array,
  seat: number,
  myTiles: number,
  energy: number,
  t: Temperament,
  leaderSeat: number | null,
  rnd: () => number = Math.random,
): number[] {
  if (energy < Math.min(t.bank, 30)) return [];
  const tiles = board.slice();
  const mine = seat + 1;
  let e = energy;
  let held = myTiles;
  const picks: number[] = [];

  if (held === 0) {
    // Parachute: the open hex with the most open land around it.
    let best = -1;
    let bestScore = -1;
    for (let i = 0; i < N; i++) {
      if (tiles[i] !== 0) continue;
      const s = countOwned(tiles, i, 0) + rnd() * 0.5;
      if (s > bestScore) {
        bestScore = s;
        best = i;
      }
    }
    if (best < 0) return [];
    tiles[best] = mine;
    held = 1;
    e -= 1;
    picks.push(best);
  }

  while (picks.length < Math.min(MAX_TARGETS, t.reach) && e > 0) {
    let best = -1;
    let bestScore = -Infinity;
    let bestCost = 0;
    for (let i = 0; i < N; i++) {
      const cost = claimCost(tiles, i, seat, held);
      if (cost === null || cost > e) continue;
      const owner = tiles[i];
      const friends = countOwned(tiles, i, mine);
      let s: number;
      if (owner === 0) {
        s = 4 + t.compact * friends * 0.9 + centrality(i) * 1.5;
      } else {
        if (t.aggression <= 0) continue;
        const leaderBonus = leaderSeat !== null && owner === leaderSeat + 1 ? 2.5 : 0;
        s = t.aggression * (9 - cost + leaderBonus) + t.compact * friends * 0.7 - 2;
      }
      // Prefer moves that touch open land (keeps expanding), with a little noise.
      for (const j of nb(i)) if (j >= 0 && tiles[j] === 0) s += 0.15;
      s += rnd() * 1.2;
      if (s > bestScore) {
        bestScore = s;
        best = i;
        bestCost = cost;
      }
    }
    if (best < 0) break;
    tiles[best] = mine;
    held++;
    e -= bestCost;
    picks.push(best);
  }
  return picks;
}
