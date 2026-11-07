// The film's narration, in order. `text` is what the captions show; `say` (when set) is what the
// voice reads, spelled for the ear. scripts/voice.ts turns each entry into public/vo/<id>.wav and
// records its timing in public/vo/manifest.json.
//
// The round's numbers come from the real round scripts/capture.ts filmed (public/capture/run.json),
// passed in as `closing`, so the narration can only say what happened on devnet.

export interface Line {
  id: string;
  text: string;
  say?: string;
  /** Speeds the take up without changing its pitch. */
  tempo?: number;
}

export interface Closing {
  roundMoves: number;
  players: unknown[];
  stats: { confirmed: number; avgMs: number };
}

export interface Script {
  open: Line[];
  demo: Line[];
  build: Line[];
  end: Line[];
}

export function makeScript(closing?: Closing | null): Script {
  const claims = closing?.roundMoves ?? 0;
  const players = closing?.players.length ?? 4;
  const avg = ((closing?.stats.avgMs ?? 0) / 1000).toFixed(1);
  return {
    open: [
      { id: "m-chain", text: "In 1620, Edmund Gunter made a chain 66 feet long, with 100 links.", say: "In sixteen twenty, Edmund Gunter made a chain sixty six feet long, with a hundred links.", tempo: 1.04 },
      { id: "m-acre", text: "For three hundred years, land was measured with it.", tempo: 1.04 },
      { id: "m-title", text: "This is Turf. A real-time land war on Solana, where every claim is a transaction.", tempo: 1.04 },
    ],
    demo: [
      { id: "d-stake", text: "No wallet to install. Your browser makes a throwaway key, and the land office pays your fees on devnet.", tempo: 1.06 },
      { id: "d-rivals", text: "Three rival surveyors join you. They're bots, sending the same instructions to the same public program.", tempo: 1.06 },
      { id: "d-chain", text: "Point at any hex, and the cheapest chain runs to it from your land. One click claims up to twelve hexes, in one transaction.", tempo: 1.06 },
      { id: "d-register", text: "Every claim is stamped in the register, with its slot, its time to confirm, and a link to check it.", tempo: 1.06 },
      { id: "d-energy", text: "Energy is the slot clock: one point every slot, about four a second on devnet. The pace of the game is the pace of the chain.", tempo: 1.06 },
      { id: "d-rule", text: "Enemy land costs more where it's solid. Solid land holds. Thin lines break.", tempo: 1.02 },
      { id: "d-close", text: "When the round ends, anyone can turn the crank. The program writes the champion into the register, and deals a fresh map.", tempo: 1.06 },
    ],
    build: [
      { id: "b-account", text: "There's no game server. Each plat is one 1,600-byte account, and the program is the referee.", say: "There's no game server. Each plat is one sixteen hundred byte account, and the program is the referee.", tempo: 1.05 },
      { id: "b-numbers", text: `That round took ${claims} claims from ${players} players. On devnet, they confirmed in ${avg} seconds on average.`, tempo: 1.05 },
      { id: "b-open", text: "And because the rules live on chain, anyone can write a surveyor of their own.", tempo: 1.04 },
    ],
    end: [
      { id: "e-close", text: "Land has been measured in chains since 1620. Now it's measured in slots. Stake your claim.", say: "Land has been measured in chains since sixteen twenty. Now it's measured in slots. Stake your claim.", tempo: 1.0 },
    ],
  };
}

export const allLines = (s: Script): Line[] => [...s.open, ...s.demo, ...s.build, ...s.end];
