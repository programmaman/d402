import type { AbstractProvider } from "ethers";
import type {
  D402BlockReference,
  D402PaymentTerms,
  Hex32,
} from "../core/index.js";
import type { PayableTerms } from "./types.js";
import type { BlockReferenceCache, LatestBlockTimestampCache } from "./cache.js";

export interface SettlementConfig {
  provider: AbstractProvider;
  settlementWindow?: number;
  settlementTimeUnixSec?: number;
}

export type ResolvedPayableTerms = PayableTerms & {
  settlementTimeUnixSec: D402PaymentTerms["settlementTimeUnixSec"];
};

export async function resolveChallengeSettlementTerms(
  paymentConfig: SettlementConfig,
  terms: PayableTerms,
  referenceCache: BlockReferenceCache | null,
): Promise<{
  terms: ResolvedPayableTerms;
  settlementReference?: D402BlockReference;
}> {
  validateTimingConfiguration(paymentConfig, terms);

  if (paymentConfig.settlementWindow !== undefined) {
    const lookup = referenceCache
      ? await referenceCache.getLatest(paymentConfig.provider)
      : await readLatestReference(paymentConfig.provider);
    if (!lookup.ok) {
      throw lookup.cause instanceof Error
        ? lookup.cause
        : new Error("unable to read latest block reference", { cause: lookup.cause });
    }

    const resolvedTerms = withSettlementTime(
      terms,
      addWindow(lookup.reference.blockTimestampUnixSec, paymentConfig.settlementWindow),
    );
    return { terms: resolvedTerms, settlementReference: lookup.reference };
  }

  return { terms: withSettlementTime(terms, fixedSettlementTime(paymentConfig, terms)) };
}

export type ProofSettlementResult =
  | {
      ok: true;
      mode: "window" | "fixed";
      terms: ResolvedPayableTerms;
      settlementReference?: D402BlockReference;
    }
  | { ok: false; reason: "missing-settlement-reference" };

export function resolveProofSettlementTerms(
  paymentConfig: SettlementConfig,
  terms: PayableTerms,
  suppliedReference?: D402BlockReference,
): ProofSettlementResult {
  validateTimingConfiguration(paymentConfig, terms);

  if (paymentConfig.settlementWindow !== undefined) {
    if (suppliedReference === undefined) {
      return { ok: false, reason: "missing-settlement-reference" };
    }
    return {
      ok: true,
      mode: "window",
      terms: withSettlementTime(
        terms,
        addWindow(suppliedReference.blockTimestampUnixSec, paymentConfig.settlementWindow),
      ),
      settlementReference: suppliedReference,
    };
  }

  return {
    ok: true,
    mode: "fixed",
    terms: withSettlementTime(terms, fixedSettlementTime(paymentConfig, terms)),
  };
}

/** @deprecated Use resolveChallengeSettlementTerms. */
export async function resolveSettlementTerms(
  paymentConfig: SettlementConfig,
  terms: PayableTerms,
  latestBlockCache: LatestBlockTimestampCache | null,
): Promise<ResolvedPayableTerms> {
  validateTimingConfiguration(paymentConfig, terms);
  if (paymentConfig.settlementWindow !== undefined && latestBlockCache !== null) {
    const timestamp = await latestBlockCache.get(paymentConfig.provider);
    if (timestamp === null) {
      throw new Error("unable to read latest block while deriving settlementTimeUnixSec");
    }
    return withSettlementTime(terms, addWindow(String(timestamp), paymentConfig.settlementWindow));
  }
  const result = await resolveChallengeSettlementTerms(paymentConfig, terms, null);
  return result.terms;
}

function validateTimingConfiguration(config: SettlementConfig, terms: PayableTerms): void {
  const termTime = (terms as Partial<Pick<PayableTerms, "settlementTimeUnixSec">>)
    .settlementTimeUnixSec;
  if (config.settlementWindow !== undefined && config.settlementTimeUnixSec !== undefined) {
    throw new Error("paymentConfig.settlementWindow and paymentConfig.settlementTimeUnixSec cannot both be set; choose one source of settlement timing");
  }
  if (config.settlementWindow !== undefined && termTime !== undefined) {
    throw new Error("paymentConfig.settlementWindow and terms.settlementTimeUnixSec cannot both be set; choose one source of settlement timing");
  }
  if (config.settlementTimeUnixSec !== undefined && termTime !== undefined) {
    throw new Error("paymentConfig.settlementTimeUnixSec and terms.settlementTimeUnixSec cannot both be set; choose one source of settlement timing");
  }
  if (config.settlementWindow !== undefined && (!Number.isInteger(config.settlementWindow) || config.settlementWindow < 0)) {
    throw new Error("paymentConfig.settlementWindow must be a non-negative integer");
  }
}

function fixedSettlementTime(
  config: SettlementConfig,
  terms: PayableTerms,
): D402PaymentTerms["settlementTimeUnixSec"] {
  if (config.settlementTimeUnixSec !== undefined) return String(config.settlementTimeUnixSec) as `${bigint}`;
  const termTime = (terms as Partial<Pick<PayableTerms, "settlementTimeUnixSec">>)
    .settlementTimeUnixSec;
  if (termTime !== undefined) return termTime;
  throw new Error("settlementTimeUnixSec must be provided by paymentConfig.settlementWindow, paymentConfig.settlementTimeUnixSec, or terms.settlementTimeUnixSec");
}

function withSettlementTime(
  terms: PayableTerms,
  settlementTimeUnixSec: D402PaymentTerms["settlementTimeUnixSec"],
): ResolvedPayableTerms {
  return { ...terms, settlementTimeUnixSec };
}

function addWindow(timestamp: string, window: number): D402PaymentTerms["settlementTimeUnixSec"] {
  return String(BigInt(timestamp) + BigInt(window)) as `${bigint}`;
}

async function readLatestReference(provider: AbstractProvider): Promise<
  | { ok: true; reference: D402BlockReference }
  | { ok: false; cause?: unknown }
> {
  try {
    const block = await provider.getBlock("latest");
    if (block === null || block.hash === null) return { ok: false };
    return {
      ok: true,
      reference: {
        blockNumber: block.number,
        blockHash: block.hash.toLowerCase() as Hex32,
        blockTimestampUnixSec: String(block.timestamp) as `${bigint}`,
      },
    };
  } catch (cause) {
    return { ok: false, cause };
  }
}
