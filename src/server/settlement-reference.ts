import type { D402BlockReference, D402RpcClient } from "../core/index.js";
import { createBlockReferenceCache } from "./cache.js";
import type { BlockReferenceCache } from "./cache.js";

export type SettlementReferenceResolution =
  | { ok: true; reference: D402BlockReference }
  | {
      ok: false;
      reason: "reference-block-mismatch" | "reference-provider-error";
      cause?: unknown;
    };

export async function resolveSettlementReference(
  rpcClient: D402RpcClient,
  cache: BlockReferenceCache | null,
  expected: D402BlockReference,
): Promise<SettlementReferenceResolution> {
  const lookup = await (cache ?? createBlockReferenceCache(0)).getByHash(rpcClient, expected);
  if (lookup.ok) {
    return { ok: true, reference: lookup.reference };
  }
  if (lookup.reason === "not-found" || lookup.reason === "mismatch") {
    return { ok: false, reason: "reference-block-mismatch" };
  }
  return { ok: false, reason: "reference-provider-error", cause: lookup.cause };
}
