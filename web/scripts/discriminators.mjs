// Prints Anchor discriminators (first 8 bytes of sha256) for Turf's instructions and account.
import { createHash } from "node:crypto";

const names = [
  "global:create_arena",
  "global:join",
  "global:claim",
  "global:next_round",
  "account:Arena",
];
for (const n of names) {
  const bytes = [...createHash("sha256").update(n).digest().subarray(0, 8)];
  console.log(n.padEnd(22), `[${bytes.join(", ")}]`);
}
