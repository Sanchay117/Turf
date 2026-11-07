// Gas station: tops up a visitor's throwaway keys with a little devnet SOL so the
// game can sign every move locally, with no wallet popups and no faucet trip.
// Runs as a Vercel function (Web-standard handlers) and inside the Vite dev server.
import { Connection, Keypair, LAMPORTS_PER_SOL, PublicKey, SystemProgram, Transaction } from "@solana/web3.js";

const RPC = process.env.RPC_URL || "https://api.devnet.solana.com";
const FIRST = Math.round(0.03 * LAMPORTS_PER_SOL); // the visitor (also pays arena rent if needed)
const REST = Math.round(0.012 * LAMPORTS_PER_SOL); // each rival bot
const LOW = Math.round(0.004 * LAMPORTS_PER_SOL);
const WINDOW_MS = 10 * 60 * 1000;
const MAX_HITS = 6;

const hits = new Map<string, number[]>();

function treasury(): Keypair | null {
  const raw = process.env.TREASURY_SECRET;
  if (!raw) return null;
  try {
    return Keypair.fromSecretKey(Uint8Array.from(JSON.parse(raw)));
  } catch {
    return null;
  }
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", "cache-control": "no-store" },
  });
}

export async function GET(): Promise<Response> {
  const t = treasury();
  if (!t) return json({ ok: false, error: "gas station not configured" }, 503);
  const conn = new Connection(RPC, "confirmed");
  const lamports = await conn.getBalance(t.publicKey);
  return json({ ok: true, treasury: t.publicKey.toBase58(), sol: lamports / LAMPORTS_PER_SOL });
}

export async function POST(request: Request): Promise<Response> {
  const t = treasury();
  if (!t) return json({ ok: false, error: "gas station not configured" }, 503);

  const ip = (request.headers.get("x-forwarded-for") ?? "local").split(",")[0].trim();
  const now = Date.now();
  const recent = (hits.get(ip) ?? []).filter((x) => now - x < WINDOW_MS);
  if (recent.length >= MAX_HITS) return json({ ok: false, error: "slow down: try again in a few minutes" }, 429);
  recent.push(now);
  hits.set(ip, recent);

  let keys: PublicKey[];
  try {
    const body = (await request.json()) as { keys?: unknown };
    if (!Array.isArray(body.keys) || body.keys.length < 1 || body.keys.length > 4) throw new Error("bad keys");
    keys = body.keys.map((k) => new PublicKey(String(k)));
  } catch {
    return json({ ok: false, error: "send { keys: [1 to 4 base58 public keys] }" }, 400);
  }

  const conn = new Connection(RPC, "confirmed");
  const infos = await conn.getMultipleAccountsInfo(keys);
  const tx = new Transaction();
  const funded: string[] = [];
  keys.forEach((k, i) => {
    const have = infos[i]?.lamports ?? 0;
    const want = i === 0 ? FIRST : REST;
    if (have >= LOW) return;
    tx.add(SystemProgram.transfer({ fromPubkey: t.publicKey, toPubkey: k, lamports: want - have }));
    funded.push(k.toBase58());
  });
  if (funded.length === 0) return json({ ok: true, funded, note: "already funded" });

  try {
    const { blockhash, lastValidBlockHeight } = await conn.getLatestBlockhash("confirmed");
    tx.recentBlockhash = blockhash;
    tx.feePayer = t.publicKey;
    tx.sign(t);
    const sig = await conn.sendRawTransaction(tx.serialize(), { maxRetries: 5 });
    await conn.confirmTransaction({ signature: sig, blockhash, lastValidBlockHeight }, "confirmed");
    return json({ ok: true, funded, sig });
  } catch (e) {
    return json({ ok: false, error: `transfer failed: ${(e as Error).message}` }, 502);
  }
}
