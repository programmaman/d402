import type {
  D402BlockReference,
  D402PaymentRequest,
  D402RpcClient,
} from "../core/index.js";
import type { PayableTerms, ResolvedPayableTerms } from "./types.js";
import type { BlockReferenceCache } from "./cache.js";
import { readBlockReference } from "./block-reference.js";
import type { D402Logger } from "../runtime/logger.js";

export interface SettlementConfig {
  rpcClient: D402RpcClient;
  settlementWindow?: number;
  settlementTimeUnixSec?: number;
  logger?: D402Logger;
}

export class SettlementTimingConfigurationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SettlementTimingConfigurationError";
  }
}

export type ResolvedSettlementTerms = ResolvedPayableTerms & {
  settlementTimeUnixSec: D402PaymentRequest["settlementTimeUnixSec"];
};

export async function resolveChallengeSettlementTerms(
  paymentConfig: SettlementConfig,
  terms: ResolvedPayableTerms,
  referenceCache: BlockReferenceCache | null,
): Promise<{
  terms: ResolvedSettlementTerms;
  settlementReference?: D402BlockReference;
}> {
  validateSettlementTimingConfiguration(paymentConfig, terms);

  if (paymentConfig.settlementWindow !== undefined) {
    const lookup = referenceCache
      ? await referenceCache.getLatest(paymentConfig.rpcClient)
      : await readBlockReference(
        paymentConfig.rpcClient,
        "latest",
        paymentConfig.logger,
      );
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
      terms: ResolvedSettlementTerms;
      settlementReference?: D402BlockReference;
    }
  | { ok: false; reason: "missing-settlement-reference" };

export function resolveProofSettlementTerms(
  paymentConfig: SettlementConfig,
  terms: ResolvedPayableTerms,
  suppliedReference?: D402BlockReference,
): ProofSettlementResult {
  validateSettlementTimingConfiguration(paymentConfig, terms);

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

function fixedSettlementTime(
  config: SettlementConfig,
  terms: ResolvedPayableTerms,
): D402PaymentRequest["settlementTimeUnixSec"] {
  if (config.settlementTimeUnixSec !== undefined) return String(config.settlementTimeUnixSec) as `${bigint}`;
  const termTime = (terms as Partial<Pick<PayableTerms, "settlementTimeUnixSec">>)
    .settlementTimeUnixSec;
  if (termTime !== undefined) return termTime;
  throw new SettlementTimingConfigurationError(
    "settlementTimeUnixSec must be provided by paymentConfig.settlementWindow, paymentConfig.settlementTimeUnixSec, or terms.settlementTimeUnixSec",
  );
}

function withSettlementTime(
  terms: ResolvedPayableTerms,
  settlementTimeUnixSec: D402PaymentRequest["settlementTimeUnixSec"],
): ResolvedSettlementTerms {
  return { ...terms, settlementTimeUnixSec };
}

function addWindow(timestamp: string, window: number): D402PaymentRequest["settlementTimeUnixSec"] {
  return String(BigInt(timestamp) + BigInt(window)) as `${bigint}`;
}

export function validateSettlementTimingConfiguration(
  config: SettlementConfig,
  terms: PayableTerms,
): void {
  const termTime = (terms as Partial<Pick<PayableTerms, "settlementTimeUnixSec">>)
    .settlementTimeUnixSec;
  if (config.settlementWindow !== undefined && config.settlementTimeUnixSec !== undefined) {
    throw new SettlementTimingConfigurationError(
      "paymentConfig.settlementWindow and paymentConfig.settlementTimeUnixSec cannot both be set; choose one source of settlement timing",
    );
  }
  if (config.settlementWindow !== undefined && termTime !== undefined) {
    throw new SettlementTimingConfigurationError(
      "paymentConfig.settlementWindow and terms.settlementTimeUnixSec cannot both be set; choose one source of settlement timing",
    );
  }
  if (config.settlementTimeUnixSec !== undefined && termTime !== undefined) {
    throw new SettlementTimingConfigurationError(
      "paymentConfig.settlementTimeUnixSec and terms.settlementTimeUnixSec cannot both be set; choose one source of settlement timing",
    );
  }
  if (config.settlementWindow !== undefined && (!Number.isInteger(config.settlementWindow) || config.settlementWindow < 0)) {
    throw new SettlementTimingConfigurationError(
      "paymentConfig.settlementWindow must be a non-negative integer",
    );
  }
}
