import type { D402CanonicalSalt } from "./constants.js";

export type Hex32 = `0x${string}`;
export type Address = `0x${string}`;
export type PaymentAddress = Address;
export type DecimalString = `${bigint}`;
export type D402Version = 0.3;

export interface D402Versioned {
  version: D402Version;
}

/**
 * Immutable block header fields used to reproduce protocol calculations.
 *
 * The containing payment terms identify the chain.
 */
export interface D402BlockReference {
  blockNumber: number;
  blockHash: Hex32;
  blockTimestampUnixSec: DecimalString;
}

export interface D402Agreement {
  id: string;
  hash?: Hex32;
  uri?: string;
}

export interface D402PaymentRequest extends D402Versioned {
  resource: string;
  method?: string;
  chainId: number;
  payeeAddress: Address;
  tokenAddress: Address | null;
  netAmount: DecimalString;
  settlementTimeUnixSec: DecimalString;
  agreement: D402Agreement;
  expiresAtUnixSec: number;
  paymentSalt?: D402CanonicalSalt;
}

export type D402PaymentRequiredReasonCode = "missing-proof";

export type D402PaymentRequiredReasonCategory =
  | "proof"
  | "request"
  | "chain"
  | "policy";

export interface D402PaymentRequiredReason {
  code: D402PaymentRequiredReasonCode;
  category: D402PaymentRequiredReasonCategory;
  retryable: boolean;
  message?: string;
}

export interface D402PaymentChallenge {
  paymentRequest: D402PaymentRequest;
  settlementReference?: D402BlockReference;
  reason: D402PaymentRequiredReason;
}

export interface DPaymentProof extends D402Versioned {
  paymentAddress: PaymentAddress;
  txHash: Hex32;
  paymentSalt: Hex32;
}

export interface D402PaymentProof {
  dPaymentProof: DPaymentProof;
  settlementReference?: D402BlockReference;
}

export interface D402PaymentActionResult {
  txHash: Hex32;
}

export type D402PaymentSaltValidation =
  | { ok: true }
  | { ok: false; reason: "payment-id-mismatch" };
