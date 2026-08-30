import type {
  D402BlockReference,
  D402RpcClient,
  Hex32,
} from "../core/index.js";
import {
  describeError,
  emitLog,
  NoopLogger,
} from "../runtime/logger.js";
import type { D402Logger } from "../runtime/logger.js";

type ResolvedBlock = Awaited<ReturnType<D402RpcClient["getBlock"]>>;

export type BlockReferenceReadResult =
  | { ok: true; reference: D402BlockReference }
  | {
      ok: false;
      reason: "not-found" | "provider-error";
      cause?: unknown;
    };

export function toBlockReference(block: ResolvedBlock): D402BlockReference {
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
  rpcClient: D402RpcClient,
  blockReference: Parameters<D402RpcClient["getBlock"]>[0],
  logger: D402Logger = NoopLogger,
): Promise<BlockReferenceReadResult> {
  const startedAt = Date.now();
  emitLog(logger, {
    level: "debug",
    event: "settlement.reference.read.started",
    message: "Reading a blockchain block reference.",
    context: { blockReference: describeBlockReference(blockReference) },
  });

  try {
    const block = await rpcClient.getBlock(blockReference);
    const reference = toBlockReference(block);
    emitLog(logger, {
      level: "debug",
      event: "settlement.reference.read.succeeded",
      message: "Read a blockchain block reference.",
      context: {
        blockReference: describeBlockReference(blockReference),
        blockNumber: reference.blockNumber,
        blockHash: reference.blockHash,
        blockTimestampUnixSec: reference.blockTimestampUnixSec,
        durationMs: Date.now() - startedAt,
      },
    });
    return { ok: true, reference };
  } catch (cause) {
    emitLog(logger, {
      level: "error",
      event: "settlement.reference.read.failed",
      message: "Failed to read a blockchain block reference.",
      context: {
        blockReference: describeBlockReference(blockReference),
        durationMs: Date.now() - startedAt,
        error: describeError(cause),
      },
    });
    return { ok: false, reason: "provider-error", cause };
  }
}

function describeBlockReference(
  reference: Parameters<D402RpcClient["getBlock"]>[0],
): string | Readonly<Record<string, unknown>> {
  return typeof reference === "object"
    ? reference
    : String(reference);
}
