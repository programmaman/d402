import type { AbstractProvider } from "ethers";
import type { D402BlockReference } from "../core/index.js";
import { createBlockReferenceCache } from "./cache.js";
import type { BlockReferenceCache } from "./cache.js";

export type SettlementReferenceResolution =
  | { ok: true; resolution: "verified"; reference: D402BlockReference }
  | { ok: true; resolution: "unavailable"; reference: D402BlockReference }
  | {
      ok: false;
      reason: "reference-block-mismatch" | "reference-provider-error";
      cause?: unknown;
    };

export async function resolveSettlementReference(
  provider: AbstractProvider,
  cache: BlockReferenceCache | null,
  expected: D402BlockReference,
): Promise<SettlementReferenceResolution> {
  const lookup = await (cache ?? createBlockReferenceCache(0)).getByHash(provider, expected);
  if (lookup.ok) {
    return { ok: true, resolution: "verified", reference: lookup.reference };
  }
  if (lookup.reason === "not-found") {
    return { ok: true, resolution: "unavailable", reference: expected };
  }
  if (lookup.reason === "mismatch") {
    return { ok: false, reason: "reference-block-mismatch" };
  }
  return { ok: false, reason: "reference-provider-error", cause: lookup.cause };
}
