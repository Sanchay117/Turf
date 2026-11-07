// Hand-written instruction builders for the Turf program (no IDL needed at runtime).
import { Buffer } from "buffer";
import { ComputeBudgetProgram, PublicKey, SystemProgram, TransactionInstruction } from "@solana/web3.js";
import { DISC, MAX_TARGETS, PROGRAM_ID, encodeName } from "./layout.ts";

export function arenaAddress(id: number): PublicKey {
  const seed = new Uint8Array(4);
  new DataView(seed.buffer).setUint32(0, id, true);
  return PublicKey.findProgramAddressSync([new TextEncoder().encode("arena"), seed], PROGRAM_ID)[0];
}

function data(disc: readonly number[], body: Uint8Array = new Uint8Array()): Buffer {
  const out = new Uint8Array(8 + body.length);
  out.set(disc, 0);
  out.set(body, 8);
  return Buffer.from(out);
}

export function createArenaIx(payer: PublicKey, id: number, roundSlots: number): TransactionInstruction {
  const body = new Uint8Array(8);
  const v = new DataView(body.buffer);
  v.setUint32(0, id, true);
  v.setUint32(4, roundSlots, true);
  return new TransactionInstruction({
    programId: PROGRAM_ID,
    keys: [
      { pubkey: arenaAddress(id), isSigner: false, isWritable: true },
      { pubkey: payer, isSigner: true, isWritable: true },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
    ],
    data: data(DISC.createArena, body),
  });
}

export function joinIx(arena: PublicKey, player: PublicKey, name: string): TransactionInstruction {
  return new TransactionInstruction({
    programId: PROGRAM_ID,
    keys: [
      { pubkey: arena, isSigner: false, isWritable: true },
      { pubkey: player, isSigner: true, isWritable: false },
    ],
    data: data(DISC.join, encodeName(name)),
  });
}

export function claimIx(arena: PublicKey, player: PublicKey, targets: number[]): TransactionInstruction {
  const t = targets.slice(0, MAX_TARGETS);
  const body = new Uint8Array(4 + 2 * t.length);
  const v = new DataView(body.buffer);
  v.setUint32(0, t.length, true);
  t.forEach((x, k) => v.setUint16(4 + 2 * k, x, true));
  return new TransactionInstruction({
    programId: PROGRAM_ID,
    keys: [
      { pubkey: arena, isSigner: false, isWritable: true },
      { pubkey: player, isSigner: true, isWritable: false },
    ],
    data: data(DISC.claim, body),
  });
}

export function nextRoundIx(arena: PublicKey): TransactionInstruction {
  return new TransactionInstruction({
    programId: PROGRAM_ID,
    keys: [{ pubkey: arena, isSigner: false, isWritable: true }],
    data: data(DISC.nextRound),
  });
}

/** Tight compute limits keep each claim cheap and quick to schedule. */
export const cu = {
  // Measured on a local validator: claim ~3.6k, join ~2.3k on an open map,
  // next_round ~3.9k, create_arena ~11.7k. Headroom covers crowded maps.
  claim: () => ComputeBudgetProgram.setComputeUnitLimit({ units: 20_000 }),
  join: () => ComputeBudgetProgram.setComputeUnitLimit({ units: 200_000 }),
  create: () => ComputeBudgetProgram.setComputeUnitLimit({ units: 30_000 }),
  next: () => ComputeBudgetProgram.setComputeUnitLimit({ units: 400_000 }),
};
