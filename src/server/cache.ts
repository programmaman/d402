import type { AbstractProvider } from "ethers";
import type { D402BlockReference, Hex32 } from "../core/index.js";

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
  getLatest(provider: AbstractProvider): Promise<BlockReferenceLookup>;
  getByHash(
    provider: AbstractProvider,
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
      `paymentConfig.cache must be a positive integer, got ${cache}`,
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
): BlockReferenceCache {
  if (!Number.isInteger(maxEntries) || maxEntries <= 0) {
    throw new Error(`maxEntries must be a positive integer, got ${maxEntries}`);
  }

  const states = new WeakMap<AbstractProvider, ProviderState>();

  function stateFor(provider: AbstractProvider): ProviderState {
    const existing = states.get(provider);
    if (existing !== undefined) {
      return existing;
    }

    const created: ProviderState = {
      byHashPending: new Map(),
      historical: new Map(),
    };
    states.set(provider, created);
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
    async getLatest(provider) {
      const state = stateFor(provider);
      const nowMs = Date.now();
      if (state.latest !== undefined && nowMs - state.latest.cachedAtMs < ttlMs) {
        return { ok: true, reference: state.latest.reference, source: "cache" };
      }
      if (state.latestPending !== undefined) {
        return state.latestPending;
      }

      const pending = readLatest(provider, state, insertHistorical);
      state.latestPending = pending;
      try {
        return await pending;
      } finally {
        if (state.latestPending === pending) delete state.latestPending;
      }
    },
    async getByHash(provider, expected) {
      const state = stateFor(provider);
      const key = expected.blockHash.toLowerCase();
      const cached = state.historical.get(key);
      if (cached !== undefined) {
        state.historical.delete(key);
        state.historical.set(key, cached);
        return compareReference(cached, expected)
          ? { ok: true, reference: cached, source: "cache" }
          : { ok: false, reason: "mismatch" };
      }

      const pendingExisting = state.byHashPending.get(key);
      if (pendingExisting !== undefined) return pendingExisting;

      const pending = readByHash(provider, expected, state, insertHistorical);
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
  provider: AbstractProvider,
  state: ProviderState,
  insertHistorical: (state: ProviderState, reference: D402BlockReference) => void,
): Promise<BlockReferenceLookup> {
  try {
    const block = await provider.getBlock("latest");
    if (block === null) return { ok: false, reason: "not-found" };
    const reference = toBlockReference(block);
    state.latest = { reference, cachedAtMs: Date.now() };
    insertHistorical(state, reference);
    return { ok: true, reference, source: "provider" };
  } catch (cause) {
    return { ok: false, reason: "provider-error", cause };
  }
}

async function readByHash(
  provider: AbstractProvider,
  expected: D402BlockReference,
  state: ProviderState,
  insertHistorical: (state: ProviderState, reference: D402BlockReference) => void,
): Promise<BlockReferenceLookup> {
  try {
    const block = await provider.getBlock(expected.blockHash);
    if (block === null) return { ok: false, reason: "not-found" };
    const reference = toBlockReference(block);
    if (!compareReference(reference, expected)) return { ok: false, reason: "mismatch" };
    insertHistorical(state, reference);
    return { ok: true, reference, source: "provider" };
  } catch (cause) {
    return { ok: false, reason: "provider-error", cause };
  }
}

function toBlockReference(
  block: NonNullable<Awaited<ReturnType<AbstractProvider["getBlock"]>>>,
): D402BlockReference {
  if (block.hash === null) throw new Error("Resolved block has no hash.");
  return {
    blockNumber: block.number,
    blockHash: block.hash.toLowerCase() as Hex32,
    blockTimestampUnixSec: String(block.timestamp) as `${bigint}`,
  };
}

function compareReference(left: D402BlockReference, right: D402BlockReference): boolean {
  return left.blockNumber === right.blockNumber
    && left.blockHash.toLowerCase() === right.blockHash.toLowerCase()
    && left.blockTimestampUnixSec === right.blockTimestampUnixSec;
}

/** @deprecated Use BlockReferenceCache. */
export interface LatestBlockTimestampCache {
  get(provider: AbstractProvider): Promise<bigint | null>;
}

/** @deprecated Use createBlockReferenceCache. */
export function createLatestBlockTimestampCache(ttlMs: number): LatestBlockTimestampCache {
  let cachedAtMs = 0;
  let cachedTimestamp: bigint | null = null;
  let pending: Promise<bigint | null> | null = null;
  return {
    async get(provider) {
      const nowMs = Date.now();
      if (cachedTimestamp !== null && nowMs - cachedAtMs < ttlMs) return cachedTimestamp;
      if (pending !== null) return pending;
      pending = provider.getBlock("latest").then((block) => {
        if (block === null) return null;
        cachedTimestamp = BigInt(block.timestamp);
        cachedAtMs = Date.now();
        return cachedTimestamp;
      }).catch(() => null);
      try {
        return await pending;
      } finally {
        pending = null;
      }
    },
  };
}
