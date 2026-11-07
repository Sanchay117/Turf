// Gas station: tops up a visitor's throwaway keys with a little devnet SOL so the
// game can sign every move locally, with no wallet popups and no faucet trip.
// Runs as a Vercel function (Web-standard handlers) and inside the Vite dev server.
//
// It has no dependencies: a System Program transfer is a small, fixed message, so
// it is built and signed here with Node's own Ed25519 and sent over plain JSON-RPC.
// (web3.js failed to load on Vercel's Node through an ESM-only transitive package.)
//
// Public devnet RPC can also refuse or rate-limit cloud servers. So the station
// first tries to send the top-up itself, and if any RPC call fails it signs the
// transfer against a blockhash the visitor's browser supplied and hands it back
// for the browser to submit. The treasury key never leaves the server either way.
import { createPrivateKey, createPublicKey, sign, type KeyObject } from "node:crypto";

const RPC = process.env.RPC_URL || process.env.VITE_RPC_URL || "https://api.devnet.solana.com";
const SOL = 1_000_000_000;
const FIRST = Math.round(0.03 * SOL); // the visitor (also pays arena rent if needed)
const REST = Math.round(0.012 * SOL); // each rival bot
const LOW = Math.round(0.004 * SOL);
const WINDOW_MS = 10 * 60 * 1000;
const MAX_HITS = 6;
const SYSTEM_PROGRAM = new Uint8Array(32);

const hits = new Map<string, number[]>();

// ---------------------------------------------------------------- base58

const ALPHABET = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";

function b58encode(bytes: Uint8Array): string {
  let n = 0n;
  for (const b of bytes) n = n * 256n + BigInt(b);
  let out = "";
  while (n > 0n) {
    out = ALPHABET[Number(n % 58n)] + out;
    n /= 58n;
  }
  for (const b of bytes) {
    if (b !== 0) break;
    out = "1" + out;
  }
  return out;
}

/** Decodes a base58 string to exactly `size` bytes, or throws. */
function b58decode(s: string, size = 32): Uint8Array {
  let n = 0n;
  for (const c of s) {
    const v = ALPHABET.indexOf(c);
    if (v < 0) throw new Error("not base58");
    n = n * 58n + BigInt(v);
  }
  const body: number[] = [];
  while (n > 0n) {
    body.unshift(Number(n % 256n));
    n /= 256n;
  }
  let zeros = 0;
  while (s[zeros] === "1") zeros++;
  const out = [...new Array(zeros).fill(0), ...body];
  if (out.length !== size) throw new Error(`expected ${size} bytes`);
  return Uint8Array.from(out);
}

// ---------------------------------------------------------------- keys and transactions

interface Treasury {
  key: KeyObject;
  pub: Uint8Array;
  address: string;
}

/** Why the treasury key could not be read, for the error message. */
function treasuryProblem(): string {
  const raw = process.env.TREASURY_SECRET?.trim();
  if (!raw) return "gas station not configured: TREASURY_SECRET is not set for this deployment";
  return `gas station not configured: TREASURY_SECRET is set (${raw.length} characters) but is not a 64-byte keypair; paste the JSON array from keys/treasury.json`;
}

function treasury(): Treasury | null {
  const raw = process.env.TREASURY_SECRET?.trim().replace(/^['"]|['"]$/g, "");
  if (!raw) return null;
  try {
    // Either the JSON array from `solana-keygen` or a base58 secret key.
    const secret = raw.startsWith("[") ? Uint8Array.from(JSON.parse(raw) as number[]) : b58decode(raw, 64);
    if (secret.length !== 64) return null;
    // PKCS#8 wrapper for a raw Ed25519 seed (the first 32 bytes of a Solana secret key).
    const der = Buffer.concat([Buffer.from("302e020100300506032b657004220420", "hex"), Buffer.from(secret.subarray(0, 32))]);
    const key = createPrivateKey({ key: der, format: "der", type: "pkcs8" });
    const spki = createPublicKey(key).export({ format: "der", type: "spki" });
    const pub = new Uint8Array(spki.subarray(spki.length - 32));
    if (Buffer.compare(Buffer.from(pub), Buffer.from(secret.subarray(32))) !== 0) return null;
    return { key, pub, address: b58encode(pub) };
  } catch {
    return null;
  }
}

function shortvec(n: number): number[] {
  const out: number[] = [];
  for (;;) {
    let b = n & 0x7f;
    n >>= 7;
    if (n) b |= 0x80;
    out.push(b);
    if (!n) return out;
  }
}

function u32(n: number): number[] {
  const b = Buffer.alloc(4);
  b.writeUInt32LE(n);
  return [...b];
}

function u64(n: number): number[] {
  const b = Buffer.alloc(8);
  b.writeBigUInt64LE(BigInt(n));
  return [...b];
}

/** A signed legacy transaction of System Program transfers from the treasury, as base64. */
function transfers(t: Treasury, to: { key: Uint8Array; lamports: number }[], blockhash: Uint8Array): string {
  // Accounts: treasury (signer, writable), each recipient (writable), System Program (read-only).
  const accounts = [t.pub, ...to.map((x) => x.key), SYSTEM_PROGRAM];
  const program = accounts.length - 1;
  const message = [
    1, 0, 1,
    ...shortvec(accounts.length),
    ...accounts.flatMap((a) => [...a]),
    ...blockhash,
    ...shortvec(to.length),
    ...to.flatMap((x, i) => {
      const data = [...u32(2), ...u64(x.lamports)]; // SystemInstruction::Transfer
      return [program, ...shortvec(2), 0, i + 1, ...shortvec(data.length), ...data];
    }),
  ];
  const msg = Uint8Array.from(message);
  const signature = sign(null, msg, t.key);
  return Buffer.concat([Buffer.from(shortvec(1)), signature, msg]).toString("base64");
}

// ---------------------------------------------------------------- JSON-RPC

async function rpc<T>(method: string, params: unknown[]): Promise<T> {
  const res = await fetch(RPC, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
    signal: AbortSignal.timeout(8000),
  });
  if (!res.ok) throw new Error(`${method}: HTTP ${res.status}`);
  const body = (await res.json()) as { result?: T; error?: { message?: string } };
  if (body.error) throw new Error(`${method}: ${body.error.message ?? "error"}`);
  return body.result as T;
}

async function confirm(signature: string, timeoutMs = 25_000): Promise<void> {
  const t0 = Date.now();
  while (Date.now() - t0 < timeoutMs) {
    const r = await rpc<{ value: ({ err: unknown; confirmationStatus?: string } | null)[] }>("getSignatureStatuses", [[signature]]);
    const s = r.value[0];
    if (s?.err) throw new Error(`transfer failed on chain: ${JSON.stringify(s.err)}`);
    if (s && (s.confirmationStatus === "confirmed" || s.confirmationStatus === "finalized")) return;
    await new Promise((ok) => setTimeout(ok, 500));
  }
  throw new Error("not confirmed in time");
}

// ---------------------------------------------------------------- handlers

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
  const t = treasury();
  if (!t) return json({ ok: false, error: treasuryProblem() }, 503);
  try {
    const r = await rpc<{ value: number }>("getBalance", [t.address, { commitment: "confirmed" }]);
    return json({ ok: true, treasury: t.address, sol: r.value / SOL });
  } catch (e) {
    return json({ ok: false, treasury: t.address, error: `rpc: ${message(e)}` }, 502);
  }
}

