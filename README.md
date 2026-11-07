# Turf

**A real-time land war where every claim is a Solana transaction.**

Land has been measured in chains since 1620, when Edmund Gunter made a surveyor's chain 66 feet long. Turf measures it in Solana slots. You click a hex, a chain of claims runs to it from your land, and the program records it in about a second for 0.000005 SOL. Your energy refills one point every slot (about every 240 ms on devnet as of November 2026; the page measures it live), so the pace of the game is the pace of the chain.

- **Play:** [turf-vert-two.vercel.app](https://turf-vert-two.vercel.app/)
- **Video (1:51):** [youtu.be/oeBJimwTZtE](https://youtu.be/oeBJimwTZtE)
- **Program (devnet):** [`Bep1f2hsBMdST6xbkfQqMAUkuQiSGrNFE4Sg9VZ4pvMi`](https://explorer.solana.com/address/Bep1f2hsBMdST6xbkfQqMAUkuQiSGrNFE4Sg9VZ4pvMi?cluster=devnet)

No wallet is needed to play. The page makes a throwaway devnet key in your browser, a small gas station tops it up with a few cents of devnet SOL, and every move is signed locally. No popups, no faucet, no install.

## How a round plays

1. **Stake your claim.** You land on seven hexes in a free corner of a 30 by 18 hex plat. Three rival surveyors (named for Mason, Dixon, Everest, Banneker and Lambton) take the other corners.
2. **Run chains.** Click any hex. The page finds the cheapest line from your land, as the program prices it, and sends up to 12 claims in one transaction. Hover first to see the line and its cost.
3. **Energy is the slot clock.** It refills one point per slot, up to 30. Open land costs 1.
4. **Solid land holds; thin lines break.** Enemy land costs 2, plus 1 for every neighbouring hex its owner holds. A long tendril is cheap to cut; a compact block is expensive to crack.
5. **The register is permanent.** A round lasts 600 slots (about two and a half minutes at devnet's pace). When it closes, anyone can turn the crank: the program writes the surveyor with the most land into the plat's Champions register and deals a fresh map.

## Why this needs Solana

A Turf round is hundreds of transactions in a couple of minutes, all writing to one shared account. That only works as a game when:

| What the game needs | What Solana gives it | Measured |
| --- | --- | --- |
| A move must land before the board moves on | Slots every 240 to 400 ms (devnet measured 240 ms in November 2026) | About 0.9 s on average from send to confirmed, across the 94-claim round in the demo film (shown live in the Register) |
| Every click can be a transaction | Fees of 5,000 lamports | 0.000005 SOL per run; a whole round costs a player well under a cent |
| Rules nobody can bend | The program checks adjacency, energy and costs | a claim uses about 3,600 compute units |
| A champions list nobody can edit | The register lives in the plat account | written by `next_round`, readable by anyone |
| Anyone can build on it | One open program, one account per plat | the rival bots use the same public instructions you do |

There is no game server. The page reads the plat account over a websocket and sends signed claims; the gas station only hands out devnet SOL.

## What runs on-chain

`programs/turf/src/lib.rs`, an Anchor 1.2 program. One zero-copy account per plat (1,600 bytes) holds everything:

- the 540-hex board (one byte per hex: owner seat or open),
- eight seats with authority, energy, last slot, hex count and name,
- the round clock (start and end slot) and move counters,
- an eight-entry Champions register.

Instructions:

| Instruction | Who | What it does |
| --- | --- | --- |
| `create_arena(id, round_slots)` | anyone | opens Plat No. `id` (a PDA), 150 to 9,000 slots per round |
| `join(name)` | a player key | takes a free seat (or one idle for 300+ slots) and spawns at a spread-out landing site |
| `claim(targets)` | a seated key | up to 12 hexes in order; each must touch your land when it is processed; refills energy from the slot clock first |
| `next_round()` | anyone, after the round's last slot | crowns the leader into the register, drops idle seats, deals a fresh map |

Energy is never ticked by a server: each claim computes `min(30, energy + (now_slot - last_slot))`, so the slot clock is the only clock.

## Repository

```
programs/turf/         Anchor program (Rust) and its unit tests
web/src/chain/         byte-exact account decoder, instruction builders, send/confirm tracking
web/src/game/          plat renderer (canvas watercolour), rival brain, chain-line routing
web/api/fund.ts        gas station (Vercel function): tops up throwaway keys with devnet SOL
web/scripts/smoke.ts   end-to-end test against a validator: create, join, play a round, crown, reset
scripts/               program build helper
```

## Run it yourself

Program (needs the Solana CLI 4.x and platform tools):

```bash
cargo test -p turf
zsh scripts/build-program.sh
solana-test-validator --reset --bpf-program Bep1f2hsBMdST6xbkfQqMAUkuQiSGrNFE4Sg9VZ4pvMi target/deploy/turf.so
```

Web, against that local validator:

```bash
cd web && npm install
npm run smoke                       # plays a full round on-chain and checks every rule
npm run dev -- --mode localnet      # http://localhost:5273, airdrops locally instead of the gas station
```

Against devnet: `npm run dev:devnet`, with `keys/treasury.json` holding a funded devnet key for the gas station (or `TREASURY_SECRET` in the environment).

## Write your own surveyor

The program is open, so a bot is a few lines. This one takes the cheapest hexes it can afford:

```ts
const me = arena.players[seat];
const options = [...arena.tiles.keys()]
  .map((i) => [i, claimCost(arena.tiles, i, seat, me.tiles)])
  .filter(([, cost]) => cost !== null && cost <= liveEnergy(me, slot))
  .sort((a, b) => a[1] - b[1]);
await chain.send("claim", [claimIx(arenaAddress, key.publicKey, options.slice(0, 12).map(([i]) => i))], [key]);
```

## Credits

Gunter's chain facts: [Wikipedia, Gunter's chain](https://en.wikipedia.org/wiki/Gunter%27s_chain). Type: IM Fell English (the Fell Types, digitised by Igino Marini), Spectral (Production Type), IBM Plex Mono. Rival surveyors are named for Charles Mason, Jeremiah Dixon, George Everest, Benjamin Banneker and William Lambton.

Built for the MLH Solana Hackathon, November 2026.
