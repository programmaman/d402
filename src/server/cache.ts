import type { AbstractProvider } from "ethers";

export interface LatestBlockTimestampCache {
  get(provider: AbstractProvider): Promise<bigint | null>;
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
    throw new Error("paymentConfig.cache must be a positive integer");
  }

  return cache;
}

export function createLatestBlockTimestampCache(
  ttlMs: number,
): LatestBlockTimestampCache {
  let cachedAtMs = 0;
  let cachedTimestamp: bigint | null = null;
  let pending: Promise<bigint | null> | null = null;

  return {
    async get(provider) {
      const nowMs = Date.now();

      if (cachedTimestamp !== null && nowMs - cachedAtMs < ttlMs) {
        return cachedTimestamp;
      }

      if (pending !== null) {
        return pending;
      }

      pending = getLatestBlockTimestamp(provider);

      try {
        const latestBlockTimestamp = await pending;
        cachedTimestamp = latestBlockTimestamp;
        cachedAtMs = latestBlockTimestamp === null ? 0 : Date.now();
        return latestBlockTimestamp;
      } finally {
        pending = null;
      }
    },
  };
}

async function getLatestBlockTimestamp(
  provider: AbstractProvider,
): Promise<bigint | null> {
  const block = await provider.getBlock("latest");
  if (block === null) {
    return null;
  }

  return BigInt(block.timestamp);
}
