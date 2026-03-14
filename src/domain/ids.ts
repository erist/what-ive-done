import { createHash } from "node:crypto";

export function stableId(namespace: string, seed: string): string {
  return createHash("sha1").update(`${namespace}:${seed}`).digest("hex");
}
