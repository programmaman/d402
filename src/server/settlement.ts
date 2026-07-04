import type {D402PaymentTerms} from "../core/index.js";
import type {AbstractProvider} from "ethers";
import type {PayableTerms} from "./types.js";
import type {LatestBlockTimestampCache} from "./cache.js";

interface SettlementConfig {
  provider: AbstractProvider;
  settlementWindow?: number;
  settlementTimeUnixSec?: number;
}

export type ResolvedPayableTerms = PayableTerms & {
  settlementTimeUnixSec: D402PaymentTerms["settlementTimeUnixSec"];
};

export async function resolveSettlementTerms(
  paymentConfig: SettlementConfig,
  terms: PayableTerms,
  latestBlockCache: LatestBlockTimestampCache | null,
): Promise<ResolvedPayableTerms> {
  const partialTerms = terms as Partial<Pick<PayableTerms, "settlementTimeUnixSec">>;
  const settlementTimeUnixSec = await resolveSettlementTimeUnixSec(
    paymentConfig,
    partialTerms,
    latestBlockCache,
  );

  return {
    ...terms,
    settlementTimeUnixSec,
  };
}

async function resolveSettlementTimeUnixSec(
  paymentConfig: SettlementConfig,
  partialTerms: Partial<Pick<PayableTerms, "settlementTimeUnixSec">>,
  latestBlockCache: LatestBlockTimestampCache | null,
): Promise<D402PaymentTerms["settlementTimeUnixSec"]> {
  if (
    paymentConfig.settlementWindow !== undefined &&
    paymentConfig.settlementTimeUnixSec !== undefined
  ) {
    throw new Error(
      "paymentConfig.settlementWindow and paymentConfig.settlementTimeUnixSec cannot both be set",
    );
  }

  if (
    paymentConfig.settlementWindow !== undefined &&
    partialTerms.settlementTimeUnixSec !== undefined
  ) {
    throw new Error(
      "paymentConfig.settlementWindow and terms.settlementTimeUnixSec cannot both be set",
    );
  }

  if (
    paymentConfig.settlementTimeUnixSec !== undefined &&
    partialTerms.settlementTimeUnixSec !== undefined
  ) {
    throw new Error(
      "paymentConfig.settlementTimeUnixSec and terms.settlementTimeUnixSec cannot both be set",
    );
  }

  if (paymentConfig.settlementWindow !== undefined) {
    const latestBlockTimestamp = latestBlockCache
      ? await latestBlockCache.get(paymentConfig.provider)
      : await getLatestBlockTimestamp(paymentConfig.provider);

    if (latestBlockTimestamp === null) {
      throw new Error("unable to read latest block for settlementWindow");
    }

    return String(
      latestBlockTimestamp + BigInt(paymentConfig.settlementWindow),
    ) as D402PaymentTerms["settlementTimeUnixSec"];
  }

  if (paymentConfig.settlementTimeUnixSec !== undefined) {
    return String(
      paymentConfig.settlementTimeUnixSec,
    ) as D402PaymentTerms["settlementTimeUnixSec"];
  }

  if (partialTerms.settlementTimeUnixSec === undefined) {
    throw new Error(
      "settlementTimeUnixSec must be provided by paymentConfig or terms",
    );
  }

  return partialTerms.settlementTimeUnixSec;
}

async function getLatestBlockTimestamp(
  provider: SettlementConfig["provider"],
): Promise<bigint | null> {
  const block = await provider.getBlock("latest");
  if (block === null) {
    return null;
  }

  return BigInt(block.timestamp);
}