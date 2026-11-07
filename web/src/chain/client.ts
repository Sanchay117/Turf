// Connection, sending and confirmation tracking. Runs in the browser and in Node scripts.
import {
  Connection,
  Keypair,
  PublicKey,
  Transaction,
  TransactionInstruction,
  type Commitment,
} from "@solana/web3.js";
import { decodeArena, type Arena } from "./layout.ts";

export const DEFAULT_RPC = "https://api.devnet.solana.com";
export const FEE_LAMPORTS = 5000;

export interface Receipt {
  sig: string;
  label: string;
  signer: string; // base58 of the signing player
  sentAt: number;
  confirmedMs?: number;
  slot?: number;
  err?: string;
}

type Listener = (r: Receipt) => void;

export class Chain {
  readonly conn: Connection;
  private bh: { blockhash: string; lastValidBlockHeight: number; at: number } | null = null;
  private bhPending: Promise<void> | null = null;
  private pending = new Map<string, Receipt>();
  private listeners = new Set<Listener>();
  private poller: ReturnType<typeof setInterval> | null = null;
  sentCount = 0;

  constructor(rpc = DEFAULT_RPC, ws?: string) {
    // No silent 429 retries: a throttled call fails fast and the caller decides, instead of piling up.
    this.conn = new Connection(rpc, { commitment: "confirmed", wsEndpoint: ws, disableRetryOnRateLimit: true });
  }

  onReceipt(fn: Listener): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  private emit(r: Receipt) {
    for (const fn of this.listeners) fn(r);
  }

  private async refreshBlockhash() {
    const { blockhash, lastValidBlockHeight } = await this.conn.getLatestBlockhash("confirmed");
    this.bh = { blockhash, lastValidBlockHeight, at: Date.now() };
  }

  async blockhash(): Promise<string> {
    const stale = !this.bh || Date.now() - this.bh.at > 20_000;
    if (stale) {
      if (!this.bhPending) this.bhPending = this.refreshBlockhash().finally(() => (this.bhPending = null));
      if (!this.bh) await this.bhPending;
    }
    return this.bh!.blockhash;
  }

  /** Sign and fire a transaction without waiting. Confirmation arrives through onReceipt. */
  async send(label: string, ixs: TransactionInstruction[], signers: Keypair[]): Promise<Receipt> {
    const tx = new Transaction();
    tx.add(...ixs);
    tx.feePayer = signers[0].publicKey;
    tx.recentBlockhash = await this.blockhash();
    tx.sign(...signers);
    const raw = tx.serialize();
    const sentAt = performance.now();
    const sig = await this.conn.sendRawTransaction(raw, { skipPreflight: true, maxRetries: 4 });
    const r: Receipt = { sig, label, signer: signers[0].publicKey.toBase58(), sentAt };
    this.sentCount++;
    this.pending.set(sig, r);
    this.emit(r);
    // Confirmation arrives over the websocket; a slow HTTP sweep catches anything it misses.
    try {
      const id = this.conn.onSignature(
        sig,
        (res, ctx) => this.settle(sig, res.err ? JSON.stringify(res.err) : undefined, ctx.slot),
        "confirmed",
      );
      this.subs.set(sig, id);
    } catch {
      /* the sweep will pick it up */
    }
    this.startPolling();
    return r;
  }

  private subs = new Map<string, number>();

  private settle(sig: string, err: string | undefined, slot: number) {
    const r = this.pending.get(sig);
    if (!r) return;
    r.confirmedMs = Math.round(performance.now() - r.sentAt);
    r.slot = slot;
    if (err) r.err = err;
    this.pending.delete(sig);
    const id = this.subs.get(sig);
    if (id !== undefined) {
      this.subs.delete(sig);
      void this.conn.removeSignatureListener(id).catch(() => undefined);
    }
    this.emit(r);
  }

  /** Send and wait for confirmation (used for setup steps like joining). */
  async sendAndWait(label: string, ixs: TransactionInstruction[], signers: Keypair[], timeoutMs = 45_000): Promise<Receipt> {
    const r = await this.send(label, ixs, signers);
    return new Promise((resolve, reject) => {
      const t0 = Date.now();
      const off = this.onReceipt((u) => {
        if (u.sig !== r.sig || u.confirmedMs === undefined) return;
        off();
        if (u.err) reject(new Error(`${label} failed: ${u.err}`));
        else resolve(u);
      });
      const guard = setInterval(() => {
        if (Date.now() - t0 > timeoutMs) {
          clearInterval(guard);
          off();
          reject(new Error(`${label} timed out`));
        }
        if (!this.pending.has(r.sig)) clearInterval(guard);
      }, 1000);
    });
  }

  private startPolling() {
    if (this.poller) return;
    this.poller = setInterval(() => void this.poll(), 2500);
  }

  /** Backup sweep for confirmations the websocket did not deliver within a few seconds. */
  private async poll() {
    if (this.pending.size === 0) {
      if (this.poller) clearInterval(this.poller);
      this.poller = null;
      return;
    }
    const now = performance.now();
    const sigs = [...this.pending.values()].filter((r) => now - r.sentAt > 4000).map((r) => r.sig).slice(0, 200);
    if (!sigs.length) return;
    try {
      const { value } = await this.conn.getSignatureStatuses(sigs);
      value.forEach((st, k) => {
        const r = this.pending.get(sigs[k]);
        if (!r) return;
        if (st && (st.confirmationStatus === "confirmed" || st.confirmationStatus === "finalized" || st.err)) {
          this.settle(sigs[k], st.err ? JSON.stringify(st.err) : undefined, st.slot);
        } else if (performance.now() - r.sentAt > 60_000) {
          this.settle(sigs[k], "dropped", 0);
        }
      });
    } catch {
      // rate limited or offline; try again on the next sweep
    }
  }

  async fetchArena(address: PublicKey, commitment: Commitment = "confirmed"): Promise<Arena | null> {
    const info = await this.conn.getAccountInfo(address, commitment);
    return info ? decodeArena(address, info.data) : null;
  }

  async fetchArenas(addresses: PublicKey[]): Promise<(Arena | null)[]> {
    const infos = await this.conn.getMultipleAccountsInfo(addresses, "confirmed");
    return infos.map((info, k) => (info ? decodeArena(addresses[k], info.data) : null));
  }

  watchArena(address: PublicKey, fn: (a: Arena) => void): () => void {
    const id = this.conn.onAccountChange(
      address,
      (info) => {
        try {
          fn(decodeArena(address, info.data));
        } catch {
          /* ignore malformed */
        }
      },
      { commitment: "processed" },
    );
    return () => void this.conn.removeAccountChangeListener(id);
  }

  watchSlot(fn: (slot: number) => void): () => void {
    let last = 0;
    let heard = 0;
    const push = (s: number) => {
      if (s > last) {
        last = s;
        fn(s);
      }
    };
    const id = this.conn.onSlotChange((s) => {
      heard = Date.now();
      push(s.slot);
    });
    // Poll only while the websocket is quiet (still connecting, or dropped).
    const t = setInterval(async () => {
      if (Date.now() - heard < 5000) return;
      try {
        push(await this.conn.getSlot("processed"));
      } catch {
        /* ignore */
      }
    }, 3000);
    return () => {
      clearInterval(t);
      void this.conn.removeSlotChangeListener(id);
    };
  }
}
