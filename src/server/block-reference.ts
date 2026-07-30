import type { AbstractProvider } from "ethers";
import type {
  D402BlockReference,
  Hex32,
} from "../core/index.js";

type ResolvedBlock = NonNullable<
  Awaited<ReturnType<AbstractProvider["getBlock"]>>
>;

export type BlockReferenceReadResult =
  | { ok: true; reference: D402BlockReference }
  | {
      ok: false;
      reason: "not-found" | "provider-error";
      cause?: unknown;
    };

export function toBlockReference(block: ResolvedBlock): D402BlockReference {
  if (block.hash === null) {
    throw new Error("Resolved block has no hash.");
  }

  return {
    blockNumber: block.number,
    blockHash: block.hash.toLowerCase() as Hex32,
    blockTimestampUnixSec: String(block.timestamp) as `${bigint}`,
  };
}

export function sameBlockReference(
  left: D402BlockReference,
  right: D402BlockReference,
): boolean {
  return left.blockNumber === right.blockNumber
    && left.blockHash.toLowerCase() === right.blockHash.toLowerCase()
    && left.blockTimestampUnixSec === right.blockTimestampUnixSec;
}

export async function readBlockReference(
  provider: AbstractProvider,
  blockHashOrBlockTag: Parameters<AbstractProvider["getBlock"]>[0],
): Promise<BlockReferenceReadResult> {
  try {
    const block = await provider.getBlock(blockHashOrBlockTag);
    if (block === null || block.hash === null) {
      return { ok: false, reason: "not-found" };
    }

    return { ok: true, reference: toBlockReference(block) };
  } catch (cause) {
    return { ok: false, reason: "provider-error", cause };
  }
}
