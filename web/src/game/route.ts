// "Run a chain": the cheapest line of hexes from your land to any target, as the program prices it.
import { N, countOwned, nb } from "../chain/layout.ts";

export interface Route {
  path: number[]; // hexes to claim, ordered outward from your land
  costs: number[]; // price of each hex on the path
}

function price(tiles: Uint8Array, j: number, mine: number): number {
  const owner = tiles[j];
  if (owner === mine) return 0;
  if (owner === 0) return 1;
  return 2 + countOwned(tiles, j, owner);
}

export function route(tiles: Uint8Array, seat: number, target: number): Route | null {
  if (target < 0 || target >= N) return null;
  const mine = seat + 1;
  if (tiles[target] === mine) return null;

  let any = false;
  for (let i = 0; i < N; i++) if (tiles[i] === mine) { any = true; break; }
  if (!any) return tiles[target] === 0 ? { path: [target], costs: [1] } : null;

  const dist = new Float64Array(N).fill(Infinity);
  const prev = new Int32Array(N).fill(-1);
  const done = new Uint8Array(N);
  const heap: [number, number][] = [];
  const push = (d: number, i: number) => {
    heap.push([d, i]);
    let k = heap.length - 1;
    while (k > 0) {
      const p = (k - 1) >> 1;
      if (heap[p][0] <= heap[k][0]) break;
      [heap[p], heap[k]] = [heap[k], heap[p]];
      k = p;
    }
  };
  const pop = (): [number, number] => {
    const top = heap[0];
    const last = heap.pop()!;
    if (heap.length) {
      heap[0] = last;
      let k = 0;
      for (;;) {
        const l = 2 * k + 1;
        const r = l + 1;
        let m = k;
        if (l < heap.length && heap[l][0] < heap[m][0]) m = l;
        if (r < heap.length && heap[r][0] < heap[m][0]) m = r;
        if (m === k) break;
        [heap[m], heap[k]] = [heap[k], heap[m]];
        k = m;
      }
    }
    return top;
  };

  for (let i = 0; i < N; i++) if (tiles[i] === mine) { dist[i] = 0; push(0, i); }
  while (heap.length) {
    const [d, i] = pop();
    if (done[i]) continue;
    done[i] = 1;
    if (i === target) break;
    for (const j of nb(i)) {
      if (j < 0 || done[j]) continue;
      // Tiny tie-break toward fewer hexes so lines run straight.
      const nd = d + price(tiles, j, mine) + 0.001;
      if (nd < dist[j]) {
        dist[j] = nd;
        prev[j] = i;
        push(nd, j);
      }
    }
  }
  if (!Number.isFinite(dist[target])) return null;

  const path: number[] = [];
  for (let k = target; k >= 0 && tiles[k] !== mine; k = prev[k]) path.push(k);
  path.reverse();
  return { path, costs: path.map((j) => price(tiles, j, mine)) };
}

/** How many hexes of a route fit in `energy` and one transaction. */
export function affordable(r: Route, energy: number, cap: number): number {
  let spent = 0;
  let n = 0;
  for (const c of r.costs) {
    if (n >= cap || spent + c > energy) break;
    spent += c;
    n++;
  }
  return n;
}
