// Throwaway devnet keys kept in this browser, so moves sign instantly with no wallet popups.
import { Keypair } from "@solana/web3.js";

const STORE = "turf.keys.v1";

export interface Keyring {
  me: Keypair;
  rivals: Keypair[];
  name: string;
}

function load(): { me: number[]; rivals: number[][]; name: string } | null {
  try {
    const raw = localStorage.getItem(STORE);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

function save(k: Keyring) {
  try {
    localStorage.setItem(
      STORE,
      JSON.stringify({ me: [...k.me.secretKey], rivals: k.rivals.map((r) => [...r.secretKey]), name: k.name }),
    );
  } catch {
    /* private window: keys live for this tab only */
  }
}

export function keyring(): Keyring {
  const s = load();
  if (s) {
    try {
      const k: Keyring = {
        me: Keypair.fromSecretKey(Uint8Array.from(s.me)),
        rivals: s.rivals.map((r) => Keypair.fromSecretKey(Uint8Array.from(r))),
        name: s.name,
      };
      while (k.rivals.length < 3) k.rivals.push(Keypair.generate());
      return k;
    } catch {
      /* fall through to fresh keys */
    }
  }
  const me = Keypair.generate();
  const k: Keyring = {
    me,
    rivals: [Keypair.generate(), Keypair.generate(), Keypair.generate()],
    name: `Surveyor ${me.publicKey.toBase58().slice(0, 4)}`,
  };
  save(k);
  return k;
}

export function rename(k: Keyring, name: string) {
  k.name = name.replace(/[^\x20-\x7e]/g, "").trim().slice(0, 15) || k.name;
  save(k);
}
