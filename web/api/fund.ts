// Gas station: tops up a visitor's throwaway keys with a little devnet SOL so the
// game can sign every move locally, with no wallet popups and no faucet trip.
// Runs as a Vercel function (Web-standard handlers) and inside the Vite dev server.
//
// Public devnet RPC sometimes refuses or rate-limits cloud servers. So the station
// first tries to send the top-up itself, and if any RPC call fails it signs the
// transfer against a blockhash the visitor's browser supplied and hands it back
// for the browser to submit. The treasury key never leaves the server either way.
import type { Keypair, PublicKey } from "@solana/web3.js";

// web3.js loads inside the handler, so a failure to load it comes back as a
// readable error instead of a crashed function.
type Web3 = typeof import("@solana/web3.js");
let web3: Web3 | null = null;
async function lib(): Promise<Web3> {
  return (web3 ??= await import("@solana/web3.js"));
}

const RPC = process.env.RPC_URL || process.env.VITE_RPC_URL || "https://api.devnet.solana.com";
const SOL = 1_000_000_000;
const FIRST = Math.round(0.03 * SOL); // the visitor (also pays arena rent if needed)
const REST = Math.round(0.012 * SOL); // each rival bot
const LOW = Math.round(0.004 * SOL);
const WINDOW_MS = 10 * 60 * 1000;
const MAX_HITS = 6;

const hits = new Map<string, number[]>();

function treasury({ Keypair }: Web3): Keypair | null {
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

function message(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

export async function GET(): Promise<Response> {
  try {
    return await balance(await lib());
  } catch (e) {
    return json({ ok: false, error: `gas station failed: ${message(e)}` }, 500);
  }
}

export async function POST(request: Request): Promise<Response> {
  try {
    return await topUp(await lib(), request);
  } catch (e) {
    return json({ ok: false, error: `gas station failed: ${message(e)}` }, 500);
  }
}

async function balance(w: Web3): Promise<Response> {
  const t = treasury(w);
  if (!t) return json({ ok: false, error: "gas station not configured" }, 503);
  try {
    const lamports = await new w.Connection(RPC, "confirmed").getBalance(t.publicKey);
    return json({ ok: true, treasury: t.publicKey.toBase58(), sol: lamports / SOL });
  } catch (e) {
    return json({ ok: false, treasury: t.publicKey.toBase58(), error: `rpc: ${message(e)}` }, 502);
  }
}

async function topUp(w: Web3, request: Request): Promise<Response> {
  const { Connection, PublicKey, SystemProgram, Transaction } = w;
  const t = treasury(w);
  if (!t) return json({ ok: false, error: "gas station not configured" }, 503);

  const ip = (request.headers.get("x-forwarded-for") ?? "local").split(",")[0].trim();
  const now = Date.now();
  const recent = (hits.get(ip) ?? []).filter((x) => now - x < WINDOW_MS);
  if (recent.length >= MAX_HITS) return json({ ok: false, error: "slow down: try again in a few minutes" }, 429);
  recent.push(now);
  hits.set(ip, recent);

  let keys: PublicKey[];
  let relayHash: string | null = null;
  try {
    const body = (await request.json()) as { keys?: unknown; blockhash?: unknown };
    if (!Array.isArray(body.keys) || body.keys.length < 1 || body.keys.length > 4) throw new Error("bad keys");
    keys = body.keys.map((k) => new PublicKey(String(k)));
    if (typeof body.blockhash === "string") relayHash = new PublicKey(body.blockhash).toBase58();
  } catch {
    return json({ ok: false, error: "send { keys: [1 to 4 base58 public keys], blockhash? }" }, 400);
  }

  const conn = new Connection(RPC, "confirmed");
  let sent = false;
  let rpcError = "";
  try {
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
    const { blockhash, lastValidBlockHeight } = await conn.getLatestBlockhash("confirmed");
    tx.recentBlockhash = blockhash;
    tx.feePayer = t.publicKey;
    tx.sign(t);
    const sig = await conn.sendRawTransaction(tx.serialize(), { maxRetries: 5 });
    sent = true;
    await conn.confirmTransaction({ signature: sig, blockhash, lastValidBlockHeight }, "confirmed");
    return json({ ok: true, funded, sig });
  } catch (e) {
    rpcError = message(e);
    // Once a top-up is on its way, never sign a second one for the same keys.
    if (sent) return json({ ok: false, error: `top-up sent but not confirmed: ${rpcError}` }, 502);
  }

  if (!relayHash) return json({ ok: false, error: `rpc: ${rpcError}` }, 502);
  const tx = new Transaction();
  keys.forEach((k, i) => tx.add(SystemProgram.transfer({ fromPubkey: t.publicKey, toPubkey: k, lamports: i === 0 ? FIRST : REST })));
  tx.recentBlockhash = relayHash;
  tx.feePayer = t.publicKey;
  tx.sign(t);
  return json({ ok: true, funded: keys.map((k) => k.toBase58()), relay: tx.serialize().toString("base64"), note: `server rpc failed: ${rpcError}` });
}
