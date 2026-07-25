export type Hex32 = `0x${string}`;
export type Address = `0x${string}`;
export type PaymentAddress = Address;
export type DecimalString = `${bigint}`;
export type D402Version = 3;

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
}

export interface DPaymentProof extends D402Versioned {
  paymentAddress: PaymentAddress;
  txHash: Hex32;
  txNonce: DecimalString;
}

export interface D402PaymentProof {
  dPaymentProof: DPaymentProof;
  settlementReference?: D402BlockReference;
}

export type D402PaymentTerms = D402PaymentRequest;
