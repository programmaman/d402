import type {
  D402BlockReference,
  D402PaymentRequest,
} from "../core/index.js";
import type {
  PayableTerms,
  PaymentConfig,
  ResolvedPayableTerms,
} from "./types.js";
import type { BlockReferenceCache } from "./cache.js";
import { readBlockReference } from "./block-reference.js";

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
  config: PaymentConfig,
  terms: ResolvedPayableTerms,
  referenceCache: BlockReferenceCache | null,
): Promise<{
  terms: ResolvedSettlementTerms;
  settlementReference?: D402BlockReference;
}> {
  validateSettlementTimingConfiguration(config, terms);

  if (config.payment.settlementWindow !== undefined) {
    const lookup = referenceCache
      ? await referenceCache.getLatest(config.adapter.rpcClient)
      : await readBlockReference(
        config.adapter.rpcClient,
        "latest",
        config.payment.logger,
      );
    if (!lookup.ok) {
      throw lookup.cause instanceof Error
        ? lookup.cause
        : new Error("unable to read latest block reference", { cause: lookup.cause });
    }

    const resolvedTerms = withSettlementTime(
      terms,
      addWindow(lookup.reference.blockTimestampUnixSec, config.payment.settlementWindow),
    );
    return { terms: resolvedTerms, settlementReference: lookup.reference };
  }

  return { terms: withSettlementTime(terms, fixedSettlementTime(config, terms)) };
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
  config: PaymentConfig,
  terms: ResolvedPayableTerms,
  suppliedReference?: D402BlockReference,
): ProofSettlementResult {
  validateSettlementTimingConfiguration(config, terms);

  if (config.payment.settlementWindow !== undefined) {
    if (suppliedReference === undefined) {
      return { ok: false, reason: "missing-settlement-reference" };
    }
    return {
      ok: true,
      mode: "window",
      terms: withSettlementTime(
        terms,
        addWindow(suppliedReference.blockTimestampUnixSec, config.payment.settlementWindow),
      ),
      settlementReference: suppliedReference,
    };
  }

  return {
    ok: true,
    mode: "fixed",
    terms: withSettlementTime(terms, fixedSettlementTime(config, terms)),
  };
}

function fixedSettlementTime(
  config: PaymentConfig,
  terms: ResolvedPayableTerms,
): D402PaymentRequest["settlementTimeUnixSec"] {
  if (config.payment.settlementTimeUnixSec !== undefined) return String(config.payment.settlementTimeUnixSec) as `${bigint}`;
  const termTime = terms.settlementTimeUnixSec;
  if (termTime !== undefined) return termTime;
  throw new SettlementTimingConfigurationError(
    "settlementTimeUnixSec must be provided by payment.settlementWindow, payment.settlementTimeUnixSec, or terms.settlementTimeUnixSec",
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
  config: PaymentConfig,
  terms: PayableTerms,
): void {
  const termTime = terms.settlementTimeUnixSec;
  if (config.payment.settlementWindow !== undefined && config.payment.settlementTimeUnixSec !== undefined) {
    throw new SettlementTimingConfigurationError(
      "payment.settlementWindow and payment.settlementTimeUnixSec cannot both be set; choose one source of settlement timing",
    );
  }
  if (config.payment.settlementWindow !== undefined && termTime !== undefined) {
    throw new SettlementTimingConfigurationError(
      "payment.settlementWindow and terms.settlementTimeUnixSec cannot both be set; choose one source of settlement timing",
    );
  }
  if (config.payment.settlementTimeUnixSec !== undefined && termTime !== undefined) {
    throw new SettlementTimingConfigurationError(
      "payment.settlementTimeUnixSec and terms.settlementTimeUnixSec cannot both be set; choose one source of settlement timing",
    );
  }
  if (config.payment.settlementWindow !== undefined && (!Number.isInteger(config.payment.settlementWindow) || config.payment.settlementWindow < 0)) {
    throw new SettlementTimingConfigurationError(
      "payment.settlementWindow must be a non-negative integer",
    );
  }
}