export async function POST(request: Request): Promise<Response> {
  try {
    return await topUp(request);
  } catch (e) {
    return json({ ok: false, error: `gas station failed: ${message(e)}` }, 500);
  }
}

async function topUp(request: Request): Promise<Response> {
  const t = treasury();
  if (!t) return json({ ok: false, error: treasuryProblem() }, 503);

  const ip = (request.headers.get("x-forwarded-for") ?? "local").split(",")[0].trim();
  const now = Date.now();
  const recent = (hits.get(ip) ?? []).filter((x) => now - x < WINDOW_MS);
  if (recent.length >= MAX_HITS) return json({ ok: false, error: "slow down: try again in a few minutes" }, 429);
  recent.push(now);
  hits.set(ip, recent);

  let keys: string[];
  let relayHash: Uint8Array | null = null;
  try {
    const body = (await request.json()) as { keys?: unknown; blockhash?: unknown };
    if (!Array.isArray(body.keys) || body.keys.length < 1 || body.keys.length > 4) throw new Error("bad keys");
    keys = [...new Set(body.keys.map(String))];
    for (const k of keys) {
      const bytes = b58decode(k);
      if (k === t.address || bytes.every((b) => b === 0)) throw new Error("bad key");
    }
    if (typeof body.blockhash === "string") relayHash = b58decode(body.blockhash);
  } catch {
    return json({ ok: false, error: "send { keys: [1 to 4 base58 public keys], blockhash? }" }, 400);
  }

  let sent = false;
  let rpcError = "";
  try {
    const infos = await rpc<{ value: ({ lamports: number } | null)[] }>("getMultipleAccounts", [
      keys,
      { commitment: "confirmed", encoding: "base64", dataSlice: { offset: 0, length: 0 } },
    ]);
    const to = keys
      .map((k, i) => ({ k, have: infos.value[i]?.lamports ?? 0, want: i === 0 ? FIRST : REST }))
      .filter((x) => x.have < LOW)
      .map((x) => ({ address: x.k, key: b58decode(x.k), lamports: x.want - x.have }));
    if (to.length === 0) return json({ ok: true, funded: [], note: "already funded" });
    const latest = await rpc<{ value: { blockhash: string } }>("getLatestBlockhash", [{ commitment: "confirmed" }]);
    const tx = transfers(t, to, b58decode(latest.value.blockhash));
    const sig = await rpc<string>("sendTransaction", [tx, { encoding: "base64", preflightCommitment: "confirmed", maxRetries: 5 }]);
    sent = true;
    await confirm(sig);
    return json({ ok: true, funded: to.map((x) => x.address), sig });
  } catch (e) {
    rpcError = message(e);
    // Once a top-up is on its way, never sign a second one for the same keys.
    if (sent) return json({ ok: false, error: `top-up sent but not confirmed: ${rpcError}` }, 502);
  }

  if (!relayHash) return json({ ok: false, error: `rpc: ${rpcError}` }, 502);
  const to = keys.map((k, i) => ({ key: b58decode(k), lamports: i === 0 ? FIRST : REST }));
  return json({ ok: true, funded: keys, relay: transfers(t, to, relayHash), note: `server rpc failed: ${rpcError}` });
}
