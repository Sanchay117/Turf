# Turf: MLH Solana Hackathon submission draft

**Name:** Turf

**Tagline:** A real-time land war where every claim is a Solana transaction.

**Links**
- Play: https://turf-vert-two.vercel.app/
- Demo video: https://youtu.be/oeBJimwTZtE
- Code: https://github.com/Sanchay117/Turf
- Program (devnet): `Bep1f2hsBMdST6xbkfQqMAUkuQiSGrNFE4Sg9VZ4pvMi`

## What it does

In 1620 Edmund Gunter made a surveyor's chain 66 feet long, with 100 links, and land was measured with it for three hundred years. Turf measures land in Solana slots instead.

You open the page, type a name and stake a claim on a 30 by 18 hex plat. Three rival surveyors join you. Click any hex and the cheapest chain of claims runs to it from your land. Up to 12 hexes go in one transaction, signed in your browser and recorded by the program in about a second. Your energy refills one point every slot, so the pace of the game is the pace of the chain. Enemy land costs 2 plus one for each neighbouring hex its owner holds: solid land holds and thin lines break. When the round ends, anyone can call `next_round`. The program writes the winner into the plat's Champions register and deals a fresh map.

No wallet, no popup and no faucet. The page makes a throwaway devnet key, and a small gas station tops it up with devnet SOL.

## How we built it

- **On-chain:** one Anchor 1.2 program. Each plat is one zero-copy account of 1,600 bytes holding the 540-hex board, eight seats, energy meters and the Champions register. The program checks every rule: adjacency, energy (refilled lazily from the slot clock), capture cost, round timing and idle seats. Instructions: `create_arena`, `join`, `claim`, `next_round`.
- **Client:** Vite and TypeScript with @solana/web3.js. Instruction builders and the account decoder are written by hand. The board is read over a websocket subscription, and confirmations arrive by websocket with a slow HTTP sweep as backup. The client's chain-line routing is a Dijkstra search priced exactly as the program prices a claim.
- **Rivals:** bots that run in the visitor's tab and send the same public instructions anyone can send.
- **The look:** a surveyor's plat. Vellum, iron-gall ink, watercolour washes per surveyor, a scale of chains, and vermilion "Recorded" seals on every confirmed transaction.

## Proof it runs on Solana

In the round filmed for the demo, four players made 94 claims on devnet, confirmed in 0.94 s on average, and paid 0.0005 SOL in fees between them. The Register shows every transaction with its slot, its time to confirm and an explorer link.

## Challenges

- Public devnet RPC rate limits. Every claim confirms over a websocket rather than by polling, retries on HTTP 429 are off, and each tab keeps to a send budget so the rivals never crowd out the human.
- A gas station on a cloud server can't count on public devnet RPC, which rate-limits and sometimes refuses cloud addresses. So the station signs the top-up against a blockhash the visitor's browser supplies and lets the browser submit it, so it never depends on its own connection to devnet.
- Devnet slots run near 240 ms right now, not the 400 ms often quoted, so the game measures slot time live for its countdown.
- Fitting a whole game into one account: a fixed zero-copy layout, one byte per hex.

## What's next

Public plats that stay open between sessions, wallet sign-in for players who want their champion records under their own key, and a mainnet plat once the rules have settled.

## Tracks

Gaming, plus Overall.
