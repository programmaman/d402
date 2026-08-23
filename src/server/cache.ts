import type { D402BlockReference, D402RpcClient } from "../core/index.js";
import {
  readBlockReference,
  sameBlockReference,
} from "./block-reference.js";
import {
  emitLog,
  NoopLogger,
} from "../runtime/logger.js";
import type { D402Logger } from "../runtime/logger.js";

export type BlockReferenceLookup =
  | {
      ok: true;
      reference: D402BlockReference;
      source: "cache" | "provider";
    }
  | {
      ok: false;
      reason: "not-found" | "provider-error" | "mismatch";
      cause?: unknown;
    };

export interface BlockReferenceCache {
  getLatest(rpcClient: D402RpcClient): Promise<BlockReferenceLookup>;
  getByHash(
    rpcClient: D402RpcClient,
    expected: D402BlockReference,
  ): Promise<BlockReferenceLookup>;
}

export function resolveLatestBlockCacheTtlMs(
  cache: boolean | number | undefined,
): number | null {
  if (cache === undefined || cache === false) {
    return null;
  }

  if (cache === true) {
    return 5_000;
  }

  if (!Number.isInteger(cache) || cache <= 0) {
    throw new Error(
      `payment.cache must be a positive integer, got ${cache}`,
    );
  }

  return cache;
}

interface ProviderState {
  latest?: { reference: D402BlockReference; cachedAtMs: number };
  latestPending?: Promise<BlockReferenceLookup>;
  byHashPending: Map<string, Promise<BlockReferenceLookup>>;
  historical: Map<string, D402BlockReference>;
}

export function createBlockReferenceCache(
  ttlMs: number,
  maxEntries = 256,
  logger: D402Logger = NoopLogger,
): BlockReferenceCache {
  if (!Number.isInteger(maxEntries) || maxEntries <= 0) {
    throw new Error(`maxEntries must be a positive integer, got ${maxEntries}`);
  }

  const states = new WeakMap<D402RpcClient, ProviderState>();

  function stateFor(rpcClient: D402RpcClient): ProviderState {
    const existing = states.get(rpcClient);
    if (existing !== undefined) {
      return existing;
    }

    const created: ProviderState = {
      byHashPending: new Map(),
      historical: new Map(),
    };
    states.set(rpcClient, created);
    return created;
  }

  function insertHistorical(state: ProviderState, reference: D402BlockReference): void {
    const key = reference.blockHash.toLowerCase();
    state.historical.delete(key);
    state.historical.set(key, reference);
    while (state.historical.size > maxEntries) {
      const oldest = state.historical.keys().next().value;
      if (oldest === undefined) break;
      state.historical.delete(oldest);
    }
  }

  return {
    async getLatest(rpcClient) {
      const state = stateFor(rpcClient);
      const nowMs = Date.now();
      if (state.latest !== undefined && nowMs - state.latest.cachedAtMs < ttlMs) {
        emitLog(logger, {
          level: "debug",
          event: "settlement.reference.cache.hit",
          message: "Using the cached latest block reference.",
          context: { reference: "latest", ageMs: nowMs - state.latest.cachedAtMs },
        });
        return { ok: true, reference: state.latest.reference, source: "cache" };
      }
      if (state.latestPending !== undefined) {
        emitLog(logger, {
          level: "debug",
          event: "settlement.reference.cache.wait",
          message: "Waiting for an in-flight latest block reference read.",
          context: { reference: "latest" },
        });
        return state.latestPending;
      }

      emitLog(logger, {
        level: "debug",
        event: "settlement.reference.cache.miss",
        message: "The latest block reference was not cached.",
        context: { reference: "latest", ttlMs },
      });
      const pending = readLatest(rpcClient, state, insertHistorical, logger);
      state.latestPending = pending;
      try {
        return await pending;
      } finally {
        if (state.latestPending === pending) delete state.latestPending;
      }
    },
    async getByHash(rpcClient, expected) {
      const state = stateFor(rpcClient);
      const key = expected.blockHash.toLowerCase();
      const cached = state.historical.get(key);
      if (cached !== undefined) {
        emitLog(logger, {
          level: "debug",
          event: "settlement.reference.cache.hit",
          message: "Using the cached historical block reference.",
          context: { reference: expected.blockHash, cacheType: "historical" },
        });
        state.historical.delete(key);
        state.historical.set(key, cached);
        return sameBlockReference(cached, expected)
          ? { ok: true, reference: cached, source: "cache" }
          : { ok: false, reason: "mismatch" };
      }

      const pendingExisting = state.byHashPending.get(key);
      if (pendingExisting !== undefined) {
        emitLog(logger, {
          level: "debug",
          event: "settlement.reference.cache.wait",
          message: "Waiting for an in-flight historical block reference read.",
          context: { reference: expected.blockHash, cacheType: "historical" },
        });
        return pendingExisting;
      }

      emitLog(logger, {
        level: "debug",
        event: "settlement.reference.cache.miss",
        message: "The historical block reference was not cached.",
        context: { reference: expected.blockHash, cacheType: "historical" },
      });

      const pending = readByHash(rpcClient, expected, state, insertHistorical, logger);
      state.byHashPending.set(key, pending);
      try {
        return await pending;
      } finally {
        if (state.byHashPending.get(key) === pending) state.byHashPending.delete(key);
      }
    },
  };
}

async function readLatest(
  rpcClient: D402RpcClient,
  state: ProviderState,
  insertHistorical: (state: ProviderState, reference: D402BlockReference) => void,
  logger: D402Logger,
): Promise<BlockReferenceLookup> {
  const result = await readBlockReference(rpcClient, "latest", logger);
  if (!result.ok) return result;

  state.latest = { reference: result.reference, cachedAtMs: Date.now() };
  insertHistorical(state, result.reference);
  return { ok: true, reference: result.reference, source: "provider" };
}

async function readByHash(
  rpcClient: D402RpcClient,
  expected: D402BlockReference,
  state: ProviderState,
  insertHistorical: (state: ProviderState, reference: D402BlockReference) => void,
  logger: D402Logger,
): Promise<BlockReferenceLookup> {
  const result = await readBlockReference(rpcClient, {
    blockHash: expected.blockHash,
  }, logger);
  if (!result.ok) return result;
  if (!sameBlockReference(result.reference, expected)) {
    return { ok: false, reason: "mismatch" };
  }

  insertHistorical(state, result.reference);
  return { ok: true, reference: result.reference, source: "provider" };
}
